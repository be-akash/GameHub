import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import Redis from "ioredis";
import { nanoid } from "nanoid";
import { getGame } from "../core/game-registry";

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
    const players = Array.isArray(body.players) && body.players.length >= 1 ? body.players.slice(0, 2) : ["p1", "p2"];
    const meta = typeof body.meta === "object" && body.meta ? body.meta : {}; // e.g. { colors: { "alex": "#ff0000", "maria": "#00ff00" } }

    const game = getGame(gameId);
    if (!game) return reply.code(400).send({ error: "Unknown gameId" });

    const roomId = nanoid(8);
    const initial = (game as any).createInitialState({ rows, cols, players });

    const room = { gameId, players, state: initial, meta };
    await redis.set(roomKey(roomId), JSON.stringify(room));

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
}
