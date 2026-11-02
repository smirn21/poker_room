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

/**
 * Opponent rim slots by count — kept clear of the board (center ~46%)
 * and spaced so names/chips don't collide on a narrow phone oval.
 */
const OPP_BY_COUNT: { left: number; top: number }[][] = [
  [],
  [{ left: 50, top: 14 }],
  [
    { left: 16, top: 17 },
    { left: 84, top: 17 },
  ],
  [
    { left: 14, top: 26 },
    { left: 50, top: 11 },
    { left: 86, top: 26 },
  ],
  [
    { left: 14, top: 34 },
    { left: 30, top: 14 },
    { left: 70, top: 14 },
    { left: 86, top: 34 },
  ],
  [
    { left: 12, top: 38 },
    { left: 24, top: 16 },
    { left: 50, top: 11 },
    { left: 76, top: 16 },
    { left: 88, top: 38 },
  ],
  [
    { left: 11, top: 40 },
    { left: 20, top: 18 },
    { left: 38, top: 12 },
    { left: 62, top: 12 },
    { left: 80, top: 18 },
    { left: 89, top: 40 },
  ],
];

/**
 * Hero in bottom strip; opponents on the rim so they don't cover the board.
 */
export function seatLayout(
  seats: { seatIndex: number; userId: string | null }[],
  myUserId: string,
): Map<number, { left: string; top: string; isHero: boolean }> {
  const occupied = seats.filter((s) => s.userId);
  const map = new Map<number, { left: string; top: string; isHero: boolean }>();
  if (!occupied.length) return map;

  const hero =
    occupied.find((s) => s.userId === myUserId) ?? occupied[0];
  const others = occupied.filter((s) => s.seatIndex !== hero.seatIndex);

  map.set(hero.seatIndex, { left: "50%", top: "88%", isHero: true });

  const slots =
    OPP_BY_COUNT[Math.min(others.length, OPP_BY_COUNT.length - 1)] ??
    OPP_BY_COUNT[OPP_BY_COUNT.length - 1];

  others.forEach((seat, i) => {
    const slot = slots[i % slots.length];
    map.set(seat.seatIndex, {
      left: `${slot.left}%`,
      top: `${slot.top}%`,
      isHero: false,
    });
  });

  return map;
}
