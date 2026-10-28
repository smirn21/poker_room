/** Decorative neon face-cards for lobby table tiles (visual only). */

const PAIRS = [
  {
    tone: "teal" as const,
    left: { rank: "A", suit: "♠", red: false },
    right: { rank: "A", suit: "♥", red: true },
  },
  {
    tone: "amber" as const,
    left: { rank: "K", suit: "♦", red: true },
    right: { rank: "K", suit: "♣", red: false },
  },
  {
    tone: "teal" as const,
    left: { rank: "Q", suit: "♠", red: false },
    right: { rank: "Q", suit: "♦", red: true },
  },
  {
    tone: "amber" as const,
    left: { rank: "J", suit: "♥", red: true },
    right: { rank: "J", suit: "♠", red: false },
  },
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
      <div className={`lobby-face lobby-face-left ${pair.left.red ? "red" : "black"}`}>
        <span className="lobby-face-rank">{pair.left.rank}</span>
        <span className="lobby-face-suit">{pair.left.suit}</span>
      </div>
      <div className={`lobby-face lobby-face-right ${pair.right.red ? "red" : "black"}`}>
        <span className="lobby-face-rank">{pair.right.rank}</span>
        <span className="lobby-face-suit">{pair.right.suit}</span>
      </div>
    </div>
  );
}
