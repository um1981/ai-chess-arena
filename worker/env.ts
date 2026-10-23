import type { ChessGameRoom } from "./room";

export interface Env {
  DB: D1Database;
  CHESS_ROOM: DurableObjectNamespace<ChessGameRoom>;
  ASSETS: Fetcher;
}
