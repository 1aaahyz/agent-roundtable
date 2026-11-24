"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  Activity, Bell, BookOpen, Boxes, CheckSquare, ChevronDown, Command, FolderOpen,
  LayoutDashboard, LogOut, Menu, Plus, Search, Settings, ShieldCheck, Users, Wifi, WifiOff, X,
} from "lucide-react";
import { useApp, useLoad } from "./AppProvider";
import { Badge, Drawer, Input, KV, StatusPill } from "./ui";
import { cn, relativeTime } from "@/lib/utils";

const NAV = [
  { label: "工作区总览", href: "", icon: LayoutDashboard },
  { label: "任务工作区", href: "/tasks", icon: FolderOpen },
  { label: "Agent 接入", href: "/agents", icon: Boxes },
  { label: "交付物", href: "/artifacts", icon: BookOpen },
  { label: "执行记录", href: "/runs", icon: Activity },
  { label: "共享资料", href: "/materials", icon: Users },
  { label: "审批中心", href: "/approvals", icon: CheckSquare },
  { label: "设置", href: "/settings", icon: Settings },
];

function useWorkspaceName() {
  const { workspaceId } = useApp();
  const { data } = useLoad<any>(`/workspaces/${workspaceId}`);
  return data?.name ?? "我的工作区";
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const { workspaceId, connected, refresh, toast, api } = useApp();
  const name = useWorkspaceName();
  const [palette, setPalette] = useState(false);
  const [notifications, setNotifications] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [query, setQuery] = useState("");
  const [workspaces, setWorkspaces] = useState<any[]>([]);

  const approvals = useLoad<any[]>(`/approvals?workspaceId=${workspaceId}&status=pending`);
  const notes = useLoad<any[]>(`/notifications?workspaceId=${workspaceId}`);
  const unread = (notes.data ?? []).filter((n) => !n.readAt).length;

  useEffect(() => {
    void api<any[]>("/workspaces").then(setWorkspaces).catch(() => {});
  }, [api]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette(true); }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "a") { e.preventDefault(); router.push(`/workspaces/${workspaceId}/approvals`); }
      if ((e.metaKey || e.ctrlKey) && e.key === "/") { e.preventDefault(); setPalette(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, workspaceId]);

  const go = (href: string) => {
    router.push(`/workspaces/${workspaceId}${href}`);
    setMobileNav(false);
    setPalette(false);
  };

  const active = NAV.find((n) => (n.href ? pathname.includes(n.href) : pathname === `/workspaces/${workspaceId}`));

  return (
    <div className="flex h-screen overflow-hidden bg-ink-50">
      {mobileNav && <div className="fixed inset-0 z-30 bg-ink-900/30 lg:hidden" onClick={() => setMobileNav(false)} />}
      <aside className={cn(
        "fixed inset-y-0 left-0 z-40 flex w-[228px] flex-col border-r border-ink-200 bg-white transition-transform lg:static lg:translate-x-0",
        mobileNav ? "translate-x-0" : "-translate-x-full",
      )}>
        <div className="flex h-[60px] shrink-0 items-center gap-2.5 border-b border-ink-100 px-4">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-500 text-[13px] font-bold text-white">A</div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold text-ink-900">智能体圆桌</div>
            <div className="text-[10px] text-ink-400">同一张桌子，同一个上下文</div>
          </div>
          <button className="text-ink-400 lg:hidden" onClick={() => setMobileNav(false)} aria-label="关闭导航"><X size={16} /></button>
        </div>

        <div className="px-3 py-3">
          <div className="group relative">
            <select
              value={workspaceId}
              onChange={(e) => router.push(`/workspaces/${e.target.value}`)}
              className="w-full cursor-pointer appearance-none rounded-md border border-ink-200 bg-ink-50 py-1.5 pl-2.5 pr-7 text-[12px] font-medium text-ink-700 hover:bg-ink-100"
              aria-label="切换工作区"
            >
              {(workspaces.length ? workspaces : [{ id: workspaceId, name }]).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
            <ChevronDown size={13} className="pointer-events-none absolute right-2 top-2 text-ink-400" />
          </div>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto px-2" aria-label="主导航">
          {NAV.map((item) => {
            const Icon = item.icon;
            const isActive = active?.label === item.label;
            return (
              <button
                key={item.label}
                onClick={() => go(item.href)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] transition-colors",
                  isActive ? "bg-brand-50 font-medium text-brand-700" : "text-ink-600 hover:bg-ink-100 hover:text-ink-900",
                )}
              >
                <Icon size={15} className={isActive ? "text-brand-600" : "text-ink-400"} />
                <span className="flex-1">{item.label}</span>
                {item.label === "审批中心" && (approvals.data?.length ?? 0) > 0 && (
                  <span className="rounded-full bg-amber-100 px-1.5 text-[10px] font-semibold text-amber-700">{approvals.data?.length}</span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="border-t border-ink-100 p-3">
          <div className="mb-2 flex items-center gap-2 text-[11px] text-ink-500">
            {connected ? <Wifi size={12} className="text-semantic-success" /> : <WifiOff size={12} className="text-semantic-warning" />}
            {connected ? "实时连接正常" : "实时连接已断开，正在重连；历史记录仍可查看"}
          </div>
          <div className="flex items-center gap-2 rounded-md px-1 py-1.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-ink-800 text-[11px] font-semibold text-white">我</div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12px] font-medium text-ink-800">工作区所有者</div>
              <div className="truncate text-[10px] text-ink-400">demo@agent.local</div>
            </div>
            <button
              onClick={async () => {
                try { await api("/auth/logout", { method: "POST", body: {} }); } catch { /* still redirect */ }
                window.location.href = "/login";
              }}
              className="rounded p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-800"
              title="退出登录"
              aria-label="退出登录"
            ><LogOut size={14} /></button>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[60px] shrink-0 items-center gap-3 border-b border-ink-200 bg-white px-4">
          <button className="text-ink-500 lg:hidden" onClick={() => setMobileNav(true)} aria-label="打开导航"><Menu size={18} /></button>
          <button
            onClick={() => setPalette(true)}
            className="flex h-8 min-w-[180px] flex-1 items-center gap-2 rounded-md border border-ink-200 bg-ink-50 px-2.5 text-[12px] text-ink-400 hover:bg-ink-100 sm:max-w-[360px]"
          >
            <Search size={14} />
            <span className="flex-1 text-left">搜索任务、Agent、产物…</span>
            <kbd className="rounded border border-ink-200 bg-white px-1.5 py-0.5 font-mono text-[10px]">⌘K</kbd>
          </button>
          <div className="ml-auto flex items-center gap-1.5">
            <button
              onClick={() => go("/tasks")}
              className="flex h-8 w-8 items-center justify-center rounded-md text-ink-500 hover:bg-ink-100"
              title="新建任务"
              aria-label="新建任务"
            ><Plus size={17} /></button>
            <button
              onClick={() => router.push(`/workspaces/${workspaceId}/approvals`)}
              className="relative flex h-8 items-center gap-1.5 rounded-md px-2 text-[12px] text-ink-600 hover:bg-ink-100"
              title="审批中心 (Ctrl+Shift+A)"
            >
              <ShieldCheck size={16} />
              {(approvals.data?.length ?? 0) > 0 && <span className="rounded-full bg-amber-100 px-1.5 text-[10px] font-semibold text-amber-700">{approvals.data?.length}</span>}
            </button>
            <button
              onClick={() => setNotifications(true)}
              className="relative flex h-8 w-8 items-center justify-center rounded-md text-ink-500 hover:bg-ink-100"
              title="通知中心"
              aria-label="通知中心"
            >
              <Bell size={16} />
              {unread > 0 && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-semantic-danger ring-2 ring-white" />}
            </button>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
      </div>

      <Drawer open={notifications} onClose={() => setNotifications(false)} title="通知中心">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-[12px] text-ink-500">{unread} 条未读</span>
          <button
            className="text-[12px] text-brand-600 hover:underline"
            onClick={async () => { try { await api(`/notifications/read-all`, { method: "POST" }); refresh(); toast("已全部标记为已读", "success"); } catch (e) { toast(e instanceof Error ? e.message : "操作失败", "error"); } }}
          >全部标为已读</button>
        </div>
        <div className="space-y-2">
          {(notes.data ?? []).length === 0 && <p className="py-10 text-center text-[13px] text-ink-400">暂无通知</p>}
          {(notes.data ?? []).map((n) => (
            <button
              key={n.id}
              onClick={async () => {
                if (!n.readAt) { try { await api(`/notifications/${n.id}/read`, { method: "POST" }); refresh(); } catch { /* navigation still proceeds */ } }
                setNotifications(false);
                router.push(n.targetRef);
              }}
              className={cn("w-full rounded-lg border p-3 text-left hover:bg-ink-50", n.readAt ? "border-ink-100 bg-white" : "border-brand-100 bg-brand-50/40")}
            >
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-medium text-ink-800">{n.title}</span>
                {!n.readAt && <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />}
              </div>
              <p className="mt-1 text-[12px] leading-5 text-ink-600">{n.body}</p>
              <p className="mt-1.5 text-[10px] text-ink-400">{relativeTime(n.createdAt)}</p>
            </button>
          ))}
        </div>
      </Drawer>

      {palette && <CommandPalette onClose={() => setPalette(false)} onNavigate={go} />}
    </div>
  );
}

function CommandPalette({ onClose, onNavigate }: { onClose: () => void; onNavigate: (href: string) => void }) {
  const { workspaceId, api } = useApp();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ group: string; label: string; href: string; meta?: string }[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => { setActiveIndex(0); }, [q]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key === "ArrowDown") { e.preventDefault(); setActiveIndex((i) => Math.min(results.length - 1, i + 1)); }
      if (e.key === "ArrowUp") { e.preventDefault(); setActiveIndex((i) => Math.max(0, i - 1)); }
      if (e.key === "Enter" && results[activeIndex]) { e.preventDefault(); onNavigate(results[activeIndex].href); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onNavigate, results, activeIndex]);

  useEffect(() => {
    void (async () => {
      try {
        const [tasks, agents, artifacts] = await Promise.all([
          api<any[]>(`/workspaces/${workspaceId}/tasks`),
          api<any[]>(`/workspaces/${workspaceId}/agents`),
          api<any[]>(`/workspaces/${workspaceId}/artifacts`),
        ]);
        const term = q.trim().toLowerCase();
        const items = [
          ...tasks.filter((t) => !term || t.title.toLowerCase().includes(term)).map((t) => ({ group: "任务", label: t.title, href: `/tasks/${t.id}`, meta: t.status })),
          ...agents.filter((a) => !term || a.name.toLowerCase().includes(term)).map((a) => ({ group: "Agent", label: a.name, href: `/agents/${a.id}`, meta: a.adapterType })),
          ...artifacts.filter((a) => !term || a.name.toLowerCase().includes(term)).map((a) => ({ group: "产物", label: a.name, href: `/artifacts/${a.id}`, meta: a.status })),
          ...NAV.filter((n) => !term || n.label.includes(term)).map((n) => ({ group: "导航", label: n.label, href: n.href, meta: "" })),
          { group: "操作", label: "新建任务", href: "/tasks?new=1", meta: "" },
          { group: "操作", label: "接入 Agent", href: "/agents/new", meta: "" },
        ];
        setResults(items.slice(0, 18));
      } catch { /* ignore */ }
    })();
  }, [q, workspaceId, api]);

  const grouped = useMemo(() => {
    const map = new Map<string, typeof results>();
    results.forEach((r) => map.set(r.group, [...(map.get(r.group) ?? []), r]));
    return Array.from(map.entries());
  }, [results]);

  return (
    <div className="fixed inset-0 z-[95] flex items-start justify-center bg-ink-900/35 px-4 pt-[12vh]" onMouseDown={onClose} role="dialog" aria-modal="true" aria-label="命令面板">
      <div className="w-full max-w-[560px] overflow-hidden rounded-xl border border-ink-200 bg-white shadow-pop animate-fade-in" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2.5 border-b border-ink-100 px-4 py-3">
          <Command size={16} className="text-ink-400" />
          <Input autoFocus aria-label="搜索任务、Agent、产物或操作" value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索任务、Agent、产物或执行操作…" className="border-0 !px-0 !py-0 focus:ring-0" />
          <kbd className="rounded border border-ink-200 px-1.5 py-0.5 font-mono text-[10px] text-ink-400">Esc</kbd>
        </div>
        <div className="max-h-[52vh] overflow-y-auto p-2">
          {grouped.length === 0 && <p className="py-10 text-center text-[13px] text-ink-400">没有匹配结果</p>}
          {grouped.map(([group, items]) => (
            <div key={group} className="mb-1.5">
              <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-ink-400">{group}</p>
              {items.map((item) => {
                const index = results.findIndex((r) => r.group === group && r.label === item.label && r.href === item.href);
                return (
                <button
                  key={`${group}-${item.label}`}
                  onClick={() => onNavigate(item.href)}
                  onMouseEnter={() => setActiveIndex(index)}
                  className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-ink-700", index === activeIndex ? "bg-brand-50 text-brand-700" : "hover:bg-ink-50")}
                >
                  <span className="flex-1 truncate">{item.label}</span>
                  {item.meta && <Badge tone="neutral">{item.meta}</Badge>}
                </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3 border-t border-ink-100 px-4 py-2 text-[10px] text-ink-400">
          <span>↑↓ 选择</span><span>Enter 打开</span><span>Esc 关闭</span>
        </div>
      </div>
    </div>
  );
}
