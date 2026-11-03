import { CARD_BACK_URL, cardFaceUrl } from "./cardUtils";
import type { Card } from "@poker/shared";

const RANKS = ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"] as const;
const SUITS = ["h", "d", "c", "s"] as const;

/** Warm the HTTP cache for every face + back so street deals don't flash empty. */
export function preloadDeckImages(): void {
  if (typeof window === "undefined") return;
  const urls = new Set<string>([CARD_BACK_URL]);
  for (const r of RANKS) {
    for (const s of SUITS) {
      urls.add(cardFaceUrl(`${r}${s}` as Card));
    }
  }
  for (const url of urls) {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
  }
}
