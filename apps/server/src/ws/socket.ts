import { Server as IOServer } from "socket.io";
import Redis from "ioredis";
import type { GameDefinition } from "@dashanddots/shared";
import { getGame } from "../core/game-registry";

const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");
const roomKey = (id: string) => `room:${id}:state`;

type RoomState = {
  gameId: string;
  players: string[];
  state: any;
};

export function attachSocket(httpServer: any) {
  const io = new IOServer(httpServer, { cors: { origin: "*" } });

  io.on("connection", (socket) => {
    socket.on("room.join", async ({ roomId, playerId }: { roomId: string; playerId: string }) => {
      if (!roomId || !playerId) return socket.emit("error", "Missing roomId or playerId");
      socket.join(roomId);

      const raw = await redis.get(roomKey(roomId));
      if (!raw) return socket.emit("error", "Room not found");
      const room: RoomState = JSON.parse(raw);

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
  });

  return io;
}
