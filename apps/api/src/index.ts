import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import { config } from "./config.js";
import { registerRoutes } from "./routes.js";
import { setupSocket } from "./socket.js";
import { HttpError } from "./errors.js";

const app = Fastify({ logger: true });

await app.register(cors, { origin: config.corsOrigin, credentials: true });
await app.register(jwt, { secret: config.jwtSecret });

app.setErrorHandler((err, _req, reply) => {
  if (err instanceof HttpError) {
    return reply.status(err.statusCode).send({ error: err.message });
  }
  if ((err as { validation?: unknown }).validation) {
    return reply.status(400).send({ error: "Validation error", details: err });
  }
  app.log.error(err);
  return reply.status(500).send({ error: "Internal Server Error" });
});

app.get("/health", async () => ({ ok: true }));

await registerRoutes(app);

await app.listen({ port: config.port, host: "0.0.0.0" });
setupSocket(app.server, app);

app.log.info(`API on :${config.port} (devBypass=${config.devBypassAuth})`);
