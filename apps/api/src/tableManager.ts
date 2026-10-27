import { HoldEmTable } from "@poker/poker-engine";
import type { PlayerAction, PublicTableState } from "@poker/shared";
import { prisma } from "./db.js";
import { config } from "./config.js";

class AsyncMutex {
  private chain: Promise<void> = Promise.resolve();
  run<T>(fn: () => Promise<T> | T): Promise<T> {
    let release!: () => void;
    const next = new Promise<void>((r) => {
      release = r;
    });
    const prev = this.chain;
    this.chain = prev.then(() => next);
    return prev.then(() => fn()).finally(release);
  }
}

interface LiveTable {
  engine: HoldEmTable;
  mutex: AsyncMutex;
  turnTimer: NodeJS.Timeout | null;
  createdById: string;
  /** userId → unix ms deadline */
  rebuyDeadlines: Map<string, number>;
  rebuyTimers: Map<string, NodeJS.Timeout>;
}

export class TableManager {
  private tables = new Map<string, LiveTable>();
  private listeners = new Set<
    (tableId: string, userId: string | undefined, state: PublicTableState) => void
  >();

  onState(
    fn: (
      tableId: string,
      userId: string | undefined,
      state: PublicTableState,
    ) => void,
  ): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(tableId: string, engine: HoldEmTable): void {
    const base = this.enrichState(tableId, engine.getPublicState());
    for (const fn of this.listeners) fn(tableId, undefined, base);
  }

  getEngine(tableId: string): HoldEmTable | undefined {
    return this.tables.get(tableId)?.engine;
  }

  getCreatedById(tableId: string): string | undefined {
    return this.tables.get(tableId)?.createdById;
  }

  invalidate(tableId: string): void {
    const live = this.tables.get(tableId);
    if (live?.turnTimer) clearTimeout(live.turnTimer);
    if (live) {
      for (const t of live.rebuyTimers.values()) clearTimeout(t);
      live.rebuyTimers.clear();
    }
    this.tables.delete(tableId);
  }

  async ensureLoaded(tableId: string): Promise<HoldEmTable> {
    const existing = this.tables.get(tableId);
    if (existing) return existing.engine;

    const row = await prisma.pokerTable.findUniqueOrThrow({
      where: { id: tableId },
      include: { seats: { include: { user: true } } },
    });

    const engine = new HoldEmTable(tableId, {
      smallBlind: row.smallBlind,
      bigBlind: row.bigBlind,
      maxSeats: row.maxSeats,
      turnSeconds: 20,
      rakePercent: row.rakePercent ?? 5,
      rakeCapBb: row.rakeCapBb ?? 3,
      noFlopNoDrop: true,
    });

    for (const seat of row.seats) {
      engine.sit(seat.seatIndex, {
        userId: seat.userId,
        name: seat.user.name,
        avatarUrl: seat.user.avatarUrl,
        stack: seat.stack,
        sittingOut: seat.sittingOut,
      });
    }

    this.tables.set(tableId, {
      engine,
      mutex: new AsyncMutex(),
      turnTimer: null,
      createdById: row.createdById,
      rebuyDeadlines: new Map(),
      rebuyTimers: new Map(),
    });
    return engine;
  }

  async withTable<T>(
    tableId: string,
    fn: (engine: HoldEmTable) => Promise<T> | T,
  ): Promise<T> {
    await this.ensureLoaded(tableId);
    const live = this.tables.get(tableId)!;
    return live.mutex.run(async () => {
      const result = await fn(live.engine);
      if (
        live.engine.status === "hand_over" &&
        live.engine.rakeTaken > 0 &&
        !live.engine.rakeSettled
      ) {
        await this.settleRake(live.engine);
        live.engine.rakeSettled = true;
      }
      this.emit(tableId, live.engine);
      if (live.engine.status === "hand_over") {
        await this.persistHand(live.engine);
      }
      await this.persistSeats(live.engine);
      if (live.engine.status === "hand_over" || live.engine.status === "waiting") {
        this.syncBustedPlayers(tableId);
        await this.maybeTransferHost(tableId);
      }
      this.scheduleTurnTimer(tableId);
      // re-emit after host/rebuy enrichment
      this.emit(tableId, live.engine);
      return result;
    });
  }

  async action(
    tableId: string,
    userId: string,
    action: PlayerAction,
  ): Promise<PublicTableState> {
    return this.withTable(tableId, (engine) => {
      engine.applyAction(userId, action);
      return this.enrichState(tableId, engine.getPublicState(userId));
    });
  }

  async startIfPossible(tableId: string): Promise<void> {
    await this.withTable(tableId, (engine) => {
      engine.tryStartHand();
    });
  }

  async nextHand(tableId: string): Promise<void> {
    await this.withTable(tableId, (engine) => {
      if (engine.status === "hand_over" || engine.status === "waiting") {
        engine.tryStartHand();
      }
    });
  }

  getState(tableId: string, userId?: string): PublicTableState | null {
    const engine = this.tables.get(tableId)?.engine;
    if (!engine) return null;
    return this.enrichState(tableId, engine.getPublicState(userId));
  }

  private enrichState(
    tableId: string,
    state: PublicTableState,
  ): PublicTableState {
    const live = this.tables.get(tableId);
    if (!live) return state;
    return {
      ...state,
      createdById: live.createdById,
      seats: state.seats.map((s) => ({
        ...s,
        rebuyDeadlineAt: s.userId
          ? (live.rebuyDeadlines.get(s.userId) ?? null)
          : null,
      })),
    };
  }

  clearRebuy(tableId: string, userId: string): void {
    const live = this.tables.get(tableId);
    if (!live) return;
    live.rebuyDeadlines.delete(userId);
    const t = live.rebuyTimers.get(userId);
    if (t) {
      clearTimeout(t);
      live.rebuyTimers.delete(userId);
    }
  }

  /**
   * After hand / waiting: start rebuy grace for stack=0 seats.
   * Clear grace if they somehow have chips again.
   */
  private syncBustedPlayers(tableId: string): void {
    const live = this.tables.get(tableId);
    if (!live) return;
    const { engine } = live;
    if (engine.status === "playing") return;

    const seatedIds = new Set<string>();
    for (const seat of engine.seats) {
      if (!seat.player) continue;
      const uid = seat.player.userId;
      seatedIds.add(uid);
      if (seat.player.stack > 0) {
        this.clearRebuy(tableId, uid);
        continue;
      }
      // stack 0 — sit out and start grace if needed
      seat.player.sittingOut = true;
      if (!live.rebuyDeadlines.has(uid)) {
        const deadline = Date.now() + config.rebuyGraceSeconds * 1000;
        live.rebuyDeadlines.set(uid, deadline);
        const timer = setTimeout(() => {
          void this.kickBusted(tableId, uid);
        }, config.rebuyGraceSeconds * 1000 + 50);
        live.rebuyTimers.set(uid, timer);
      }
    }

    for (const uid of [...live.rebuyDeadlines.keys()]) {
      if (!seatedIds.has(uid)) this.clearRebuy(tableId, uid);
    }
  }

  private async kickBusted(tableId: string, userId: string): Promise<void> {
    const live = this.tables.get(tableId);
    if (!live) return;
    const deadline = live.rebuyDeadlines.get(userId);
    if (!deadline || Date.now() < deadline - 100) return;

    try {
      await this.withTable(tableId, (engine) => {
        if (engine.status === "playing") {
          // retry shortly after hand
          const retry = setTimeout(() => {
            void this.kickBusted(tableId, userId);
          }, 2000);
          live.rebuyTimers.set(userId, retry);
          return;
        }
        const seat = engine.seats.find((s) => s.player?.userId === userId);
        if (!seat?.player || seat.player.stack > 0) {
          this.clearRebuy(tableId, userId);
          return;
        }
        engine.leave(userId);
        this.clearRebuy(tableId, userId);
      });

      const dbSeat = await prisma.tableSeat.findUnique({
        where: { tableId_userId: { tableId, userId } },
      });
      if (dbSeat) {
        await prisma.tableSeat.delete({ where: { id: dbSeat.id } });
      }
      await this.maybeTransferHost(tableId);
      this.emit(tableId, live.engine);
    } catch {
      /* leave may fail mid-hand; timer retries above */
    }
  }

  /** Host leaves or sole funded player remains → transfer createdById */
  async maybeTransferHost(tableId: string): Promise<void> {
    const live = this.tables.get(tableId);
    if (!live) return;
    const funded = live.engine.seats
      .filter((s) => s.player && s.player.stack > 0)
      .map((s) => s.player!.userId);
    const seated = live.engine.seats
      .filter((s) => s.player)
      .map((s) => s.player!.userId);

    let nextHost: string | null = null;
    const hostStillSeated = seated.includes(live.createdById);

    if (funded.length === 1 && funded[0] !== live.createdById) {
      nextHost = funded[0];
    } else if (!hostStillSeated && funded.length >= 1) {
      nextHost = funded[0];
    } else if (!hostStillSeated && seated.length >= 1) {
      nextHost = seated[0];
    }

    if (nextHost && nextHost !== live.createdById) {
      live.createdById = nextHost;
      await prisma.pokerTable.update({
        where: { id: tableId },
        data: { createdById: nextHost },
      });
    }
  }

  private scheduleTurnTimer(tableId: string): void {
    const live = this.tables.get(tableId);
    if (!live) return;
    if (live.turnTimer) {
      clearTimeout(live.turnTimer);
      live.turnTimer = null;
    }
    const { engine } = live;
    if (engine.status !== "playing" || !engine.turnEndsAt) return;
    const delay = Math.max(0, engine.turnEndsAt - Date.now() + 50);
    live.turnTimer = setTimeout(() => {
      void this.withTable(tableId, (eng) => {
        if (eng.status === "playing" && eng.turnEndsAt && Date.now() >= eng.turnEndsAt - 100) {
          eng.timeoutCurrentActor();
        }
      });
    }, delay);
  }

  /** Credit pot rake to the first admin (room owner) */
  private async settleRake(engine: HoldEmTable): Promise<void> {
    const total = engine.rakeTaken;
    if (total <= 0) return;

    let house = await prisma.user.findFirst({
      where: { role: "admin" },
      orderBy: { createdAt: "asc" },
    });
    if (!house) {
      house = await prisma.user.upsert({
        where: { telegramId: "house" },
        update: {},
        create: {
          telegramId: "house",
          name: "House",
          role: "admin",
          whitelisted: true,
          balance: 0,
        },
      });
    }

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: house!.id },
        data: { balance: { increment: total } },
      });
      await tx.ledgerEntry.create({
        data: {
          userId: house!.id,
          kind: "rake_income",
          amount: total,
          meta: JSON.stringify({
            tableId: engine.tableId,
            handNo: engine.handNo,
            percent: engine.config.rakePercent,
            capBb: engine.config.rakeCapBb,
          }),
        },
      });
    });
  }

  private async persistSeats(engine: HoldEmTable): Promise<void> {
    const liveIds = new Set(
      engine.seats.filter((s) => s.player).map((s) => s.player!.userId),
    );
    const dbSeats = await prisma.tableSeat.findMany({
      where: { tableId: engine.tableId },
    });
    for (const row of dbSeats) {
      if (!liveIds.has(row.userId)) {
        await prisma.tableSeat.delete({ where: { id: row.id } });
      }
    }
    for (const seat of engine.seats) {
      if (!seat.player) continue;
      await prisma.tableSeat.updateMany({
        where: { tableId: engine.tableId, userId: seat.player.userId },
        data: { stack: seat.player.stack, sittingOut: seat.player.sittingOut },
      });
    }
  }

  private async persistHand(engine: HoldEmTable): Promise<void> {
    await prisma.hand.create({
      data: {
        tableId: engine.tableId,
        handNo: engine.handNo,
        board: JSON.stringify(engine.board),
        pot: engine.winners.reduce((a, w) => a + w.amount, 0),
        winners: JSON.stringify(engine.winners),
        history: JSON.stringify(engine.handHistory),
      },
    });
  }
}

export const tableManager = new TableManager();
