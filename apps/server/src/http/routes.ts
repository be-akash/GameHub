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
    const rows = Number(body.rows ?? 5);
    const cols = Number(body.cols ?? 5);
    const players = (body.players ?? []) as string[];

    const game = getGame(gameId);
    if (!game) return reply.code(400).send({ error: "Unknown gameId" });

    const roomId = nanoid(8);
    const initial = (game as any).createInitialState({ rows, cols, players });

    const room = { gameId, players, state: initial };
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
