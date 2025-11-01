import Fastify from "fastify";
import cors from "@fastify/cors";
import { createServer } from "http";
import { registerRoutes } from "./http/routes";
import { attachSocket } from "./ws/socket";

// add near top
const API_PORT = Number(process.env.API_PORT ?? 4002);
const WS_PORT = Number(process.env.WS_PORT ?? 4001);
const CORS_ORIGIN = (process.env.CORS_ORIGIN ?? "http://localhost:3000").split(",");

async function start() {
  const app = Fastify({ logger: true });

  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // dev tools / curl
      const ok = CORS_ORIGIN.some((allowed) => origin === allowed);
      cb(ok ? null : new Error("CORS blocked"), ok);
    },
    credentials: true,
  });

  await registerRoutes(app);

  const httpServer = createServer();
  attachSocket(httpServer);

  // const wsPort = Number(process.env.PORT || 4001);
  // const httpPort = wsPort + 1;

  httpServer.listen(WS_PORT, () => {
    console.log(`WS listening on :${WS_PORT}`);
  });

  await app.listen({ port: API_PORT, host: "0.0.0.0" });
  console.log(`HTTP listening on :${API_PORT}`);
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
