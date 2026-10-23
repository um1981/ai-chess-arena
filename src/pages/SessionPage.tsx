import { useEffect, useMemo, useRef, useState } from "react";
import type { Color, MoveRecord, PlayerInfo, PublicState } from "../../shared/types";
import { ChessBoard, PieceGlyph, materialInfo } from "../components/ChessBoard";
import { McpConnect } from "../components/McpConnect";
import { useGameSocket } from "../lib/useGameSocket";
import { api, formatMs, formatSeconds, navigate, reasonLabel, useNow } from "../lib/util";
import { StatusBadge } from "./Home";

export function SessionPage({ sessionId }: { sessionId: string }) {
  const { state, setState, conn, error, clockOffset } = useGameSocket(sessionId);
  const [flipped, setFlipped] = useState(false);
  const [viewPly, setViewPly] = useState<number | null>(null); // null = live
  const [busy, setBusy] = useState(false);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const now = useNow(100, state?.status === "playing");

  // Snap back to live view when a new move arrives while watching live
  const moveCount = state?.moveCount ?? 0;
  useEffect(() => {
    setViewPly((v) => (v !== null && v >= moveCount ? null : v));
  }, [moveCount]);

  // Keyboard navigation through history
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!state || (e.target as HTMLElement)?.tagName === "INPUT") return;
      const cur = viewPly ?? state.moveCount;
      if (e.key === "ArrowLeft") setViewPly(Math.max(0, cur - 1));
      if (e.key === "ArrowRight") setViewPly(cur + 1 >= state.moveCount ? null : cur + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state, viewPly]);

  if (!state) {
    return (
      <div className="glass mx-auto max-w-lg rounded-3xl p-10 text-center">
        {error ? (
          <>
            <div className="mb-2 text-4xl">♟</div>
            <p className="text-lg font-bold">{error}</p>
            <p className="mt-1 font-mono text-sm text-slate-500">#{sessionId}</p>
            <button onClick={() => navigate("/")} className="mt-6 rounded-xl bg-white/10 px-5 py-2 font-semibold hover:bg-white/15">
              Back to lobby
            </button>
          </>
        ) : (
          <p className="animate-pulse text-slate-400">Connecting to arena…</p>
        )}
      </div>
    );
  }

  const serverNow = now + clockOffset;
  const running = state.status === "playing" && state.turnStartedAt ? Math.max(0, serverNow - state.turnStartedAt) : 0;

  const viewing = viewPly !== null && viewPly < state.moveCount;
  const viewMove: MoveRecord | null = viewing && viewPly! > 0 ? state.moves[viewPly! - 1] : null;
  const boardFen = viewing ? (viewPly === 0 ? "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1" : viewMove!.fenAfter) : state.fen;
  const boardLast = viewing ? (viewMove ? { from: viewMove.from, to: viewMove.to } : null) : state.lastMove;
  const material = materialInfo(boardFen);

  const doAction = async (action: "start" | "abort") => {
    if (action === "abort" && !confirm("ยุติเกมนี้ (abort)?")) return;
    setBusy(true);
    setActionErr(null);
    try {
      const r = await api<{ state: PublicState }>(`/api/session/${sessionId}/${action}`, { method: "POST", body: "{}" });
      setState(r.state);
    } catch (e: any) {
      setActionErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const top: Color = flipped ? "w" : "b";
  const bottom: Color = flipped ? "b" : "w";
  const card = (c: Color) => (
    <PlayerCard
      color={c}
      info={c === "w" ? state.white : state.black}
      active={state.status === "playing" && state.turn === c}
      liveMs={state.status === "playing" && state.turn === c ? running : 0}
      captured={c === "w" ? material.capturedByWhite : material.capturedByBlack}
      advantage={c === "w" ? material.balance : -material.balance}
      winner={state.status === "finished" ? state.winner : null}
    />
  );

  const bothJoined = state.white.joined && state.black.joined;

  return (
    <div className="space-y-5">
      {/* Session header bar */}
      <div className="glass flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-mono text-lg font-bold text-slate-200">#{state.sessionId}</span>
          <StatusBadge status={state.status} />
          <ConnBadge conn={conn} />
          <span className="text-sm text-slate-500">
            Move {Math.floor(state.moveCount / 2) + 1} · {state.moveCount} plies
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {state.status === "waiting" && (
            <button
              onClick={() => doAction("start")}
              disabled={!bothJoined || busy}
              title={bothJoined ? "Start the game" : "Waiting for both agents to join"}
              className={`rounded-xl px-5 py-2 font-bold transition ${
                bothJoined
                  ? "pulse-ring bg-gradient-to-r from-emerald-400 to-cyan-400 text-slate-950 hover:brightness-110"
                  : "cursor-not-allowed bg-white/5 text-slate-500"
              }`}
            >
              ▶ Start Game
            </button>
          )}
          {state.status !== "finished" && (
            <button
              onClick={() => doAction("abort")}
              disabled={busy}
              className="rounded-xl border border-rose-500/30 px-4 py-2 text-sm font-semibold text-rose-300 hover:bg-rose-500/10"
            >
              Abort
            </button>
          )}
          <button onClick={() => setFlipped((f) => !f)} className="rounded-xl bg-white/5 px-3 py-2 text-sm font-semibold hover:bg-white/10" title="Flip board">
            ⇅ Flip
          </button>
          <PgnButtons state={state} />
        </div>
      </div>
      {actionErr && <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-sm text-rose-300">{actionErr}</div>}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_420px] xl:grid-cols-[minmax(0,1fr)_480px]">
        {/* Board column */}
        <div className="mx-auto w-full max-w-[calc(100vh-150px)] space-y-3">
          {card(top)}
          <div className="relative">
            <ChessBoard fen={boardFen} lastMove={boardLast} inCheck={!viewing && state.inCheck} flipped={flipped} />
            {state.status === "finished" && !viewing && <GameOverOverlay state={state} />}
            {state.status === "waiting" && <WaitingOverlay state={state} />}
          </div>
          {card(bottom)}
          {/* History navigation */}
          <div className="flex items-center justify-center gap-2">
            {[
              ["⏮", () => setViewPly(0)],
              ["◀", () => setViewPly(Math.max(0, (viewPly ?? state.moveCount) - 1))],
              ["▶", () => { const n = (viewPly ?? state.moveCount) + 1; setViewPly(n >= state.moveCount ? null : n); }],
              ["⏭", () => setViewPly(null)],
            ].map(([label, fn]) => (
              <button
                key={label as string}
                onClick={fn as () => void}
                disabled={state.moveCount === 0}
                className="h-9 w-12 rounded-lg bg-white/5 text-sm hover:bg-white/10 disabled:opacity-30"
              >
                {label as string}
              </button>
            ))}
            {viewing && (
              <span className="ml-2 rounded-full bg-amber-400/10 px-3 py-1 text-xs font-semibold text-amber-300 ring-1 ring-amber-400/30">
                Replay · ply {viewPly}/{state.moveCount}
              </span>
            )}
          </div>
        </div>

        {/* Side panels */}
        <div className="space-y-5">
          <CommentaryPanel state={state} />
          <MoveList moves={state.moves} viewPly={viewing ? viewPly : null} onSelect={(p) => setViewPly(p >= state.moveCount ? null : p)} />
          <ThinkChart moves={state.moves} white={state.white} black={state.black} />
          <McpConnect sessionId={state.sessionId} />
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ pieces

function ConnBadge({ conn }: { conn: string }) {
  const live = conn === "live";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${live ? "text-cyan-300" : "text-amber-300"}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${live ? "bg-cyan-300 shadow-[0_0_8px_#22d3ee]" : "animate-pulse bg-amber-300"}`} />
      {live ? "WebSocket live" : conn}
    </span>
  );
}

function PlayerCard(props: {
  color: Color;
  info: PlayerInfo;
  active: boolean;
  liveMs: number;
  captured: string[];
  advantage: number;
  winner: PublicState["winner"];
}) {
  const { color, info, active, liveMs, captured, advantage, winner } = props;
  const isWinner = winner === color;
  const total = info.timeMs + liveMs;
  return (
    <div
      className={`flex items-center gap-3 rounded-2xl border px-4 py-3 transition ${
        active
          ? "border-cyan-400/50 bg-cyan-400/[0.07] shadow-[0_0_30px_-8px_rgba(34,211,238,0.6)]"
          : isWinner
            ? "border-amber-400/50 bg-amber-400/[0.07]"
            : "border-white/5 bg-black/25"
      }`}
    >
      <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl text-2xl ${color === "w" ? "bg-slate-100" : "bg-slate-800 ring-1 ring-slate-600"}`}>
        <PieceGlyph piece={color === "w" ? "K" : "k"} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={`truncate font-bold ${info.name ? "text-slate-100" : "italic text-slate-600"}`}>
            {info.name ?? "Waiting for agent…"}
          </span>
          {isWinner && <span className="text-sm">🏆</span>}
          {active && <span className="rounded bg-cyan-400/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-cyan-300">thinking</span>}
        </div>
        <div className="mt-0.5 flex h-5 items-center gap-0.5 text-base">
          <span className="mr-1 text-[10px] font-semibold uppercase tracking-widest text-slate-500">{color === "w" ? "White" : "Black"}</span>
          {captured.map((p, i) => (
            <PieceGlyph key={i} piece={color === "w" ? p : p.toUpperCase()} className="-ml-1 text-[15px] opacity-90" />
          ))}
          {advantage > 0 && <span className="ml-1 text-xs font-bold text-emerald-400">+{advantage}</span>}
        </div>
      </div>
      <div className="text-right">
        <div className={`font-mono text-2xl font-bold tabular-nums ${active ? "text-cyan-300" : "text-slate-300"}`}>{formatMs(total)}</div>
        <div className="font-mono text-[11px] tabular-nums text-slate-500">
          {active ? <>this move {formatMs(liveMs, true)}</> : "total think time"}
        </div>
      </div>
    </div>
  );
}

function WaitingOverlay({ state }: { state: PublicState }) {
  const both = state.white.joined && state.black.joined;
  return (
    <div className="absolute inset-0 grid place-items-center rounded-2xl bg-[#070a13]/70 backdrop-blur-[2px]">
      <div className="mx-6 max-w-sm rounded-2xl border border-white/10 bg-black/60 p-6 text-center">
        <div className="mb-2 text-4xl">{both ? "⚔️" : "⏳"}</div>
        <p className="text-lg font-bold">{both ? "Both agents are ready" : "Waiting for agents to join"}</p>
        <p className="mt-1 text-sm text-slate-400">
          {both ? "กด ▶ Start Game เพื่อเริ่มการแข่งขัน" : `${Number(state.white.joined) + Number(state.black.joined)}/2 joined — เชื่อม Agent ผ่าน MCP (ดูแผง Connect)`}
        </p>
      </div>
    </div>
  );
}

function GameOverOverlay({ state }: { state: PublicState }) {
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;
  const title = state.winner === "draw" ? "Draw" : state.winner ? `${state.winner === "w" ? state.white.name : state.black.name} wins!` : "Game aborted";
  const result = state.winner === "w" ? "1 – 0" : state.winner === "b" ? "0 – 1" : state.winner === "draw" ? "½ – ½" : "–";
  return (
    <div className="absolute inset-0 grid place-items-center rounded-2xl bg-[#070a13]/60 backdrop-blur-[2px]" onClick={() => setHidden(true)}>
      <div className="mx-6 rounded-2xl border border-amber-400/30 bg-black/70 px-8 py-6 text-center shadow-[0_0_60px_-10px_rgba(251,191,36,0.5)]">
        <div className="text-xs font-bold uppercase tracking-[0.3em] text-amber-300">Game Over</div>
        <div className="mt-2 text-3xl font-black">{title}</div>
        <div className="mt-1 font-mono text-xl text-slate-300">{result}</div>
        <div className="mt-1 text-sm text-slate-400">{reasonLabel(state.endReason)}</div>
        <div className="mt-4 text-[11px] text-slate-500">click to dismiss</div>
      </div>
    </div>
  );
}

function CommentaryPanel({ state }: { state: PublicState }) {
  const items = useMemo(() => [...state.moves].reverse().slice(0, 40), [state.moves]);
  return (
    <section className="glass rounded-2xl p-4">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-slate-400">
        <span className="text-fuchsia-400">●</span> Live Commentary
      </h3>
      <div className="scrollbar-thin max-h-72 space-y-2 overflow-y-auto pr-1">
        {items.length === 0 && <p className="py-6 text-center text-sm text-slate-600">ยังไม่มีการเดินหมาก</p>}
        {items.map((m, i) => (
          <div
            key={m.moveNumber}
            className={`rounded-xl border px-3 py-2 ${i === 0 ? "border-fuchsia-400/30 bg-fuchsia-400/[0.06]" : "border-white/5 bg-black/20"}`}
          >
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="flex items-center gap-2">
                <span className={`h-2.5 w-2.5 rounded-sm ${m.color === "w" ? "bg-slate-100" : "bg-slate-800 ring-1 ring-slate-500"}`} />
                <span className="font-semibold text-slate-300">{m.agent}</span>
                <span className="font-mono font-bold text-cyan-300">
                  {Math.ceil(m.moveNumber / 2)}
                  {m.color === "w" ? "." : "…"} {m.san}
                </span>
              </span>
              <span className="font-mono text-slate-500">⏱ {formatSeconds(m.timeSpentMs)}</span>
            </div>
            {m.commentary && <p className="mt-1.5 text-sm leading-relaxed text-slate-300">{m.commentary}</p>}
          </div>
        ))}
      </div>
    </section>
  );
}

function MoveList({ moves, viewPly, onSelect }: { moves: MoveRecord[]; viewPly: number | null; onSelect: (ply: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (viewPly === null && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [moves.length, viewPly]);
  const rows: [MoveRecord, MoveRecord | undefined][] = [];
  for (let i = 0; i < moves.length; i += 2) rows.push([moves[i], moves[i + 1]]);
  const current = viewPly ?? moves.length;
  const cell = (m: MoveRecord | undefined) =>
    m ? (
      <button
        onClick={() => onSelect(m.moveNumber)}
        className={`flex w-full items-center justify-between rounded-md px-2 py-1 text-left font-mono text-sm transition hover:bg-white/10 ${
          current === m.moveNumber ? "bg-cyan-400/20 text-cyan-200" : "text-slate-200"
        }`}
      >
        <span className="font-semibold">{m.san}</span>
        <span className="text-[10px] text-slate-500">{formatSeconds(m.timeSpentMs)}</span>
      </button>
    ) : (
      <span />
    );
  return (
    <section className="glass rounded-2xl p-4">
      <h3 className="mb-3 text-sm font-bold uppercase tracking-widest text-slate-400">Moves</h3>
      <div ref={ref} className="scrollbar-thin max-h-56 overflow-y-auto pr-1">
        {rows.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-600">—</p>
        ) : (
          <div className="grid grid-cols-[2.5rem_1fr_1fr] gap-x-1 gap-y-0.5">
            {rows.map(([w, b], i) => (
              <div key={i} className="contents">
                <span className="py-1 text-right font-mono text-xs leading-6 text-slate-600">{i + 1}.</span>
                {cell(w)}
                {cell(b)}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function ThinkChart({ moves, white, black }: { moves: MoveRecord[]; white: PlayerInfo; black: PlayerInfo }) {
  if (moves.length === 0) return null;
  const max = Math.max(...moves.map((m) => m.timeSpentMs), 1);
  const avg = (c: Color) => {
    const ms = moves.filter((m) => m.color === c);
    return ms.length ? ms.reduce((a, m) => a + m.timeSpentMs, 0) / ms.length : 0;
  };
  return (
    <section className="glass rounded-2xl p-4">
      <h3 className="mb-3 text-sm font-bold uppercase tracking-widest text-slate-400">Thinking Time</h3>
      <div className="flex h-24 items-end gap-[2px] overflow-hidden">
        {moves.slice(-80).map((m) => (
          <div
            key={m.moveNumber}
            title={`${Math.ceil(m.moveNumber / 2)}${m.color === "w" ? "." : "…"} ${m.san} — ${formatSeconds(m.timeSpentMs)}`}
            className={`min-w-[3px] flex-1 rounded-t-sm ${m.color === "w" ? "bg-slate-200/80" : "bg-fuchsia-400/80"}`}
            style={{ height: `${Math.max(4, (m.timeSpentMs / max) * 100)}%` }}
          />
        ))}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg bg-black/25 px-3 py-2">
          <div className="text-slate-500">⬜ {white.name ?? "White"}</div>
          <div className="font-mono text-slate-200">avg {formatSeconds(Math.round(avg("w")))} · total {formatMs(white.timeMs)}</div>
        </div>
        <div className="rounded-lg bg-black/25 px-3 py-2">
          <div className="text-fuchsia-300/80">⬛ {black.name ?? "Black"}</div>
          <div className="font-mono text-slate-200">avg {formatSeconds(Math.round(avg("b")))} · total {formatMs(black.timeMs)}</div>
        </div>
      </div>
    </section>
  );
}

function PgnButtons({ state }: { state: PublicState }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(state.pgn);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const download = () => {
    const blob = new Blob([state.pgn], { type: "application/x-chess-pgn" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `chess-arena-${state.sessionId}.pgn`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <div className="flex overflow-hidden rounded-xl bg-white/5 text-sm font-semibold">
      <button onClick={copy} className="px-3 py-2 hover:bg-white/10">
        {copied ? "✓ Copied" : "PGN"}
      </button>
      <button onClick={download} className="border-l border-white/10 px-3 py-2 hover:bg-white/10" title="Download PGN">
        ⤓
      </button>
    </div>
  );
}
