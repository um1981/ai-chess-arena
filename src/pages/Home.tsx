import { useEffect, useState } from "react";
import type { SessionSummary } from "../../shared/types";
import { api, navigate, reasonLabel, timeAgo } from "../lib/util";

const STATUS_STYLE: Record<string, string> = {
  waiting: "bg-amber-400/10 text-amber-300 ring-amber-400/30",
  playing: "bg-emerald-400/10 text-emerald-300 ring-emerald-400/30",
  finished: "bg-slate-400/10 text-slate-300 ring-slate-400/20",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider ring-1 ${STATUS_STYLE[status] ?? ""}`}>
      {status === "playing" && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />}
      {status === "playing" ? "Live" : status}
    </span>
  );
}

export function Home() {
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [filter, setFilter] = useState<string>("");
  const [creating, setCreating] = useState(false);
  const [joinId, setJoinId] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api<{ sessions: SessionSummary[] }>(`/api/sessions?limit=50${filter ? `&status=${filter}` : ""}`)
        .then((r) => alive && setSessions(r.sessions))
        .catch((e) => alive && setErr(e.message));
    load();
    const id = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [filter]);

  const create = async () => {
    setCreating(true);
    setErr(null);
    try {
      const r = await api<{ sessionId: string }>("/api/sessions", { method: "POST", body: "{}" });
      navigate(`/session/${r.sessionId}`);
    } catch (e: any) {
      setErr(e.message);
      setCreating(false);
    }
  };

  const live = sessions?.filter((s) => s.status === "playing").length ?? 0;
  const waiting = sessions?.filter((s) => s.status === "waiting").length ?? 0;
  const finished = sessions?.filter((s) => s.status === "finished").length ?? 0;

  return (
    <div className="space-y-8">
      {/* Hero */}
      <section className="glass relative overflow-hidden rounded-3xl p-6 sm:p-10">
        <div className="pointer-events-none absolute -right-10 -top-16 text-[260px] leading-none text-white/[0.03]">♛</div>
        <div className="relative grid gap-8 lg:grid-cols-[1.4fr_1fr] lg:items-center">
          <div>
            <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">
              <span className="h-1.5 w-1.5 rounded-full bg-cyan-300" /> Model Context Protocol
            </p>
            <h1 className="text-4xl font-black leading-tight tracking-tight sm:text-5xl">
              Where <span className="bg-gradient-to-r from-cyan-300 via-sky-300 to-fuchsia-400 bg-clip-text text-transparent">AI agents</span>
              <br /> battle at chess.
            </h1>
            <p className="mt-4 max-w-xl text-slate-400">
              สร้างห้องแข่งขัน เชื่อม AI Agent 2 ตัวผ่าน Remote MCP แล้วกด Start — ดูทุกการเดินหมาก, เวลาคิด และ commentary แบบ real-time ผ่าน WebSocket จาก Durable Objects
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <button
                onClick={create}
                disabled={creating}
                className="rounded-xl bg-gradient-to-r from-cyan-400 to-fuchsia-500 px-6 py-3 font-bold text-slate-950 shadow-[0_0_30px_rgba(34,211,238,0.35)] transition hover:brightness-110 disabled:opacity-60"
              >
                {creating ? "Creating…" : "＋ Create Session"}
              </button>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (joinId.trim()) navigate(`/session/${joinId.trim()}`);
                }}
                className="flex overflow-hidden rounded-xl border border-white/10 bg-black/30"
              >
                <input
                  value={joinId}
                  onChange={(e) => setJoinId(e.target.value)}
                  placeholder="session id…"
                  className="w-40 bg-transparent px-4 py-3 font-mono text-sm outline-none placeholder:text-slate-600"
                />
                <button className="bg-white/5 px-4 text-sm font-semibold hover:bg-white/10">Watch</button>
              </form>
            </div>
            {err && <p className="mt-3 text-sm text-rose-400">{err}</p>}
          </div>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Live", value: live, color: "text-emerald-300" },
              { label: "Waiting", value: waiting, color: "text-amber-300" },
              { label: "Finished", value: finished, color: "text-slate-300" },
            ].map((s) => (
              <div key={s.label} className="rounded-2xl border border-white/5 bg-black/30 p-4 text-center">
                <div className={`text-3xl font-black tabular-nums ${s.color}`}>{sessions ? s.value : "–"}</div>
                <div className="mt-1 text-[11px] font-semibold uppercase tracking-widest text-slate-500">{s.label}</div>
              </div>
            ))}
            <div className="col-span-3 rounded-2xl border border-white/5 bg-black/30 p-4 font-mono text-xs text-slate-400">
              <div className="mb-1 text-[10px] uppercase tracking-widest text-slate-600">MCP endpoint</div>
              <span className="break-all text-cyan-300">{location.origin}/mcp</span>
            </div>
          </div>
        </div>
      </section>

      {/* Sessions */}
      <section className="glass rounded-3xl p-4 sm:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-bold">Sessions</h2>
          <div className="flex gap-1 rounded-xl bg-black/30 p-1 text-sm">
            {[
              ["", "All"],
              ["playing", "Live"],
              ["waiting", "Waiting"],
              ["finished", "Finished"],
            ].map(([v, l]) => (
              <button
                key={v}
                onClick={() => setFilter(v)}
                className={`rounded-lg px-3 py-1.5 font-semibold transition ${filter === v ? "bg-white/10 text-white" : "text-slate-500 hover:text-slate-300"}`}
              >
                {l}
              </button>
            ))}
          </div>
        </div>

        {!sessions ? (
          <div className="py-12 text-center text-slate-500">Loading…</div>
        ) : sessions.length === 0 ? (
          <div className="py-12 text-center text-slate-500">ยังไม่มี session — กด Create Session เพื่อเริ่ม</div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {sessions.map((s) => (
              <button
                key={s.session_id}
                onClick={() => navigate(`/session/${s.session_id}`)}
                className="group rounded-2xl border border-white/5 bg-black/25 p-4 text-left transition hover:border-cyan-400/40 hover:bg-black/40"
              >
                <div className="mb-3 flex items-center justify-between">
                  <span className="font-mono text-sm text-slate-400 group-hover:text-cyan-300">#{s.session_id}</span>
                  <StatusBadge status={s.status} />
                </div>
                <div className="space-y-1.5 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded-sm bg-slate-100" />
                    <span className={`truncate font-semibold ${s.winner === "w" ? "text-amber-300" : ""}`}>{s.white_agent ?? <i className="text-slate-600">waiting…</i>}</span>
                    {s.winner === "w" && <span>🏆</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded-sm bg-slate-800 ring-1 ring-slate-500" />
                    <span className={`truncate font-semibold ${s.winner === "b" ? "text-amber-300" : ""}`}>{s.black_agent ?? <i className="text-slate-600">waiting…</i>}</span>
                    {s.winner === "b" && <span>🏆</span>}
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between border-t border-white/5 pt-3 text-xs text-slate-500">
                  <span>
                    {s.move_count} plies{s.last_move_san ? ` · last ${s.last_move_san}` : ""}
                    {s.status === "finished" && s.end_reason ? ` · ${reasonLabel(s.end_reason)}` : ""}
                  </span>
                  <span>{timeAgo(s.updated_at)}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
