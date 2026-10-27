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

/** Fixed rim slots — never dead-center over the board. */
const OPP_SLOTS: { left: number; top: number }[] = [
  { left: 16, top: 18 },
  { left: 84, top: 18 },
  { left: 6, top: 42 },
  { left: 94, top: 42 },
  { left: 22, top: 12 },
  { left: 78, top: 12 },
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

  others.forEach((seat, i) => {
    const slot = OPP_SLOTS[i % OPP_SLOTS.length];
    map.set(seat.seatIndex, {
      left: `${slot.left}%`,
      top: `${slot.top}%`,
      isHero: false,
    });
  });

  return map;
}
