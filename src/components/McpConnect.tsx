import { useState } from "react";

function CopyBlock({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="group relative">
      {label && <div className="mb-1 text-[11px] font-semibold uppercase tracking-widest text-slate-500">{label}</div>}
      <pre className="scrollbar-thin overflow-x-auto whitespace-pre-wrap break-all rounded-xl border border-white/5 bg-black/40 p-3 pr-16 font-mono text-[12px] leading-relaxed text-slate-300">
        {text}
      </pre>
      <button
        onClick={async () => {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
        }}
        className="absolute right-2 top-2 rounded-md bg-white/10 px-2 py-1 text-[11px] font-semibold text-slate-200 hover:bg-white/20"
        style={label ? { top: "1.75rem" } : undefined}
      >
        {copied ? "✓" : "Copy"}
      </button>
    </div>
  );
}

export function McpConnect({ sessionId }: { sessionId: string }) {
  const [tab, setTab] = useState<"prompt" | "remote" | "stdio">("prompt");
  const url = `${location.origin}/mcp`;

  const prompt = (name: string) =>
    `Use the "chess-arena" MCP tools. Join chess session "${sessionId}" with agent_name "${name}" and play a complete game of chess until it is over. Loop: call wait_for_turn; when status is "your_turn", pick the strongest legal move and call make_move with a short commentary explaining your idea; otherwise call wait_for_turn again. Never stop until status is "game_over".`;

  return (
    <section className="glass rounded-2xl p-4">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-slate-400">
        <span className="text-cyan-400">⚡</span> Connect AI Agents (MCP)
      </h3>
      <div className="mb-3 flex gap-1 rounded-xl bg-black/30 p-1 text-xs font-semibold">
        {(
          [
            ["prompt", "1 · Agent prompt"],
            ["remote", "2 · Remote MCP"],
            ["stdio", "3 · stdio proxy"],
          ] as const
        ).map(([k, l]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`flex-1 rounded-lg px-2 py-1.5 transition ${tab === k ? "bg-white/10 text-white" : "text-slate-500 hover:text-slate-300"}`}
          >
            {l}
          </button>
        ))}
      </div>

      {tab === "prompt" && (
        <div className="space-y-3">
          <p className="text-xs text-slate-400">หลังจากเชื่อม MCP แล้ว ส่ง prompt นี้ให้ Agent แต่ละตัว (เปลี่ยนชื่อได้):</p>
          <CopyBlock label="Agent A" text={prompt("Agent A")} />
          <CopyBlock label="Agent B" text={prompt("Agent B")} />
        </div>
      )}

      {tab === "remote" && (
        <div className="space-y-3">
          <CopyBlock label="MCP URL (Streamable HTTP)" text={url} />
          <CopyBlock label="Claude Code" text={`claude mcp add --transport http chess-arena ${url}`} />
          <CopyBlock
            label="Cursor / VS Code / Windsurf (mcp.json)"
            text={JSON.stringify({ mcpServers: { "chess-arena": { url } } }, null, 2)}
          />
          <CopyBlock label="Gemini CLI (settings.json)" text={JSON.stringify({ mcpServers: { "chess-arena": { httpUrl: url } } }, null, 2)} />
        </div>
      )}

      {tab === "stdio" && (
        <div className="space-y-3">
          <p className="text-xs text-slate-400">สำหรับ MCP client ที่รองรับเฉพาะ stdio (เช่น Claude Desktop):</p>
          <CopyBlock
            label="Bundled proxy (scripts/mcp-stdio-proxy.mjs)"
            text={JSON.stringify(
              { mcpServers: { "chess-arena": { command: "node", args: ["/path/to/ai-chess-arena/scripts/mcp-stdio-proxy.mjs", url] } } },
              null,
              2
            )}
          />
          <CopyBlock
            label="or via mcp-remote"
            text={JSON.stringify({ mcpServers: { "chess-arena": { command: "npx", args: ["-y", "mcp-remote", url] } } }, null, 2)}
          />
        </div>
      )}
    </section>
  );
}
