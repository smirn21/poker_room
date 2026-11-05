export type Suit = "c" | "d" | "h" | "s";
export type Rank =
  | "2"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "T"
  | "J"
  | "Q"
  | "K"
  | "A";

export type Card = `${Rank}${Suit}`;

export type Street = "preflop" | "flop" | "turn" | "river" | "showdown";

export type PlayerActionType =
  | "fold"
  | "check"
  | "call"
  | "bet"
  | "raise"
  | "all-in";

export interface PlayerAction {
  type: PlayerActionType;
  amount?: number;
}

export interface TableConfig {
  smallBlind: number;
  bigBlind: number;
  maxSeats: number;
  turnSeconds: number;
  /**
   * Pot rake % (cash-game standard worldwide). Default 5.
   * Taken from pot at hand end → room owner. Not paid into pot.
   */
  rakePercent: number;
  /**
   * Max rake in big blinds (e.g. 3 → cap = 3 × BB). Scales with stakes.
   * GGPoker-style default: 3BB.
   */
  rakeCapBb: number;
  /**
   * If true (default): no flop dealt → no rake ("no flop, no drop").
   */
  noFlopNoDrop: boolean;
}

export type SeatActionLabel =
  | "fold"
  | "check"
  | "call"
  | "bet"
  | "raise"
  | "all-in"
  | null;

export interface PublicSeat {
  seatIndex: number;
  userId: string | null;
  name: string | null;
  avatarUrl: string | null;
  stack: number;
  bet: number;
  folded: boolean;
  allIn: boolean;
  sittingOut: boolean;
  isDealer: boolean;
  isSb: boolean;
  isBb: boolean;
  isTurn: boolean;
  /** Still in the current hand (has cards / not folded out) */
  inHand: boolean;
  lastAction: SeatActionLabel;
  holeCards?: Card[] | null;
  /** Unix ms — busted player must rebuy before this or is removed */
  rebuyDeadlineAt?: number | null;
}

export interface PublicTableState {
  tableId: string;
  status: "waiting" | "playing" | "hand_over";
  street: Street | null;
  board: Card[];
  pot: number;
  seats: PublicSeat[];
  handNo: number;
  minRaise: number;
  callAmount: number;
  canCheck: boolean;
  legalActions: PlayerActionType[];
  /** Unix ms when current actor's turn expires */
  turnEndsAt: number | null;
  turnSeconds: number;
  rakePercent: number;
  rakeCapBb: number;
  /** Rake taken from pot this hand (chips → owner) */
  rakeTaken?: number;
  /** Display name (e.g. Стол 3) */
  name?: string | null;
  /** Current table host */
  createdById?: string | null;
  /** Short join code for copy/share (TBL-XXXXXX) */
  inviteCode?: string | null;
  winners?: {
    seatIndex: number;
    amount: number;
    handName?: string;
    handCards?: Card[];
  }[];
  message?: string;
}

export interface ChatMessageDTO {
  id: string;
  tableId: string;
  userId: string;
  name: string;
  avatarUrl: string | null;
  text: string;
  at: string;
}

export interface UserDTO {
  id: string;
  telegramId: string;
  name: string;
  username: string | null;
  avatarUrl: string | null;
  balance: number;
  role: "user" | "admin";
  whitelisted: boolean;
  /** True when admin blocked the account. */
  blocked: boolean;
  personalInviteCode?: string | null;
}

/** Parts of a deep-link invite payload (REF alone, TBL alone, or REF_TBL). */
export interface InvitePayloadParts {
  /** Personal referral code REF-… when present. */
  refCode: string | null;
  /** Open-table code TBL-… when present. */
  tableCode: string | null;
  /** Single legacy token (CLUB-/REF-/TBL-/raw) when not a composite. */
  singleCode: string | null;
}

/**
 * Normalize Telegram start / startapp / ?invite= payloads.
 * Accepts REF-…, TBL-…, CLUB-…, ref_XXXX, and composite REF-…_TBL-….
 */
export function normalizeInviteToken(raw: string): string {
  let c = raw.trim();
  if (!c) return "";
  // Telegram /start sometimes uses ref_XXXX without the REF- prefix.
  if (/^ref[_-]/i.test(c) && !/^ref-/i.test(c)) {
    c = c.replace(/^ref[_-]/i, "");
    if (!/^(REF|CLUB|TBL)-/i.test(c)) {
      c = `REF-${c}`;
    }
  }
  return c.toUpperCase();
}

/** Build startapp / ?invite= param that invites via REF and opens a table. */
export function composeTableReferralParam(
  refCode: string,
  tableCode: string,
): string {
  return `${refCode.trim().toUpperCase()}_${tableCode.trim().toUpperCase()}`;
}

/** Split REF_TBL composites or return a single invite token. */
export function parseInvitePayload(raw: string): InvitePayloadParts {
  const c = normalizeInviteToken(raw);
  if (!c) {
    return { refCode: null, tableCode: null, singleCode: null };
  }
  const composite = c.match(
    /^(REF-[A-Z0-9]+)[_]+(TBL-[A-Z0-9]+)$/,
  );
  if (composite) {
    return {
      refCode: composite[1]!,
      tableCode: composite[2]!,
      singleCode: null,
    };
  }
  const swapped = c.match(/^(TBL-[A-Z0-9]+)[_]+(REF-[A-Z0-9]+)$/);
  if (swapped) {
    return {
      refCode: swapped[2]!,
      tableCode: swapped[1]!,
      singleCode: null,
    };
  }
  if (c.startsWith("REF-")) {
    return { refCode: c, tableCode: null, singleCode: c };
  }
  if (c.startsWith("TBL-")) {
    return { refCode: null, tableCode: c, singleCode: c };
  }
  return { refCode: null, tableCode: null, singleCode: c };
}
