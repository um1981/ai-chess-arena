/**
 * Remote MCP server (Streamable HTTP transport, stateless).
 *
 *  POST /mcp  - JSON-RPC request(s). Responds with application/json, or with a
 *               text/event-stream (SSE) for long-running tools when the client
 *               accepts it (keep-alive comments + progress notifications keep the
 *               connection warm while an agent waits for its opponent).
 *  GET  /mcp  - 405 (no server-initiated stream; allowed by the spec)
 */
import type { Env } from "./env";
import { createSession, isValidSessionId, listSessions, roomStub } from "./sessions";

const SERVER_INFO = { name: "ai-chess-arena", title: "AI Chess Arena", version: "1.0.0" };
const SUPPORTED_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const LONG_RUNNING_TOOLS = new Set(["wait_for_turn"]);

const INSTRUCTIONS = `You are a chess-playing AI agent in the AI Chess Arena.
Game loop:
1. join_session(session_id, agent_name) -> remember your color and player_token.
2. Loop: wait_for_turn(session_id, player_token)
   - status "your_turn": analyse board/FEN, pick ONE move from legal_moves_san and call make_move (add short commentary explaining your idea; spectators see it live).
   - status "waiting_for_start" / "waiting_for_opponent": simply call wait_for_turn again.
   - status "game_over": stop and report the result.
Never stop calling wait_for_turn until the game is over. Moves accept SAN (Nf3, O-O, e8=Q) or UCI (g1f3, e7e8q).`;

type JsonRpcId = string | number | null;
interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: any;
}

interface ToolContext {
  env: Env;
  origin: string;
  progress?: (message: string) => void;
  requestSessionId?: string | null;
}

const sid = { type: "string", description: "Session ID (e.g. cfjn-vxzd) shown on spectator web page or in list_sessions" };
const tok = { type: "string", description: "Secret player_token returned by join_session" };

const TOOLS = [
  {
    name: "list_sessions",
    title: "List sessions",
    description: "List recent chess sessions. Use status='waiting' to find a room that needs players.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["waiting", "playing", "finished"] },
        limit: { type: "number", description: "Max rows (default 20)" },
      },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "create_session",
    title: "Create session",
    description: "Create a new empty chess session (room). Returns session_id and the spectator URL.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "join_session",
    title: "Join session",
    description: "Join a session as a player. Returns your color ('w' or 'b') and a secret player_token required for every other call.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: sid,
        sessionId: { type: "string", description: "Alias for session_id" },
        agent_name: { type: "string", description: "Display name, e.g. 'Claude Opus' or 'GPT-5'" },
        agentName: { type: "string", description: "Alias for agent_name" },
        preferred_color: {
          type: "string",
          enum: ["white", "black", "any"],
          description: "Default: any. If your preferred color is already taken, you will automatically be assigned the available color.",
        },
        preferredColor: { type: "string", enum: ["white", "black", "any"], description: "Alias for preferred_color" },
      },
      required: ["agent_name"],
    },
  },
  {
    name: "wait_for_turn",
    title: "Wait for my turn",
    description:
      "Block until it is your turn, the game ends, or timeout_seconds elapses. Returns status (your_turn | waiting_for_start | waiting_for_opponent | game_over), FEN, ASCII board, last move and legal moves. If status is not your_turn and not game_over, call it again.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: sid,
        sessionId: { type: "string", description: "Alias for session_id (optional if player_token provided)" },
        player_token: tok,
        playerToken: { type: "string", description: "Alias for player_token" },
        timeout_seconds: { type: "number", description: "Max seconds to wait (default 45, max 600)" },
        timeoutSeconds: { type: "number", description: "Alias for timeout_seconds" },
      },
      required: ["player_token"],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "make_move",
    title: "Make a move",
    description: "Play a move when it is your turn. Accepts SAN (e4, Nf3, O-O, exd5, e8=Q) or UCI (e2e4, e7e8q). Optional commentary is shown live to spectators.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: sid,
        sessionId: { type: "string", description: "Alias for session_id (optional if player_token provided)" },
        player_token: tok,
        playerToken: { type: "string", description: "Alias for player_token" },
        move: { type: "string", description: "Move in SAN or UCI" },
        commentary: { type: "string", description: "Short explanation of your idea (max 1000 chars)" },
      },
      required: ["player_token", "move"],
    },
  },
  {
    name: "get_game_state",
    title: "Get game state",
    description: "Get the full current state of a session (FEN, PGN, clocks, move list). Does not require a token.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: sid,
        sessionId: { type: "string", description: "Alias for session_id" },
      },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "resign",
    title: "Resign",
    description: "Resign the game (your opponent wins).",
    inputSchema: {
      type: "object",
      properties: {
        session_id: sid,
        sessionId: { type: "string", description: "Alias for session_id" },
        player_token: tok,
        playerToken: { type: "string", description: "Alias for player_token" },
      },
      required: ["player_token"],
    },
    annotations: { destructiveHint: true },
  },
];

class ToolError extends Error {}

function normalizeArgs(args: any): any {
  if (args === null || args === undefined) return {};
  if (typeof args === "string") {
    const trimmed = args.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        return normalizeArgs(JSON.parse(trimmed));
      } catch {
        return { session_id: trimmed };
      }
    }
    return { session_id: trimmed };
  }
  if (Array.isArray(args)) {
    if (args.length === 1) return normalizeArgs(args[0]);
    return { session_id: args[0], player_token: args[1], move: args[2] };
  }
  if (typeof args === "object") {
    let result = { ...args };
    if (result.arguments) {
      const nested = normalizeArgs(result.arguments);
      result = { ...result, ...nested };
    }
    if (result.input) {
      const nested = normalizeArgs(result.input);
      result = { ...result, ...nested };
    }
    if (result.parameters) {
      const nested = normalizeArgs(result.parameters);
      result = { ...result, ...nested };
    }
    return result;
  }
  return args;
}

function extractArg(args: any, ...keys: string[]): any {
  const norm = normalizeArgs(args);
  if (!norm || typeof norm !== "object") return undefined;
  for (const k of keys) {
    if (norm[k] !== undefined && norm[k] !== null) return norm[k];
    const lower = k.toLowerCase().replace(/_/g, "");
    for (const [key, val] of Object.entries(norm)) {
      if (key.toLowerCase().replace(/_/g, "") === lower && val !== undefined && val !== null) {
        return val;
      }
    }
  }
  return undefined;
}

async function requireSession(args: any, ctx: ToolContext): Promise<string> {
  const norm = normalizeArgs(args);
  let raw: any = undefined;
  if (norm && typeof norm === "object") {
    raw = extractArg(norm, "session_id", "sessionId", "sessionID", "id", "session", "room_id", "roomId");
  } else if (typeof norm === "string") {
    raw = norm;
  }
  let id = String(raw ?? "").trim().replace(/^["']|["']$/g, "");
  // If a full URL or path was passed (e.g. https://.../session/cfjn-vxzd or /session/cfjn-vxzd)
  if (id.includes("/")) {
    const match = id.match(/([a-zA-Z0-9]{4}-[a-zA-Z0-9]{4}|[a-zA-Z0-9_-]{3,64})$/);
    if (match) id = match[1];
  }
  if (isValidSessionId(id)) return id;

  // Fallback 1: resolve by player_token if provided in arguments!
  const token = extractArg(norm, "player_token", "playerToken", "token", "player");
  if (token && typeof token === "string" && token.trim().length > 10) {
    try {
      const row = await ctx.env.DB.prepare(
        `SELECT session_id FROM chess_sessions WHERE white_token = ?1 OR black_token = ?1 LIMIT 1`
      ).bind(token.trim()).first<{ session_id: string }>();
      if (row?.session_id && isValidSessionId(row.session_id)) {
        console.log(`[requireSession] Resolved session_id from player_token: ${row.session_id}`);
        return row.session_id;
      }
    } catch (err) {
      console.error("Failed to resolve session by token:", err);
    }
  }

  // Fallback 2: check ctx.requestSessionId (from headers / query params)
  if (ctx.requestSessionId && isValidSessionId(ctx.requestSessionId)) {
    console.log(`[requireSession] Used requestSessionId: ${ctx.requestSessionId}`);
    return ctx.requestSessionId;
  }

  // Fallback 3: auto-resolve to the latest active (playing or waiting) session from D1!
  try {
    const latest = await ctx.env.DB.prepare(
      `SELECT session_id FROM chess_sessions WHERE status IN ('playing', 'waiting') ORDER BY updated_at DESC LIMIT 1`
    ).first<{ session_id: string }>();
    if (latest?.session_id && isValidSessionId(latest.session_id)) {
      console.log(`[requireSession] Auto-resolved to active session: ${latest.session_id}`);
      return latest.session_id;
    }
  } catch (err) {
    console.error("Failed to auto-resolve active session:", err);
  }

  throw new ToolError(`Invalid or missing session_id (received: ${JSON.stringify(args)})`);
}

async function callTool(name: string, args: any, ctx: ToolContext): Promise<{ text: string; data: unknown; isError?: boolean }> {
  const { env, origin } = ctx;
  const out = (data: any, text?: string) => ({ data, text: text ? `${text}\n\n${JSON.stringify(data, null, 2)}` : JSON.stringify(data, null, 2) });
  const fail = (error: string) => ({ data: { ok: false, error }, text: `Error: ${error}`, isError: true });

  switch (name) {
    case "list_sessions": {
      const status = extractArg(args, "status", "state");
      const limit = Number(extractArg(args, "limit", "count", "max") ?? 20);
      const rows = await listSessions(env, { status, limit });
      return out({ sessions: rows });
    }
    case "create_session": {
      const state = await createSession(env);
      return out(
        { session_id: state.sessionId, spectator_url: `${origin}/session/${state.sessionId}` },
        `Session created. Next: join_session with session_id "${state.sessionId}".`
      );
    }
    case "join_session": {
      const id = await requireSession(args, ctx);
      const agentName = String(extractArg(args, "agent_name", "agentName", "name", "agent") ?? "").trim() || "Anonymous Agent";
      const pc = String(extractArg(args, "preferred_color", "preferredColor", "color") ?? "any").toLowerCase();
      const preferred = pc.startsWith("w") ? "w" : pc.startsWith("b") ? "b" : "any";
      const res = await roomStub(env, id).join(agentName, preferred);
      if (!res.ok) return fail(res.error);
      const note = res.note ? ` Note: ${res.note}` : "";
      return out(
        {
          ok: true,
          session_id: id,
          color: res.color,
          color_name: res.color === "w" ? "white" : "black",
          player_token: res.token,
          spectator_url: `${origin}/session/${id}`,
        },
        `Joined as ${res.color === "w" ? "WHITE" : "BLACK"}.${note} Keep player_token secret. Next: call wait_for_turn.`
      );
    }
    case "wait_for_turn": {
      const id = await requireSession(args, ctx);
      const token = String(extractArg(args, "player_token", "playerToken", "token", "player") ?? "").trim();
      if (!token) return fail("Missing player_token");
      const timeoutRaw = extractArg(args, "timeout_seconds", "timeoutSeconds", "timeout", "seconds");
      const timeout = Math.max(1, Math.min(Number(timeoutRaw ?? 45) || 45, 600));
      ctx.progress?.("Waiting for turn...");
      const res = await roomStub(env, id).waitForTurn(token, timeout * 1000);
      if (!res.ok) return fail(res.error);
      const t = res.turn;
      const s = t.state;
      const summary = [
        `STATUS: ${t.status}`,
        t.message,
        `You are ${t.you === "w" ? "White" : "Black"}. Move ${Math.floor(s.moveCount / 2) + 1}, ${s.turn === "w" ? "White" : "Black"} to move.${s.inCheck ? " CHECK!" : ""}`,
        `FEN: ${s.fen}`,
        s.lastMove ? `Last move: ${s.lastMove.san}${s.lastCommentary ? ` — "${s.lastCommentary}"` : ""}` : "",
        "",
        t.board_ascii,
        t.legal_moves_san.length ? `Legal moves (SAN): ${t.legal_moves_san.join(" ")}` : "",
      ]
        .filter((l) => l !== "")
        .join("\n");
      return {
        text: summary,
        data: {
          status: t.status,
          you: t.you,
          message: t.message,
          fen: s.fen,
          turn: s.turn,
          in_check: s.inCheck,
          move_count: s.moveCount,
          last_move: s.lastMove,
          last_commentary: s.lastCommentary,
          winner: s.winner,
          end_reason: s.endReason,
          pgn: s.pgn,
          clocks_ms: { white: s.white.timeMs, black: s.black.timeMs },
          legal_moves_san: t.legal_moves_san,
          legal_moves_uci: t.legal_moves_uci,
        },
      };
    }
    case "make_move": {
      const id = await requireSession(args, ctx);
      const token = String(extractArg(args, "player_token", "playerToken", "token", "player") ?? "").trim();
      if (!token) return fail("Missing player_token");
      const move = String(extractArg(args, "move", "move_san", "move_uci", "san", "uci") ?? "").trim();
      if (!move) return fail("Missing move");
      const commentary = extractArg(args, "commentary", "comment", "note");
      const res = await roomStub(env, id).move(token, move, commentary);
      if (!res.ok) return fail(res.error);
      return out(
        {
          ok: true,
          played: res.move.san,
          time_spent_ms: res.move.timeSpentMs,
          fen: res.state.fen,
          game_over: res.game_over,
          winner: res.state.winner,
          end_reason: res.state.endReason,
        },
        res.message
      );
    }
    case "get_game_state": {
      const id = await requireSession(args, ctx);
      const state = await roomStub(env, id).getState();
      if (!state) return fail("Session not found");
      return out({ ...state, spectator_url: `${origin}/session/${id}` });
    }
    case "resign": {
      const id = await requireSession(args, ctx);
      const token = String(extractArg(args, "player_token", "playerToken", "token", "player") ?? "").trim();
      if (!token) return fail("Missing player_token");
      const res = await roomStub(env, id).resign(token);
      if (!res.ok) return fail(res.error);
      return out({ ok: true, winner: res.state.winner, end_reason: res.state.endReason }, "You resigned.");
    }
    default:
      throw new RpcError(-32602, `Unknown tool: ${name}`);
  }
}

class RpcError extends Error {
  constructor(public code: number, message: string) {
    super(message);
  }
}

async function handleRpc(msg: JsonRpcRequest, ctx: ToolContext): Promise<object | null> {
  const isNotification = msg.id === undefined || msg.id === null;
  try {
    let result: unknown;
    switch (msg.method) {
      case "initialize": {
        const requested = msg.params?.protocolVersion;
        result = {
          protocolVersion: SUPPORTED_VERSIONS.includes(requested) ? requested : SUPPORTED_VERSIONS[0],
          capabilities: { tools: { listChanged: false }, resources: {}, prompts: {} },
          serverInfo: SERVER_INFO,
          instructions: INSTRUCTIONS,
        };
        break;
      }
      case "ping":
        result = {};
        break;
      case "tools/list":
        result = { tools: TOOLS };
        break;
      case "resources/list":
        result = { resources: [] };
        break;
      case "resources/templates/list":
        result = { resourceTemplates: [] };
        break;
      case "prompts/list":
        result = {
          prompts: [
            {
              name: "play_chess",
              description: "Instructions for playing a full game in a session",
              arguments: [
                { name: "session_id", required: true },
                { name: "agent_name", required: false },
              ],
            },
          ],
        };
        break;
      case "prompts/get": {
        const a = msg.params?.arguments ?? {};
        result = {
          description: "Play a full chess game",
          messages: [
            {
              role: "user",
              content: {
                type: "text",
                text: `${INSTRUCTIONS}\n\nJoin session "${a.session_id ?? "<session_id>"}" as "${a.agent_name ?? "AI Agent"}" and play the whole game until it is over. Play strong chess.`,
              },
            },
          ],
        };
        break;
      }
      case "tools/call": {
        const name = msg.params?.name;
        // Merge msg.params and all its sub-objects so NO property is EVER lost:
        const paramObj = typeof msg.params === "object" && msg.params !== null ? msg.params : {};
        const argsObj = typeof msg.params?.arguments === "object" && msg.params?.arguments !== null ? msg.params.arguments : {};
        const inputObj = typeof msg.params?.input === "object" && msg.params?.input !== null ? msg.params.input : {};
        const metaObj = typeof msg.params?._meta === "object" && msg.params?._meta !== null ? msg.params._meta : {};
        const msgObj = typeof (msg as any).session_id === "string" ? { session_id: (msg as any).session_id } : {};
        const merged = {
          ...paramObj,
          ...argsObj,
          ...inputObj,
          ...metaObj,
          ...msgObj,
        };
        if (typeof msg.params?.arguments === "string") {
          try {
            Object.assign(merged, JSON.parse(msg.params.arguments));
          } catch {
            if (!merged.session_id) merged.session_id = msg.params.arguments;
          }
        }
        delete merged.name; // don't confuse name with tool args
        const args = normalizeArgs(merged);
        console.log(`[MCP tools/call] ${name}:`, JSON.stringify(args));
        try {
          const r = await callTool(name, args, ctx);
          result = {
            content: [{ type: "text", text: r.text }],
            structuredContent: r.data && typeof r.data === "object" ? r.data : undefined,
            isError: r.isError ?? false,
          };
        } catch (err) {
          if (err instanceof RpcError) throw err;
          const message = err instanceof Error ? err.message : String(err);
          result = { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
        }
        break;
      }
      default:
        if (msg.method?.startsWith("notifications/")) return null;
        throw new RpcError(-32601, `Method not found: ${msg.method}`);
    }
    return isNotification ? null : { jsonrpc: "2.0", id: msg.id, result };
  } catch (err) {
    if (isNotification) return null;
    const code = err instanceof RpcError ? err.code : -32603;
    return { jsonrpc: "2.0", id: msg.id ?? null, error: { code, message: err instanceof Error ? err.message : String(err) } };
  }
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, Authorization, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID",
  "Access-Control-Expose-Headers": "Mcp-Session-Id, Mcp-Protocol-Version",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS } });

export async function handleMcp(request: Request, env: Env): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (request.method === "GET") {
    const accept = request.headers.get("Accept") ?? "";
    if (!accept.includes("text/event-stream")) {
      return json({ name: SERVER_INFO.name, transport: "streamable-http", endpoint: "/mcp", tools: TOOLS.map((t) => t.name) });
    }
    return new Response("Server-initiated SSE stream not supported; use POST.", { status: 405, headers: { Allow: "POST", ...CORS } });
  }
  if (request.method === "DELETE") return new Response(null, { status: 204, headers: CORS });
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: CORS });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400);
  }

  const batch = Array.isArray(body);
  const messages = (batch ? body : [body]) as JsonRpcRequest[];
  if (!messages.length || messages.some((m) => !m || typeof m !== "object" || typeof m.method !== "string")) {
    // Could be JSON-RPC responses sent by the client — acknowledge.
    return new Response(null, { status: 202, headers: CORS });
  }
  const origin = new URL(request.url).origin;
  const urlObj = new URL(request.url);
  const headerSessionId = request.headers.get("mcp-session-id") || request.headers.get("x-session-id");
  const querySessionId = urlObj.searchParams.get("session_id") || urlObj.searchParams.get("sessionId");
  const requestSessionId = (headerSessionId || querySessionId)?.trim() || null;
  const ctx: ToolContext = { env, origin, requestSessionId };
  const hasRequests = messages.some((m) => m.id !== undefined && m.id !== null);

  if (!hasRequests) {
    await Promise.all(messages.map((m) => handleRpc(m, ctx)));
    return new Response(null, { status: 202, headers: CORS });
  }

  const wantsSse =
    (request.headers.get("Accept") ?? "").includes("text/event-stream") &&
    messages.some((m) => m.method === "tools/call" && LONG_RUNNING_TOOLS.has(m.params?.name));

  if (!wantsSse) {
    const results = (await Promise.all(messages.map((m) => handleRpc(m, ctx)))).filter(Boolean);
    return json(batch ? results : results[0]);
  }

  // ---- SSE mode: keep the connection alive while waiting on the Durable Object
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  const write = (chunk: string) => writer.write(enc.encode(chunk)).catch(() => {});
  let eventId = 0;
  const sendEvent = (data: unknown) => write(`id: ${++eventId}\nevent: message\ndata: ${JSON.stringify(data)}\n\n`);

  const progressTokens = messages.map((m) => m.params?._meta?.progressToken).filter((t) => t !== undefined);
  let tick = 0;
  const keepAlive = setInterval(() => {
    tick++;
    write(`: keepalive ${tick}\n\n`);
    for (const progressToken of progressTokens) {
      sendEvent({ jsonrpc: "2.0", method: "notifications/progress", params: { progressToken, progress: tick, message: "Waiting for opponent..." } });
    }
  }, 15_000);

  const work = (async () => {
    try {
      write(": connected\n\n");
      const results = await Promise.all(messages.map((m) => handleRpc(m, ctx)));
      for (const r of results) if (r) await sendEvent(r);
    } finally {
      clearInterval(keepAlive);
      await writer.close().catch(() => {});
    }
  })();
  void work;

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      ...CORS,
    },
  });
}
