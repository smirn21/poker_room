import type { Card, Rank } from "@poker/shared";
import { RANK_VALUE, cardRank, cardSuit } from "./cards.js";

export interface EvaluatedHand {
  rank: number; // category 0-8
  values: number[]; // tiebreakers high to low
  name: string;
  cards?: Card[]; // best 5 cards when known
}

const CATEGORY = {
  highCard: 0,
  pair: 1,
  twoPair: 2,
  trips: 3,
  straight: 4,
  flush: 5,
  fullHouse: 6,
  quads: 7,
  straightFlush: 8,
} as const;

function combinations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const [first, ...rest] = arr;
  const withFirst = combinations(rest, k - 1).map((c) => [first, ...c]);
  const withoutFirst = combinations(rest, k);
  return [...withFirst, ...withoutFirst];
}

function straightHigh(ranks: number[]): number | null {
  const uniq = [...new Set(ranks)].sort((a, b) => b - a);
  // wheel A-5
  if (
    uniq.includes(14) &&
    uniq.includes(5) &&
    uniq.includes(4) &&
    uniq.includes(3) &&
    uniq.includes(2)
  ) {
    return 5;
  }
  for (let i = 0; i <= uniq.length - 5; i++) {
    const slice = uniq.slice(i, i + 5);
    if (slice[0] - slice[4] === 4 && new Set(slice).size === 5) {
      return slice[0];
    }
  }
  return null;
}

function evalFive(cards: Card[]): EvaluatedHand {
  const ranks = cards.map((c) => RANK_VALUE[cardRank(c)]).sort((a, b) => b - a);
  const suits = cards.map((c) => cardSuit(c));
  const isFlush = suits.every((s) => s === suits[0]);
  const sHigh = straightHigh(ranks);

  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
  const byCount = [...counts.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return b[0] - a[0];
  });

  if (isFlush && sHigh !== null) {
    return {
      rank: CATEGORY.straightFlush,
      values: [sHigh],
      name: sHigh === 14 ? "Royal Flush" : "Straight Flush",
    };
  }
  if (byCount[0][1] === 4) {
    const kicker = byCount.find((x) => x[1] === 1)![0];
    return {
      rank: CATEGORY.quads,
      values: [byCount[0][0], kicker],
      name: "Four of a Kind",
    };
  }
  if (byCount[0][1] === 3 && byCount[1]?.[1] === 2) {
    return {
      rank: CATEGORY.fullHouse,
      values: [byCount[0][0], byCount[1][0]],
      name: "Full House",
    };
  }
  if (isFlush) {
    return { rank: CATEGORY.flush, values: ranks, name: "Flush" };
  }
  if (sHigh !== null) {
    return { rank: CATEGORY.straight, values: [sHigh], name: "Straight" };
  }
  if (byCount[0][1] === 3) {
    const kickers = byCount.filter((x) => x[1] === 1).map((x) => x[0]);
    return {
      rank: CATEGORY.trips,
      values: [byCount[0][0], ...kickers],
      name: "Three of a Kind",
    };
  }
  if (byCount[0][1] === 2 && byCount[1]?.[1] === 2) {
    const high = Math.max(byCount[0][0], byCount[1][0]);
    const low = Math.min(byCount[0][0], byCount[1][0]);
    const kicker = byCount.find((x) => x[1] === 1)![0];
    return {
      rank: CATEGORY.twoPair,
      values: [high, low, kicker],
      name: "Two Pair",
    };
  }
  if (byCount[0][1] === 2) {
    const kickers = byCount.filter((x) => x[1] === 1).map((x) => x[0]);
    return {
      rank: CATEGORY.pair,
      values: [byCount[0][0], ...kickers],
      name: "One Pair",
    };
  }
  return { rank: CATEGORY.highCard, values: ranks, name: "High Card" };
}

export function compareHands(a: EvaluatedHand, b: EvaluatedHand): number {
  if (a.rank !== b.rank) return a.rank - b.rank;
  for (let i = 0; i < Math.max(a.values.length, b.values.length); i++) {
    const av = a.values[i] ?? 0;
    const bv = b.values[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

/** Best 5-card hand from 5–7 cards (includes the winning five) */
export function evaluateBest(cards: Card[]): EvaluatedHand {
  if (cards.length < 5) {
    throw new Error("Need at least 5 cards");
  }
  if (cards.length === 5) {
    const ev = evalFive(cards);
    return { ...ev, cards: [...cards] };
  }
  let best: EvaluatedHand | null = null;
  let bestFive: Card[] = [];
  for (const five of combinations(cards, 5)) {
    const ev = evalFive(five);
    if (!best || compareHands(ev, best) > 0) {
      best = ev;
      bestFive = five;
    }
  }
  return { ...best!, cards: [...bestFive] };
}

export function rankName(rank: Rank): string {
  return rank;
}
