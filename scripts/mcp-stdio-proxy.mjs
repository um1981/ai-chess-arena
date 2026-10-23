#!/usr/bin/env node
/**
 * AI Chess Arena — local stdio <-> Remote MCP (Streamable HTTP) proxy.
 *
 * For MCP clients that only support stdio servers (e.g. Claude Desktop).
 * Zero dependencies, Node 18+.
 *
 * Usage:
 *   node scripts/mcp-stdio-proxy.mjs https://ai-chess-arena.<you>.workers.dev/mcp
 *   (or set CHESS_ARENA_MCP_URL)
 *
 * Claude Desktop config:
 *   { "mcpServers": { "chess-arena": { "command": "node",
 *       "args": ["C:/path/to/scripts/mcp-stdio-proxy.mjs", "https://.../mcp"] } } }
 */
import { createInterface } from "node:readline";

const url = process.argv[2] || process.env.CHESS_ARENA_MCP_URL;
if (!url) {
  process.stderr.write("Usage: node mcp-stdio-proxy.mjs <remote-mcp-url>\n");
  process.exit(1);
}

let sessionId = null;
let protocolVersion = null;
const log = (...a) => process.stderr.write(`[chess-arena-proxy] ${a.join(" ")}\n`);
const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");

async function forward(message) {
  const isRequest = message && message.id !== undefined && message.id !== null && typeof message.method === "string";
  try {
    const headers = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
    if (sessionId) headers["Mcp-Session-Id"] = sessionId;
    if (protocolVersion) headers["Mcp-Protocol-Version"] = protocolVersion;

    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(message) });
    const sid = res.headers.get("mcp-session-id");
    if (sid) sessionId = sid;
    if (res.status === 202 || res.status === 204) return;
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);

    const type = res.headers.get("content-type") || "";
    if (type.includes("text/event-stream")) {
      const decoder = new TextDecoder();
      let buffer = "";
      for await (const chunk of res.body) {
        buffer += decoder.decode(chunk, { stream: true });
        let idx;
        while ((idx = buffer.search(/\r?\n\r?\n/)) !== -1) {
          const raw = buffer.slice(0, idx);
          buffer = buffer.slice(idx).replace(/^\r?\n\r?\n/, "");
          const data = raw
            .split(/\r?\n/)
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.slice(5).trimStart())
            .join("\n");
          if (data) emit(JSON.parse(data));
        }
      }
    } else {
      const text = await res.text();
      if (text.trim()) emit(JSON.parse(text));
    }
  } catch (err) {
    log("error:", err?.message || err);
    if (isRequest) send({ jsonrpc: "2.0", id: message.id, error: { code: -32603, message: `Proxy error: ${err?.message || err}` } });
  }
}

function emit(payload) {
  for (const msg of Array.isArray(payload) ? payload : [payload]) {
    if (msg?.result?.protocolVersion) protocolVersion = msg.result.protocolVersion;
    send(msg);
  }
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    return;
  }
  // Fire concurrently: a long wait_for_turn must not block other requests.
  pending++;
  forward(msg).finally(() => {
    pending--;
    if (stdinClosed && pending === 0) process.exit(0);
  });
});
let pending = 0;
let stdinClosed = false;
rl.on("close", () => {
  stdinClosed = true;
  if (pending === 0) process.exit(0);
});
log(`proxying stdio -> ${url}`);
