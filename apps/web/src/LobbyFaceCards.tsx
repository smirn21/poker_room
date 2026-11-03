/** Decorative neon face-cards for lobby table tiles (visual only). */

import type { Card } from "@poker/shared";
import { cardFaceUrl } from "./cardUtils";

const PAIRS: { tone: "teal" | "amber"; left: Card; right: Card }[] = [
  { tone: "teal", left: "As", right: "Ah" },
  { tone: "amber", left: "Kd", right: "Kc" },
  { tone: "teal", left: "Qs", right: "Qd" },
  { tone: "amber", left: "Jh", right: "Js" },
];

function hashTone(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h) % PAIRS.length;
}

export function LobbyFaceCards({ tableId }: { tableId: string }) {
  const pair = PAIRS[hashTone(tableId)]!;
  return (
    <div className={`lobby-faces lobby-faces-${pair.tone}`} aria-hidden>
      <img
        className="lobby-face lobby-face-left"
        src={cardFaceUrl(pair.left)}
        alt=""
        draggable={false}
        decoding="async"
      />
      <img
        className="lobby-face lobby-face-right"
        src={cardFaceUrl(pair.right)}
        alt=""
        draggable={false}
        decoding="async"
      />
    </div>
  );
}
