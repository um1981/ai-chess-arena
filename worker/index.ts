import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./env";
import { handleMcp } from "./mcp";
import { createSession, getArchivedSession, isValidSessionId, listSessions, roomStub } from "./sessions";

export { ChessGameRoom } from "./room";

const app = new Hono<{ Bindings: Env }>();

app.use("/api/*", cors());

app.get("/health", (c) => c.json({ ok: true, service: "ai-chess-arena", time: Date.now() }));

// ---------------------------------------------------------------- REST API

app.get("/api/sessions", async (c) => {
  const status = c.req.query("status");
  const limit = Number(c.req.query("limit") ?? 30);
  return c.json({ sessions: await listSessions(c.env, { status: status || undefined, limit }) });
});

app.post("/api/sessions", async (c) => {
  const state = await createSession(c.env);
  return c.json({ sessionId: state.sessionId, state }, 201);
});

app.get("/api/session/:id", async (c) => {
  const id = c.req.param("id");
  if (!isValidSessionId(id)) return c.json({ error: "Invalid session id" }, 400);
  const state = await roomStub(c.env, id).getState();
  if (state) return c.json({ state });
  const archived = await getArchivedSession(c.env, id);
  if (archived) return c.json({ archived });
  return c.json({ error: "Session not found" }, 404);
});

app.get("/api/session/:id/moves", async (c) => {
  const id = c.req.param("id");
  if (!isValidSessionId(id)) return c.json({ error: "Invalid session id" }, 400);
  const { results } = await c.env.DB.prepare(
    `SELECT move_number, player_color, agent_name, move_san, fen_after, time_spent_ms, commentary, created_at
     FROM chess_moves WHERE session_id = ?1 ORDER BY move_number ASC`
  )
    .bind(id)
    .all();
  return c.json({ moves: results });
});

app.post("/api/session/:id/start", async (c) => {
  const id = c.req.param("id");
  if (!isValidSessionId(id)) return c.json({ error: "Invalid session id" }, 400);
  const res = await roomStub(c.env, id).start();
  return res.ok ? c.json(res) : c.json(res, 409);
});

app.post("/api/session/:id/abort", async (c) => {
  const id = c.req.param("id");
  if (!isValidSessionId(id)) return c.json({ error: "Invalid session id" }, 400);
  const res = await roomStub(c.env, id).abort();
  return res.ok ? c.json(res) : c.json(res, 409);
});

/** Spectator WebSocket -> forwarded to the session's Durable Object */
app.get("/api/session/:id/ws", async (c) => {
  const id = c.req.param("id");
  if (!isValidSessionId(id)) return c.text("Invalid session id", 400);
  if (c.req.header("Upgrade")?.toLowerCase() !== "websocket") return c.text("Expected WebSocket", 426);
  return roomStub(c.env, id).fetch(c.req.raw);
});

// ---------------------------------------------------------------- Remote MCP

app.all("/mcp", (c) => handleMcp(c.req.raw, c.env));
app.all("/mcp/*", (c) => handleMcp(c.req.raw, c.env));

app.notFound((c) => {
  if (c.req.path.startsWith("/api/")) return c.json({ error: "Not found" }, 404);
  return c.env.ASSETS.fetch(c.req.raw);
});

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: err.message || "Internal error" }, 500);
});

export default app;
