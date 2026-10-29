import { Readable } from "node:stream";
import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import { config } from "./config.js";
import { registerRoutes } from "./routes.js";
import { setupSocket } from "./socket.js";
import { HttpError } from "./errors.js";
import {
  markTronhooksError,
  processTronhooksEvent,
  tronhooksStatus,
  verifyTronhooksSignature,
  type TronhooksEvent,
} from "./tronhooks.js";

const app = Fastify({ logger: true });

type ReqWithRaw = { rawBody?: Buffer };

/** Preserve exact bytes for TronHooks HMAC (must run before JSON parse). */
app.addHook("preParsing", async (request, _reply, payload) => {
  if (
    request.method !== "POST" ||
    !request.url.startsWith("/webhooks/tronhooks")
  ) {
    return payload;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of payload) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks);
  (request as ReqWithRaw).rawBody = raw;
  return Readable.from(raw);
});

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

app.get("/health", async () => ({
  ok: true,
  tronhooks: tronhooksStatus(),
}));

app.post("/webhooks/tronhooks", async (req, reply) => {
  const raw = (req as ReqWithRaw).rawBody;
  if (!raw || !Buffer.isBuffer(raw)) {
    markTronhooksError("missing_raw_body");
    return reply.status(400).send({ error: "missing raw body" });
  }
  if (!config.tronhooksEnabled || !config.tronhooksWebhookSecret) {
    markTronhooksError("webhook_not_configured");
    return reply.status(503).send({ error: "TronHooks webhook not configured" });
  }
  const sig =
    (req.headers["x-signature"] as string | undefined) ??
    (req.headers["X-Signature"] as string | undefined);
  if (!verifyTronhooksSignature(raw, sig, config.tronhooksWebhookSecret)) {
    markTronhooksError("bad_signature");
    return reply.status(401).send({ error: "bad signature" });
  }

  let event: TronhooksEvent;
  try {
    event = JSON.parse(raw.toString("utf8")) as TronhooksEvent;
  } catch {
    return reply.status(400).send({ error: "invalid json" });
  }
  if (!event?.event_id || !event.tx_id || !event.amount_raw) {
    return reply.status(400).send({ error: "invalid event" });
  }

  try {
    const result = await processTronhooksEvent(event, app.log);
    return reply.status(200).send(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    markTronhooksError(msg);
    app.log.error({ err: msg }, "tronhooks_process_failed");
    return reply.status(500).send({ error: "process failed" });
  }
});

await registerRoutes(app);

await app.listen({ port: config.port, host: "0.0.0.0" });
setupSocket(app.server, app);

const { startTronWatcher } = await import("./tronWatcher.js");
startTronWatcher(app.log);

app.log.info(
  {
    tronhooks: tronhooksStatus(),
    trongridPoll: config.tronWatchEnabled,
  },
  `API on :${config.port} (devBypass=${config.devBypassAuth})`,
);
