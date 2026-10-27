import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { compareHands, evaluateBest } from "./handEval.js";
import type { Card } from "@poker/shared";

describe("handEval", () => {
  it("detects royal flush", () => {
    const cards: Card[] = ["Ah", "Kh", "Qh", "Jh", "Th", "2c", "3d"];
    const h = evaluateBest(cards);
    assert.equal(h.name, "Royal Flush");
  });

  it("pair beats high card", () => {
    const pair = evaluateBest(["Ah", "Ad", "2c", "5d", "9s"]);
    const high = evaluateBest(["Kh", "Qd", "2c", "5d", "9s"]);
    assert.ok(compareHands(pair, high) > 0);
  });

  it("wheel straight", () => {
    const h = evaluateBest(["Ah", "2d", "3c", "4s", "5h"]);
    assert.equal(h.name, "Straight");
    assert.equal(h.values[0], 5);
  });
});
