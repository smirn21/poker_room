import type {
  Card,
  PlayerAction,
  PlayerActionType,
  PublicSeat,
  PublicTableState,
  SeatActionLabel,
  Street,
  TableConfig,
} from "@poker/shared";
import { makeDeck, shuffle } from "./cards.js";
import { compareHands, evaluateBest } from "./handEval.js";

export interface SeatPlayer {
  userId: string;
  name: string;
  avatarUrl: string | null;
  stack: number;
  sittingOut: boolean;
}

interface SeatState {
  player: SeatPlayer | null;
  hole: Card[];
  bet: number;
  totalInvested: number;
  folded: boolean;
  allIn: boolean;
  actedThisRound: boolean;
  lastAction: SeatActionLabel;
}

export interface WinnerInfo {
  seatIndex: number;
  amount: number;
  handName?: string;
  /** Best 5 cards that made the hand (for UI highlight) */
  handCards?: Card[];
}

export class HoldEmTable {
  readonly tableId: string;
  readonly config: TableConfig;
  seats: SeatState[];
  deck: Card[] = [];
  board: Card[] = [];
  street: Street | null = null;
  pot = 0;
  handNo = 0;
  dealerIndex = 0;
  sbIndex = -1;
  bbIndex = -1;
  actionIndex = -1;
  currentBet = 0;
  minRaise = 0;
  lastFullRaise = 0;
  status: "waiting" | "playing" | "hand_over" = "waiting";
  winners: WinnerInfo[] = [];
  message = "";
  handHistory: unknown[] = [];
  turnEndsAt: number | null = null;
  /** Pot rake taken this hand → owner ledger */
  rakeTaken = 0;
  /** True after rake credited to owner for this handNo */
  rakeSettled = false;
  /** True only after a real multi-way showdown (not win-by-fold). */
  revealHoleAtShowdown = false;

  constructor(tableId: string, config: TableConfig) {
    this.tableId = tableId;
    this.config = {
      ...config,
      maxSeats: Math.min(9, Math.max(2, config.maxSeats)),
      // Never allow a sub-45s clock — stale callers used to pass 20.
      turnSeconds: Math.max(45, Number(config.turnSeconds) || 45),
      rakePercent: Math.max(0, Math.min(20, config.rakePercent ?? 5)),
      rakeCapBb: Math.max(0, config.rakeCapBb ?? 3),
      noFlopNoDrop: config.noFlopNoDrop !== false,
    };
    this.seats = Array.from({ length: this.config.maxSeats }, () =>
      emptySeat(),
    );
  }

  seatedCount(): number {
    return this.seats.filter((s) => s.player && !s.player.sittingOut).length;
  }

  sit(seatIndex: number, player: SeatPlayer): void {
    if (seatIndex < 0 || seatIndex >= this.seats.length) {
      throw new Error("Invalid seat");
    }
    if (this.seats[seatIndex].player) throw new Error("Seat taken");
    if (this.seats.some((s) => s.player?.userId === player.userId)) {
      throw new Error("Already seated");
    }
    if (player.stack <= 0) throw new Error("Need chips");
    // Mid-hand join: sit out until the next deal
    const midHand = this.status === "playing";
    this.seats[seatIndex] = {
      ...emptySeat(),
      player: {
        ...player,
        sittingOut: midHand ? true : player.sittingOut,
      },
      folded: true,
    };
  }

  leave(userId: string): SeatPlayer | null {
    const idx = this.seats.findIndex((s) => s.player?.userId === userId);
    if (idx < 0) return null;
    if (this.status === "playing" && this.seats[idx].player && !this.seats[idx].folded) {
      if (this.actionIndex === idx) {
        // Fold on their turn (advances the hand); seat remains until we remove below.
        this.applyAction(userId, { type: "fold" });
      } else {
        this.seats[idx].folded = true;
        this.seats[idx].lastAction = "fold";
        const contenders = this.seats
          .map((s, i) => ({ s, i }))
          .filter(({ s }) => s.player && !s.folded);
        if (contenders.length === 1) {
          this.awardSingle(contenders[0].i);
        }
      }
    }
    const removeIdx = this.seats.findIndex((s) => s.player?.userId === userId);
    if (removeIdx < 0) return null;
    const p = this.seats[removeIdx].player;
    this.seats[removeIdx] = emptySeat();
    if (this.status === "playing" && this.actionIndex === removeIdx) {
      this.actionIndex = this.nextActor(removeIdx, true);
      this.armTurnClock();
    }
    if (this.status !== "playing") this.maybeWaiting();
    return p;
  }

  /** Add chips between hands (rebuy). Clears sit-out. */
  addStack(userId: string, chips: number): number {
    if (chips <= 0) throw new Error("Need positive chips");
    if (this.status === "playing") {
      throw new Error("Finish the hand first");
    }
    const seat = this.seats.find((s) => s.player?.userId === userId);
    if (!seat?.player) throw new Error("Not seated");
    seat.player.stack += chips;
    seat.player.sittingOut = false;
    return seat.player.stack;
  }

  tryStartHand(): boolean {
    if (this.status === "playing") return false;
    // Players who sat mid-hand (sittingOut + chips) should join the next deal.
    // Busted stack=0 stay sittingOut until rebuy.
    for (const s of this.seats) {
      if (s.player && s.player.stack > 0 && s.player.sittingOut) {
        s.player.sittingOut = false;
      }
    }
    const active = this.occupiedSeats().filter(
      (i) => this.seats[i].player!.stack > 0 && !this.seats[i].player!.sittingOut,
    );
    if (active.length < 2) {
      this.status = "waiting";
      this.message = "Waiting for players";
      return false;
    }
    this.startHand(active);
    return true;
  }

  private startHand(active: number[]): void {
    this.handNo += 1;
    this.status = "playing";
    this.street = "preflop";
    this.board = [];
    this.pot = 0;
    this.winners = [];
    this.handHistory = [];
    this.rakeTaken = 0;
    this.rakeSettled = false;
    this.revealHoleAtShowdown = false;
    this.deck = shuffle(makeDeck());
    this.currentBet = 0;
    this.minRaise = this.config.bigBlind;
    this.lastFullRaise = this.config.bigBlind;

    for (const s of this.seats) {
      // clear mid-hand sit-out so newcomers play this deal
      if (s.player?.sittingOut) s.player.sittingOut = false;
      s.hole = [];
      s.bet = 0;
      s.totalInvested = 0;
      s.folded = !s.player || s.player.stack <= 0;
      s.allIn = false;
      s.actedThisRound = false;
      s.lastAction = null;
    }

    this.dealerIndex = this.nextOccupied(this.dealerIndex, active);
    if (active.length === 2) {
      this.sbIndex = this.dealerIndex;
      this.bbIndex = this.nextOccupied(this.dealerIndex, active);
    } else {
      this.sbIndex = this.nextOccupied(this.dealerIndex, active);
      this.bbIndex = this.nextOccupied(this.sbIndex, active);
    }

    this.postBlind(this.sbIndex, this.config.smallBlind);
    this.postBlind(this.bbIndex, this.config.bigBlind);
    this.currentBet = Math.max(
      this.seats[this.sbIndex].bet,
      this.seats[this.bbIndex].bet,
    );

    for (const i of active) {
      this.seats[i].hole = [this.deck.pop()!, this.deck.pop()!];
    }

    this.actionIndex = this.nextActor(this.bbIndex, true);
    this.armTurnClock();
    this.message = `Hand #${this.handNo}`;
    this.handHistory.push({ event: "deal", handNo: this.handNo });
  }

  applyAction(userId: string, action: PlayerAction): void {
    if (this.status !== "playing" || this.actionIndex < 0) {
      throw new Error("Not in a hand");
    }
    const seat = this.seats[this.actionIndex];
    if (!seat.player || seat.player.userId !== userId) {
      throw new Error("Not your turn");
    }

    const toCall = this.currentBet - seat.bet;
    const legal = this.legalActionsFor(this.actionIndex);

    let type = action.type;
    if (type === "all-in") {
      // normalize
    } else if (!legal.includes(type)) {
      throw new Error(`Illegal action: ${type}`);
    }

    if (type === "fold") {
      seat.folded = true;
      seat.actedThisRound = true;
      seat.lastAction = "fold";
    } else if (type === "check") {
      if (toCall > 0) throw new Error("Cannot check");
      seat.actedThisRound = true;
      seat.lastAction = "check";
    } else if (type === "call") {
      this.commit(this.actionIndex, toCall);
      seat.actedThisRound = true;
      seat.lastAction = "call";
    } else if (type === "bet" || type === "raise") {
      const amount = action.amount ?? 0;
      if (type === "bet" && this.currentBet > 0) throw new Error("Use raise");
      if (type === "raise" && this.currentBet === 0) type = "bet";
      const raiseTo = type === "bet" ? amount : amount;
      const need = raiseTo - seat.bet;
      if (need <= toCall) throw new Error("Raise too small");
      const raiseSize = raiseTo - this.currentBet;
      if (
        raiseSize < this.minRaise &&
        seat.player.stack > need
      ) {
        throw new Error(`Minimum raise is ${this.minRaise}`);
      }
      this.commit(this.actionIndex, need);
      if (raiseSize >= this.minRaise) {
        this.minRaise = raiseSize;
        this.lastFullRaise = raiseSize;
        // reopen action
        for (let i = 0; i < this.seats.length; i++) {
          if (i !== this.actionIndex) this.seats[i].actedThisRound = false;
        }
      }
      this.currentBet = this.seats[this.actionIndex].bet;
      seat.actedThisRound = true;
      seat.lastAction = type === "bet" ? "bet" : "raise";
    } else if (type === "all-in") {
      const all = seat.player.stack;
      this.commit(this.actionIndex, all);
      if (seat.bet > this.currentBet) {
        const raiseSize = seat.bet - this.currentBet;
        if (raiseSize >= this.minRaise) {
          this.minRaise = raiseSize;
          for (let i = 0; i < this.seats.length; i++) {
            if (i !== this.actionIndex) this.seats[i].actedThisRound = false;
          }
        }
        this.currentBet = seat.bet;
      }
      seat.actedThisRound = true;
      seat.lastAction = "all-in";
    }

    this.handHistory.push({
      event: "action",
      seat: this.actionIndex,
      userId,
      action,
    });

    this.advanceAfterAction();
  }

  /** Auto time-bank: check if possible, otherwise fold */
  timeoutCurrentActor(): void {
    if (this.status !== "playing" || this.actionIndex < 0) return;
    const seat = this.seats[this.actionIndex];
    if (!seat.player) return;
    const toCall = this.currentBet - seat.bet;
    this.applyAction(seat.player.userId, {
      type: toCall <= 0 ? "check" : "fold",
    });
  }

  private armTurnClock(): void {
    if (this.status === "playing" && this.actionIndex >= 0) {
      const secs = Math.max(45, this.config.turnSeconds || 45);
      this.config.turnSeconds = secs;
      this.turnEndsAt = Date.now() + secs * 1000;
    } else {
      this.turnEndsAt = null;
    }
  }

  private advanceAfterAction(): void {
    const contenders = this.seats
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => s.player && !s.folded);

    if (contenders.length === 1) {
      this.awardSingle(contenders[0].i);
      return;
    }

    if (this.bettingRoundComplete()) {
      this.collectBetsToPot();
      this.nextStreetOrShowdown();
      return;
    }

    this.actionIndex = this.nextActor(this.actionIndex, false);
    this.armTurnClock();
  }

  private bettingRoundComplete(): boolean {
    const active = this.seats
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => s.player && !s.folded && !s.allIn);

    if (active.length === 0) return true;

    for (const { s } of active) {
      if (!s.actedThisRound) return false;
      if (s.bet !== this.currentBet) return false;
    }
    return true;
  }

  /** True when betting is done and the board must be run out (everyone all-in / one can act). */
  isAllInRunoutSituation(): boolean {
    if (this.status !== "playing") return false;
    const stillIn = this.seats.filter((s) => s.player && !s.folded);
    if (stillIn.length < 2) return false;
    const canAct = stillIn.filter((s) => !s.allIn && s.player!.stack > 0);
    return canAct.length <= 1;
  }

  /**
   * Server schedules pauses between streets. True while we still need another
   * street deal or the final showdown after the river is out.
   */
  needsAllInRunout(): boolean {
    if (this.status !== "playing") return false;
    if (!this.isAllInRunoutSituation()) return false;
    // Board incomplete → deal next street; board complete → showdown next tick.
    return true;
  }

  /** Deal the next runout street, or showdown once all 5 cards are out. */
  continueAllInRunout(): void {
    if (this.status !== "playing") return;
    if (!this.isAllInRunoutSituation()) return;

    if (this.board.length >= 5) {
      this.showdown();
      return;
    }

    if (this.street === "preflop") {
      this.street = "flop";
      this.board.push(this.deck.pop()!, this.deck.pop()!, this.deck.pop()!);
    } else if (this.street === "flop") {
      this.street = "turn";
      this.board.push(this.deck.pop()!);
    } else if (this.street === "turn") {
      this.street = "river";
      this.board.push(this.deck.pop()!);
    } else if (this.street === "river") {
      // Should already have 5; fall through to showdown.
      this.showdown();
      return;
    }

    this.actionIndex = -1;
    this.turnEndsAt = null;
    this.message = this.street!.toUpperCase();
  }

  private nextStreetOrShowdown(): void {
    const stillIn = this.seats.filter((s) => s.player && !s.folded);
    const canAct = stillIn.filter((s) => !s.allIn && s.player!.stack > 0);

    if (this.street === "preflop") {
      this.street = "flop";
      this.board.push(this.deck.pop()!, this.deck.pop()!, this.deck.pop()!);
    } else if (this.street === "flop") {
      this.street = "turn";
      this.board.push(this.deck.pop()!);
    } else if (this.street === "turn") {
      this.street = "river";
      this.board.push(this.deck.pop()!);
    } else if (this.street === "river") {
      this.showdown();
      return;
    }

    if (canAct.length <= 1) {
      // All-in runout: one street at a time. TableManager pauses, then
      // continueAllInRunout() for turn / river / showdown.
      this.actionIndex = -1;
      this.turnEndsAt = null;
      this.message = this.street!.toUpperCase();
      if (this.board.length >= 5) {
        // River already dealt in this step — showdown on the next scheduled tick
        // so clients can see the last card before winners flash.
      }
      return;
    }

    this.currentBet = 0;
    this.minRaise = this.config.bigBlind;
    for (const s of this.seats) {
      s.bet = 0;
      s.actedThisRound = false;
      if (!s.folded) s.lastAction = null;
    }
    this.actionIndex = this.nextActor(this.dealerIndex, true);
    this.armTurnClock();
    this.message = this.street!.toUpperCase();
  }

  /**
   * Cash-game rake: percent of pot, capped at rakeCapBb × BB.
   * No flop, no drop when configured.
   */
  private takeRakeFromPot(): number {
    if (this.pot <= 0) return 0;
    if (this.config.noFlopNoDrop && this.board.length < 3) return 0;
    const pct = this.config.rakePercent;
    if (pct <= 0) return 0;
    const cap = Math.floor(this.config.rakeCapBb * this.config.bigBlind);
    let rake = Math.floor((this.pot * pct) / 100);
    if (cap > 0) rake = Math.min(rake, cap);
    rake = Math.min(rake, this.pot);
    if (rake <= 0) return 0;
    this.pot -= rake;
    this.rakeTaken = rake;
    this.handHistory.push({
      event: "rake",
      percent: pct,
      capBb: this.config.rakeCapBb,
      amount: rake,
    });
    return rake;
  }

  private showdown(): void {
    this.street = "showdown";
    this.collectBetsToPot();
    this.takeRakeFromPot();
    const sidePots = this.buildSidePots();
    this.winners = [];
    let contested = false;

    const stillInCount = this.seats.filter((s) => s.player && !s.folded).length;

    for (const pot of sidePots) {
      const eligible = pot.eligible.filter((i) => !this.seats[i].folded);
      if (eligible.length === 0) continue;
      if (eligible.length === 1) {
        // Return chips to the sole eligible seat. At a multi-way showdown this is
        // an uncalled bet — credit the stack but do NOT mark them as a hand winner
        // (otherwise both players show «ПОБЕДА» when only one took the pot).
        this.pay(eligible[0], pot.amount);
        if (stillInCount <= 1) {
          this.winners.push({ seatIndex: eligible[0], amount: pot.amount });
        }
        continue;
      }
      contested = true;
      const scored = eligible.map((i) => ({
        i,
        hand: evaluateBest([...this.seats[i].hole, ...this.board]),
      }));
      scored.sort((a, b) => compareHands(b.hand, a.hand));
      const best = scored[0].hand;
      const winners = scored.filter((s) => compareHands(s.hand, best) === 0);
      const share = Math.floor(pot.amount / winners.length);
      let rem = pot.amount - share * winners.length;
      for (const w of winners) {
        const amt = share + (rem > 0 ? 1 : 0);
        if (rem > 0) rem -= 1;
        this.pay(w.i, amt);
        const existing = this.winners.find((x) => x.seatIndex === w.i);
        if (existing) {
          existing.amount += amt;
          if (!existing.handName) {
            existing.handName = w.hand.name;
            existing.handCards = w.hand.cards;
          }
        } else {
          this.winners.push({
            seatIndex: w.i,
            amount: amt,
            handName: w.hand.name,
            handCards: w.hand.cards,
          });
        }
      }
    }

    // Open hole cards only when at least one pot was contested.
    this.revealHoleAtShowdown = contested;
    this.status = "hand_over";
    this.actionIndex = -1;
    this.armTurnClock();
    this.message = "Hand complete";
    this.handHistory.push({ event: "showdown", winners: this.winners });
  }

  private awardSingle(seatIndex: number): void {
    this.collectBetsToPot();
    this.takeRakeFromPot();
    const win = this.pot;
    this.pay(seatIndex, win);
    this.winners = [{ seatIndex, amount: win }];
    this.pot = 0;
    this.status = "hand_over";
    this.street = "showdown";
    this.actionIndex = -1;
    this.revealHoleAtShowdown = false;
    this.armTurnClock();
    this.message = "Everyone folded";
  }

  private buildSidePots(): { amount: number; eligible: number[] }[] {
    const levels = [
      ...new Set(
        this.seats
          .map((s, i) => ({ inv: s.totalInvested, i, folded: s.folded }))
          .filter((x) => x.inv > 0)
          .map((x) => x.inv),
      ),
    ].sort((a, b) => a - b);

    const pots: { amount: number; eligible: number[] }[] = [];
    let prev = 0;
    for (const level of levels) {
      const contributors = this.seats
        .map((s, i) => ({ s, i }))
        .filter(({ s }) => s.totalInvested >= level);
      const amount = (level - prev) * contributors.length;
      const eligible = contributors
        .filter(({ s }) => !s.folded)
        .map(({ i }) => i);
      // also include folded who contributed? eligible for winning only non-folded
      if (amount > 0) pots.push({ amount, eligible });
      prev = level;
    }

    // leftover from rounding — ensure pot drained
    const accounted = pots.reduce((a, p) => a + p.amount, 0);
    if (accounted < this.pot && pots.length) {
      pots[pots.length - 1].amount += this.pot - accounted;
    }
    this.pot = 0;
    return pots;
  }

  private pay(seatIndex: number, amount: number): void {
    const p = this.seats[seatIndex].player;
    if (!p) return;
    p.stack += amount;
  }

  private collectBetsToPot(): void {
    for (const s of this.seats) {
      this.pot += s.bet;
      s.bet = 0;
    }
  }

  private postBlind(seatIndex: number, amount: number): void {
    this.commit(seatIndex, amount);
  }

  private commit(seatIndex: number, amount: number): void {
    const s = this.seats[seatIndex];
    if (!s.player) return;
    const pay = Math.min(amount, s.player.stack);
    s.player.stack -= pay;
    s.bet += pay;
    s.totalInvested += pay;
    if (s.player.stack === 0) s.allIn = true;
  }

  private occupiedSeats(): number[] {
    return this.seats
      .map((s, i) => (s.player ? i : -1))
      .filter((i) => i >= 0);
  }

  private nextOccupied(from: number, active: number[]): number {
    const n = this.seats.length;
    for (let step = 1; step <= n; step++) {
      const i = (from + step) % n;
      if (active.includes(i)) return i;
    }
    return from;
  }

  private nextActor(from: number, includeNext: boolean): number {
    const n = this.seats.length;
    const start = includeNext ? 1 : 1;
    for (let step = start; step <= n; step++) {
      const i = (from + step) % n;
      const s = this.seats[i];
      if (!s.player || s.folded || s.allIn) continue;
      if (s.player.sittingOut) continue;
      return i;
    }
    return -1;
  }

  private maybeWaiting(): void {
    if (this.seatedCount() < 2) {
      this.status = "waiting";
      this.street = null;
    }
  }

  legalActionsFor(seatIndex: number): PlayerActionType[] {
    const s = this.seats[seatIndex];
    if (!s.player || this.actionIndex !== seatIndex) return [];
    const toCall = this.currentBet - s.bet;
    const actions: PlayerActionType[] = ["fold", "all-in"];
    if (toCall <= 0) actions.push("check");
    if (toCall > 0 && s.player.stack > 0) actions.push("call");
    if (this.currentBet === 0 && s.player.stack > this.config.bigBlind) {
      actions.push("bet");
    }
    if (this.currentBet > 0 && s.player.stack > toCall) {
      actions.push("raise");
    }
    return actions;
  }

  getPublicState(forUserId?: string): PublicTableState {
    const turnSeat = this.actionIndex;
    const legal =
      turnSeat >= 0 &&
      this.seats[turnSeat].player?.userId === forUserId
        ? this.legalActionsFor(turnSeat)
        : [];

    const toCall =
      turnSeat >= 0 ? this.currentBet - this.seats[turnSeat].bet : 0;

    const seats: PublicSeat[] = this.seats.map((s, i) => {
      const inHand =
        Boolean(s.player) &&
        this.status === "playing" &&
        s.hole.length > 0 &&
        !s.folded;
      const isSelf = s.player?.userId === forUserId;
      // Win-by-fold: muck — only the player sees their own cards.
      // Contested showdown: open all remaining hands.
      const showCards =
        isSelf
          ? s.hole
          : this.revealHoleAtShowdown &&
              this.street === "showdown" &&
              s.player &&
              !s.folded
            ? s.hole
            : null;
      return {
        seatIndex: i,
        userId: s.player?.userId ?? null,
        name: s.player?.name ?? null,
        avatarUrl: s.player?.avatarUrl ?? null,
        stack: s.player?.stack ?? 0,
        bet: s.bet,
        folded: s.folded,
        allIn: s.allIn,
        sittingOut: s.player?.sittingOut ?? false,
        isDealer: i === this.dealerIndex && this.status !== "waiting",
        isSb: i === this.sbIndex && this.status === "playing",
        isBb: i === this.bbIndex && this.status === "playing",
        isTurn: i === this.actionIndex && this.status === "playing",
        inHand,
        lastAction: s.lastAction,
        holeCards: showCards && showCards.length ? showCards : null,
      };
    });

    return {
      tableId: this.tableId,
      status: this.status,
      street: this.street,
      board: [...this.board],
      pot: this.pot + this.seats.reduce((a, s) => a + s.bet, 0),
      seats,
      handNo: this.handNo,
      minRaise: this.minRaise,
      callAmount: Math.max(0, toCall),
      canCheck: toCall <= 0,
      legalActions: legal,
      turnEndsAt: this.turnEndsAt,
      turnSeconds: Math.max(45, this.config.turnSeconds || 45),
      rakePercent: this.config.rakePercent,
      rakeCapBb: this.config.rakeCapBb,
      rakeTaken: this.rakeTaken || undefined,
      winners: this.winners.length ? this.winners : undefined,
      message: this.message,
    };
  }
}

function emptySeat(): SeatState {
  return {
    player: null,
    hole: [],
    bet: 0,
    totalInvested: 0,
    folded: true,
    allIn: false,
    actedThisRound: false,
    lastAction: null,
  };
}
