import type { Card } from "@poker/shared";
import { parseCard } from "./cardUtils";

interface Props {
  card: Card;
  size?: "sm" | "md" | "lg" | "hero";
  dealDelayMs?: number;
  className?: string;
  highlight?: boolean;
  dimmed?: boolean;
}

export function PlayingCard({
  card,
  size = "md",
  dealDelayMs = 0,
  className = "",
  highlight = false,
  dimmed = false,
}: Props) {
  const { rank, symbol, colorClass } = parseCard(card);
  return (
    <div
      className={`pcard pcard-${size} ${colorClass} ${highlight ? "pcard-win" : ""} ${dimmed ? "pcard-dim" : ""} ${className}`}
      style={{ animationDelay: `${dealDelayMs}ms` }}
      aria-label={`${rank}${symbol}`}
    >
      <div className="pcard-corner pcard-tl">
        <span className="pcard-rank">{rank}</span>
        <span className="pcard-suit">{symbol}</span>
      </div>
      <div className="pcard-pip">{symbol}</div>
      <div className="pcard-corner pcard-br">
        <span className="pcard-rank">{rank}</span>
        <span className="pcard-suit">{symbol}</span>
      </div>
    </div>
  );
}

export function CardBack({
  size = "md",
  className = "",
  dealDelayMs = 0,
}: {
  size?: "sm" | "md" | "lg" | "hero";
  className?: string;
  dealDelayMs?: number;
}) {
  return (
    <div
      className={`pcard pcard-${size} pcard-back ${className}`}
      style={{ animationDelay: `${dealDelayMs}ms` }}
      aria-hidden
    />
  );
}
