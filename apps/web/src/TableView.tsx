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
import { ACTION_LABEL_RU, describeHandStrength } from "./handStrength";

const WS = import.meta.env.VITE_WS_URL ?? "http://localhost:3001";
const REACTIONS = ["😀", "😂", "🔥", "👏", "😎", "😱", "💪", "🎉"];

interface Props {
  tableId: string;
  user: UserDTO;
  onBack: () => void;
  onUser: (u: UserDTO) => void;
}

interface FlyingChip {
  id: string;
  value: number;
  dx: number;
  dy: number;
  delay: number;
}

interface FloatReact {
  id: string;
  emoji: string;
  name: string;
}

export function TableView({ tableId, user, onBack, onUser }: Props) {
  const [state, setState] = useState<PublicTableState | null>(null);
  const [messages, setMessages] = useState<ChatMessageDTO[]>([]);
  const [chatText, setChatText] = useState("");
  const [raiseAmt, setRaiseAmt] = useState(200);
  const [error, setError] = useState<string | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [boardAnimKey, setBoardAnimKey] = useState(0);
  const [revealedBoard, setRevealedBoard] = useState<Card[]>([]);
  const [flying, setFlying] = useState<FlyingChip[]>([]);
  const [potDisplay, setPotDisplay] = useState(0);
  const [turnLeft, setTurnLeft] = useState(1);
  const [showEmoji, setShowEmoji] = useState(false);
  const [floats, setFloats] = useState<FloatReact[]>([]);
  const feltRef = useRef<HTMLDivElement>(null);
  const prevBoardLen = useRef(0);
  const prevHandNo = useRef(0);
  const lastPotRef = useRef(0);
  const celebratedHand = useRef(-1);

  useEffect(() => {
    const token = getToken();
    const s = io(WS, { auth: { token } });
    setSocket(s);

    s.on("table:state", (st: PublicTableState) => setState(st));
    s.on("table:error", (e: { message: string }) => setError(e.message));
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
        }, 2200);
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

  // Turn timer bar
  useEffect(() => {
    if (!state?.turnEndsAt || state.status !== "playing") {
      setTurnLeft(1);
      return;
    }
    const total = (state.turnSeconds || 20) * 1000;
    const tick = () => {
      const left = Math.max(0, (state.turnEndsAt! - Date.now()) / total);
      setTurnLeft(left);
    };
    tick();
    const id = window.setInterval(tick, 100);
    return () => clearInterval(id);
  }, [state?.turnEndsAt, state?.turnSeconds, state?.status]);

  // Board reveal
  useEffect(() => {
    if (!state) return;
    const board = state.board ?? [];
    if (state.handNo !== prevHandNo.current) {
      prevHandNo.current = state.handNo;
      prevBoardLen.current = 0;
      setRevealedBoard([]);
      setFlying([]);
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
    board.slice(from).forEach((card, i) => {
      window.setTimeout(() => {
        setRevealedBoard((prev) =>
          prev.includes(card) ? prev : [...prev, card],
        );
      }, 180 + i * 280);
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

    const felt = feltRef.current;
    if (!felt) return;
    const feltBox = felt.getBoundingClientRect();
    const potX = feltBox.width / 2;
    const potY = feltBox.height * 0.42;
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
        { maxChips: 8 },
      );
      let delay = 0;
      for (const pile of piles) {
        for (let i = 0; i < pile.count; i++) {
          chips.push({
            id: `f-${state.handNo}-${id++}`,
            value: pile.value,
            dx: dx + (Math.random() * 24 - 12),
            dy: dy + (Math.random() * 18 - 9),
            delay,
          });
          delay += 45;
        }
      }
    }

    setFlying(chips);
    setPotDisplay(0);
    const t = window.setTimeout(() => setFlying([]), 900 + chips.length * 45);
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
      if (w?.handName) return w.handName;
    }
    return describeHandStrength(mySeat.holeCards, state?.board ?? []);
  }, [mySeat, state?.board, state?.status, state?.winners]);

  const isMyTurn = Boolean(mySeat?.isTurn);
  const streetLabel =
    state?.street && state.street !== "showdown"
      ? state.street.toUpperCase()
      : state?.status === "hand_over"
        ? "SHOWDOWN"
        : state?.status === "waiting"
          ? "WAITING"
          : "";

  function act(
    action: "fold" | "check" | "call" | "bet" | "raise" | "all-in",
    amount?: number,
  ) {
    setError(null);
    socket?.emit("table:action", { tableId, action, amount });
  }

  async function leave() {
    try {
      const r = await api.leaveTable(tableId);
      onUser(r.user);
      onBack();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Leave failed");
    }
  }

  async function nextHand() {
    celebratedHand.current = -1;
    await api.nextHand(tableId);
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

  const winnerText =
    state?.winners
      ?.map((w) => {
        const name =
          state.seats.find((s) => s.seatIndex === w.seatIndex)?.name ??
          `Seat ${w.seatIndex + 1}`;
        return `${name} +${w.amount}${w.handName ? ` · ${w.handName}` : ""}`;
      })
      .join(" · ") ?? "";

  function renderSeat(seat: PublicSeat, onFelt: boolean) {
    const pos = layout.get(seat.seatIndex);
    if (!pos) return null;
    const isWinner = winningSeatIndexes.has(seat.seatIndex);
    const winInfo = state?.winners?.find((w) => w.seatIndex === seat.seatIndex);
    const actionRu = seat.lastAction
      ? ACTION_LABEL_RU[seat.lastAction]
      : null;
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
          {isWinner && <span className="badge badge-win">WIN</span>}
        </div>
        {seat.avatarUrl ? (
          <img className="avatar" src={seat.avatarUrl} alt="" />
        ) : (
          <div className="avatar avatar-fallback">
            {(seat.name ?? "?")[0]}
          </div>
        )}
        {seat.inHand && !seat.holeCards && (
          <div className="opp-backs">
            <CardBack size="sm" />
            <CardBack size="sm" />
          </div>
        )}
        <div className="seat-meta">
          <div className="name">{seat.name}</div>
          {actionRu && !seat.isTurn && (
            <div
              className={`action-tag action-${seat.lastAction ?? "fold"}`}
            >
              {actionRu}
            </div>
          )}
          {winInfo?.handName && (
            <div className="hand-name">{winInfo.handName}</div>
          )}
          {seat.isTurn && (
            <div className="turn-bar">
              <div
                className="turn-bar-fill"
                style={{ transform: `scaleX(${turnLeft})` }}
              />
            </div>
          )}
        </div>
        <ChipStack amount={seat.stack} size="sm" className="seat-chips" />
        {seat.bet > 0 && (
          <div className={`bet-stack ${pos.isHero ? "bet-up" : "bet-down"}`}>
            <ChipStack amount={seat.bet} size="sm" />
          </div>
        )}
        {seat.holeCards && seat.holeCards.length > 0 && onFelt && (
          <div className="hole">
            {seat.holeCards.map((c) => (
              <PlayingCard
                key={c}
                card={c}
                size="sm"
                className="deal-in"
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
          className={`seat hero-inline ${seat.isTurn ? "turn" : ""} ${seat.folded ? "folded" : ""} ${isWinner ? "winner" : ""}`}
        >
          {body}
        </div>
      );
    }

    return (
      <div
        key={seat.seatIndex}
        className={`seat ${seat.isTurn ? "turn" : ""} ${seat.folded ? "folded" : ""} ${isWinner ? "winner" : ""}`}
        style={{ left: pos.left, top: pos.top }}
      >
        {body}
      </div>
    );
  }

  return (
    <div className="table-screen">
      <div className="table-topbar">
        <button type="button" className="secondary" onClick={onBack}>
          Lobby
        </button>
        <div className="table-status">
          <span className="street-pill">{streetLabel || "—"}</span>
          <span className="hint">Hand #{state?.handNo ?? 0}</span>
        </div>
        <div className="top-tools">
          <button
            type="button"
            className="icon-btn"
            onClick={() => setShowEmoji((v) => !v)}
            aria-label="Emoji"
          >
            😊
          </button>
          <button type="button" className="secondary" onClick={leave}>
            Leave
          </button>
        </div>
      </div>

      {error && <p className="error">{error}</p>}

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
          <div className="pot-area">
            {potDisplay > 0 ? (
              <ChipStack amount={potDisplay} size="md" />
            ) : (
              <div className="pot-empty">Pot 0</div>
            )}
            {state?.rakeTaken ? (
              <div className="hint" style={{ marginTop: 4, opacity: 0.85 }}>
                Rake {state.rakeTaken}
              </div>
            ) : state?.rakePercent ? (
              <div className="hint" style={{ marginTop: 4, opacity: 0.55 }}>
                Rake {state.rakePercent}% / {state.rakeCapBb}BB
              </div>
            ) : null}
          </div>
          {handLabel && <div className="strength-pill">{handLabel}</div>}
          <div className="board" key={boardAnimKey}>
            {revealedBoard.map((c, idx) => (
              <PlayingCard
                key={`${state?.handNo}-${idx}-${c}`}
                card={c}
                size="lg"
                className="deal-in"
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
          {winnerText ? (
            <div className="winner-banner winner-banner-glow">{winnerText}</div>
          ) : null}
        </div>

        {flying.map((f) => (
          <span
            key={f.id}
            className={`chip chip-fly chip-v${f.value}`}
            style={
              {
                "--dx": `${f.dx}px`,
                "--dy": `${f.dy}px`,
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

      {/* Hero strip */}
      {mySeat && (
        <div
          className={`hero-zone ${isMyTurn ? "hero-turn" : ""} ${winningSeatIndexes.has(mySeat.seatIndex) ? "winner" : ""}`}
        >
          {renderSeat(mySeat, false)}
          <div className="hero-cards">
            {mySeat.holeCards?.map((c) => (
              <PlayingCard
                key={c}
                card={c}
                size="hero"
                className="deal-in"
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
                <CardBack size="lg" />
                <CardBack size="lg" />
              </>
            )}
          </div>
          {handLabel && <div className="hero-strength">{handLabel}</div>}
        </div>
      )}

      {(state?.status === "hand_over" || state?.status === "waiting") && (
        <button
          type="button"
          className="primary-wide"
          onClick={async () => {
            try {
              setError(null);
              if (state?.status === "waiting") await api.startHand(tableId);
              else await nextHand();
            } catch (e) {
              setError(e instanceof Error ? e.message : "Start failed");
            }
          }}
        >
          {state?.status === "waiting" ? "Start hand" : "Next hand"}
        </button>
      )}

      {isMyTurn && (
        <div className="actions actions-live">
          <button
            type="button"
            disabled={!state?.legalActions.includes("fold")}
            onClick={() => act("fold")}
          >
            Fold
          </button>
          <button
            type="button"
            disabled={
              !(
                state?.legalActions.includes("check") ||
                state?.legalActions.includes("call")
              )
            }
            onClick={() => act(state?.canCheck ? "check" : "call")}
          >
            {state?.canCheck ? "Check" : `Call ${state?.callAmount ?? 0}`}
          </button>
          <button
            type="button"
            disabled={!state?.legalActions.includes("all-in")}
            onClick={() => act("all-in")}
          >
            All-in
          </button>
          <input
            type="number"
            value={raiseAmt}
            onChange={(e) => setRaiseAmt(Number(e.target.value))}
            style={{ gridColumn: "1 / 3", margin: 0 }}
          />
          <button
            type="button"
            disabled={
              !(
                state?.legalActions.includes("bet") ||
                state?.legalActions.includes("raise")
              )
            }
            onClick={() =>
              act(
                state?.legalActions.includes("bet") ? "bet" : "raise",
                raiseAmt,
              )
            }
          >
            Bet/Raise
          </button>
        </div>
      )}

      <div className="panel chat-panel">
        <div className="chat">
          {messages.map((m) => (
            <div key={m.id} className="msg">
              <strong>{m.name}</strong>: {m.text}
            </div>
          ))}
        </div>
        <form className="row" onSubmit={sendChat}>
          <input
            value={chatText}
            onChange={(e) => setChatText(e.target.value)}
            placeholder="Message the table…"
            style={{ margin: 0, flex: 1 }}
          />
          <button type="submit">Send</button>
        </form>
      </div>
    </div>
  );
}
