// apps/server/src/index.ts
import Fastify from "fastify";
import cors from "@fastify/cors";
import { createServer } from "http";
import { registerRoutes } from "./http/routes";
import { attachSocket } from "./ws/socket";

const API_PORT = Number(process.env.API_PORT ?? 4002);
const WS_PORT = Number(process.env.WS_PORT ?? 4001);
const RENDER_PORT = process.env.PORT ? Number(process.env.PORT) : null; // Render supplies PORT
const CORS_ORIGIN = (process.env.CORS_ORIGIN ?? "http://localhost:3000")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

// Single-port when running on Render (PORT) or when SINGLE_PORT=1
const SINGLE_PORT = !!RENDER_PORT || process.env.SINGLE_PORT === "1";

async function start() {
  const app = Fastify({ logger: true });

  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      const ok = CORS_ORIGIN.includes(origin) || CORS_ORIGIN.includes("*");
      cb(ok ? null : new Error("CORS blocked"), ok);
    },
    credentials: true,
  });

  await registerRoutes(app);

  if (SINGLE_PORT) {
    // One port for both API + Socket.IO (Render)
    attachSocket(app.server);
    const port = RENDER_PORT ?? 10000;
    await app.listen({ port, host: "0.0.0.0" });
    app.log.info(`HTTP+WS listening on :${port}`);
  } else {
    // Dev: two ports
    const httpServer = createServer();
    attachSocket(httpServer);
    await new Promise<void>((resolve) => httpServer.listen(WS_PORT, resolve));
    console.log(`WS listening on :${WS_PORT}`);

    await app.listen({ port: API_PORT, host: "0.0.0.0" });
    console.log(`HTTP listening on :${API_PORT}`);
  }
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
