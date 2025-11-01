// ADD/EDIT at top
import { Server as IOServer } from "socket.io";
import Redis from "ioredis";
import type { GameDefinition } from "@dashanddots/shared";
import { getGame } from "../core/game-registry";

export const occupancy = new Map<string, Map<string, string>>(); // export so routes can read it
export let ioRef: IOServer | null = null; // exported handle for routes as fallback

const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");
const roomKey = (id: string) => `room:${id}:state`;

const rate = new Map<string, { chat: { tokens: number, last: number }, move: { tokens: number, last: number } }>();
const refill = (b: { tokens: number, last: number }, rps: number, cap: number) => {
  const now = Date.now();
  const delta = (now - b.last) / 1000;
  b.tokens = Math.min(cap, b.tokens + delta * rps);
  b.last = now;
};
const take = (b: { tokens: number, last: number }, cost = 1) => {
  if (b.tokens >= cost) { b.tokens -= cost; return true; }
  return false;
};

type RoomState = {
  gameId: string;
  players: string[];
  state: any;
  meta?: {
    colors?: Record<string, string>;
    chatEnabled?: boolean;
    locked?: boolean;
    owner?: string;
  };
};

// Accept fastify instance to decorate with io
export function attachSocket(httpServer: any, fastifyApp?: any) {
  const io = new IOServer(httpServer, { cors: { origin: "*" } });
  ioRef = io;
  if (fastifyApp) fastifyApp.io = io; // <-- make available to routes

  io.on("connection", (socket) => {
    rate.set(socket.id, { chat: { tokens: 5, last: Date.now() }, move: { tokens: 5, last: Date.now() } });
    // JOIN with ack so we can reject if locked
    socket.on(
      "room.join",
      async (
        { roomId, playerId }: { roomId: string; playerId: string },
        ack?: (resp: { ok?: true; error?: string }) => void
      ) => {
        if (!roomId || !playerId) return ack?.({ error: "Missing roomId or playerId" });

        const raw = await redis.get(roomKey(roomId));
        if (!raw) return ack?.({ error: "Room not found" });
        const room: RoomState = JSON.parse(raw);

        // enforce lock: only existing players can join
        if (room.meta?.locked && !room.players.includes(playerId)) {
          return ack?.({ error: "Room is locked" });
        }

        // single-holder policy per name
        const byPlayer = occupancy.get(roomId) || new Map<string, string>();
        const holder = byPlayer.get(playerId);
        if (holder && holder !== socket.id) {
          const old = io.sockets.sockets.get(holder);
          old?.leave(roomId);
          old?.emit("room.kicked", { reason: "Name taken by new connection" });
          old?.disconnect(true);
        }
        byPlayer.set(playerId, socket.id);
        occupancy.set(roomId, byPlayer);

        socket.data.roomId = roomId;
        socket.data.playerId = playerId;
        socket.join(roomId);

        if (!room.players.includes(playerId)) {
          room.players.push(playerId);
          await redis.set(roomKey(roomId), JSON.stringify(room));
          await redis.expire(roomKey(roomId), 60 * 60 * 24);
        }

        socket.emit("game.state", room.state);
        socket.to(roomId).emit("game.events", [{ type: "player-joined", payload: { playerId } }]);
        io.to(roomId).emit("chat.system", { text: `${playerId} joined`, at: Date.now() });
        return ack?.({ ok: true });
      }
    );

    // Moves now use ACK to return validation errors
    // apps/server/src/ws/socket.ts
    socket.on(
      "game.move",
      async (
        payload: any,
        ack?: (resp: { ok?: true; error?: string }) => void
      ) => {

        const b = rate.get(socket.id)!;
        refill(b.move, 2, 4);
        if (!take(b.move, 1)) return ack?.({ error: "Slow down (moves)" });
        // helper so we never forget to respond
        const respond = (r: { ok?: true; error?: string }) => {
          try { ack?.(r); } catch { }
        };

        try {
          const roomId = socket.data?.roomId as string | undefined;
          const player = socket.data?.playerId as string | undefined;

          if (!roomId || !player) return respond({ error: "Not in a room" });

          const raw = await redis.get(roomKey(roomId));
          if (!raw) return respond({ error: "Room vanished" });

          const cur: RoomState = JSON.parse(raw);
          const game = getGame(cur.gameId) as GameDefinition | undefined;
          if (!game) return respond({ error: "Game not found" });

          // validate against the actual player on this socket
          const v = game.validateMove(cur.state, payload, player);
          if (v !== true) return respond({ error: String(v) });

          // apply
          const applied = game.applyMove(cur.state, payload, player);
          cur.state = applied.state;

          await redis.set(roomKey(roomId), JSON.stringify(cur));
          await redis.expire(roomKey(roomId), 60 * 60 * 24);

          // broadcast new state/events
          io.to(roomId).emit("game.state", cur.state);
          if (applied.events?.length) io.to(roomId).emit("game.events", applied.events);

          return respond({ ok: true });
        } catch (e: any) {
          console.error("[game.move] error", e);
          return respond({ error: "Move failed" });
        }
      }
    );


    // Chat (respects meta.chatEnabled)
    socket.on(
      "chat.message",
      async (
        { text, roomId: rid }: { text: string; roomId?: string },
        ack?: (resp: { ok?: true; error?: string }) => void
      ) => {
        const b = rate.get(socket.id)!;
        refill(b.chat, 2, 5);
        if (!take(b.chat, 1)) return ack?.({ error: "Slow down (chat)" });
        const roomId = (rid || socket.data.roomId || "").trim();
        const from = (socket.data?.playerId || "anon").toString();
        const t = String(text ?? "").trim();
        if (!roomId) return ack?.({ error: "Not joined to a room" });
        if (!t) return ack?.({ error: "Empty message" });

        const raw = await redis.get(roomKey(roomId));
        if (raw) {
          const room: RoomState = JSON.parse(raw);
          if (room?.meta?.chatEnabled === false) {
            return ack?.({ error: "Chat is disabled for this room" });
          }
        }
        const room = socket.nsp.adapter.rooms.get(roomId);
        if (!room || !room.has(socket.id)) socket.join(roomId);

        io.to(roomId).emit("chat.message", { from, text: t.slice(0, 300), at: Date.now() });
        return ack?.({ ok: true });
      }
    );
    socket.on("disconnect", () => rate.delete(socket.id));

    socket.on("disconnect", () => {
      const { roomId, playerId } = socket.data || {};
      if (roomId && playerId) {
        const byPlayer = occupancy.get(roomId);
        if (byPlayer?.get(playerId) === socket.id) byPlayer.delete(playerId);
      }
    });
  });

  return io;
}
