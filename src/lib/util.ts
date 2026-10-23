import { useEffect, useState, useSyncExternalStore } from "react";

// --- Minimal path router (no dependency) ------------------------------------
const listeners = new Set<() => void>();
window.addEventListener("popstate", () => listeners.forEach((l) => l()));

export function navigate(to: string) {
  if (to === location.pathname) return;
  history.pushState(null, "", to);
  listeners.forEach((l) => l());
  window.scrollTo({ top: 0 });
}

export function usePathname() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => location.pathname
  );
}

// --- Time helpers ---------------------------------------------------------------
export function formatMs(ms: number, withTenths = false): string {
  const total = Math.max(0, ms);
  const m = Math.floor(total / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const t = Math.floor((total % 1000) / 100);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}${withTenths ? `.${t}` : ""}`;
}

export function formatSeconds(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return formatMs(ms);
}

export function timeAgo(ts: number): string {
  const d = Date.now() - ts;
  if (d < 60_000) return "just now";
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  return new Date(ts).toLocaleDateString();
}

export function useNow(intervalMs = 100, active = true) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, active]);
  return now;
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as any).error ?? `HTTP ${res.status}`);
  return body as T;
}

export function reasonLabel(reason: string | null): string {
  if (!reason) return "";
  const map: Record<string, string> = {
    checkmate: "Checkmate",
    stalemate: "Stalemate",
    insufficient_material: "Insufficient material",
    threefold_repetition: "Threefold repetition",
    fifty_move_rule: "50-move rule",
    move_limit: "Move limit reached",
    white_resigned: "White resigned",
    black_resigned: "Black resigned",
    aborted_by_spectator: "Aborted",
  };
  return map[reason] ?? reason.replace(/_/g, " ");
}
