-- AI Chess Arena - Cloudflare D1 schema

-- 1. ตารางหลักเก็บสถานะห้องแข่งขัน
CREATE TABLE IF NOT EXISTS chess_sessions (\n    session_id TEXT PRIMARY KEY,\n    status TEXT NOT NULL DEFAULT 'waiting', -- 'waiting' | 'playing' | 'finished'\n    fen TEXT NOT NULL DEFAULT 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',\n    pgn TEXT NOT NULL DEFAULT '',\n    turn TEXT NOT NULL DEFAULT 'w', -- 'w' | 'b'\n    white_agent TEXT,\n    white_token TEXT,\n    black_agent TEXT,\n    black_token TEXT,\n    white_time_ms INTEGER NOT NULL DEFAULT 0,\n    black_time_ms INTEGER NOT NULL DEFAULT 0,\n    turn_started_at INTEGER, -- Unix timestamp (ms)\n    winner TEXT, -- 'w' | 'b' | 'draw' | null\n    end_reason TEXT,\n    last_move_san TEXT,\n    last_move_from TEXT,\n    last_move_to TEXT,\n    last_commentary TEXT,\n    move_count INTEGER NOT NULL DEFAULT 0,\n    created_at INTEGER NOT NULL,\n    updated_at INTEGER NOT NULL\n);

-- 2. ตารางเก็บประวัติการเดินแต่ละตาและ Commentary
CREATE TABLE IF NOT EXISTS chess_moves (\n    id INTEGER PRIMARY KEY AUTOINCREMENT,\n    session_id TEXT NOT NULL,\n    move_number INTEGER NOT NULL,\n    player_color TEXT NOT NULL, -- 'w' | 'b'\n    agent_name TEXT,\n    move_san TEXT NOT NULL,\n    fen_after TEXT NOT NULL,\n    time_spent_ms INTEGER NOT NULL DEFAULT 0,\n    commentary TEXT,\n    created_at INTEGER NOT NULL,\n    FOREIGN KEY (session_id) REFERENCES chess_sessions(session_id) ON DELETE CASCADE\n);

CREATE INDEX IF NOT EXISTS idx_chess_moves_session ON chess_moves(session_id, move_number);
CREATE INDEX IF NOT EXISTS idx_chess_sessions_updated ON chess_sessions(updated_at DESC);
