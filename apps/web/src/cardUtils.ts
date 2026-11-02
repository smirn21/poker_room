import type { Card } from "@poker/shared";

export type SuitKey = "h" | "d" | "c" | "s";

/** Four-color deck: ♦ blue, ♥ red, ♣ green, ♠ black */
export function parseCard(card: Card): {
  rank: string;
  suit: SuitKey;
  symbol: string;
  colorClass: "suit-heart" | "suit-diamond" | "suit-club" | "suit-spade";
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
  return { rank, suit, symbol, colorClass };
}

export function formatCard(card: Card): { label: string; red: boolean } {
  const p = parseCard(card);
  return {
    label: `${p.rank}${p.symbol}`,
    red: p.suit === "h" || p.suit === "d",
  };
}

export type HoleDir = "up" | "down" | "left" | "right";

type OppSlot = { left: number; top: number; hole: HoleDir };

/**
 * Opponent rim slots by count — clear of board/pot, with hole-card
 * direction so showdown faces sit outside the oval (not on the board).
 */
const OPP_BY_COUNT: OppSlot[][] = [
  [],
  [{ left: 50, top: 12, hole: "up" }],
  [
    { left: 16, top: 14, hole: "up" },
    { left: 84, top: 14, hole: "up" },
  ],
  [
    { left: 12, top: 28, hole: "left" },
    { left: 50, top: 11, hole: "up" },
    { left: 88, top: 28, hole: "right" },
  ],
  [
    { left: 10, top: 34, hole: "left" },
    { left: 28, top: 12, hole: "up" },
    { left: 72, top: 12, hole: "up" },
    { left: 90, top: 34, hole: "right" },
  ],
  [
    { left: 9, top: 36, hole: "left" },
    { left: 24, top: 14, hole: "up" },
    { left: 50, top: 9, hole: "up" },
    { left: 76, top: 14, hole: "up" },
    { left: 91, top: 36, hole: "right" },
  ],
  [
    { left: 8, top: 40, hole: "left" },
    { left: 20, top: 18, hole: "up" },
    { left: 36, top: 10, hole: "up" },
    { left: 64, top: 10, hole: "up" },
    { left: 80, top: 18, hole: "up" },
    { left: 92, top: 40, hole: "right" },
  ],
];

export type SeatLayoutPos = {
  left: string;
  top: string;
  isHero: boolean;
  holeDir: HoleDir;
};

/**
 * Hero in bottom strip; opponents on the rim so they don't cover the board.
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
