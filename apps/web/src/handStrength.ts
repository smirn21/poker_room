import { evaluateBest } from "@poker/poker-engine";
import type { Card } from "@poker/shared";

const RANK_RU: Record<string, string> = {
  "2": "2",
  "3": "3",
  "4": "4",
  "5": "5",
  "6": "6",
  "7": "7",
  "8": "8",
  "9": "9",
  T: "10",
  J: "J",
  Q: "Q",
  K: "K",
  A: "A",
};

/** Live hand label for hero (Russian, Pokerdom-style) */
export function describeHandStrength(
  hole: Card[],
  board: Card[],
): string | null {
  if (hole.length < 2) return null;
  const cards = [...hole, ...board];
  if (cards.length < 5) {
    // Preflop / incomplete board — pair in hole only
    const r0 = hole[0].slice(0, -1);
    const r1 = hole[1].slice(0, -1);
    if (r0 === r1) return `Пара, ${RANK_RU[r0]}${RANK_RU[r1]}`;
    return null;
  }
  try {
    const h = evaluateBest(cards);
    return localizeHand(h.name, h.values);
  } catch {
    return null;
  }
}

function localizeHand(name: string, values: number[]): string {
  const face = (v: number) => {
    const map: Record<number, string> = {
      14: "A",
      13: "K",
      12: "Q",
      11: "J",
      10: "10",
    };
    return map[v] ?? String(v);
  };

  switch (name) {
    case "Royal Flush":
      return "Роял-флеш";
    case "Straight Flush":
      return `Стрит-флеш, ${face(values[0])}`;
    case "Four of a Kind":
      return `Каре, ${face(values[0])}`;
    case "Full House":
      return `Фулл-хаус, ${face(values[0])}ы`;
    case "Flush":
      return "Флеш";
    case "Straight":
      return `Стрит, ${face(values[0])}`;
    case "Three of a Kind":
      return `Сет, ${face(values[0])}`;
    case "Two Pair":
      return `Две пары, ${face(values[0])}${face(values[1])}`;
    case "One Pair":
      return `Пара, ${face(values[0])}${face(values[0])}`;
    case "High Card":
      return `Старшая, ${face(values[0])}`;
    default:
      return name;
  }
}

export const ACTION_LABEL_RU: Record<string, string> = {
  fold: "ФОЛД",
  check: "ЧЕК",
  call: "КОЛЛ",
  bet: "СТАВКА",
  raise: "РЕЙЗ",
  "all-in": "ОЛЛ-ИН",
};
