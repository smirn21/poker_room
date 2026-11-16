import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HoldEmTable } from "./table.js";

function seatAllIn(t: HoldEmTable, i: number, userId: string, stack: number) {
  t.sit(i, {
    userId,
    name: userId,
    avatarUrl: null,
    stack,
    sittingOut: false,
  });
}

describe("all-in runout", () => {
  it("reveals flop then pauses; turn/river/showdown via continueAllInRunout", () => {
    const t = new HoldEmTable("t1", {
      smallBlind: 50,
      bigBlind: 100,
      maxSeats: 2,
      turnSeconds: 45,
      rakePercent: 0,
      rakeCapBb: 0,
      noFlopNoDrop: true,
    });
    seatAllIn(t, 0, "a", 500);
    seatAllIn(t, 1, "b", 500);
    t.tryStartHand();
    assert.equal(t.status, "playing");
    assert.equal(t.street, "preflop");

    const first = t.seats[t.actionIndex]!.player!.userId;
    t.applyAction(first, { type: "all-in" });
    // Opponent has not answered yet — must NOT start board runout.
    assert.equal(t.needsAllInRunout(), false);
    assert.equal(t.street, "preflop");
    assert.equal(t.board.length, 0);

    const second = t.seats[t.actionIndex]!.player!.userId;
    t.applyAction(second, { type: "all-in" });

    assert.equal(t.status, "playing");
    assert.equal(t.street, "flop");
    assert.equal(t.board.length, 3);
    assert.equal(t.needsAllInRunout(), true);
    assert.equal(t.winners.length, 0);

    t.continueAllInRunout();
    assert.equal(t.street, "turn");
    assert.equal(t.board.length, 4);
    assert.equal(t.status, "playing");

    t.continueAllInRunout();
    assert.equal(t.street, "river");
    assert.equal(t.board.length, 5);
    assert.equal(t.status, "playing");

    t.continueAllInRunout();
    assert.equal(t.status, "hand_over");
    assert.ok(t.winners.length > 0);
    assert.equal(t.needsAllInRunout(), false);
  });

  it("does not run out the board until the opponent calls or folds the all-in", () => {
    const t = new HoldEmTable("t2", {
      smallBlind: 50,
      bigBlind: 100,
      maxSeats: 2,
      turnSeconds: 45,
      rakePercent: 5,
      rakeCapBb: 3,
      noFlopNoDrop: true,
    });
    seatAllIn(t, 0, "hero", 2000);
    seatAllIn(t, 1, "villain", 2000);
    t.tryStartHand();

    const first = t.seats[t.actionIndex]!.player!.userId;
    t.applyAction(first, { type: "all-in" });

    assert.equal(t.needsAllInRunout(), false);
    assert.equal(t.isAllInRunoutSituation(), false);
    assert.equal(t.street, "preflop");
    assert.equal(t.board.length, 0);
    // Opponent still to act — continueAllInRunout must be a no-op.
    t.continueAllInRunout();
    assert.equal(t.street, "preflop");
    assert.equal(t.board.length, 0);
    assert.equal(t.status, "playing");

    const second = t.seats[t.actionIndex]!.player!.userId;
    t.applyAction(second, { type: "fold" });
    assert.equal(t.status, "hand_over");
    assert.equal(t.board.length, 0);
    assert.ok(t.winners.some((w) => t.seats[w.seatIndex]!.player!.userId === first));
  });
});
