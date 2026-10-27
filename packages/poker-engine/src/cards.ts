import type { Card, Rank, Suit } from "@poker/shared";

const RANKS: Rank[] = [
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "T",
  "J",
  "Q",
  "K",
  "A",
];
const SUITS: Suit[] = ["c", "d", "h", "s"];

export const RANK_VALUE: Record<Rank, number> = {
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "7": 7,
  "8": 8,
  "9": 9,
  T: 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
};

export function makeDeck(): Card[] {
  const deck: Card[] = [];
  for (const r of RANKS) {
    for (const s of SUITS) {
      deck.push(`${r}${s}`);
    }
  }
  return deck;
}

function randomU32(): number {
  const buf = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buf);
  return buf[0]!;
}

/** Fisher–Yates with Web Crypto (works in Node 20+ and browsers) */
export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomU32() % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function cardRank(card: Card): Rank {
  return card.slice(0, -1) as Rank;
}

export function cardSuit(card: Card): Suit {
  return card.slice(-1) as Suit;
}
