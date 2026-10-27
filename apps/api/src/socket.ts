import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "./db.js";
import { tableManager } from "./tableManager.js";
import { config } from "./config.js";

export function setupSocket(httpServer: HttpServer, app: FastifyInstance): Server {
  const io = new Server(httpServer, {
    cors: { origin: config.corsOrigin, credentials: true },
  });

  tableManager.onState((tableId, _userId, baseState) => {
    const room = `table:${tableId}`;
    // send personalized states to each socket in room
    for (const socket of io.sockets.adapter.rooms.get(room) ?? []) {
      const s = io.sockets.sockets.get(socket);
      const uid = s?.data.userId as string | undefined;
      const state = tableManager.getState(tableId, uid) ?? baseState;
      s?.emit("table:state", state);
    }
  });

  io.use(async (socket, next) => {
    try {
      const token =
        (socket.handshake.auth?.token as string | undefined) ||
        (socket.handshake.query?.token as string | undefined);
      if (!token) return next(new Error("Unauthorized"));
      const payload = app.jwt.verify<{ sub: string }>(token);
      const user = await prisma.user.findUnique({ where: { id: payload.sub } });
      if (!user?.whitelisted) return next(new Error("Forbidden"));
      socket.data.userId = user.id;
      socket.data.user = user;
      next();
    } catch {
      next(new Error("Unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    socket.on("table:subscribe", async (raw, ack) => {
      try {
        const { tableId } = z.object({ tableId: z.string() }).parse(raw);
        await tableManager.ensureLoaded(tableId);
        socket.join(`table:${tableId}`);
        socket.data.tableId = tableId;
        const state = tableManager.getState(tableId, socket.data.userId);
        socket.emit("table:state", state);
        if (typeof ack === "function") ack({ ok: true });
      } catch (e) {
        socket.emit("table:error", {
          message: e instanceof Error ? e.message : "subscribe failed",
        });
      }
    });

    socket.on("table:action", async (raw) => {
      try {
        const body = z
          .object({
            tableId: z.string().optional(),
            action: z.enum([
              "fold",
              "check",
              "call",
              "bet",
              "raise",
              "all-in",
            ]),
            amount: z.number().int().positive().optional(),
          })
          .parse(raw);
        const tableId = body.tableId ?? socket.data.tableId;
        if (!tableId) throw new Error("No table");
        await tableManager.action(tableId, socket.data.userId, {
          type: body.action,
          amount: body.amount,
        });
      } catch (e) {
        socket.emit("table:error", {
          message: e instanceof Error ? e.message : "action failed",
        });
      }
    });

    socket.on("chat:send", async (raw) => {
      try {
        const body = z
          .object({
            tableId: z.string().optional(),
            text: z.string().trim().min(1).max(500),
          })
          .parse(raw);
        const tableId = body.tableId ?? socket.data.tableId;
        if (!tableId) throw new Error("No table");
        const user = socket.data.user;
        const msg = await prisma.chatMessage.create({
          data: {
            tableId,
            userId: user.id,
            text: body.text,
          },
        });
        io.to(`table:${tableId}`).emit("chat:message", {
          id: msg.id,
          tableId,
          userId: user.id,
          name: user.name,
          avatarUrl: user.avatarUrl,
          text: msg.text,
          at: msg.createdAt.toISOString(),
        });
      } catch (e) {
        socket.emit("table:error", {
          message: e instanceof Error ? e.message : "chat failed",
        });
      }
    });

    socket.on("react:send", (raw) => {
      try {
        const body = z
          .object({
            tableId: z.string().optional(),
            emoji: z.string().min(1).max(8),
          })
          .parse(raw);
        const tableId = body.tableId ?? socket.data.tableId;
        if (!tableId) throw new Error("No table");
        const user = socket.data.user;
        io.to(`table:${tableId}`).emit("react:message", {
          userId: user.id,
          name: user.name,
          emoji: body.emoji,
          at: Date.now(),
        });
      } catch (e) {
        socket.emit("table:error", {
          message: e instanceof Error ? e.message : "react failed",
        });
      }
    });
  });

  return io;
}
