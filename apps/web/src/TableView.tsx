import { useEffect, useMemo, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import type {
  Card,
  ChatMessageDTO,
  PublicSeat,
  PublicTableState,
  UserDTO,
} from "@poker/shared";
import { api, getToken } from "./api";
import { seatLayout } from "./cardUtils";
import { PlayingCard, CardBack } from "./PlayingCard";
import { ChipStack } from "./ChipStack";
import { amountToChips } from "./chips";
import {
  actionLabel,
  describeHandStrength,
  localizeHandName,
} from "./handStrength";
import { useI18n } from "./i18n";
import { LanguageSwitcher } from "./i18n/LanguageSwitcher";
import { tableReferralDeepLink } from "./telegramLinks";
import { CenterNotice } from "./CenterNotice";
import { localizeApiError } from "./localizeApiError";
import {
  playAction,
  playDealCard,
  playDealSequence,
  playShuffle,
  playTurnUrgent,
  playWin,
  unlockAudio,
  vibrateTurnUrgent,
} from "./sounds";

const WS = import.meta.env.VITE_WS_URL ?? "http://localhost:3001";
const REACTIONS = ["😀", "😂", "😠", "🔥", "👏", "😎", "😱", "💪", "🎉"];

function digitsOnly(raw: string): string {
  return raw.replace(/\D/g, "");
}

function parseChips(raw: string, fallback = 0): number {
  const n = Number.parseInt(digitsOnly(raw), 10);
  return Number.isFinite(n) ? n : fallback;
}

interface Props {
  tableId: string;
  user: UserDTO;
  onBack: () => void;
  onUser: (u: UserDTO) => void;
  /** Leave table UI for wallet top-up; seat stays until rebuy grace ends. */
  onTopUp?: () => void;
}

interface FlyingChip {
  id: string;
  value: number;
  dx: number;
  dy: number;
  delay: number;
  /** Start offset from pot center (vacuum swirl) */
  ox?: number;
  oy?: number;
}

interface FloatReact {
  id: string;
  emoji: string;
  name: string;
}

export function TableView({ tableId, user, onBack, onUser, onTopUp }: Props) {
  const { t, locale } = useI18n();
  const [state, setState] = useState<PublicTableState | null>(null);
  const [messages, setMessages] = useState<ChatMessageDTO[]>([]);
  const [chatText, setChatText] = useState("");
  const [raiseAmt, setRaiseAmt] = useState("200");
  const [error, setErrorRaw] = useState<string | null>(null);
  const [okNotice, setOkNotice] = useState<string | null>(null);

  const setError = (msg: string | null) => {
    setOkNotice(null);
    setErrorRaw(msg == null ? null : localizeApiError(msg));
  };
  const [socket, setSocket] = useState<Socket | null>(null);
  const [boardAnimKey, setBoardAnimKey] = useState(0);
  const [revealedBoard, setRevealedBoard] = useState<Card[]>([]);
  const [flying, setFlying] = useState<FlyingChip[]>([]);
  const [potDisplay, setPotDisplay] = useState(0);
  const [turnLeft, setTurnLeft] = useState(1);
  const [turnSecLeft, setTurnSecLeft] = useState<number | null>(null);
  const [showEmoji, setShowEmoji] = useState(false);
  const [floats, setFloats] = useState<FloatReact[]>([]);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [tableNameDraft, setTableNameDraft] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [rebuyAmt, setRebuyAmt] = useState("2000");
  const [rebuyLeft, setRebuyLeft] = useState<number | null>(null);
  const feltRef = useRef<HTMLDivElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  const prevBoardLen = useRef(0);
  const prevHandNo = useRef(0);
  const lastPotRef = useRef(0);
  const celebratedHand = useRef(-1);
  const dealtHandSfx = useRef(-1);
  const turnUrgentWarned = useRef(false);

  // Unlock Web Audio on first tap (required in Telegram / iOS)
  useEffect(() => {
    const unlock = () => unlockAudio();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("touchstart", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("touchstart", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  // Keep chat pinned to the newest message
  useEffect(() => {
    const el = chatRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => {
    const token = getToken();
    const s = io(WS, { auth: { token } });
    setSocket(s);

    s.on("table:state", (st: PublicTableState) => setState(st));
    s.on("table:error", (e: { message: string }) =>
      setError(e.message),
    );
    s.on("chat:message", (m: ChatMessageDTO) =>
      setMessages((prev) => [...prev, m]),
    );
    s.on(
      "react:message",
      (r: { userId: string; name: string; emoji: string; at: number }) => {
        const id = `${r.at}-${r.userId}`;
        setFloats((prev) => [...prev, { id, emoji: r.emoji, name: r.name }]);
        window.setTimeout(() => {
          setFloats((prev) => prev.filter((x) => x.id !== id));
        }, 4400);
      },
    );

    s.emit("table:subscribe", { tableId });
    api
      .chatHistory(tableId)
      .then((r) => setMessages(r.messages as ChatMessageDTO[]));

    return () => {
      s.disconnect();
    };
  }, [tableId]);

  useEffect(() => {
    if (!state) return;
    if (state.pot > 0) {
      lastPotRef.current = state.pot;
      setPotDisplay(state.pot);
    } else if (state.status === "playing") {
      setPotDisplay(0);
      lastPotRef.current = 0;
    }
  }, [state?.pot, state?.status, state]);

  // Turn timer bar + countdown seconds
  useEffect(() => {
    if (!state?.turnEndsAt || state.status !== "playing") {
      setTurnLeft(1);
      setTurnSecLeft(null);
      return;
    }
    const total = Math.max(45, state.turnSeconds || 45) * 1000;
    const tick = () => {
      const msLeft = Math.max(0, state.turnEndsAt! - Date.now());
      setTurnLeft(msLeft / total);
      setTurnSecLeft(Math.ceil(msLeft / 1000));
    };
    tick();
    const id = window.setInterval(tick, 100);
    return () => clearInterval(id);
  }, [state?.turnEndsAt, state?.turnSeconds, state?.status]);

  // Board reveal + deal SFX
  useEffect(() => {
    if (!state) return;
    const board = state.board ?? [];
    if (state.handNo !== prevHandNo.current) {
      prevHandNo.current = state.handNo;
      prevBoardLen.current = 0;
      setRevealedBoard([]);
      setFlying([]);
      // Shuffle sting + hole-card deal when a new hand starts
      if (state.status === "playing" && dealtHandSfx.current !== state.handNo) {
        dealtHandSfx.current = state.handNo;
        const seatsIn = state.seats.filter((s) => s.inHand).length;
        playShuffle();
        playDealSequence(Math.min(12, Math.max(4, seatsIn * 2)), 95, 180);
      }
    }
    if (board.length === prevBoardLen.current) {
      setRevealedBoard(board);
      return;
    }
    if (board.length < prevBoardLen.current) {
      prevBoardLen.current = board.length;
      setRevealedBoard(board);
      return;
    }
    const from = prevBoardLen.current;
    prevBoardLen.current = board.length;
    setBoardAnimKey((k) => k + 1);
    setRevealedBoard(board.slice(0, from));
    // Focal moment: stagger street cards (flop slower; turn/river one-by-one)
    const added = board.length - from;
    const gap = added >= 3 ? 280 : 320;
    board.slice(from).forEach((card, i) => {
      window.setTimeout(() => {
        playDealCard(from + i);
        setRevealedBoard((prev) =>
          prev.includes(card) ? prev : [...prev, card],
        );
      }, 160 + i * gap);
    });
  }, [state]);

  const layout = useMemo(
    () => seatLayout(state?.seats ?? [], user.id),
    [state?.seats, user.id],
  );

  useEffect(() => {
    if (!state || state.status !== "hand_over" || !state.winners?.length) return;
    if (celebratedHand.current === state.handNo) return;
    celebratedHand.current = state.handNo;
    playWin();

    const felt = feltRef.current;
    if (!felt) return;
    const feltBox = felt.getBoundingClientRect();
    // Pot chips sit under the board (~58% down the felt)
    const potX = feltBox.width / 2;
    const potY = feltBox.height * 0.58;
    const chips: FlyingChip[] = [];
    let id = 0;

    for (const w of state.winners) {
      const pos = layout.get(w.seatIndex);
      if (!pos) continue;
      const seatX = (parseFloat(pos.left) / 100) * feltBox.width;
      const seatY = (parseFloat(pos.top) / 100) * feltBox.height;
      const dx = seatX - potX;
      const dy = seatY - potY;
      const piles = amountToChips(
        Math.max(w.amount, lastPotRef.current / state.winners.length),
        { maxChips: 14 },
      );
      let delay = 0;
      for (const pile of piles) {
        for (let i = 0; i < pile.count; i++) {
          // Tight spiral start, then vacuum toward winner
          const spread = 10 + Math.random() * 18;
          const ang = Math.random() * Math.PI * 2;
          chips.push({
            id: `f-${state.handNo}-${id++}`,
            value: pile.value,
            dx: dx + Math.cos(ang) * (Math.random() * 8),
            dy: dy + Math.sin(ang) * (Math.random() * 8),
            delay,
            ox: Math.cos(ang) * spread,
            oy: Math.sin(ang) * spread * 0.55,
          });
          delay += 28;
        }
      }
    }

    setFlying(chips);
    setPotDisplay(0);
    const clearAt = 1100 + chips.length * 28;
    const t = window.setTimeout(() => setFlying([]), clearAt);
    return () => window.clearTimeout(t);
  }, [state, layout]);

  const mySeat = useMemo(
    () => state?.seats.find((x) => x.userId === user.id) ?? null,
    [state, user.id],
  );

  const winningSeatIndexes = useMemo(
    () => new Set(state?.winners?.map((w) => w.seatIndex) ?? []),
    [state?.winners],
  );

  const winningCards = useMemo(() => {
    const set = new Set<string>();
    for (const w of state?.winners ?? []) {
      for (const c of w.handCards ?? []) set.add(c);
    }
    return set;
  }, [state?.winners]);

  const showdownHighlight = Boolean(
    state?.status === "hand_over" && winningCards.size > 0,
  );

  const handLabel = useMemo(() => {
    if (!mySeat?.holeCards?.length) return null;
    if (state?.status === "hand_over") {
      const w = state.winners?.find((x) => x.seatIndex === mySeat.seatIndex);
      if (w?.handName) return localizeHandName(w.handName, locale);
    }
    return describeHandStrength(mySeat.holeCards, state?.board ?? [], locale);
  }, [mySeat, state?.board, state?.status, state?.winners, locale]);

  const isMyTurn = Boolean(mySeat?.isTurn);

  // Sound + vibrate once when ≤10s remain on your clock
  useEffect(() => {
    if (!isMyTurn || turnSecLeft == null || state?.status !== "playing") {
      if (!isMyTurn || turnSecLeft == null || turnSecLeft > 10) {
        turnUrgentWarned.current = false;
      }
      return;
    }
    if (turnSecLeft > 10) {
      turnUrgentWarned.current = false;
      return;
    }
    if (turnSecLeft <= 10 && turnSecLeft > 0 && !turnUrgentWarned.current) {
      turnUrgentWarned.current = true;
      playTurnUrgent();
      vibrateTurnUrgent();
    }
  }, [isMyTurn, turnSecLeft, state?.status]);

  // Client fallback if server auto-next stalls after showdown (~7s pause + slack)
  useEffect(() => {
    if (state?.status !== "hand_over") return;
    const id = window.setTimeout(() => {
      void api.nextHand(tableId).catch(() => {
        /* server may already have dealt */
      });
    }, 8500);
    return () => window.clearTimeout(id);
  }, [state?.status, state?.handNo, tableId]);

  /** Engine expects raise-to total: currentBet + minRaise (= myBet + call + minRaise). */
  const minRaiseTo = useMemo(() => {
    if (!state || state.status !== "playing") return 0;
    return Math.max(
      1,
      (mySeat?.bet ?? 0) + (state.callAmount ?? 0) + (state.minRaise ?? 0),
    );
  }, [state, mySeat?.bet]);

  // Always fill the raise field with the legal minimum on your turn
  useEffect(() => {
    if (!state || state.status !== "playing" || !isMyTurn) return;
    const can =
      state.legalActions.includes("bet") ||
      state.legalActions.includes("raise");
    if (!can || minRaiseTo <= 0) return;
    setRaiseAmt(String(minRaiseTo));
  }, [
    isMyTurn,
    minRaiseTo,
    state?.handNo,
    state?.street,
    state?.status,
    state?.legalActions,
  ]);

  const streetLabel = (() => {
    if (state?.street && state.street !== "showdown") {
      const map: Record<string, string> = {
        preflop: t("streetPreflop"),
        flop: t("streetFlop"),
        turn: t("streetTurn"),
        river: t("streetRiver"),
      };
      return map[state.street] ?? state.street.toUpperCase();
    }
    if (state?.status === "hand_over") return t("streetShowdown");
    if (state?.status === "waiting") return t("streetWaiting");
    return "";
  })();

  function act(
    action: "fold" | "check" | "call" | "bet" | "raise" | "all-in",
    amount?: number,
  ) {
    setError(null);
    playAction(action);
    socket?.emit("table:action", { tableId, action, amount });
  }

  async function leave() {
    if (!window.confirm(t("confirmLeave"))) return;
    try {
      const r = await api.leaveTable(tableId);
      onUser(r.user);
      onBack();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errLeave"));
    }
  }

  const isHost = Boolean(state?.createdById && state.createdById === user.id);
  const mySeatLive = state?.seats.find((s) => s.userId === user.id);
  const tableInviteCode = state?.inviteCode ?? null;
  const tableName = state?.name ?? null;
  const playing = state?.status === "playing";
  /** Seated players share a REF+TBL deep link (club entry + seat at this table). */
  const showTableInvite = Boolean(mySeatLive && tableInviteCode);
  const needsRebuy = Boolean(
    mySeatLive &&
      mySeatLive.stack <= 0 &&
      state &&
      state.status !== "playing",
  );

  useEffect(() => {
    if (!needsRebuy || !mySeatLive?.rebuyDeadlineAt) {
      setRebuyLeft(null);
      return;
    }
    const tick = () => {
      const left = Math.max(
        0,
        Math.ceil((mySeatLive.rebuyDeadlineAt! - Date.now()) / 1000),
      );
      setRebuyLeft(left);
    };
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [needsRebuy, mySeatLive?.rebuyDeadlineAt]);

  async function copyTableInvite() {
    if (!tableInviteCode) return;
    let refCode = user.personalInviteCode?.trim() || null;
    if (!refCode) {
      try {
        const r = await api.referral();
        refCode = r.code;
        onUser({ ...user, personalInviteCode: r.code });
      } catch {
        setError(t("copyFailed"));
        return;
      }
    }
    const link = tableReferralDeepLink(refCode, tableInviteCode);
    // Deep link in the body — Telegram clients often drop/ignore share `url`.
    const shareBody = t("inviteShareText", { link });
    try {
      if (navigator.share) {
        await navigator.share({
          title: tableName ?? t("brand"),
          text: shareBody,
        });
        setInviteCopied(true);
        setOkNotice(t("noticeCopied"));
        window.setTimeout(() => setInviteCopied(false), 2000);
        return;
      }
      await navigator.clipboard.writeText(shareBody);
      setInviteCopied(true);
      setOkNotice(t("noticeCopied"));
      window.setTimeout(() => setInviteCopied(false), 2000);
    } catch {
      try {
        await navigator.clipboard.writeText(link);
        setInviteCopied(true);
        setOkNotice(t("noticeCopied"));
        window.setTimeout(() => setInviteCopied(false), 2000);
      } catch {
        setError(t("copyFailed"));
      }
    }
  }

  useEffect(() => {
    if (tableName) setTableNameDraft(tableName);
  }, [tableName]);

  async function saveTableName() {
    const next = tableNameDraft.trim();
    if (!next || next === tableName) {
      setEditingName(false);
      return;
    }
    try {
      setError(null);
      await api.renameTable(tableId, next);
      setEditingName(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errRename"));
    }
  }

  async function doRebuy() {
    try {
      setError(null);
      const r = await api.rebuyTable(tableId, Math.max(1, parseChips(rebuyAmt)));
      onUser(r.user);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errRebuy"));
    }
  }

  function sendChat(e: React.FormEvent) {
    e.preventDefault();
    if (!chatText.trim()) return;
    socket?.emit("chat:send", { tableId, text: chatText.trim() });
    setChatText("");
  }

  function sendReact(emoji: string) {
    socket?.emit("react:send", { tableId, emoji });
    setShowEmoji(false);
  }

  const isShowdown = state?.status === "hand_over";
  const winnerText =
    isShowdown && state?.winners?.length
      ? state.winners
          .map((w) => {
            const name =
              state.seats.find((s) => s.seatIndex === w.seatIndex)?.name ??
              t("seatN", { n: w.seatIndex + 1 });
            const hand = localizeHandName(w.handName, locale);
            return `${name} +${w.amount}${hand ? ` · ${hand}` : ""}`;
          })
          .join(" · ")
      : "";
  const aggressiveBet =
    (a: string | null | undefined) =>
      a === "bet" || a === "raise" || a === "all-in";

  function renderSeat(seat: PublicSeat, onFelt: boolean) {
    const pos = layout.get(seat.seatIndex);
    if (!pos) return null;
    const isWinner = winningSeatIndexes.has(seat.seatIndex);
    const winInfo = state?.winners?.find((w) => w.seatIndex === seat.seatIndex);
    const actionText =
      !isShowdown && seat.lastAction
        ? actionLabel(seat.lastAction, locale)
        : null;
    const winHand = localizeHandName(winInfo?.handName, locale);
    const badges = [
      seat.isDealer ? "D" : null,
      seat.isSb ? "SB" : null,
      seat.isBb ? "BB" : null,
    ].filter(Boolean) as string[];

    const body = (
      <>
        <div className="seat-badges">
          {badges.map((b) => (
            <span key={b} className={`badge badge-${b.toLowerCase()}`}>
              {b}
            </span>
          ))}
          {isWinner && <span className="badge badge-win">{t("win")}</span>}
        </div>
        {seat.avatarUrl ? (
          <img className="avatar" src={seat.avatarUrl} alt="" />
        ) : (
          <div className="avatar avatar-fallback">
            {(seat.name ?? "?")[0]}
          </div>
        )}
        {seat.inHand && !seat.holeCards && onFelt && (
          <div
            className={`opp-backs opp-backs-${pos.holeDir}`}
            key={`backs-${state?.handNo}-${seat.seatIndex}`}
          >
            <CardBack
              size="sm"
              className="hole-deal"
              dealDelayMs={seat.seatIndex * 45}
            />
            <CardBack
              size="sm"
              className="hole-deal"
              dealDelayMs={seat.seatIndex * 45 + 110}
            />
          </div>
        )}
        <div className="seat-meta">
          <div className="name">{seat.name}</div>
          {/* Non-bet actions stay by the name; bet/raise/all-in live on the bet stack */}
          {actionText &&
            !seat.isTurn &&
            !(seat.bet > 0 && aggressiveBet(seat.lastAction)) && (
            <div
              className={`action-tag action-${seat.lastAction ?? "fold"}`}
            >
              {actionText}
            </div>
          )}
          {isWinner && winInfo && winInfo.amount > 0 && (
            <div className="win-amount">+{winInfo.amount}</div>
          )}
          {seat.isTurn && !isShowdown && (
            <>
              {turnSecLeft != null && (
                <div
                  className={`turn-clock-seat${
                    turnSecLeft <= 10 ? " turn-clock-urgent" : ""
                  }`}
                >
                  {t("turnSeconds", { n: turnSecLeft })}
                </div>
              )}
              <div className="turn-bar">
                <div
                  className="turn-bar-fill"
                  style={{ transform: `scaleX(${turnLeft})` }}
                />
              </div>
            </>
          )}
        </div>
        <ChipStack amount={seat.stack} size="sm" className="seat-chips" />
        {winHand && onFelt && (
          <div className="hand-name hand-name-win" title={winHand}>
            {winHand}
          </div>
        )}
        {seat.bet > 0 && !isShowdown && (
          <div
            className={`bet-stack bet-${pos.betDir}${
              aggressiveBet(seat.lastAction) ? " bet-stack-loud" : ""
            }`}
            aria-label={`${actionText ?? "bet"} ${seat.bet}`}
          >
            {actionText && aggressiveBet(seat.lastAction) && !seat.isTurn && (
              <div
                className={`action-tag action-tag-on-bet action-${seat.lastAction ?? "raise"} action-tag-bet`}
              >
                {actionText}
              </div>
            )}
            <ChipStack
              amount={seat.bet}
              size="md"
              mode="compact"
              className="bet-chip-visible"
            />
          </div>
        )}
        {seat.holeCards && seat.holeCards.length > 0 && onFelt && (
          <div className={`hole hole-opp hole-${pos.holeDir}`}>
            {seat.holeCards.map((c, i) => (
              <PlayingCard
                key={`${state?.handNo}-opp-${seat.seatIndex}-${c}`}
                card={c}
                size="lg"
                className="street-reveal"
                dealDelayMs={i * 100}
                highlight={showdownHighlight && winningCards.has(c)}
                dimmed={
                  showdownHighlight && isWinner && !winningCards.has(c)
                }
              />
            ))}
          </div>
        )}
      </>
    );

    if (!onFelt) {
      return (
        <div
          className={`seat hero-inline ${seat.isTurn ? "turn" : ""} ${seat.folded ? "folded" : ""} ${isWinner ? "winner" : ""}${
            seat.bet > 0 && !isShowdown ? " seat-betting" : ""
          }`}
        >
          {body}
        </div>
      );
    }

    return (
      <div
        key={seat.seatIndex}
        className={`seat seat-rim-${pos.rim}${pos.sideLeft ? " seat-side-left" : " seat-side-right"} ${seat.isTurn ? "turn" : ""} ${seat.folded ? "folded" : ""} ${isWinner ? "winner" : ""}${
          seat.bet > 0 && !isShowdown ? " seat-betting" : ""
        }`}
        style={{ left: pos.left, top: pos.top }}
      >
        {body}
      </div>
    );
  }

  return (
    <div
      className={`table-screen${playing ? " table-screen-playing" : ""}${isMyTurn ? " table-screen-turn" : ""}${state?.status === "hand_over" ? " table-screen-over" : ""}`}
    >
      {tableName && (
        <div className="table-title-row">
          <button
            type="button"
            className="table-name-chip table-name-chip-hero"
            onClick={() => isHost && setEditingName(true)}
            disabled={!isHost}
            title={isHost ? t("renameTable") : tableName}
          >
            {tableName}
          </button>
        </div>
      )}
      <div className="table-topbar">
        <button type="button" className="secondary table-back-btn" onClick={onBack}>
          {t("lobby")}
        </button>
        <div className="table-status">
          <span className="street-pill">{streetLabel || "—"}</span>
          <span className="hint table-hand-hint">
            {t("handNo", { n: state?.handNo ?? 0 })}
          </span>
        </div>
        <div className="top-tools">
          {showTableInvite && (
            <button
              type="button"
              className={`invite-chip${inviteCopied ? " invite-chip-ok" : ""}`}
              onClick={() => void copyTableInvite()}
              title={inviteCopied ? t("inviteTableCopied") : t("inviteShareHint")}
            >
              {isHost && <span className="host-dot" aria-hidden />}
              <span className="invite-chip-code">
                {inviteCopied ? t("inviteTableCopied") : t("inviteTable")}
              </span>
            </button>
          )}
          <LanguageSwitcher className="lang-switch-compact" />
          <button
            type="button"
            className={`icon-btn emoji-tool-btn${showEmoji ? " emoji-tool-btn-on" : ""}`}
            onClick={() => setShowEmoji((v) => !v)}
            aria-label={t("reactEmoji")}
            title={t("reactEmoji")}
          >
            😊
          </button>
          <button
            type="button"
            className="secondary table-leave-btn"
            onClick={leave}
            aria-label={t("leave")}
            title={t("leave")}
          >
            <span className="table-leave-full">{t("leave")}</span>
            <span className="table-leave-short" aria-hidden>
              ✕
            </span>
          </button>
        </div>
      </div>

      <CenterNotice
        text={error ?? okNotice}
        variant={error ? "error" : "ok"}
        onClose={() => {
          setErrorRaw(null);
          setOkNotice(null);
        }}
      />

      {editingName && isHost && (
        <div className="table-rename-row">
          <input
            value={tableNameDraft}
            onChange={(e) => setTableNameDraft(e.target.value)}
            maxLength={40}
            aria-label={t("renameTable")}
          />
          <button type="button" className="btn-compact" onClick={() => void saveTableName()}>
            {t("renameSave")}
          </button>
          <button
            type="button"
            className="secondary btn-compact"
            onClick={() => {
              setEditingName(false);
              setTableNameDraft(tableName ?? "");
            }}
          >
            {t("back")}
          </button>
        </div>
      )}

      {needsRebuy && (
        <div className="rebuy-overlay" role="dialog" aria-labelledby="rebuy-title">
          <div className="rebuy-card panel panel-compact">
            <h2 id="rebuy-title" className="pane-title">
              {t("rebuyTitle")}
            </h2>
            <p className="hint hint-tight">
              {t("rebuyHint", { sec: rebuyLeft ?? "…" })}
            </p>
            {user.balance <= 0 || user.balance < parseChips(rebuyAmt, 1) ? (
              <p className="hint hint-tight rebuy-need-deposit">
                {t("rebuyNeedDeposit")}
              </p>
            ) : null}
            <label htmlFor="rebuy-amt">
              {t("buyIn")}
              <input
                id="rebuy-amt"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                enterKeyHint="done"
                autoComplete="off"
                value={rebuyAmt}
                onChange={(e) => setRebuyAmt(digitsOnly(e.target.value))}
              />
            </label>
            <p className="hint">
              {t("balanceShort")}: {user.balance}
            </p>
            {(user.balance <= 0 ||
              parseChips(rebuyAmt) > user.balance) &&
              onTopUp && (
                <button
                  type="button"
                  className="primary-wide"
                  onClick={() => onTopUp()}
                >
                  {t("rebuyTopUp")}
                </button>
              )}
            <button
              type="button"
              className={
                user.balance > 0 && parseChips(rebuyAmt) <= user.balance
                  ? "primary-wide"
                  : "secondary primary-wide"
              }
              onClick={() => void doRebuy()}
              disabled={
                parseChips(rebuyAmt) <= 0 ||
                parseChips(rebuyAmt) > user.balance
              }
            >
              {t("rebuyAction")}
            </button>
            <button
              type="button"
              className="secondary primary-wide"
              onClick={() => void leave()}
            >
              {t("rebuyLeave")}
            </button>
          </div>
        </div>
      )}

      {showEmoji && (
        <div className="emoji-bar">
          {REACTIONS.map((e) => (
            <button key={e} type="button" onClick={() => sendReact(e)}>
              {e}
            </button>
          ))}
        </div>
      )}

      <div className="felt" ref={feltRef}>
        <div className="felt-rail" />

        <div className="board-zone">
          <div className="board street-pulse" key={boardAnimKey}>
            {revealedBoard.map((c, idx) => (
              <PlayingCard
                key={`${state?.handNo}-${idx}-${c}`}
                card={c}
                size="lg"
                className="street-reveal"
                dealDelayMs={idx * 90}
                highlight={showdownHighlight && winningCards.has(c)}
                dimmed={showdownHighlight && !winningCards.has(c)}
              />
            ))}
            {Array.from({
              length: Math.max(0, 5 - revealedBoard.length),
            }).map((_, i) => (
              <div key={`ph-${i}`} className="board-slot" />
            ))}
          </div>
          {/* Pot cluster ONLY under board — never above into top seats */}
          <div className="pot-cluster">
            {potDisplay > 0 ? (
              <div className="pot-caption pot-caption-solo">
                {t("potLabel", { amount: potDisplay })}
              </div>
            ) : (
              <div className="pot-empty">{t("potZero")}</div>
            )}
            {potDisplay > 0 && (
              <div className="pot-chips-under" aria-hidden>
                <ChipStack
                  amount={potDisplay}
                  size="md"
                  mode="piles"
                  maxChips={12}
                  showLabel={false}
                />
              </div>
            )}
            {state?.rakeTaken ? (
              <div className="hint pot-rake">
                {t("rakeTaken", { amount: state.rakeTaken })}
              </div>
            ) : state?.rakePercent ? (
              <div className="hint pot-rake pot-rake-dim">
                {t("rakeRule", {
                  percent: state.rakePercent,
                  cap: state.rakeCapBb,
                })}
              </div>
            ) : null}
          </div>
        </div>

        {flying.map((f) => (
          <span
            key={f.id}
            className={`chip chip-fly chip-vacuum chip-v${f.value}`}
            style={
              {
                "--dx": `${f.dx}px`,
                "--dy": `${f.dy}px`,
                "--ox": `${f.ox ?? 0}px`,
                "--oy": `${f.oy ?? 0}px`,
                animationDelay: `${f.delay}ms`,
              } as React.CSSProperties
            }
          />
        ))}

        {floats.map((f) => (
          <div key={f.id} className="float-react">
            <span className="float-emoji">{f.emoji}</span>
            <span className="float-name">{f.name}</span>
          </div>
        ))}

        {(state?.seats ?? [])
          .filter((s) => s.userId && s.userId !== user.id)
          .map((seat) => renderSeat(seat, true))}
      </div>

      {winnerText ? (
        <div className="winner-banner winner-banner-glow winner-banner-felt">
          <div className="winner-banner-title">{t("win")}</div>
          <div className="winner-banner-body">{winnerText}</div>
        </div>
      ) : null}

      {/* Hero strip */}
      {mySeat && (
        <div
          className={`hero-zone ${isMyTurn ? "hero-turn" : ""} ${winningSeatIndexes.has(mySeat.seatIndex) ? "winner" : ""}${
            showdownHighlight ? " hero-zone-showdown" : ""
          }`}
        >
          {renderSeat(mySeat, false)}
          <div
            className="hero-cards"
            key={`hero-cards-${state?.handNo}-${mySeat.holeCards?.join(",") ?? "backs"}`}
          >
            {mySeat.holeCards?.map((c, i) => (
              <PlayingCard
                key={`${state?.handNo}-hole-${c}`}
                card={c}
                size="hero"
                className="hole-deal"
                dealDelayMs={i * 140}
                highlight={showdownHighlight && winningCards.has(c)}
                dimmed={
                  showdownHighlight &&
                  winningSeatIndexes.has(mySeat.seatIndex) &&
                  !winningCards.has(c)
                }
              />
            ))}
            {mySeat.inHand && !mySeat.holeCards && (
              <>
                <CardBack size="lg" className="hole-deal" dealDelayMs={40} />
                <CardBack size="lg" className="hole-deal" dealDelayMs={180} />
              </>
            )}
          </div>
          {/* During showdown the hand name lives in the winner banner — avoid overlap */}
          {handLabel && !showdownHighlight && (
            <div className="hero-strength">{handLabel}</div>
          )}
          {playing && turnSecLeft != null && (
            <div
              className={`turn-clock-hero${isMyTurn ? " turn-clock-mine" : ""}${
                turnSecLeft <= 10 ? " turn-clock-urgent" : ""
              }`}
              aria-live="polite"
            >
              <span className="turn-clock-label">
                {isMyTurn ? t("turnYours") : t("turnWaiting")}
              </span>
              <span className="turn-clock-value">
                {t("turnSeconds", { n: turnSecLeft })}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Server auto-deals after showdown; keep a manual fallback. */}
      {(state?.status === "waiting" || state?.status === "hand_over") && (
        <button
          type="button"
          className="primary-wide"
          onClick={async () => {
            try {
              setError(null);
              if (state?.status === "waiting") await api.startHand(tableId);
              else await api.nextHand(tableId);
            } catch (e) {
              setError(e instanceof Error ? e.message : t("errStart"));
            }
          }}
        >
          {state?.status === "waiting" ? t("startHand") : t("nextHand")}
        </button>
      )}

      {mySeat && playing && (
        <div
          className={`actions actions-live${isMyTurn ? " actions-armed" : " actions-idle"}`}
        >
          <button
            type="button"
            disabled={!isMyTurn || !state?.legalActions.includes("fold")}
            onClick={() => act("fold")}
          >
            {t("fold")}
          </button>
          <button
            type="button"
            disabled={
              !isMyTurn ||
              !(
                state?.legalActions.includes("check") ||
                state?.legalActions.includes("call")
              )
            }
            onClick={() => act(state?.canCheck ? "check" : "call")}
          >
            {state?.canCheck
              ? t("check")
              : t("callAmount", { amount: state?.callAmount ?? 0 })}
          </button>
          <button
            type="button"
            disabled={!isMyTurn || !state?.legalActions.includes("all-in")}
            onClick={() => act("all-in")}
          >
            {t("allIn")}
          </button>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            enterKeyHint="done"
            autoComplete="off"
            value={raiseAmt}
            disabled={!isMyTurn}
            placeholder={minRaiseTo > 0 ? String(minRaiseTo) : undefined}
            onChange={(e) => setRaiseAmt(digitsOnly(e.target.value))}
            onBlur={() => {
              if (!isMyTurn || minRaiseTo <= 0) return;
              if (parseChips(raiseAmt) < minRaiseTo) {
                setRaiseAmt(String(minRaiseTo));
              }
            }}
            style={{ gridColumn: "1 / 3", margin: 0 }}
          />
          <button
            type="button"
            disabled={
              !isMyTurn ||
              !(
                state?.legalActions.includes("bet") ||
                state?.legalActions.includes("raise")
              ) ||
              parseChips(raiseAmt) <= 0
            }
            onClick={() => {
              const amt = Math.max(minRaiseTo, parseChips(raiseAmt));
              if (amt !== parseChips(raiseAmt)) setRaiseAmt(String(amt));
              act(
                state?.legalActions.includes("bet") ? "bet" : "raise",
                amt,
              );
            }}
          >
            {t("betRaise")}
          </button>
        </div>
      )}

      <div className="panel chat-panel">
        <div className="chat" ref={chatRef}>
          {messages.map((m) => (
            <div key={m.id} className="msg">
              <strong>{m.name}</strong>: {m.text}
            </div>
          ))}
        </div>
        <form className="row chat-compose" onSubmit={sendChat}>
          <button
            type="button"
            className={`icon-btn emoji-compose-btn${showEmoji ? " emoji-tool-btn-on" : ""}`}
            onClick={() => setShowEmoji((v) => !v)}
            aria-label={t("reactEmoji")}
            title={t("reactEmoji")}
          >
            😊
          </button>
          <input
            value={chatText}
            onChange={(e) => setChatText(e.target.value)}
            placeholder={t("chatPlaceholder")}
            style={{ margin: 0, flex: 1 }}
          />
          <button type="submit">{t("send")}</button>
        </form>
      </div>
    </div>
  );
}
