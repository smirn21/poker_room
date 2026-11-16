import type { Card } from "@poker/shared";

export type SuitKey = "h" | "d" | "c" | "s";

const SUIT_FILE: Record<SuitKey, string> = {
  h: "heart",
  d: "diamond",
  c: "club",
  s: "spade",
};

/** Jumbo-index PNG deck in /cards (Vertical2, classic red/black, CC0). */
export function cardFaceUrl(card: Card): string {
  const rawRank = card.slice(0, -1);
  const suit = card.slice(-1) as SuitKey;
  const rankFile =
    rawRank === "A"
      ? "Ace"
      : rawRank === "K"
        ? "King"
        : rawRank === "Q"
          ? "Queen"
          : rawRank === "J"
            ? "Jack"
            : rawRank === "T"
              ? "10"
              : rawRank;
  return `/cards/${SUIT_FILE[suit]}${rankFile}.png`;
}

export const CARD_BACK_URL = "/cards/blueBack.png";

/** Classic two-color deck for labels: ♥♦ red, ♣♠ black */
export function parseCard(card: Card): {
  rank: string;
  suit: SuitKey;
  symbol: string;
  colorClass: "suit-heart" | "suit-diamond" | "suit-club" | "suit-spade";
  red: boolean;
} {
  const rank = card.slice(0, -1).replace("T", "10");
  const suit = card.slice(-1) as SuitKey;
  const symbol =
    suit === "h" ? "♥" : suit === "d" ? "♦" : suit === "c" ? "♣" : "♠";
  const colorClass =
    suit === "h"
      ? "suit-heart"
      : suit === "d"
        ? "suit-diamond"
        : suit === "c"
          ? "suit-club"
          : "suit-spade";
  return {
    rank,
    suit,
    symbol,
    colorClass,
    red: suit === "h" || suit === "d",
  };
}

export function formatCard(card: Card): { label: string; red: boolean } {
  const p = parseCard(card);
  return {
    label: `${p.rank}${p.symbol}`,
    red: p.red,
  };
}

export type HoleDir = "up" | "down" | "left" | "right";

/** Street bet placement relative to seat — always away from hole cards / chrome. */
export type BetDir = "out-up" | "out-down" | "out-left" | "out-right" | "in-up";

type OppSlot = { left: number; top: number; hole: HoleDir };

/**
 * Top rim: hole cards face the pot (down) so they never cover the table chrome;
 * bets go left/right of the seat. Side seats: bets outward. Lower arc: bets up.
 */
export function betDirForSlot(leftPct: number, topPct: number): BetDir {
  if (topPct <= 22) return leftPct <= 50 ? "out-left" : "out-right";
  if (leftPct <= 22) return "out-left";
  if (leftPct >= 78) return "out-right";
  return "out-up";
}

/**
 * Opponent rim slots — stay outside the center keepout (~28–72% × 28–70%)
 * so seats never collide with board / pot. hole = direction for backs & showdown.
 * Top-arc holes face the pot (`down`) to clear topbar leave / tools.
 * Index = opponent count (hero is in the bottom strip). Full ring = 8 → 9-max.
 */
const OPP_BY_COUNT: OppSlot[][] = [
  [],
  [{ left: 50, top: 17, hole: "down" }],
  [
    { left: 14, top: 18, hole: "down" },
    { left: 86, top: 18, hole: "down" },
  ],
  [
    { left: 12, top: 24, hole: "left" },
    { left: 50, top: 17, hole: "down" },
    { left: 88, top: 24, hole: "right" },
  ],
  [
    { left: 10, top: 30, hole: "left" },
    { left: 24, top: 17, hole: "down" },
    { left: 76, top: 17, hole: "down" },
    { left: 90, top: 30, hole: "right" },
  ],
  [
    { left: 9, top: 36, hole: "left" },
    { left: 20, top: 17, hole: "down" },
    { left: 50, top: 17, hole: "down" },
    { left: 80, top: 17, hole: "down" },
    { left: 91, top: 36, hole: "right" },
  ],
  [
    { left: 8, top: 42, hole: "left" },
    { left: 11, top: 22, hole: "left" },
    { left: 28, top: 17, hole: "down" },
    { left: 72, top: 17, hole: "down" },
    { left: 89, top: 22, hole: "right" },
    { left: 92, top: 42, hole: "right" },
  ],
  [
    { left: 8, top: 48, hole: "left" },
    { left: 10, top: 28, hole: "left" },
    { left: 24, top: 17, hole: "down" },
    { left: 50, top: 17, hole: "down" },
    { left: 76, top: 17, hole: "down" },
    { left: 90, top: 28, hole: "right" },
    { left: 92, top: 48, hole: "right" },
  ],
  [
    { left: 8, top: 54, hole: "left" },
    { left: 9, top: 34, hole: "left" },
    { left: 14, top: 18, hole: "down" },
    { left: 34, top: 17, hole: "down" },
    { left: 66, top: 17, hole: "down" },
    { left: 86, top: 18, hole: "down" },
    { left: 91, top: 34, hole: "right" },
    { left: 92, top: 54, hole: "right" },
  ],
];

/** Which rim arc — drives where win-combo labels / hole cards may grow. */
export type RimZone = "top" | "left" | "right" | "mid";

export function rimForSlot(leftPct: number, topPct: number): RimZone {
  if (topPct <= 22) return "top";
  if (leftPct <= 22) return "left";
  if (leftPct >= 78) return "right";
  return "mid";
}

export type SeatLayoutPos = {
  left: string;
  top: string;
  isHero: boolean;
  holeDir: HoleDir;
  betDir: BetDir;
  rim: RimZone;
  /** Seat is on the left half of the felt (for label side). */
  sideLeft: boolean;
};

/**
 * Hero in bottom strip; opponents on the rim of the portrait oval.
 */
export function seatLayout(
  seats: { seatIndex: number; userId: string | null }[],
  myUserId: string,
): Map<number, SeatLayoutPos> {
  const occupied = seats.filter((s) => s.userId);
  const map = new Map<number, SeatLayoutPos>();
  if (!occupied.length) return map;

  const hero =
    occupied.find((s) => s.userId === myUserId) ?? occupied[0];
  const others = occupied.filter((s) => s.seatIndex !== hero.seatIndex);

  map.set(hero.seatIndex, {
    left: "50%",
    top: "88%",
    isHero: true,
    holeDir: "up",
    betDir: "in-up",
    rim: "mid",
    sideLeft: true,
  });

  const slots =
    OPP_BY_COUNT[Math.min(others.length, OPP_BY_COUNT.length - 1)] ??
    OPP_BY_COUNT[OPP_BY_COUNT.length - 1];

  others.forEach((seat, i) => {
    const slot = slots[i % slots.length];
    map.set(seat.seatIndex, {
      left: `${slot.left}%`,
      top: `${slot.top}%`,
      isHero: false,
      holeDir: slot.hole,
      betDir: betDirForSlot(slot.left, slot.top),
      rim: rimForSlot(slot.left, slot.top),
      sideLeft: slot.left <= 50,
    });
  });

  return map;
}
