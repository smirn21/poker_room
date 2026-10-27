/** Chip denominations (high → low). Colors keyed in CSS as `.chip-v{value}` */
export const CHIP_DENOMS = [5000, 1000, 500, 100, 25, 5, 1] as const;

export type ChipDenom = (typeof CHIP_DENOMS)[number];

export interface ChipPile {
  value: ChipDenom;
  count: number;
}

/**
 * Break amount into denomination piles.
 * Caps total visible chips by promoting into higher denoms so the UI stays clean.
 */
export function amountToChips(
  amount: number,
  opts: { maxChips?: number } = {},
): ChipPile[] {
  const maxChips = opts.maxChips ?? 10;
  let rest = Math.max(0, Math.floor(amount));
  if (rest === 0) return [];

  const counts = new Map<ChipDenom, number>();
  for (const d of CHIP_DENOMS) {
    const n = Math.floor(rest / d);
    if (n > 0) {
      counts.set(d, n);
      rest -= n * d;
    }
  }

  const total = () => [...counts.values()].reduce((a, b) => a + b, 0);

  // Promote: if too many chips of a small denom, leave remainder and push value up
  while (total() > maxChips) {
    let promoted = false;
    for (let i = CHIP_DENOMS.length - 1; i > 0; i--) {
      const low = CHIP_DENOMS[i];
      const high = CHIP_DENOMS[i - 1];
      const need = Math.floor(high / low);
      const lowCount = counts.get(low) ?? 0;
      if (lowCount >= need) {
        const convert = Math.floor(lowCount / need);
        counts.set(low, lowCount - convert * need);
        if ((counts.get(low) ?? 0) === 0) counts.delete(low);
        counts.set(high, (counts.get(high) ?? 0) + convert);
        promoted = true;
        if (total() <= maxChips) break;
      }
    }
    if (!promoted) {
      // Still over: merge smallest piles into a display-only higher chip
      const entries = [...counts.entries()].sort((a, b) => a[0] - b[0]);
      if (entries.length < 2) break;
      const [smallVal, smallCount] = entries[0];
      const value = smallVal * smallCount;
      counts.delete(smallVal);
      // fold into next existing or create nearest higher
      const next =
        CHIP_DENOMS.find((d) => d > smallVal && (counts.has(d) || d >= value)) ??
        CHIP_DENOMS[0];
      const add = Math.max(1, Math.floor(value / next));
      counts.set(next, (counts.get(next) ?? 0) + add);
    }
  }

  // Cap per-pile height (visual stack)
  const maxPerPile = 6;
  for (const [v, c] of [...counts.entries()]) {
    if (c > maxPerPile) {
      counts.set(v, maxPerPile);
      // spill remainder upward if possible
      const spill = (c - maxPerPile) * v;
      const higher = CHIP_DENOMS.find((d) => d > v);
      if (higher) {
        const extra = Math.floor(spill / higher);
        if (extra > 0) counts.set(higher, (counts.get(higher) ?? 0) + extra);
      }
    }
  }

  return CHIP_DENOMS.filter((d) => (counts.get(d) ?? 0) > 0).map((value) => ({
    value,
    count: counts.get(value)!,
  }));
}

export function formatChips(amount: number): string {
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 10_000) return `${Math.round(amount / 1000)}k`;
  if (amount >= 1000) return `${(amount / 1000).toFixed(amount % 1000 ? 1 : 0)}k`;
  return String(amount);
}
