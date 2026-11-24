"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export class ApiClientError extends Error {
  constructor(message: string, public code: string, public status: number) {
    super(message);
  }
}

export async function api<T = any>(path: string, opts?: { method?: string; body?: unknown }): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    method: opts?.method ?? "GET",
    headers: { "Content-Type": "application/json" },
    body: opts?.body === undefined ? undefined : JSON.stringify(opts.body),
    cache: "no-store",
    credentials: "same-origin",
  });
  const json = await response.json().catch(() => ({}));
  if (response.status === 401 && typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
    // Session expired or never established: force the login screen.
    window.location.href = "/login";
  }
  if (!response.ok) {
    throw new ApiClientError(json?.error?.message ?? "请求失败", json?.error?.code ?? "UNKNOWN", response.status);
  }
  return json as T;
}

interface ToastItem {
  id: string;
  kind: "success" | "error" | "info";
  text: string;
}

interface ConfirmOptions {
  title: string;
  body?: string;
  danger?: boolean;
  confirmText?: string;
}

export interface LiveStream {
  runId: string;
  taskId: string;
  agentId?: string;
  text: string;
}

interface AppContextValue {
  api: typeof api;
  refreshKey: number;
  refresh: () => void;
  toast: (text: string, kind?: ToastItem["kind"]) => void;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  workspaceId: string;
  lastEvent: { type: string; data: any; id: string } | null;
  streams: Record<string, LiveStream>;
  connected: boolean;
}

const AppContext = createContext<AppContextValue | null>(null);

const EVENT_TYPES = [
  "task.updated", "message.created", "message.updated", "message.delta", "run.updated",
  "approval.requested", "approval.resolved", "artifact.submitted", "artifact.updated",
  "agent.status_changed", "notification.created",
];

export function AppProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  const match = pathname.match(/\/workspaces\/([^/]+)/);
  const workspaceId = match?.[1] ?? "ws_demo";
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [confirmOptions, setConfirmOptions] = useState<ConfirmOptions | null>(null);
  const confirmResolver = useRef<((value: boolean) => void) | null>(null);
  const [refreshKey, setRefresh] = useState(0);
  const [lastEvent, setLastEvent] = useState<AppContextValue["lastEvent"]>(null);
  const [streams, setStreams] = useState<Record<string, LiveStream>>({});
  const [connected, setConnected] = useState(false);
  const completedRuns = useRef<Set<string>>(new Set());

  const toast = useCallback((text: string, kind: ToastItem["kind"] = "info") => {
    const id = Math.random().toString(36).slice(2);
    setToasts((list) => [...list, { id, kind, text }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 3600);
  }, []);

  const confirm = useCallback((options: ConfirmOptions) => {
    setConfirmOptions(options);
    return new Promise<boolean>((resolve) => { confirmResolver.current = resolve; });
  }, []);

  const resolveConfirm = (value: boolean) => {
    confirmResolver.current?.(value);
    confirmResolver.current = null;
    setConfirmOptions(null);
  };

  useEffect(() => {
    if (!confirmOptions) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") resolveConfirm(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmOptions]);

  useEffect(() => {
    if (!pathname.startsWith("/workspaces") && !pathname.startsWith("/onboarding")) return;
    // mode=live: fresh connection only (no replay of historical deltas).
    // EventSource auto-reconnects with its own Last-Event-ID, which the server honours.
    const source = new EventSource(`/api/v1/events?workspaceId=${encodeURIComponent(workspaceId)}&mode=live`);
    const handler = (event: MessageEvent) => {
      try {
        const parsed = JSON.parse(event.data);
        setLastEvent({ type: parsed.type, data: parsed.data, id: parsed.id });
        if (parsed.type === "message.delta") {
          const runId = String(parsed.data.runId ?? "");
          const taskId = String(parsed.data.taskId ?? "");
          if (!runId || completedRuns.current.has(runId)) return;
          setStreams((prev) => {
            const current = prev[runId] ?? { runId, taskId, agentId: parsed.data.agentId, text: "" };
            return { ...prev, [runId]: { ...current, text: current.text + String(parsed.data.delta ?? "") } };
          });
        }
        if (parsed.type === "message.created") {
          const runId = String(parsed.data.runId ?? "");
          if (runId) {
            completedRuns.current.add(runId);
            if (completedRuns.current.size > 300) {
              completedRuns.current = new Set(Array.from(completedRuns.current).slice(-150));
            }
            setStreams((prev) => {
              if (!prev[runId]) return prev;
              const next = { ...prev };
              delete next[runId];
              return next;
            });
          }
        }
        if (["message.created", "message.updated", "run.updated", "task.updated", "approval.resolved", "artifact.updated"].includes(parsed.type)) {
          setRefresh((k) => k + 1);
        }
      } catch {
        // ignore malformed events
      }
    };
    EVENT_TYPES.forEach((type) => source.addEventListener(type, handler as EventListener));
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    return () => source.close();
  }, [workspaceId, pathname]);

  const value = useMemo<AppContextValue>(() => ({
    api,
    refreshKey,
    refresh: () => setRefresh((k) => k + 1),
    toast,
    confirm,
    workspaceId,
    lastEvent,
    streams,
    connected,
  }), [refreshKey, toast, confirm, workspaceId, lastEvent, streams, connected]);

  return (
    <AppContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-5 right-5 z-[100] flex w-[340px] flex-col gap-2" aria-live="polite">
        {toasts.map((t) => {
          const Icon = t.kind === "success" ? CheckCircle2 : t.kind === "error" ? XCircle : Info;
          return (
            <div key={t.id} className={cn(
              "pointer-events-auto flex items-start gap-2.5 rounded-lg border bg-white px-3.5 py-3 shadow-pop animate-slide-in",
              t.kind === "error" ? "border-red-200" : t.kind === "success" ? "border-emerald-200" : "border-ink-200",
            )}>
              <Icon size={16} className={cn("mt-0.5 shrink-0", t.kind === "error" ? "text-semantic-danger" : t.kind === "success" ? "text-semantic-success" : "text-brand-500")} />
              <span className="flex-1 text-[13px] leading-5 text-ink-700">{t.text}</span>
              <button onClick={() => setToasts((list) => list.filter((x) => x.id !== t.id))} className="text-ink-400 hover:text-ink-700" aria-label="关闭提示">
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
      {confirmOptions && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-ink-900/35 px-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-[420px] rounded-xl border border-ink-200 bg-white p-5 shadow-pop animate-fade-in">
            <div className="flex gap-3">
              <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", confirmOptions.danger ? "bg-red-50 text-semantic-danger" : "bg-brand-50 text-brand-600")}>
                <AlertTriangle size={18} />
              </div>
              <div>
                <h3 className="text-[15px] font-semibold text-ink-900">{confirmOptions.title}</h3>
                {confirmOptions.body && <p className="mt-1 text-[13px] leading-5 text-ink-500">{confirmOptions.body}</p>}
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button className="btn-base h-9 border border-ink-200 px-3.5 text-ink-600 hover:bg-ink-50" onClick={() => resolveConfirm(false)}>取消</button>
              <button
                className={cn("btn-base h-9 px-3.5 text-white", confirmOptions.danger ? "bg-semantic-danger hover:brightness-95" : "bg-brand-500 hover:bg-brand-600")}
                onClick={() => resolveConfirm(true)}
              >
                {confirmOptions.confirmText ?? "确认"}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppContext.Provider>
  );
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside AppProvider");
  return ctx;
}

/** Loads data from the API and reloads on global refresh/SSE mutations. */
export function useLoad<T = any>(path: string | null) {
  const { api: apiFn, refreshKey } = useApp();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    if (!path) return;
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const result = await apiFn<T>(path);
      // Ignore stale responses: only the most recent request may write state.
      if (id === requestId.current) setData(result);
    } catch (e) {
      if (id === requestId.current) setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [path, refreshKey, apiFn]);

  useEffect(() => { void load(); }, [load]);
  return { data, loading, error, reload: load, setData };
}
