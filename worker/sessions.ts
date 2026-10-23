import type { SessionSummary } from "../shared/types";
import type { Env } from "./env";

const ID_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

export function newSessionId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let id = "";
  for (const b of bytes) id += ID_ALPHABET[b % ID_ALPHABET.length];
  return `${id.slice(0, 4)}-${id.slice(4)}`;
}

export function isValidSessionId(id: string | undefined | null): id is string {
  return !!id && /^[A-Za-z0-9_-]{3,64}$/.test(id);
}

export function roomStub(env: Env, sessionId: string) {
  return env.CHESS_ROOM.get(env.CHESS_ROOM.idFromName(sessionId));
}

export async function createSession(env: Env) {
  const sessionId = newSessionId();
  const state = await roomStub(env, sessionId).create(sessionId);
  return state;
}

export async function listSessions(env: Env, opts: { status?: string; limit?: number } = {}): Promise<SessionSummary[]> {
  const limit = Math.max(1, Math.min(opts.limit ?? 30, 100));
  const cols = `session_id, status, white_agent, black_agent, winner, end_reason, move_count, last_move_san, created_at, updated_at`;
  const stmt = opts.status
    ? env.DB.prepare(`SELECT ${cols} FROM chess_sessions WHERE status = ?1 ORDER BY updated_at DESC LIMIT ?2`).bind(opts.status, limit)
    : env.DB.prepare(`SELECT ${cols} FROM chess_sessions ORDER BY updated_at DESC LIMIT ?1`).bind(limit);
  const { results } = await stmt.all<SessionSummary>();
  return results ?? [];
}

/** Read an archived session straight from D1 (fallback when the DO has no state). */
export async function getArchivedSession(env: Env, sessionId: string) {
  const session = await env.DB.prepare(
    `SELECT session_id, status, fen, pgn, turn, white_agent, black_agent, white_time_ms, black_time_ms, turn_started_at,
            winner, end_reason, last_move_san, last_move_from, last_move_to, last_commentary, move_count, created_at, updated_at
     FROM chess_sessions WHERE session_id = ?1`
  )
    .bind(sessionId)
    .first();
  if (!session) return null;
  const { results: moves } = await env.DB.prepare(
    `SELECT move_number, player_color, agent_name, move_san, fen_after, time_spent_ms, commentary, created_at
     FROM chess_moves WHERE session_id = ?1 ORDER BY move_number ASC`
  )
    .bind(sessionId)
    .all();
  return { session, moves };
}
