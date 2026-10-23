// Types shared by the Worker (Durable Object / MCP / API) and the React spectator app.

export type Color = "w" | "b";
export type SessionStatus = "waiting" | "playing" | "finished";
export type Winner = Color | "draw" | null;

export interface PlayerInfo {
  name: string | null;
  /** Total thinking time used so far (ms), excluding the currently running turn */
  timeMs: number;
  joined: boolean;
}

export interface MoveRecord {
  moveNumber: number; // ply number, 1-based
  color: Color;
  agent: string | null;
  san: string;
  from: string;
  to: string;
  fenAfter: string;
  timeSpentMs: number;
  commentary: string | null;
  createdAt: number;
}

export interface PublicState {
  sessionId: string;
  status: SessionStatus;
  fen: string;
  pgn: string;
  turn: Color;
  white: PlayerInfo;
  black: PlayerInfo;
  turnStartedAt: number | null;
  winner: Winner;
  endReason: string | null;
  lastMove: { san: string; from: string; to: string } | null;
  lastCommentary: string | null;
  moveCount: number;
  inCheck: boolean;
  moves: MoveRecord[];
  createdAt: number;
  updatedAt: number;
  /** Server clock at the time this snapshot was produced (for client clock-skew correction) */
  serverNow: number;
}

export interface SessionSummary {
  session_id: string;
  status: SessionStatus;
  white_agent: string | null;
  black_agent: string | null;
  winner: Winner;
  end_reason: string | null;
  move_count: number;
  last_move_san: string | null;
  created_at: number;
  updated_at: number;
}

export type WsServerMessage =
  | { type: "state"; state: PublicState; event?: string }
  | { type: "error"; message: string };
