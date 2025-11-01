import { Server as IOServer } from "socket.io";
import Redis from "ioredis";
import type { GameDefinition } from "@dashanddots/shared";
import { getGame } from "../core/game-registry";

const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");
const roomKey = (id: string) => `room:${id}:state`;
export const occupancy = new Map<string, Map<string, string>>();

type RoomState = {
  gameId: string;
  players: string[];
  state: any;
  meta?: {
    colors?: Record<string, string>;
    chatEnabled?: boolean;
    owner?: string;
    locked?: boolean;
  };
};

export function attachSocket(httpServer: any) {
  const io = new IOServer(httpServer, { cors: { origin: "*" } });

  io.on("connection", (socket) => {
    socket.on("room.join", async ({ roomId, playerId }: { roomId: string; playerId: string }) => {

      if (!roomId || !playerId) return socket.emit("error", "Missing roomId or playerId");

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
      // ack?.({ ok: true });
      io.to(roomId).emit("chat.system", { text: `${playerId} joined`, at: Date.now() });
      const raw = await redis.get(roomKey(roomId));
      if (!raw) return socket.emit("error", "Room not found");
      const room: RoomState = JSON.parse(raw);
      if (room.meta?.locked) {
        // allow only if playerId is exactly an existing player in room.players
        if (!room.players.includes(playerId)) {
          socket.emit("error", "Room is locked");
          return;
        }
      }

      if (!room.players.includes(playerId)) {
        room.players.push(playerId);
        await redis.set(roomKey(roomId), JSON.stringify(room));
      }

      socket.emit("game.state", room.state);
      socket.to(roomId).emit("game.events", [{ type: "player-joined", payload: { playerId } }]);


      socket.on("game.move", async (payload: any) => {
        const raw2 = await redis.get(roomKey(roomId));
        if (!raw2) return socket.emit("error", "Room vanished");
        const cur: RoomState = JSON.parse(raw2);

        const game = getGame(cur.gameId) as GameDefinition;
        if (!game) return socket.emit("error", "Game not found");

        const who = cur.state.currentPlayer;
        const valid = game.validateMove(cur.state, payload, who);
        if (valid !== true) return socket.emit("error", valid);

        const applied = game.applyMove(cur.state, payload, who);
        cur.state = applied.state;
        await redis.set(roomKey(roomId), JSON.stringify(cur));

        io.to(roomId).emit("game.state", cur.state);
        if (applied.events?.length) io.to(roomId).emit("game.events", applied.events);
      });
    });

    socket.on("disconnect", () => {
      const { roomId, playerId } = socket.data || {};
      if (roomId && playerId) {
        const byPlayer = occupancy.get(roomId);
        if (byPlayer?.get(playerId) === socket.id) {
          byPlayer.delete(playerId);
        }
      }
    });

    socket.on(
      "chat.message",
      async (
        { text, roomId: rid }: { text: string; roomId?: string },
        ack?: (resp: { ok?: true; error?: string }) => void
      ) => {
        const roomId = (rid || socket.data.roomId || "").trim();
        const from = (socket.data?.playerId || "anon").toString();
        const t = String(text ?? "").trim();

        if (!roomId) { ack?.({ error: "Not joined to a room" }); return; }
        if (!t) { ack?.({ error: "Empty message" }); return; }

        // ⛔ Respect chatEnabled if you want enforcement on server
        const raw = await redis.get(roomKey(roomId));
        if (raw) {
          const room: RoomState = JSON.parse(raw);
          if (room?.meta?.chatEnabled === false) {
            ack?.({ error: "Chat is disabled for this room" });
            return;
          }
        }

        // ensure membership (race-safe)
        const r = socket.nsp.adapter.rooms.get(roomId);
        if (!r || !r.has(socket.id)) socket.join(roomId);

        io.to(roomId).emit("chat.message", { from, text: t.slice(0, 300), at: Date.now() });
        ack?.({ ok: true });
      }
    );



    socket.onAny((event, ...args) => {
      try {
        console.log(`[io:onAny] ${socket.id} event="${event}" args=`, JSON.stringify(args));
      } catch {
        console.log(`[io:onAny] ${socket.id} event="${event}" (args not JSON-serializable)`);
      }
    });


  });

  return io;
}
