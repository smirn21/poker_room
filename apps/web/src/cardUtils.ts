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
 * Hero at bottom; others along the top arc so they don't cover the board.
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

  // Hero is rendered in the bottom strip, not on the felt oval
  map.set(hero.seatIndex, { left: "50%", top: "88%", isHero: true });

  const n = others.length;
  if (n === 0) return map;

  const start = (-Math.PI * 5) / 6;
  const end = -Math.PI / 6;
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const angle = start + t * (end - start);
    const x = 50 + 41 * Math.cos(angle);
    const y = 44 + 34 * Math.sin(angle);
    map.set(others[i].seatIndex, {
      left: `${x}%`,
      top: `${Math.max(12, Math.min(58, y))}%`,
      isHero: false,
    });
  }
  return map;
}
