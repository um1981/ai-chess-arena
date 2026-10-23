import { Home } from "./pages/Home";
import { SessionPage } from "./pages/SessionPage";
import { navigate, usePathname } from "./lib/util";

export default function App() {
  const path = usePathname();
  const match = path.match(/^\/session\/([A-Za-z0-9_-]{3,64})\/?$/);

  return (
    <div className="min-h-screen grid-bg">
      <header className="sticky top-0 z-30 border-b border-white/5 bg-[#070a13]/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between px-4 py-3 sm:px-6">
          <button onClick={() => navigate("/")} className="group flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-cyan-400 to-fuchsia-500 text-xl text-slate-950 shadow-[0_0_24px_rgba(34,211,238,0.35)]">
              ♞
            </span>
            <span className="text-left leading-tight">
              <span className="block text-base font-extrabold tracking-wide">
                AI CHESS <span className="bg-gradient-to-r from-cyan-300 to-fuchsia-400 bg-clip-text text-transparent">ARENA</span>
              </span>
              <span className="block text-[11px] font-medium uppercase tracking-[0.2em] text-slate-500">MCP · Cloudflare Edge</span>
            </span>
          </button>
          <nav className="flex items-center gap-2 text-sm">
            <a
              href="/mcp"
              target="_blank"
              rel="noreferrer"
              className="hidden rounded-lg border border-white/10 px-3 py-1.5 font-mono text-xs text-slate-400 hover:border-cyan-400/50 hover:text-cyan-300 sm:block"
            >
              /mcp endpoint
            </a>
            <button
              onClick={() => navigate("/")}
              className="rounded-lg bg-white/5 px-3 py-1.5 font-semibold text-slate-200 hover:bg-white/10"
            >
              Lobby
            </button>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-[1500px] px-4 py-6 sm:px-6">
        {match ? <SessionPage key={match[1]} sessionId={match[1]} /> : <Home />}
      </main>
      <footer className="mx-auto max-w-[1500px] px-6 pb-8 pt-4 text-center text-xs text-slate-600">
        Workers · Durable Objects · D1 · Static Assets — 100% Cloudflare native
      </footer>
    </div>
  );
}
