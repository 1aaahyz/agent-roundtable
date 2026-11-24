import type { ID } from "./types";

export function newId(prefix: string): ID {
  const uuid = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `${prefix}_${uuid.replace(/-/g, "").slice(0, 20)}`;
}

export function now(): string {
  return new Date().toISOString();
}

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function relativeTime(iso?: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const abs = Math.abs(diff);
  const future = diff < 0;
  const units: Array<[number, string]> = [
    [86400000, "天"],
    [3600000, "小时"],
    [60000, "分钟"],
  ];
  for (const [ms, label] of units) {
    if (abs >= ms) {
      const n = Math.floor(abs / ms);
      return future ? `${n}${label}后` : `${n}${label}前`;
    }
  }
  return future ? "即将" : "刚刚";
}

export function formatDateTime(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Client-side mirror of the server fingerprint helper; never returns the full secret. */
export function credentialFingerprintClient(value: string): string {
  const clean = value.replace(/[^A-Za-z0-9-]/g, "");
  return `${clean.slice(0, 3) || "key"}…${clean.slice(-4) || "****"}`;
}

export function truncate(s: string, n = 80): string {
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}

export interface DiffLine {
  kind: "context" | "add" | "del";
  text: string;
  oldLine?: number;
  newLine?: number;
}

/** Unified line diff via LCS. Deterministic and dependency-free. */
export function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = oldText.replace(/\r\n/g, "\n").split("\n");
  const b = newText.replace(/\r\n/g, "\n").split("\n");
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  let oldLine = 1;
  let newLine = 1;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: "context", text: a[i], oldLine: oldLine++, newLine: newLine++ });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ kind: "del", text: a[i], oldLine: oldLine++ });
      i++;
    } else {
      out.push({ kind: "add", text: b[j], newLine: newLine++ });
      j++;
    }
  }
  while (i < n) out.push({ kind: "del", text: a[i++], oldLine: oldLine++ });
  while (j < m) out.push({ kind: "add", text: b[j++], newLine: newLine++ });
  return out;
}

export const STATUS_LABEL: Record<string, string> = {
  draft: "草稿",
  discussing: "讨论中",
  executing: "执行中",
  review: "待验收",
  done: "已完成",
  blocked: "已阻塞",
  cancelled: "已取消",
  archived: "已归档",
  queued: "排队中",
  running: "运行中",
  waiting_input: "等待输入",
  waiting_approval: "等待审批",
  succeeded: "成功",
  failed: "失败",
  timed_out: "已超时",
  untested: "未测试",
  online: "在线",
  busy: "忙碌",
  offline: "离线",
  error: "错误",
  disabled: "已停用",
};

export const AGENT_COLORS = [
  "#3b6fe0",
  "#8b5cf6",
  "#0f9d8a",
  "#d97706",
  "#c0392b",
  "#0e7490",
  "#7c3aed",
  "#4d7c0f",
];

export function agentColor(index: number): string {
  return AGENT_COLORS[Math.abs(index) % AGENT_COLORS.length];
}
