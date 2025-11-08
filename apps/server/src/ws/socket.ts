// ws/socket.ts
import { Server as IOServer } from "socket.io";
import Redis from "ioredis";
import type { GameDefinition } from "@dashanddots/shared";
import { getGame } from "../core/game-registry.js";
import { undoLastMove as undoDots } from "../games/dots-and-boxes.js";

export const occupancy = new Map<string, Map<string, string>>();
export let ioRef: IOServer | null = null;

const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");
const roomKey = (id: string) => `room:${id}:state`;

// token bucket helpers unchanged…
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
    pendingUndo?: {
      requestedBy: string;
      targetRevision: number;
      expiresAt: number;
    };
  };
};

// ✅ Accept corsOrigins and (optionally) fastify app to expose io
export function attachSocket(
  httpServer: any,
  fastifyApp?: any
) {
  const io = new IOServer(httpServer, { cors: { origin: "*" } });
  ioRef = io;
  if (fastifyApp) (fastifyApp as any).io = io;

  io.on("connection", (socket) => {
    rate.set(socket.id, {
      chat: { tokens: 5, last: Date.now() },
      move: { tokens: 5, last: Date.now() },
    });

    // JOIN with ack
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

        if (room.meta?.locked && !room.players.includes(playerId)) {
          return ack?.({ error: "Room is locked" });
        }

        // single socket per name
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

    // ✅ Moves with ACK (invalid move → { error })
    socket.on(
      "game.move",
      async (payload: any, ack?: (resp: { ok?: true; error?: string }) => void) => {
        const respond = (r: { ok?: true; error?: string }) => { try { ack?.(r); } catch { } };

        // simple rate limit
        const b = rate.get(socket.id)!;
        refill(b.move, 2, 4);
        if (!take(b.move, 1)) return respond({ error: "Slow down (moves)" });

        try {
          const roomId = socket.data?.roomId as string | undefined;
          const player = socket.data?.playerId as string | undefined;
          if (!roomId || !player) return respond({ error: "Not in a room" });

          const raw = await redis.get(roomKey(roomId));
          if (!raw) return respond({ error: "Room vanished" });

          const cur: RoomState = JSON.parse(raw);
          const game = getGame(cur.gameId) as GameDefinition<any, any> | undefined; // 👈 avoid TS mismatch
          if (!game) return respond({ error: "Game not found" });

          const v = game.validateMove(cur.state, payload, player);
          if (v !== true) return respond({ error: String(v) });

          const applied = game.applyMove(cur.state, payload, player);
          cur.state = applied.state;

          await redis.set(roomKey(roomId), JSON.stringify(cur));
          await redis.expire(roomKey(roomId), 60 * 60 * 24);

          io.to(roomId).emit("game.state", cur.state);
          if (applied.events?.length) io.to(roomId).emit("game.events", applied.events);

          return respond({ ok: true });
        } catch (e) {
          console.error("[game.move] error", e);
          return respond({ error: "Move failed" });
        }
      }
    );

    // === UNDO: fast self-undo (still player's turn) ===
    socket.on(
      "game.undo",
      async (_payload: { expectedRevision: number }, ack?: (resp: { ok?: true; error?: string }) => void) => {
        // We don’t do fast self-undo anymore. Always require approval,
        // and only last mover can request it.
        const respond = (r: { ok?: true; error?: string }) => { try { ack?.(r); } catch { } };

        try {
          const roomId = socket.data?.roomId as string | undefined;
          const playerId = socket.data?.playerId as string | undefined;
          if (!roomId || !playerId) return respond({ error: "Not in a room" });

          const raw = await redis.get(roomKey(roomId));
          if (!raw) return respond({ error: "Room vanished" });
          const cur: RoomState = JSON.parse(raw);

          if (cur.gameId !== "dots-and-boxes") return respond({ error: "Undo not supported for this game" });
          const st = cur.state || {};
          const last = st.lastMove;

          if (!last || last.playerId !== playerId) {
            return respond({ error: "not_last_mover" });
          }

          // Reuse the same code path as "game.undo.request"
          const opponent = (st.players || []).find((p: string) => p !== playerId);
          if (!opponent) return respond({ error: "no_opponent" });

          cur.meta = cur.meta || {};
          cur.meta.pendingUndo = {
            requestedBy: playerId,
            targetRevision: st.revision ?? 0,
            expiresAt: Date.now() + 30_000, // or just Date.now() + 1 if you don't want timers; server won’t enforce
          };

          await redis.set(roomKey(roomId), JSON.stringify(cur));
          await redis.expire(roomKey(roomId), 60 * 60 * 24);

          io.to(roomId).emit("undo.request", { from: playerId, expiresAt: cur.meta.pendingUndo.expiresAt });
          io.to(roomId).emit("chat.system", { text: `${playerId} requested an undo`, at: Date.now() });

          return respond({ ok: true });
        } catch (e) {
          console.error("[game.undo] error", e);
          return respond({ error: "Undo failed" });
        }
      }
    );


    // === UNDO: request approval (opponent must approve) ===
    socket.on(
      "game.undo.request",
      async (payload: { expectedRevision: number }, ack?: (resp: { ok?: true; error?: string }) => void) => {
        const respond = (r: { ok?: true; error?: string }) => { try { ack?.(r); } catch { } };
        try {
          const roomId = socket.data?.roomId as string | undefined;
          const playerId = socket.data?.playerId as string | undefined;
          if (!roomId || !playerId) return respond({ error: "Not in a room" });

          const raw = await redis.get(roomKey(roomId));
          if (!raw) return respond({ error: "Room vanished" });
          const cur: RoomState = JSON.parse(raw);

          if (cur.gameId !== "dots-and-boxes") return respond({ error: "Undo not supported for this game" });

          const expectedRevision = payload?.expectedRevision ?? -1;
          const st = cur.state || {};
          if (typeof st.revision !== "number") return respond({ error: "State missing revision" });
          if (expectedRevision !== st.revision) return respond({ error: "out_of_date" });

          const opponent = (st.players || []).find((p: string) => p !== playerId);
          if (!opponent) return respond({ error: "no_opponent" });

          // Store pending request in room meta
          cur.meta = cur.meta || {};
          cur.meta.pendingUndo = {
            requestedBy: playerId,
            targetRevision: st.revision,
            expiresAt: Date.now() + 30_000, // 30s
          };

          const last = st.lastMove;
          if (!last || last.playerId !== playerId) {
            return respond({ error: "not_last_mover" });
          }


          await redis.set(roomKey(roomId), JSON.stringify(cur));
          await redis.expire(roomKey(roomId), 60 * 60 * 24);

          io.to(roomId).emit("undo.request", { from: playerId, expiresAt: cur.meta.pendingUndo.expiresAt });
          io.to(roomId).emit("chat.system", { text: `${playerId} requested an undo`, at: Date.now() });
          return respond({ ok: true });
        } catch (e) {
          console.error("[game.undo.request] error", e);
          return respond({ error: "Request failed" });
        }
      }
    );

    // === UNDO: approval response ===
    socket.on(
      "game.undo.respond",
      async (payload: { approve: boolean }, ack?: (resp: { ok?: true; error?: string }) => void) => {
        const respond = (r: { ok?: true; error?: string }) => { try { ack?.(r); } catch { } };
        try {
          const roomId = socket.data?.roomId as string | undefined;
          const playerId = socket.data?.playerId as string | undefined;
          if (!roomId || !playerId) return respond({ error: "Not in a room" });

          const raw = await redis.get(roomKey(roomId));
          if (!raw) return respond({ error: "Room vanished" });
          const cur: RoomState = JSON.parse(raw);

          const meta = cur.meta || {};
          const pending = meta.pendingUndo;
          if (!pending) return respond({ error: "no_pending_request" });
          if (Date.now() > pending.expiresAt) {
            meta.pendingUndo = undefined;
            cur.meta = meta;
            await redis.set(roomKey(roomId), JSON.stringify(cur));
            await redis.expire(roomKey(roomId), 60 * 60 * 24);
            return respond({ error: "expired" });
          }
          if (playerId === pending.requestedBy) {
            return respond({ error: "not_authorized" });
          }

          if (!payload?.approve) {
            meta.pendingUndo = undefined;
            cur.meta = meta;
            await redis.set(roomKey(roomId), JSON.stringify(cur));
            await redis.expire(roomKey(roomId), 60 * 60 * 24);

            io.to(roomId).emit("undo.result", { approved: false, by: playerId });
            io.to(roomId).emit("chat.system", { text: `${playerId} rejected the undo request`, at: Date.now() });
            return respond({ ok: true });
          }

          // Approved → do the undo
          if (cur.gameId !== "dots-and-boxes") return respond({ error: "Undo not supported for this game" });
          undoDots(cur.state, 1);
          meta.pendingUndo = undefined;
          cur.meta = meta;

          await redis.set(roomKey(roomId), JSON.stringify(cur));
          await redis.expire(roomKey(roomId), 60 * 60 * 24);

          io.to(roomId).emit("game.state", cur.state);
          io.to(roomId).emit("undo.result", { approved: true, by: playerId });
          io.to(roomId).emit("chat.system", { text: `${playerId} approved the undo`, at: Date.now() });
          return respond({ ok: true });
        } catch (e) {
          console.error("[game.undo.respond] error", e);
          return respond({ error: "Respond failed" });
        }
      }
    );


    // Chat (respects meta.chatEnabled) with ACK
    socket.on(
      "chat.message",
      async (
        { text, roomId: rid }: { text: string; roomId?: string },
        ack?: (resp: { ok?: true; error?: string }) => void
      ) => {
        const respond = (r: { ok?: true; error?: string }) => { try { ack?.(r); } catch { } };

        const b = rate.get(socket.id)!;
        refill(b.chat, 2, 5);
        if (!take(b.chat, 1)) return respond({ error: "Slow down (chat)" });

        const roomId = (rid || socket.data.roomId || "").trim();
        const from = (socket.data?.playerId || "anon").toString();
        const t = String(text ?? "").trim();

        if (!roomId) return respond({ error: "Not joined to a room" });
        if (!t) return respond({ error: "Empty message" });

        const raw = await redis.get(roomKey(roomId));
        if (raw) {
          const room: RoomState = JSON.parse(raw);
          if (room?.meta?.chatEnabled === false) {
            return respond({ error: "Chat is disabled for this room" });
          }
        }

        const room = socket.nsp.adapter.rooms.get(roomId);
        if (!room || !room.has(socket.id)) socket.join(roomId);

        io.to(roomId).emit("chat.message", { from, text: t.slice(0, 300), at: Date.now() });
        return respond({ ok: true });
      }
    );

    // ✅ single disconnect handler (you had it twice)
    socket.on("disconnect", () => {
      rate.delete(socket.id);
      const { roomId, playerId } = socket.data || {};
      if (roomId && playerId) {
        const byPlayer = occupancy.get(roomId);
        if (byPlayer?.get(playerId) === socket.id) byPlayer.delete(playerId);
      }
    });
  });

  return io;
}
