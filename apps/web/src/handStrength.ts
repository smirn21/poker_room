import { evaluateBest } from "@poker/poker-engine";
import type { Card } from "@poker/shared";
import { en } from "./i18n/locales/en";
import { ru, type MessageKey } from "./i18n/locales/ru";

type Locale = "ru" | "en";

const RANK: Record<string, string> = {
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

const catalogs = { ru, en } as const;

function tr(locale: Locale, key: MessageKey, vars?: Record<string, string>): string {
  const catalog = catalogs[locale] ?? catalogs.ru;
  let s = catalog[key] ?? catalogs.ru[key] ?? key;
  if (vars) {
    s = s.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? `{${k}}`);
  }
  return s;
}

/** Live hand label for hero */
export function describeHandStrength(
  hole: Card[],
  board: Card[],
  locale: Locale = "ru",
): string | null {
  if (hole.length < 2) return null;
  const cards = [...hole, ...board];
  if (cards.length < 5) {
    const r0 = hole[0].slice(0, -1);
    const r1 = hole[1].slice(0, -1);
    if (r0 === r1) {
      return tr(locale, "handPair", { rank: RANK[r0] ?? r0 });
    }
    return null;
  }
  try {
    const h = evaluateBest(cards);
    return localizeHand(h.name, h.values, locale);
  } catch {
    return null;
  }
}

function localizeHand(name: string, values: number[], locale: Locale): string {
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
      return tr(locale, "handRoyalFlush");
    case "Straight Flush":
      return tr(locale, "handStraightFlush", { rank: face(values[0]) });
    case "Four of a Kind":
      return tr(locale, "handFourKind", { rank: face(values[0]) });
    case "Full House":
      return tr(locale, "handFullHouse", { rank: face(values[0]) });
    case "Flush":
      return tr(locale, "handFlush");
    case "Straight":
      return tr(locale, "handStraight", { rank: face(values[0]) });
    case "Three of a Kind":
      return tr(locale, "handThreeKind", { rank: face(values[0]) });
    case "Two Pair":
      return tr(locale, "handTwoPair", {
        a: face(values[0]),
        b: face(values[1]),
      });
    case "One Pair":
      return tr(locale, "handOnePair", { rank: face(values[0]) });
    case "High Card":
      return tr(locale, "handHighCard", { rank: face(values[0]) });
    default:
      return name;
  }
}

export function actionLabel(
  action: string,
  locale: Locale = "ru",
): string | null {
  const keyMap: Record<string, MessageKey> = {
    fold: "actionFold",
    check: "actionCheck",
    call: "actionCall",
    bet: "actionBet",
    raise: "actionRaise",
    "all-in": "actionAllIn",
  };
  const key = keyMap[action];
  return key ? tr(locale, key) : null;
}

/** Localize English engine hand names from the server (no rank detail). */
export function localizeHandName(
  name: string | undefined | null,
  locale: Locale = "ru",
): string {
  if (!name) return "";
  const map: Record<string, MessageKey> = {
    "Royal Flush": "handRoyalFlush",
    "Straight Flush": "handStraightFlushShort",
    "Four of a Kind": "handFourKindShort",
    "Full House": "handFullHouseShort",
    Flush: "handFlush",
    Straight: "handStraightShort",
    "Three of a Kind": "handThreeKindShort",
    "Two Pair": "handTwoPairShort",
    "One Pair": "handOnePairShort",
    "High Card": "handHighCardShort",
  };
  const key = map[name];
  return key ? tr(locale, key) : name;
}

/** @deprecated use actionLabel(locale) */
export const ACTION_LABEL_RU: Record<string, string> = {
  fold: ru.actionFold,
  check: ru.actionCheck,
  call: ru.actionCall,
  bet: ru.actionBet,
  raise: ru.actionRaise,
  "all-in": ru.actionAllIn,
};
