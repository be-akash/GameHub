import Fastify from "fastify";
import cors from "@fastify/cors";
import { createServer } from "http";
import { registerRoutes } from "./http/routes";
import { attachSocket } from "./ws/socket";
import { Server } from "socket.io";
async function start() {
  const app = Fastify({ logger: true });

  await app.register(cors, {
    origin: (origin, cb) => cb(null, true), // dev only
    credentials: true,
  });

  await registerRoutes(app);

  const httpServer = createServer();
  attachSocket(httpServer);

  const wsPort = Number(process.env.PORT || 4001);
  const httpPort = wsPort + 1;

  httpServer.listen(wsPort, () => {
    console.log(`WS listening on :${wsPort}`);
  });

  await app.listen({ port: httpPort, host: "0.0.0.0" });
  console.log(`HTTP listening on :${httpPort}`);
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
