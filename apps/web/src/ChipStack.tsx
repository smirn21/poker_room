import { amountToChips, formatChips } from "./chips";

interface Props {
  amount: number;
  size?: "sm" | "md" | "lg";
  /** Pokerdom-style: one chip icon + amount (default). Use "piles" for multi-denom stacks */
  mode?: "compact" | "piles";
  showLabel?: boolean;
  maxChips?: number;
  className?: string;
}

export function ChipStack({
  amount,
  size = "md",
  mode = "compact",
  showLabel = true,
  maxChips = 10,
  className = "",
}: Props) {
  if (amount <= 0) return null;

  if (mode === "compact") {
    const top = amountToChips(amount, { maxChips: 3 })[0];
    const value = top?.value ?? 100;
    return (
      <div
        className={`chip-stack chip-stack-${size} chip-compact ${className}`}
        title={`${amount}`}
      >
        <span className={`chip chip-static chip-v${value}`}>
          {shortLabel(value)}
        </span>
        {showLabel && <span className="chip-label">{formatChips(amount)}</span>}
      </div>
    );
  }

  const piles = amountToChips(amount, { maxChips });
  return (
    <div className={`chip-stack chip-stack-${size} ${className}`} title={`${amount}`}>
      <div className="chip-piles">
        {piles.map((pile) => (
          <div key={pile.value} className="chip-pile">
            {Array.from({ length: pile.count }).map((_, i) => (
              <span
                key={i}
                className={`chip chip-v${pile.value}`}
                style={{ bottom: `${i * (size === "sm" ? 2.5 : 3.2)}px` }}
              >
                {i === pile.count - 1 ? shortLabel(pile.value) : ""}
              </span>
            ))}
          </div>
        ))}
      </div>
      {showLabel && <span className="chip-label">{formatChips(amount)}</span>}
    </div>
  );
}

function shortLabel(v: number): string {
  if (v >= 1000) return `${v / 1000}k`;
  return String(v);
}
