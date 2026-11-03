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

type OppSlot = { left: number; top: number; hole: HoleDir };

/**
 * Opponent rim slots for a portrait (vertically stretched) felt.
 * Index = opponent count (hero is in the bottom strip). Full ring = 8 opps → 9-max.
 */
const OPP_BY_COUNT: OppSlot[][] = [
  [],
  [{ left: 50, top: 12, hole: "up" }],
  [
    { left: 18, top: 18, hole: "up" },
    { left: 82, top: 18, hole: "up" },
  ],
  [
    { left: 14, top: 28, hole: "up" },
    { left: 50, top: 12, hole: "up" },
    { left: 86, top: 28, hole: "up" },
  ],
  [
    { left: 12, top: 36, hole: "up" },
    { left: 28, top: 14, hole: "up" },
    { left: 72, top: 14, hole: "up" },
    { left: 88, top: 36, hole: "up" },
  ],
  [
    { left: 11, top: 42, hole: "up" },
    { left: 26, top: 16, hole: "up" },
    { left: 50, top: 11, hole: "up" },
    { left: 74, top: 16, hole: "up" },
    { left: 89, top: 42, hole: "up" },
  ],
  [
    { left: 10, top: 48, hole: "up" },
    { left: 14, top: 28, hole: "up" },
    { left: 32, top: 13, hole: "up" },
    { left: 68, top: 13, hole: "up" },
    { left: 86, top: 28, hole: "up" },
    { left: 90, top: 48, hole: "up" },
  ],
  [
    { left: 10, top: 52, hole: "up" },
    { left: 12, top: 34, hole: "up" },
    { left: 26, top: 16, hole: "up" },
    { left: 50, top: 10, hole: "up" },
    { left: 74, top: 16, hole: "up" },
    { left: 88, top: 34, hole: "up" },
    { left: 90, top: 52, hole: "up" },
  ],
  [
    { left: 9, top: 58, hole: "up" },
    { left: 10, top: 40, hole: "up" },
    { left: 18, top: 22, hole: "up" },
    { left: 36, top: 11, hole: "up" },
    { left: 64, top: 11, hole: "up" },
    { left: 82, top: 22, hole: "up" },
    { left: 90, top: 40, hole: "up" },
    { left: 91, top: 58, hole: "up" },
  ],
];

export type SeatLayoutPos = {
  left: string;
  top: string;
  isHero: boolean;
  holeDir: HoleDir;
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
    });
  });

  return map;
}
