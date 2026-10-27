import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { validateInitData } from "./telegramAuth.js";
import { tableManager } from "./tableManager.js";
import { httpError } from "./errors.js";
import type { UserDTO } from "@poker/shared";

function toUserDTO(u: {
  id: string;
  telegramId: string;
  name: string;
  username: string | null;
  avatarUrl: string | null;
  balance: number;
  role: string;
  whitelisted: boolean;
}): UserDTO {
  return {
    id: u.id,
    telegramId: u.telegramId,
    name: u.name,
    username: u.username,
    avatarUrl: u.avatarUrl,
    balance: u.balance,
    role: u.role === "admin" ? "admin" : "user",
    whitelisted: u.whitelisted,
  };
}

async function requireUser(app: FastifyInstance, request: { headers: { authorization?: string } }) {
  const auth = request.headers.authorization;
  if (!auth?.startsWith("Bearer ")) throw httpError.unauthorized();
  const payload = await app.jwt.verify<{ sub: string }>(auth.slice(7));
  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user) throw httpError.unauthorized();
  return user;
}

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.post("/auth/telegram", async (req, reply) => {
    const body = z.object({ initData: z.string().min(1) }).parse(req.body);
    let tg;
    try {
      tg = validateInitData(body.initData);
    } catch (e) {
      // Reply directly — avoids HttpError instanceof issues across builds
      // and maps invalid/missing Telegram hash to 401 (not 500).
      return reply.status(401).send({
        error: e instanceof Error ? e.message : "Invalid Telegram auth",
      });
    }
    const telegramId = String(tg.id);
    const isAdmin = config.adminTelegramIds.includes(telegramId);
    const name = [tg.first_name, tg.last_name].filter(Boolean).join(" ");

    let user = await prisma.user.findUnique({ where: { telegramId } });
    if (!user) {
      user = await prisma.user.create({
        data: {
          telegramId,
          name,
          username: tg.username ?? null,
          avatarUrl: tg.photo_url ?? null,
          role: isAdmin ? "admin" : "user",
          whitelisted: isAdmin,
          balance: isAdmin ? config.signupBonus : 0,
        },
      });
      if (isAdmin) {
        await prisma.ledgerEntry.create({
          data: {
            userId: user.id,
            kind: "signup_bonus",
            amount: config.signupBonus,
          },
        });
      }
    } else {
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          name,
          username: tg.username ?? null,
          avatarUrl: tg.photo_url ?? user.avatarUrl,
          role: isAdmin ? "admin" : user.role,
          whitelisted: isAdmin ? true : user.whitelisted,
        },
      });
    }

    const token = await reply.jwtSign(
      { sub: user.id },
      { expiresIn: "7d" },
    );
    return { token, user: toUserDTO(user) };
  });

  app.post("/auth/invite", async (req, reply) => {
    const user = await requireUser(app, req);
    const body = z.object({ code: z.string().min(3) }).parse(req.body);
    if (user.whitelisted) {
      return { user: toUserDTO(user) };
    }

    const invite = await prisma.invite.findUnique({
      where: { code: body.code.trim().toUpperCase() },
    });
    if (!invite) throw httpError.badRequest("Invalid invite");
    if (invite.expiresAt && invite.expiresAt < new Date()) {
      throw httpError.badRequest("Invite expired");
    }
    if (invite.uses >= invite.maxUses) {
      throw httpError.badRequest("Invite exhausted");
    }

    const updated = await prisma.$transaction(async (tx) => {
      await tx.invite.update({
        where: { id: invite.id },
        data: { uses: { increment: 1 } },
      });
      const u = await tx.user.update({
        where: { id: user.id },
        data: {
          whitelisted: true,
          balance: { increment: config.signupBonus },
        },
      });
      await tx.ledgerEntry.create({
        data: {
          userId: u.id,
          kind: "signup_bonus",
          amount: config.signupBonus,
          meta: JSON.stringify({ invite: invite.code }),
        },
      });
      return u;
    });

    return { user: toUserDTO(updated) };
  });

  app.get("/me", async (req) => {
    const user = await requireUser(app, req);
    return { user: toUserDTO(user) };
  });

  app.get("/tables", async (req) => {
    const user = await requireUser(app, req);
    if (!user.whitelisted) throw httpError.forbidden("Not whitelisted");
    const tables = await prisma.pokerTable.findMany({
      where: { status: "open" },
      include: { seats: true },
      orderBy: { createdAt: "desc" },
    });
    return {
      tables: tables.map((t) => ({
        id: t.id,
        name: t.name,
        smallBlind: t.smallBlind,
        bigBlind: t.bigBlind,
        rakePercent: t.rakePercent,
        rakeCapBb: t.rakeCapBb,
        maxSeats: t.maxSeats,
        seated: t.seats.length,
      })),
    };
  });

  app.post("/tables", async (req) => {
    const user = await requireUser(app, req);
    if (!user.whitelisted) throw httpError.forbidden("Not whitelisted");
    const body = z
      .object({
        name: z.string().min(1).max(40).default("Hold'em"),
        smallBlind: z.number().int().positive().default(50),
        bigBlind: z.number().int().positive().default(100),
        /** Pot rake % → owner. Scales with pot / stakes */
        rakePercent: z.number().int().min(0).max(20).default(5),
        /** Cap in big blinds (e.g. 3 → max 3×BB per hand) */
        rakeCapBb: z.number().int().min(0).max(20).default(3),
        maxSeats: z.number().int().min(2).max(9).default(6),
      })
      .parse(req.body);

    if (body.bigBlind < body.smallBlind * 2) {
      throw httpError.badRequest("bigBlind should be >= 2 * smallBlind");
    }

    const table = await prisma.pokerTable.create({
      data: {
        name: body.name,
        smallBlind: body.smallBlind,
        bigBlind: body.bigBlind,
        rakePercent: body.rakePercent,
        rakeCapBb: body.rakeCapBb,
        maxSeats: body.maxSeats,
        createdById: user.id,
      },
    });
    await tableManager.ensureLoaded(table.id);
    return { table };
  });

  app.post("/tables/:id/join", async (req) => {
    const user = await requireUser(app, req);
    if (!user.whitelisted) throw httpError.forbidden("Not whitelisted");
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = z
      .object({
        buyIn: z.number().int().positive(),
        seatIndex: z.number().int().min(0).max(8).optional(),
      })
      .parse(req.body);

    const table = await prisma.pokerTable.findUniqueOrThrow({
      where: { id },
      include: { seats: true },
    });
    if (table.status !== "open") throw httpError.badRequest("Table closed");

    const existing = table.seats.find((s) => s.userId === user.id);
    if (existing) {
      await tableManager.ensureLoaded(id);
      const fresh = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      return {
        seatIndex: existing.seatIndex,
        user: toUserDTO(fresh),
        state: tableManager.getState(id, user.id),
        reentered: true,
      };
    }

    if (user.balance < body.buyIn) {
      throw httpError.badRequest("Insufficient balance");
    }

    const taken = new Set(table.seats.map((s) => s.seatIndex));
    let seatIndex = body.seatIndex;
    if (seatIndex === undefined || taken.has(seatIndex)) {
      seatIndex = [...Array(table.maxSeats).keys()].find((i) => !taken.has(i));
    }
    if (seatIndex === undefined) throw httpError.badRequest("Table full");

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { balance: { decrement: body.buyIn } },
      });
      await tx.ledgerEntry.create({
        data: {
          userId: user.id,
          kind: "buy_in",
          amount: -body.buyIn,
          meta: JSON.stringify({ tableId: id }),
        },
      });
      await tx.tableSeat.create({
        data: {
          tableId: id,
          userId: user.id,
          seatIndex,
          stack: body.buyIn,
        },
      });
    });

    await tableManager.withTable(id, (engine) => {
      if (!engine.seats.some((s) => s.player?.userId === user.id)) {
        engine.sit(seatIndex, {
          userId: user.id,
          name: user.name,
          avatarUrl: user.avatarUrl,
          stack: body.buyIn,
          sittingOut: false,
        });
      }
      // Do not auto-deal on join — host starts when ready (avoids HU deal before 3rd sits)
    });

    const fresh = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    return {
      seatIndex,
      user: toUserDTO(fresh),
      state: tableManager.getState(id, user.id),
    };
  });

  app.post("/tables/:id/leave", async (req) => {
    const user = await requireUser(app, req);
    const { id } = z.object({ id: z.string() }).parse(req.params);

    const seat = await prisma.tableSeat.findUnique({
      where: { tableId_userId: { tableId: id, userId: user.id } },
    });
    if (!seat) throw httpError.badRequest("Not seated");

    let cashOut = seat.stack;
    await tableManager.withTable(id, (engine) => {
      if (engine.status === "playing") {
        throw httpError.badRequest("Finish the hand first");
      }
      const left = engine.leave(user.id);
      cashOut = left?.stack ?? seat.stack;
      tableManager.clearRebuy(id, user.id);
    });

    await prisma.$transaction(async (tx) => {
      await tx.tableSeat.delete({ where: { id: seat.id } });
      await tx.user.update({
        where: { id: user.id },
        data: { balance: { increment: cashOut } },
      });
      await tx.ledgerEntry.create({
        data: {
          userId: user.id,
          kind: "cash_out",
          amount: cashOut,
          meta: JSON.stringify({ tableId: id }),
        },
      });
    });

    await tableManager.maybeTransferHost(id);

    const fresh = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    return { user: toUserDTO(fresh) };
  });

  /** Top-up stack at table after bust (or voluntary rebuy between hands). */
  app.post("/tables/:id/rebuy", async (req) => {
    const user = await requireUser(app, req);
    if (!user.whitelisted) throw httpError.forbidden("Not whitelisted");
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = z
      .object({ buyIn: z.number().int().positive() })
      .parse(req.body);

    const seat = await prisma.tableSeat.findUnique({
      where: { tableId_userId: { tableId: id, userId: user.id } },
    });
    if (!seat) throw httpError.badRequest("Not seated");
    if (user.balance < body.buyIn) {
      throw httpError.badRequest("Insufficient balance");
    }

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { balance: { decrement: body.buyIn } },
      });
      await tx.ledgerEntry.create({
        data: {
          userId: user.id,
          kind: "buy_in",
          amount: -body.buyIn,
          meta: JSON.stringify({ tableId: id, rebuy: true }),
        },
      });
      await tx.tableSeat.update({
        where: { id: seat.id },
        data: {
          stack: { increment: body.buyIn },
          sittingOut: false,
        },
      });
    });

    await tableManager.withTable(id, (engine) => {
      engine.addStack(user.id, body.buyIn);
      tableManager.clearRebuy(id, user.id);
    });
    await tableManager.maybeTransferHost(id);

    const fresh = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    return {
      user: toUserDTO(fresh),
      state: tableManager.getState(id, user.id),
    };
  });

  app.post("/tables/:id/next-hand", async (req) => {
    const user = await requireUser(app, req);
    if (!user.whitelisted) throw httpError.forbidden();
    const { id } = z.object({ id: z.string() }).parse(req.params);
    await tableManager.nextHand(id);
    return { state: tableManager.getState(id, user.id) };
  });

  app.post("/tables/:id/start", async (req) => {
    const user = await requireUser(app, req);
    if (!user.whitelisted) throw httpError.forbidden();
    const { id } = z.object({ id: z.string() }).parse(req.params);
    await tableManager.startIfPossible(id);
    const state = tableManager.getState(id, user.id);
    if (!state || state.status === "waiting") {
      throw httpError.badRequest("Need at least 2 seated players");
    }
    return { state };
  });

  app.get("/wallet/ledger", async (req) => {
    const user = await requireUser(app, req);
    const entries = await prisma.ledgerEntry.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return { entries };
  });

  app.post("/wallet/deposit", async (req) => {
    const user = await requireUser(app, req);
    if (!user.whitelisted) throw httpError.forbidden();
    const body = z
      .object({
        amountChips: z.number().int().positive().max(1_000_000),
        asset: z.enum(["USDT", "TON"]).default("USDT"),
      })
      .parse(req.body);

    const intent = await prisma.depositIntent.create({
      data: {
        userId: user.id,
        amountChips: body.amountChips,
        asset: body.asset,
        externalRef: `MANUAL-${randomBytes(4).toString("hex")}`,
      },
    });

    return {
      intent,
      instructions: {
        note: "MVP: send crypto to club wallet, then ask admin to confirm this intent.",
        reference: intent.externalRef,
        amountChips: intent.amountChips,
        asset: intent.asset,
      },
    };
  });

  app.get("/wallet/deposits", async (req) => {
    const user = await requireUser(app, req);
    const deposits = await prisma.depositIntent.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    return { deposits };
  });

  /** Rake income for room owner */
  app.get("/admin/house", async (req) => {
    const user = await requireUser(app, req);
    if (user.role !== "admin") throw httpError.forbidden();

    const house = await prisma.user.findFirst({
      where: { role: "admin" },
      orderBy: { createdAt: "asc" },
    });
    const kinds = ["rake_income", "house_fee_income"];
    const entries = await prisma.ledgerEntry.findMany({
      where: { kind: { in: kinds } },
      orderBy: { createdAt: "desc" },
      take: 30,
    });
    const agg = await prisma.ledgerEntry.aggregate({
      where: { kind: { in: kinds } },
      _sum: { amount: true },
    });

    return {
      balance: house?.balance ?? user.balance,
      totalHouseFees: agg._sum.amount ?? 0,
      recent: entries.map((e) => ({
        id: e.id,
        amount: e.amount,
        at: e.createdAt,
        meta: e.meta ? JSON.parse(e.meta) : null,
      })),
      note: "Cash-game rake: % of pot (cap in BB), no flop → no drop. Scales with stakes.",
    };
  });

  app.post("/admin/invites", async (req) => {
    const user = await requireUser(app, req);
    if (user.role !== "admin") throw httpError.forbidden();
    const body = z
      .object({
        maxUses: z.number().int().positive().default(5),
        code: z.string().min(4).max(24).optional(),
      })
      .parse(req.body);

    const code =
      body.code?.toUpperCase() ??
      `CLUB-${randomBytes(3).toString("hex").toUpperCase()}`;

    const invite = await prisma.invite.create({
      data: {
        code,
        maxUses: body.maxUses,
        createdById: user.id,
      },
    });
    return { invite };
  });

  app.get("/admin/deposits", async (req) => {
    const user = await requireUser(app, req);
    if (user.role !== "admin") throw httpError.forbidden();
    const deposits = await prisma.depositIntent.findMany({
      where: { status: "pending" },
      include: { user: true },
      orderBy: { createdAt: "asc" },
    });
    return { deposits };
  });

  app.post("/admin/deposits/:id/confirm", async (req) => {
    const user = await requireUser(app, req);
    if (user.role !== "admin") throw httpError.forbidden();
    const { id } = z.object({ id: z.string() }).parse(req.params);

    const intent = await prisma.depositIntent.findUniqueOrThrow({
      where: { id },
    });
    if (intent.status !== "pending") {
      throw httpError.badRequest("Already processed");
    }

    await prisma.$transaction(async (tx) => {
      await tx.depositIntent.update({
        where: { id },
        data: { status: "confirmed" },
      });
      await tx.user.update({
        where: { id: intent.userId },
        data: { balance: { increment: intent.amountChips } },
      });
      await tx.ledgerEntry.create({
        data: {
          userId: intent.userId,
          kind: "deposit",
          amount: intent.amountChips,
          meta: JSON.stringify({ intentId: id, asset: intent.asset }),
        },
      });
    });

    return { ok: true };
  });

  app.get("/tables/:id/chat", async (req) => {
    const user = await requireUser(app, req);
    if (!user.whitelisted) throw httpError.forbidden();
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const messages = await prisma.chatMessage.findMany({
      where: { tableId: id },
      include: { user: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return {
      messages: messages.reverse().map((m) => ({
        id: m.id,
        tableId: m.tableId,
        userId: m.userId,
        name: m.user.name,
        avatarUrl: m.user.avatarUrl,
        text: m.text,
        at: m.createdAt.toISOString(),
      })),
    };
  });
}
