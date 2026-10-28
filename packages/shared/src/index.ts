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
}
