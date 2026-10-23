import { DurableObject } from "cloudflare:workers";
import { Chess, type Move } from "chess.js";
import type { Color, MoveRecord, PublicState, SessionStatus, Winner } from "../shared/types";
import type { Env } from "./env";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
/** Hard cap on plies so two stubborn agents can't play forever */
const MAX_PLIES = 400;

interface PlayerSlot {
  name: string;
  token: string;
  timeMs: number;
}

interface RoomState {
  sessionId: string;
  status: SessionStatus;
  white: PlayerSlot | null;
  black: PlayerSlot | null;
  turnStartedAt: number | null;
  winner: Winner;
  endReason: string | null;
  lastCommentary: string | null;
  moves: MoveRecord[];
  createdAt: number;
  updatedAt: number;
}

export type TurnStatus = "your_turn" | "game_over" | "waiting_for_start" | "waiting_for_opponent";

export interface TurnInfo {
  status: TurnStatus;
  you: Color;
  message: string;
  state: PublicState;
  board_ascii: string;
  legal_moves_san: string[];
  legal_moves_uci: string[];
}

export type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

interface Waiter {
  color: Color;
  resolve: (info: TurnInfo) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * ChessGameRoom — one instance per session_id.
 *  - Authoritative in-memory + DO storage game state
 *  - Hibernatable WebSockets for spectators (instant broadcast)
 *  - Promise based wait-queue for MCP long-poll calls (no DB polling)
 *  - Mirrors every important change into D1
 */
export class ChessGameRoom extends DurableObject<Env> {
  private room: RoomState | null = null;
  private chess: Chess | null = null;
  private waiters = new Set<Waiter>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    ctx.blockConcurrencyWhile(async () => {
      this.room = (await ctx.storage.get<RoomState>("room")) ?? null;
      if (this.room) {
        this.chess = this.rebuildChess(this.room);
      } else {
        await this.ensureLoaded();
      }
    });
  }

  // ---------------------------------------------------------------- helpers

  private async ensureLoaded(): Promise<void> {
    if (this.room) return;
    const sessionId = this.ctx.id.name;
    if (!sessionId) return;
    try {
      const session = await this.env.DB.prepare(
        `SELECT * FROM chess_sessions WHERE session_id = ?1`
      )
        .bind(sessionId)
        .first<any>();
      if (!session) return;

      const { results: moveRows } = await this.env.DB.prepare(
        `SELECT * FROM chess_moves WHERE session_id = ?1 ORDER BY move_number ASC`
      )
        .bind(sessionId)
        .all<any>();

      const chess = new Chess();
      const moves: MoveRecord[] = [];
      for (const m of (moveRows ?? [])) {
        let san = m.move_san;
        let from = "";
        let to = "";
        try {
          const played = chess.move(san);
          from = played.from;
          to = played.to;
          san = played.san;
        } catch {
          // preserve raw values if parsing fails
        }
        moves.push({
          moveNumber: m.move_number,
          color: m.player_color as Color,
          agent: m.agent_name,
          san,
          from,
          to,
          fenAfter: m.fen_after,
          timeSpentMs: m.time_spent_ms ?? 0,
          commentary: m.commentary ?? null,
          createdAt: m.created_at,
        });
      }

      this.room = {
        sessionId: session.session_id,
        status: session.status as SessionStatus,
        white: session.white_agent
          ? {
              name: session.white_agent,
              token: session.white_token ?? crypto.randomUUID(),
              timeMs: session.white_time_ms ?? 0,
            }
          : null,
        black: session.black_agent
          ? {
              name: session.black_agent,
              token: session.black_token ?? crypto.randomUUID(),
              timeMs: session.black_time_ms ?? 0,
            }
          : null,
        turnStartedAt: session.turn_started_at ?? null,
        winner: session.winner as Winner,
        endReason: session.end_reason ?? null,
        lastCommentary: session.last_commentary ?? null,
        moves,
        createdAt: session.created_at,
        updatedAt: session.updated_at,
      };
      this.applyHeaders(chess, this.room);
      this.chess = chess;
      await this.ctx.storage.put("room", this.room);
    } catch (err) {
      console.error("Failed to hydrate room from D1:", err);
    }
  }

  private rebuildChess(room: RoomState): Chess {
    const chess = new Chess();
    for (const m of room.moves) chess.move(m.san);
    this.applyHeaders(chess, room);
    return chess;
  }

  private applyHeaders(chess: Chess, room: RoomState) {
    chess.setHeader("Event", "AI Chess Arena");
    chess.setHeader("Site", "Cloudflare Workers");
    chess.setHeader("Date", new Date(room.createdAt).toISOString().slice(0, 10).replace(/-/g, "."));
    chess.setHeader("Round", room.sessionId);
    chess.setHeader("White", room.white?.name ?? "?");
    chess.setHeader("Black", room.black?.name ?? "?");
    const result =
      room.status !== "finished" ? "*" : room.winner === "w" ? "1-0" : room.winner === "b" ? "0-1" : room.winner === "draw" ? "1/2-1/2" : "*";
    chess.setHeader("Result", result);
  }

  private publicState(): PublicState {
    const room = this.room!;
    const chess = this.chess!;
    this.applyHeaders(chess, room);
    const last = room.moves[room.moves.length - 1];
    return {
      sessionId: room.sessionId,
      status: room.status,
      fen: chess.fen(),
      pgn: chess.pgn(),
      turn: chess.turn() as Color,
      white: { name: room.white?.name ?? null, timeMs: room.white?.timeMs ?? 0, joined: !!room.white },
      black: { name: room.black?.name ?? null, timeMs: room.black?.timeMs ?? 0, joined: !!room.black },
      turnStartedAt: room.turnStartedAt,
      winner: room.winner,
      endReason: room.endReason,
      lastMove: last ? { san: last.san, from: last.from, to: last.to } : null,
      lastCommentary: room.lastCommentary,
      moveCount: room.moves.length,
      inCheck: chess.inCheck(),
      moves: room.moves,
      createdAt: room.createdAt,
      updatedAt: room.updatedAt,
      serverNow: Date.now(),
    };
  }

  private colorOf(token: string): Color | null {
    if (!this.room || !token) return null;
    if (this.room.white?.token === token) return "w";
    if (this.room.black?.token === token) return "b";
    return null;
  }

  private turnInfo(color: Color): TurnInfo {
    const room = this.room!;
    const chess = this.chess!;
    const state = this.publicState();
    let status: TurnStatus;
    let message: string;
    if (room.status === "finished") {
      status = "game_over";
      const res = room.winner === "draw" ? "Draw" : room.winner ? (room.winner === color ? "You WON" : "You LOST") : "No result";
      message = `Game over (${room.endReason ?? "ended"}). ${res}.`;
    } else if (room.status === "waiting") {
      status = "waiting_for_start";
      message = !room.white || !room.black
        ? "Waiting for the opponent to join and for the spectator to press Start. Call wait_for_turn again."
        : "Both players joined. Waiting for the spectator to press Start. Call wait_for_turn again.";
    } else if (chess.turn() === color) {
      status = "your_turn";
      message = `It is your turn (${color === "w" ? "White" : "Black"}). ${
        state.lastMove ? `Opponent played ${state.lastMove.san}. ` : ""
      }Choose one of legal_moves and call make_move.`;
    } else {
      status = "waiting_for_opponent";
      message = "Opponent is thinking. Call wait_for_turn again.";
    }
    const yourTurn = status === "your_turn";
    const verbose = yourTurn ? (chess.moves({ verbose: true }) as Move[]) : [];
    return {
      status,
      you: color,
      message,
      state: { ...state, moves: state.moves.slice(-10) },
      board_ascii: chess.ascii(),
      legal_moves_san: verbose.map((m) => m.san),
      legal_moves_uci: verbose.map((m) => m.from + m.to + (m.promotion ?? "")),
    };
  }

  private isReady(color: Color): boolean {
    const room = this.room!;
    return room.status === "finished" || (room.status === "playing" && this.chess!.turn() === color);
  }

  /** Persist to DO storage, mirror to D1, broadcast to spectators, wake waiting agents. */
  private async commit(event: string, newMove?: MoveRecord) {
    const room = this.room!;
    room.updatedAt = Date.now();
    await this.ctx.storage.put("room", room);
    await this.syncD1(newMove);
    this.broadcast(event);
    this.notifyWaiters();
  }

  private async syncD1(newMove?: MoveRecord) {
    const room = this.room!;
    const s = this.publicState();
    const stmts: D1PreparedStatement[] = [
      this.env.DB.prepare(
        `INSERT INTO chess_sessions (session_id, status, fen, pgn, turn, white_agent, white_token, black_agent, black_token,
           white_time_ms, black_time_ms, turn_started_at, winner, end_reason, last_move_san, last_move_from, last_move_to,
           last_commentary, move_count, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21)
         ON CONFLICT(session_id) DO UPDATE SET
           status = excluded.status, fen = excluded.fen, pgn = excluded.pgn, turn = excluded.turn,
           white_agent = excluded.white_agent, white_token = excluded.white_token,
           black_agent = excluded.black_agent, black_token = excluded.black_token,
           white_time_ms = excluded.white_time_ms, black_time_ms = excluded.black_time_ms,
           turn_started_at = excluded.turn_started_at, winner = excluded.winner, end_reason = excluded.end_reason,
           last_move_san = excluded.last_move_san, last_move_from = excluded.last_move_from, last_move_to = excluded.last_move_to,
           last_commentary = excluded.last_commentary, move_count = excluded.move_count, updated_at = excluded.updated_at`
      ).bind(
        room.sessionId, room.status, s.fen, s.pgn, s.turn,
        room.white?.name ?? null, room.white?.token ?? null,
        room.black?.name ?? null, room.black?.token ?? null,
        room.white?.timeMs ?? 0, room.black?.timeMs ?? 0,
        room.turnStartedAt, room.winner, room.endReason,
        s.lastMove?.san ?? null, s.lastMove?.from ?? null, s.lastMove?.to ?? null,
        room.lastCommentary, room.moves.length, room.createdAt, room.updatedAt
      ),
    ];
    if (newMove) {
      stmts.push(
        this.env.DB.prepare(
          `INSERT INTO chess_moves (session_id, move_number, player_color, agent_name, move_san, fen_after, time_spent_ms, commentary, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`
        ).bind(
          room.sessionId, newMove.moveNumber, newMove.color, newMove.agent, newMove.san,
          newMove.fenAfter, newMove.timeSpentMs, newMove.commentary, newMove.createdAt
        )
      );
    }
    try {
      await this.env.DB.batch(stmts);
    } catch (err) {
      // D1 is the archive; never let an archive failure break a live game.
      console.error("D1 sync failed", err);
    }
  }

  private broadcast(event: string) {
    const msg = JSON.stringify({ type: "state", event, state: this.publicState() });
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(msg);
      } catch {
        /* socket already closed */
      }
    }
  }

  private notifyWaiters() {
    for (const w of [...this.waiters]) {
      if (this.isReady(w.color)) {
        clearTimeout(w.timer);
        this.waiters.delete(w);
        w.resolve(this.turnInfo(w.color));
      }
    }
  }

  private finish(winner: Winner, reason: string) {
    const room = this.room!;
    const now = Date.now();
    if (room.status === "playing" && room.turnStartedAt) {
      const slot = this.chess!.turn() === "w" ? room.white : room.black;
      if (slot) slot.timeMs += now - room.turnStartedAt;
    }
    room.status = "finished";
    room.winner = winner;
    room.endReason = reason;
    room.turnStartedAt = null;
  }

  // ------------------------------------------------------------ RPC methods

  async create(sessionId: string): Promise<PublicState> {
    await this.ensureLoaded();
    if (!this.room) {
      const now = Date.now();
      this.room = {
        sessionId,
        status: "waiting",
        white: null,
        black: null,
        turnStartedAt: null,
        winner: null,
        endReason: null,
        lastCommentary: null,
        moves: [],
        createdAt: now,
        updatedAt: now,
      };
      this.chess = this.rebuildChess(this.room);
      await this.commit("created");
    }
    return this.publicState();
  }

  async getState(): Promise<PublicState | null> {
    await this.ensureLoaded();
    return this.room ? this.publicState() : null;
  }

  async join(
    agentName: string,
    preferred: "w" | "b" | "any" = "any"
  ): Promise<Result<{ color: Color; token: string; state: PublicState; note?: string }>> {
    await this.ensureLoaded();
    const room = this.room;
    if (!room) return { ok: false, error: "Session not found" };
    if (room.status !== "waiting") return { ok: false, error: `Session is already ${room.status}` };
    const name = (agentName || "").trim().slice(0, 60) || "Anonymous Agent";

    let color: Color | null = null;
    let fallbackNote: string | undefined;

    if (preferred === "w") {
      if (!room.white) {
        color = "w";
      } else if (!room.black) {
        color = "b";
        fallbackNote = `White was already taken by "${room.white.name}". Assigned to Black instead.`;
      }
    } else if (preferred === "b") {
      if (!room.black) {
        color = "b";
      } else if (!room.white) {
        color = "w";
        fallbackNote = `Black was already taken by "${room.black.name}". Assigned to White instead.`;
      }
    } else {
      color = !room.white ? "w" : !room.black ? "b" : null;
    }

    if (!color) {
      return { ok: false, error: "Session is full (both colors taken)" };
    }
    const token = crypto.randomUUID();
    const slot: PlayerSlot = { name, token, timeMs: 0 };
    if (color === "w") room.white = slot;
    else room.black = slot;
    await this.commit("joined");
    return { ok: true, color, token, state: this.publicState(), note: fallbackNote };
  }

  async start(): Promise<Result<{ state: PublicState }>> {
    await this.ensureLoaded();
    const room = this.room;
    if (!room) return { ok: false, error: "Session not found" };
    if (room.status !== "waiting") return { ok: false, error: `Game is already ${room.status}` };
    if (!room.white || !room.black) return { ok: false, error: "Both agents must join before starting" };
    room.status = "playing";
    room.turnStartedAt = Date.now();
    await this.commit("started");
    return { ok: true, state: this.publicState() };
  }

  async move(token: string, moveText: string, commentary?: string): Promise<Result<{ move: MoveRecord; state: PublicState; game_over: boolean; message: string }>> {
    await this.ensureLoaded();
    const room = this.room;
    if (!room) return { ok: false, error: "Session not found" };
    const color = this.colorOf(token);
    if (!color) return { ok: false, error: "Invalid player_token" };
    if (room.status === "waiting") return { ok: false, error: "Game has not started yet. Call wait_for_turn." };
    if (room.status === "finished") return { ok: false, error: `Game is over (${room.endReason}).` };
    const chess = this.chess!;
    if (chess.turn() !== color) return { ok: false, error: "Not your turn. Call wait_for_turn." };

    const raw = (moveText || "").trim();
    const uci = raw.toLowerCase().match(/^([a-h][1-8])-?([a-h][1-8])=?([qrbn])?$/);
    let played: Move;
    try {
      played = uci ? chess.move({ from: uci[1], to: uci[2], promotion: uci[3] ?? "q" }) : chess.move(raw);
    } catch {
      return {
        ok: false,
        error: `Illegal move "${raw}". Legal moves (SAN): ${chess.moves().join(", ")}`,
      };
    }

    const now = Date.now();
    const spent = room.turnStartedAt ? now - room.turnStartedAt : 0;
    const slot = color === "w" ? room.white! : room.black!;
    slot.timeMs += spent;
    const note = commentary ? String(commentary).trim().slice(0, 1000) || null : null;
    const record: MoveRecord = {
      moveNumber: room.moves.length + 1,
      color,
      agent: slot.name,
      san: played.san,
      from: played.from,
      to: played.to,
      fenAfter: chess.fen(),
      timeSpentMs: spent,
      commentary: note,
      createdAt: now,
    };
    room.moves.push(record);
    room.lastCommentary = note;
    room.turnStartedAt = now;

    // Game termination checks
    let message = `Played ${played.san}.`;
    if (chess.isCheckmate()) this.finish(color, "checkmate");
    else if (chess.isStalemate()) this.finish("draw", "stalemate");
    else if (chess.isInsufficientMaterial()) this.finish("draw", "insufficient_material");
    else if (chess.isThreefoldRepetition()) this.finish("draw", "threefold_repetition");
    else if (chess.isDrawByFiftyMoves()) this.finish("draw", "fifty_move_rule");
    else if (room.moves.length >= MAX_PLIES) this.finish("draw", "move_limit");
    const over = (room.status as SessionStatus) === "finished";
    if (over) message += ` Game over: ${room.endReason}.`;
    else message += " Now call wait_for_turn to wait for the opponent.";

    await this.commit(over ? "game_over" : "move", record);
    return { ok: true, move: record, state: this.publicState(), game_over: over, message };
  }

  async resign(token: string): Promise<Result<{ state: PublicState }>> {
    await this.ensureLoaded();
    const room = this.room;
    if (!room) return { ok: false, error: "Session not found" };
    const color = this.colorOf(token);
    if (!color) return { ok: false, error: "Invalid player_token" };
    if (room.status === "finished") return { ok: false, error: "Game is already over" };
    this.finish(color === "w" ? "b" : "w", `${color === "w" ? "white" : "black"}_resigned`);
    await this.commit("game_over");
    return { ok: true, state: this.publicState() };
  }

  async abort(reason = "aborted_by_spectator"): Promise<Result<{ state: PublicState }>> {
    await this.ensureLoaded();
    const room = this.room;
    if (!room) return { ok: false, error: "Session not found" };
    if (room.status === "finished") return { ok: false, error: "Game is already over" };
    this.finish(null, reason);
    await this.commit("game_over");
    return { ok: true, state: this.publicState() };
  }

  /** Long-poll: resolves when it's this player's turn, game ends, or timeout elapses. */
  async waitForTurn(token: string, timeoutMs: number): Promise<Result<{ turn: TurnInfo }>> {
    await this.ensureLoaded();
    if (!this.room) return { ok: false, error: "Session not found" };
    const color = this.colorOf(token);
    if (!color) return { ok: false, error: "Invalid player_token" };
    if (this.isReady(color)) return { ok: true, turn: this.turnInfo(color) };
    const ms = Math.max(1000, Math.min(timeoutMs, 10 * 60_000));
    const info = await new Promise<TurnInfo>((resolve) => {
      const waiter: Waiter = {
        color,
        resolve,
        timer: setTimeout(() => {
          this.waiters.delete(waiter);
          resolve(this.turnInfo(color));
        }, ms),
      };
      this.waiters.add(waiter);
    });
    return { ok: true, turn: info };
  }

  // -------------------------------------------------------- WebSocket (spectators)

  async fetch(request: Request): Promise<Response> {
    await this.ensureLoaded();
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    if (this.room) server.send(JSON.stringify({ type: "state", event: "snapshot", state: this.publicState() }));
    else server.send(JSON.stringify({ type: "error", message: "Session not found" }));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    await this.ensureLoaded();
    if (typeof message === "string" && message.includes("sync") && this.room) {
      ws.send(JSON.stringify({ type: "state", event: "snapshot", state: this.publicState() }));
    }
  }

  async webSocketClose(ws: WebSocket, code: number) {
    try {
      ws.close(code === 1005 ? 1000 : code, "closing");
    } catch {
      /* ignore */
    }
  }
}
