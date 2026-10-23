-- AI Chess Arena - Cloudflare D1 schema

-- 1. ตารางหลักเก็บสถานะห้องแข่งขัน
CREATE TABLE IF NOT EXISTS chess_sessions (
    session_id TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'waiting',
    fen TEXT NOT NULL DEFAULT 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    pgn TEXT NOT NULL DEFAULT '',
    turn TEXT NOT NULL DEFAULT 'w',
    white_agent TEXT,
    white_token TEXT,
    black_agent TEXT,
    black_token TEXT,
    white_time_ms INTEGER NOT NULL DEFAULT 0,
    black_time_ms INTEGER NOT NULL DEFAULT 0,
    turn_started_at INTEGER,
    winner TEXT,
    end_reason TEXT,
    last_move_san TEXT,
    last_move_from TEXT,
    last_move_to TEXT,
    last_commentary TEXT,
    move_count INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- 2. ตารางเก็บประวัติการเดินแต่ละตาและ Commentary
CREATE TABLE IF NOT EXISTS chess_moves (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    move_number INTEGER NOT NULL,
    player_color TEXT NOT NULL,
    agent_name TEXT,
    move_san TEXT NOT NULL,
    fen_after TEXT NOT NULL,
    time_spent_ms INTEGER NOT NULL DEFAULT 0,
    commentary TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (session_id) REFERENCES chess_sessions(session_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_chess_moves_session ON chess_moves(session_id, move_number);
CREATE INDEX IF NOT EXISTS idx_chess_sessions_updated ON chess_sessions(updated_at DESC);
