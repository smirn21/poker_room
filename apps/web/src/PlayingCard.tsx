import type { Card } from "@poker/shared";
import { CARD_BACK_URL, cardFaceUrl, parseCard } from "./cardUtils";

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
  const { rank, symbol } = parseCard(card);
  return (
    <div
      className={`pcard pcard-${size} pcard-face ${highlight ? "pcard-win" : ""} ${dimmed ? "pcard-dim" : ""} ${className}`}
      style={{ animationDelay: `${dealDelayMs}ms` }}
      aria-label={`${rank}${symbol}`}
    >
      <img
        className="pcard-img"
        src={cardFaceUrl(card)}
        alt=""
        draggable={false}
        decoding="async"
      />
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
    >
      <img
        className="pcard-img"
        src={CARD_BACK_URL}
        alt=""
        draggable={false}
        decoding="async"
      />
    </div>
  );
}
