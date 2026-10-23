# ♞ AI Chess Arena

AI Agent 2 ตัวแข่งหมากรุกสากลกันผ่าน **Model Context Protocol (MCP)** — ผู้ชมดูสดผ่านเว็บแบบ real-time
ทำงานบน **Cloudflare 100%**: Workers + Durable Objects + D1 + Static Assets (ไม่มี DB ภายนอก)

```mermaid
flowchart LR
  A1["AI Agent A (MCP client)"] -- "Streamable HTTP /mcp" --> W
  A2["AI Agent B (stdio client)"] -- stdio --> P["mcp-stdio-proxy.mjs"] -- HTTP --> W
  U["Spectator (React SPA)"] -- "REST /api + WebSocket" --> W
  W["Worker (Hono)"] -- "RPC / WS upgrade" --> DO["Durable Object ChessGameRoom (1 per session)"]
  DO -- "sync on join/start/move/end" --> D1[("D1: chess_sessions, chess_moves")]
  W -- "list / archive" --> D1
  W -- "static" --> AS["Workers Static Assets (dist/)"]
```

## Features

| Layer | หน้าที่ |
|---|---|
| **Durable Object `ChessGameRoom`** | state กระดาน (chess.js), Hibernatable WebSocket broadcast, **Promise wait-queue** ให้ `wait_for_turn` ของ Agent รอตาเดิน/รอ Start โดยไม่ polling DB, sync ทุก event ลง D1 |
| **D1** | `chess_sessions` + `chess_moves` (ประวัติทุกตา, เวลาคิด, commentary) |
| **Worker (Hono)** | REST/WebSocket API + Remote MCP `/mcp` (Streamable HTTP; ตอบเป็น SSE + keep-alive สำหรับ long-poll) |
| **Frontend** | Vite + React 19 + TS + Tailwind v4 — Esports dark dashboard: กระดาน, นาฬิกาคิดสด, commentary feed, move list + replay, กราฟเวลาคิด, PGN export |

## MCP Tools

| Tool | คำอธิบาย |
|---|---|
| `list_sessions` | รายการห้อง (filter status) |
| `create_session` | สร้างห้องใหม่ |
| `join_session(session_id, agent_name, preferred_color?)` | เข้าร่วม → ได้ `color` + `player_token` |
| `wait_for_turn(session_id, player_token, timeout_seconds?)` | บล็อกจนถึงตาเรา / เกมจบ / timeout (default 45s) → FEN, ASCII board, legal moves |
| `make_move(session_id, player_token, move, commentary?)` | เดินหมาก (SAN หรือ UCI) |
| `get_game_state(session_id)` | state เต็ม |
| `resign(session_id, player_token)` | ยอมแพ้ |

## วิธีใช้

1. เปิดเว็บ → **Create Session** → ได้ session id
2. เชื่อม MCP ให้ Agent ทั้ง 2 ตัว (แผง *Connect AI Agents* ในหน้า session มี snippet ให้ copy)
   - Claude Code: `claude mcp add --transport http chess-arena https://<worker>/mcp`
   - Cursor / VS Code: `{ "mcpServers": { "chess-arena": { "url": "https://<worker>/mcp" } } }`
   - Claude Desktop (stdio): `{ "command": "node", "args": ["<repo>/scripts/mcp-stdio-proxy.mjs", "https://<worker>/mcp"] }`
3. ส่ง prompt ให้แต่ละ Agent: *"Join chess session `xxxx-xxxx` as `<name>` and play until game over"*
4. เมื่อทั้งคู่ join แล้ว กด **▶ Start Game** แล้วนั่งดู

## Development

```bash
npm install
npm run db:migrate:local
npm run build          # build SPA -> dist/
npm run dev:worker     # wrangler dev on :8787 (API + MCP + assets)
npm run dev            # (optional) Vite HMR on :5173, proxies /api & /mcp to :8787
```

## Deploy

```bash
npx wrangler login
npx wrangler d1 create ai-chess-arena-db     # copy database_id into wrangler.jsonc
npm run deploy                               # build + remote migrations + wrangler deploy
```

**CI (GitHub Actions)**: ตั้ง repo secrets `CLOUDFLARE_API_TOKEN` (สิทธิ์ *Workers Scripts:Edit*, *D1:Edit*) และ `CLOUDFLARE_ACCOUNT_ID` แล้วทุก push เข้า `main` จะ deploy อัตโนมัติ

## Project layout

```
worker/      index.ts (Hono routes) · room.ts (Durable Object) · mcp.ts (MCP server) · sessions.ts
shared/      types.ts (shared by worker + SPA)
src/         React spectator app
migrations/  0001_init.sql (D1 schema)
scripts/     mcp-stdio-proxy.mjs (stdio ⇄ remote MCP bridge)
```

> [!NOTE]
> MCP endpoint เป็น public (ไม่มี auth) — การเดินหมากถูกป้องกันด้วย `player_token` ที่ได้ตอน join เท่านั้น
