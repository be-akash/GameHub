import Fastify from "fastify";

const app = Fastify({ logger: true });

app.get("/health", async () => ({ ok: true }));

const port = Number(process.env.PORT || 4001);
app.listen({ port, host: "0.0.0.0" }).then(() => {
  console.log(`HTTP listening on :${port}`);
});
