import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import Redis from "ioredis";
import { nanoid } from "nanoid";
import { getGame } from "../core/game-registry";
import { occupancy } from "../ws/socket";
import type { Server as IOServer } from "socket.io";

const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");
const roomKey = (id: string) => `room:${id}:state`;

export async function registerRoutes(app: FastifyInstance) {
  app.get("/health", async () => ({ ok: true }));

  app.post("/rooms", async (req: FastifyRequest, reply: FastifyReply) => {

    const body = (req.body ?? {}) as any;
    const gameId: string = body.gameId || "dots-and-boxes";



    // allow client to send any players (names), colors meta, and size between 5..40
    const rows = Math.max(5, Math.min(40, Number(body.rows ?? 5)));
    const cols = Math.max(5, Math.min(40, Number(body.cols ?? 5)));
    const players =
      Array.isArray(body.players) && body.players.length >= 1
        ? body.players.slice(0, 2)
        : ["p1", "p2"];

    // ✅ Extract meta safely
    const owner = (body.owner as string) || players[0];
    const meta = typeof body.meta === "object" && body.meta ? body.meta : {};
    meta.owner = owner;
    meta.locked = Boolean(body.locked) || false;

    // ✅ Default chatEnabled if missing (true = on by default)
    if (typeof meta.chatEnabled === "undefined") {
      meta.chatEnabled = true;
    }



    const game = getGame(gameId);
    if (!game) return reply.code(400).send({ error: "Unknown gameId" });

    const roomId = nanoid(8);
    const initial = (game as any).createInitialState({ rows, cols, players });

    // ✅ Include chatEnabled in meta
    const room = { gameId, players, state: initial, meta };

    await redis.set(roomKey(roomId), JSON.stringify(room));

    // ✅ Send meta info back (optional)
    return reply.send({ roomId, gameId });
  });


  app.get("/rooms/:id", async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as any;
    const raw = await redis.get(roomKey(id));
    if (!raw) return reply.code(404).send({ error: "Room not found" });
    return reply.send(JSON.parse(raw));
  });

  app.get("/games", async (_req: FastifyRequest, reply: FastifyReply) => {
    return reply.send([{ id: "dots-and-boxes", name: "Dots & Boxes" }]);
  });

  app.post("/debug/chat/:roomId", async (req, reply) => {
    const { roomId } = req.params as any;
    const { text = "hello from server", from = "server" } = (req.body ?? {}) as any;

    // IMPORTANT: import the Socket.IO server where you created it
    // If you export 'io' from ws/socket.ts when you call attachSocket(httpServer),
    // make sure to import it here, or pass 'io' into route factories.
    // If 'io' is not directly available here, move this endpoint into the same module as 'io'.

    // Example if you stored io on fastify instance:
    // const io = (app as any).io as IOServer;

    (app as any).io.to(roomId).emit("chat.message", { from, text, at: Date.now() });
    return reply.send({ ok: true });
  });

  app.post("/rooms/:id/lock", async (req, reply) => {
    const { id } = req.params as any;
    const { by, locked } = (req.body ?? {}) as { by: string; locked: boolean };
    const raw = await redis.get(roomKey(id));
    if (!raw) return reply.code(404).send({ error: "Room not found" });
    const room = JSON.parse(raw);
    if (room.meta?.owner !== by) return reply.code(403).send({ error: "Only owner can lock" });
    room.meta.locked = !!locked;
    await redis.set(roomKey(id), JSON.stringify(room));
    return reply.send({ ok: true, locked: room.meta.locked });
  });

  app.post("/rooms/:id/kick", async (req, reply) => {
    const { id } = req.params as any;
    const { by, target } = (req.body ?? {}) as { by: string; target: string };
    const raw = await redis.get(roomKey(id));
    if (!raw) return reply.code(404).send({ error: "Room not found" });
    const room = JSON.parse(raw);
    if (room.meta?.owner !== by) return reply.code(403).send({ error: "Only owner can kick" });

    const byPlayer = occupancy.get(id);
    const holder = byPlayer?.get(target);
    if (holder) {
      const sock = io.sockets.sockets.get(holder);
      sock?.emit("room.kicked", { reason: "Removed by owner" });
      sock?.leave(id);
      sock?.disconnect(true);
      byPlayer?.delete(target);
    }
    return reply.send({ ok: true });
  });


}
