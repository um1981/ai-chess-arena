import { useMemo, type CSSProperties } from "react";

const GLYPH: Record<string, string> = { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟\uFE0E" };
const FILES = "abcdefgh";

export function parseFen(fen: string): (string | null)[][] {
  const rows = fen.split(" ")[0].split("/");
  return rows.map((row) => {
    const out: (string | null)[] = [];
    for (const ch of row) {
      if (/\d/.test(ch)) for (let i = 0; i < Number(ch); i++) out.push(null);
      else out.push(ch);
    }
    return out;
  });
}

const START_COUNT: Record<string, number> = { p: 8, n: 2, b: 2, r: 2, q: 1 };
const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 };

/** Pieces each side has captured + material balance (positive = white ahead). */
export function materialInfo(fen: string) {
  const board = parseFen(fen).flat();
  const count = (p: string) => board.filter((x) => x === p).length;
  const capturedByWhite: string[] = [];
  const capturedByBlack: string[] = [];
  let balance = 0;
  for (const t of ["q", "r", "b", "n", "p"]) {
    const w = count(t.toUpperCase());
    const b = count(t);
    for (let i = 0; i < Math.max(0, START_COUNT[t] - b); i++) capturedByWhite.push(t);
    for (let i = 0; i < Math.max(0, START_COUNT[t] - w); i++) capturedByBlack.push(t);
    balance += (w - b) * VALUE[t];
  }
  return { capturedByWhite, capturedByBlack, balance };
}

export function PieceGlyph({ piece, className = "", style }: { piece: string; className?: string; style?: CSSProperties }) {
  const isWhite = piece === piece.toUpperCase();
  return (
    <span className={`piece ${isWhite ? "piece-w" : "piece-b"} ${className}`} style={style}>
      {GLYPH[piece.toLowerCase()]}
    </span>
  );
}

interface Props {
  fen: string;
  lastMove?: { from: string; to: string } | null;
  inCheck?: boolean;
  flipped?: boolean;
}

export function ChessBoard({ fen, lastMove, inCheck, flipped }: Props) {
  const board = useMemo(() => parseFen(fen), [fen]);
  const turn = fen.split(" ")[1] ?? "w";

  const ranks = flipped ? [0, 1, 2, 3, 4, 5, 6, 7].reverse() : [0, 1, 2, 3, 4, 5, 6, 7];
  const files = flipped ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];

  return (
    <div
      className="relative aspect-square w-full select-none overflow-hidden rounded-2xl border border-white/10 shadow-[0_0_60px_-10px_rgba(34,211,238,0.25)]"
      style={{ containerType: "inline-size" }}
    >
      <div className="grid h-full w-full grid-cols-8 grid-rows-8">
        {ranks.map((r, ri) =>
          files.map((f, fi) => {
            const square = `${FILES[f]}${8 - r}`;
            const piece = board[r]?.[f] ?? null;
            const dark = (r + f) % 2 === 1;
            const isFrom = lastMove?.from === square;
            const isTo = lastMove?.to === square;
            const checked = inCheck && piece && piece.toLowerCase() === "k" && (turn === "w" ? piece === "K" : piece === "k");
            return (
              <div
                key={square}
                className={`relative flex items-center justify-center ${dark ? "bg-[#2b3a55]" : "bg-[#8ea3c4]"}`}
              >
                {(isFrom || isTo) && (
                  <div className={`absolute inset-0 ${isTo ? "bg-cyan-300/45" : "bg-cyan-300/25"}`} />
                )}
                {checked && (
                  <div className="absolute inset-0 bg-[radial-gradient(circle,rgba(244,63,94,0.95)_0%,rgba(244,63,94,0.35)_55%,transparent_75%)]" />
                )}
                {fi === 0 && (
                  <span className={`absolute left-1 top-0.5 text-[10px] font-bold sm:text-xs ${dark ? "text-[#8ea3c4]" : "text-[#2b3a55]"}`}>
                    {8 - r}
                  </span>
                )}
                {ri === 7 && (
                  <span className={`absolute bottom-0.5 right-1 text-[10px] font-bold sm:text-xs ${dark ? "text-[#8ea3c4]" : "text-[#2b3a55]"}`}>
                    {FILES[f]}
                  </span>
                )}
                {piece && (
                  <PieceGlyph
                    key={isTo ? `${square}-${fen}` : square}
                    piece={piece}
                    className={`relative z-10 ${isTo ? "animate-land" : ""}`}
                    style={{ fontSize: "10cqw" }}
                  />
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
