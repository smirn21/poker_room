import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import { config } from "./config.js";
import { registerRoutes } from "./routes.js";
import { setupSocket } from "./socket.js";
import { HttpError } from "./errors.js";

const app = Fastify({ logger: true });

const corsAllow = new Set(
  [
    config.corsOrigin,
    "https://kiosk-hedgehog22.eu.pythonanywhere.com",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
  ].filter(Boolean),
);
await app.register(cors, {
  origin: (origin, cb) => {
    // Non-browser / same-origin / Telegram WebView occasionally omits Origin
    if (!origin || corsAllow.has(origin)) {
      cb(null, true);
      return;
    }
    cb(null, false);
  },
  credentials: true,
  // Default @fastify/cors is GET,HEAD,POST only — browser blocks DELETE/PATCH
  // (admin delete table, host rename) as a failed fetch → "No connection to API".
  methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
});
await app.register(jwt, { secret: config.jwtSecret });

app.setErrorHandler((err, _req, reply) => {
  if (
    err instanceof HttpError ||
    (err &&
      typeof err === "object" &&
      "statusCode" in err &&
      typeof (err as HttpError).statusCode === "number" &&
      (err as HttpError).statusCode >= 400 &&
      (err as HttpError).statusCode < 600)
  ) {
    const status = (err as HttpError).statusCode;
    const message =
      err instanceof Error ? err.message : "Request failed";
    return reply.status(status).send({ error: message });
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
