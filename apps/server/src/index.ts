import Fastify, { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { createServer } from "http";
import { registerRoutes } from "./http/routes.js";
import { attachSocket } from "./ws/socket.js";

// ── Env ────────────────────────────────────────────────────────────────────────
const PORT = Number(process.env.PORT ?? 0);        // Render supplies this
const API_PORT = Number(process.env.API_PORT ?? 4002); // local dev API port
const WS_PORT = Number(process.env.WS_PORT ?? 4001);  // local dev WS port
const CORS_ORIGIN = (process.env.CORS_ORIGIN ?? "http://localhost:3000")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

// ── Start ──────────────────────────────────────────────────────────────────────
async function start() {
  const app: FastifyInstance = Fastify({ logger: true });

  // CORS: keep it simple & typed
  // @fastify/cors for Fastify v5 expects origin: boolean | string | RegExp | (string|RegExp)[] | function
  await app.register(cors, {
    origin: (origin, cb) => {
      // Allow tools/curl
      if (!origin) return cb(null, true);
      // Allow if matches the allowlist
      const allowed =
        CORS_ORIGIN.length === 0 || CORS_ORIGIN.includes(origin);
      cb(allowed ? null : new Error("CORS blocked"), allowed);
    },
    credentials: true,
  } as any); // cast avoids TS noise across plugin signature variants

  // HTTP routes
  await registerRoutes(app);

  if (PORT) {
    // ── Single-port mode (Render or local when you set PORT) ──
    // Fastify already has an http.Server at app.server → attach Socket.IO to it
    attachSocket(app.server, app);
    await app.listen({ port: PORT, host: "0.0.0.0" });
    app.log.info(`HTTP+WS listening on :${PORT} (single-port mode)`);
  } else {
    // ── Two-port local dev ──
    // 1) API
    await app.listen({ port: API_PORT, host: "0.0.0.0" });
    app.log.info(`HTTP listening on :${API_PORT}`);

    // 2) WS
    const wsServer = createServer(); // pure WS server (no request handler)
    attachSocket(wsServer, app);
    wsServer.listen(WS_PORT, () => {
      console.log(`WS listening on :${WS_PORT}`);
    });
  }
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
