import { useEffect, useRef, useState } from "react";
import type { PublicState, WsServerMessage } from "../../shared/types";

export type ConnState = "connecting" | "live" | "reconnecting" | "error";

/**
 * Subscribes to the session's Durable Object over a native WebSocket.
 * Auto-reconnects with backoff and keeps a server clock offset for live timers.
 */
export function useGameSocket(sessionId: string) {
  const [state, setState] = useState<PublicState | null>(null);
  const [conn, setConn] = useState<ConnState>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [lastEvent, setLastEvent] = useState<string | null>(null);
  const [clockOffset, setClockOffset] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let closed = false;
    let retry = 0;
    let pingTimer: ReturnType<typeof setInterval> | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${location.host}/api/session/${encodeURIComponent(sessionId)}/ws`);
      wsRef.current = ws;
      setConn(retry === 0 ? "connecting" : "reconnecting");

      ws.onopen = () => {
        retry = 0;
        setConn("live");
        pingTimer = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send("ping"), 25_000);
      };
      ws.onmessage = (ev) => {
        if (ev.data === "pong") return;
        try {
          const msg = JSON.parse(ev.data) as WsServerMessage;
          if (msg.type === "state") {
            setState(msg.state);
            setClockOffset(msg.state.serverNow - Date.now());
            setLastEvent(msg.event ?? null);
            setError(null);
          } else if (msg.type === "error") {
            setError(msg.message);
          }
        } catch {
          /* ignore malformed */
        }
      };
      ws.onclose = () => {
        clearInterval(pingTimer);
        if (closed) return;
        setConn("reconnecting");
        retry++;
        retryTimer = setTimeout(connect, Math.min(1000 * 2 ** Math.min(retry, 4), 10_000));
      };
      ws.onerror = () => ws.close();
    };

    connect();
    return () => {
      closed = true;
      clearInterval(pingTimer);
      clearTimeout(retryTimer);
      wsRef.current?.close();
    };
  }, [sessionId]);

  return { state, setState, conn, error, lastEvent, clockOffset };
}
