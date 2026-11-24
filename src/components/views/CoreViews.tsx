"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight, BookOpen, Boxes, CheckSquare, ChevronRight, CircleAlert, Clock3,
  FileText, Filter, ListTodo, Plus, Search, Sparkles, Users,
} from "lucide-react";
import { useApp, useLoad } from "../AppProvider";
import { Avatar, Badge, Button, Card, EmptyState, ErrorBanner, Field, Input, Modal, SectionHeader, Select, Skeleton, StatusPill, Textarea } from "../ui";
import { cn, relativeTime, STATUS_LABEL } from "@/lib/utils";

/* ---------------- Login ---------------- */
export function LoginView() {
  const router = useRouter();
  const { api, toast } = useApp();
  const [email, setEmail] = useState("demo@agent.local");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    setBusy(true); setError("");
    try {
      await api("/auth/login", { method: "POST", body: { email, password } });
      router.push("/onboarding");
    } catch (e) {
      setError(e instanceof Error ? e.message : "登录失败");
    } finally { setBusy(false); }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-50 px-4">
      <div className="w-full max-w-[420px]">
        <div className="mb-8 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500 text-lg font-bold text-white">A</div>
          <div>
            <h1 className="text-[18px] font-semibold tracking-tight text-ink-900">Agent 协作工作区</h1>
            <p className="mt-0.5 text-[12px] text-ink-500">让多个 Agent 围绕同一任务讨论、分工、修改，由你最终验收。</p>
          </div>
        </div>
        <Card className="p-6">
          <h2 className="text-[15px] font-semibold text-ink-900">登录到工作区</h2>
          <p className="mt-1 text-[12px] text-ink-500">本地账号，密码仅存于本机（scrypt 哈希），不上传任何服务。</p>
          <div className="mt-5 space-y-4">
            <Field label="邮箱" required>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            </Field>
            <Field label="密码" required>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="••••••••" />
            </Field>
            {error && <ErrorBanner message={error} />}
            <Button variant="primary" className="w-full" onClick={submit} disabled={busy}>
              {busy ? "登录中…" : "登录"} <ArrowRight size={14} />
            </Button>
          </div>
          <div className="mt-5 border-t border-ink-100 pt-4">
            <p className="text-[11px] leading-5 text-ink-400">
              首次使用默认密码 <code className="font-mono">demo-2026</code>，登录后可在设置里修改。Agent 不能自行完成任务，最终验收始终由你决定。
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}

/* ---------------- Onboarding ---------------- */
export function OnboardingView() {
  const router = useRouter();
  const { workspaceId, api, toast } = useApp();
  const [busy, setBusy] = useState(false);

  const choose = async (kind: "task" | "agent" | "demo") => {
    setBusy(true);
    try {
      if (kind === "demo") {
        await api(`/workspaces/${workspaceId}/agents`, {
          method: "POST",
          body: { name: "体验 Agent", adapterType: "demo", role: "writer", capabilities: ["写作"], endpoint: "local://demo-agent" },
        });
        toast("演示 Agent 已接入，可随时加入任务", "success");
      }
      router.push(kind === "task" ? `/workspaces/${workspaceId}/tasks?new=1` : `/workspaces/${workspaceId}${kind === "agent" ? "/agents/new" : ""}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "操作失败", "error");
      setBusy(false);
    }
  };

  const options = [
    { kind: "task" as const, icon: ListTodo, title: "创建第一个任务", desc: "写下目标、约束和验收标准", action: "新建任务" },
    { kind: "agent" as const, icon: Boxes, title: "先接入 Agent", desc: "Demo、A2A 或 HTTP 回调", action: "接入 Agent" },
    { kind: "demo" as const, icon: Sparkles, title: "用演示 Agent 体验", desc: "本地模拟，完整跑通讨论与产物", action: "立即体验" },
  ];

  return (
    <div className="mx-auto flex min-h-full max-w-[820px] flex-col justify-center px-6 py-12">
      <h1 className="text-[22px] font-semibold text-ink-900">从这里开始</h1>
      <p className="mt-2 text-[13px] text-ink-500">默认工作区已就绪。选择一个起点，随时可以改。</p>
      <div className="mt-8 grid gap-3 md:grid-cols-3">
        {options.map((o) => {
          const Icon = o.icon;
          return (
            <button key={o.kind} disabled={busy} onClick={() => choose(o.kind)} className="surface group p-5 text-left transition-colors hover:border-brand-300 hover:bg-brand-50/30">
              <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50 text-brand-600"><Icon size={18} /></div>
              <h3 className="text-[14px] font-semibold text-ink-800">{o.title}</h3>
              <p className="mt-1 text-[12px] leading-5 text-ink-500">{o.desc}</p>
              <div className="mt-4 flex items-center gap-1 text-[12px] font-medium text-brand-600">{o.action} <ChevronRight size={13} className="transition-transform group-hover:translate-x-0.5" /></div>
            </button>
          );
        })}
      </div>
      <button onClick={() => router.push(`/workspaces/${workspaceId}`)} className="mt-8 self-start text-[12px] text-ink-500 underline underline-offset-2 hover:text-ink-800">
        跳过，直接查看工作区总览
      </button>
    </div>
  );
}

/* ---------------- Overview ---------------- */
export function OverviewView() {
  const router = useRouter();
  const { workspaceId } = useApp();
  const { data, loading, error, reload } = useLoad<any>(`/workspaces/${workspaceId}/overview`);
  const [createOpen, setCreateOpen] = useState(false);

  if (loading && !data) return <div className="space-y-4 p-6"><Skeleton className="h-16 w-full" /><Skeleton className="h-40 w-full" /><Skeleton className="h-40 w-full" /></div>;
  if (error && !data) return <div className="p-6"><ErrorBanner message={error} onRetry={reload} /></div>;
  if (!data) return null;

  const c = data.counts;
  const needs = data.needsAction;
  const go = (path: string) => router.push(`/workspaces/${workspaceId}${path}`);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1240px] px-6 py-6">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-[20px] font-semibold tracking-tight text-ink-900">工作区总览</h1>
            <p className="mt-0.5 text-[12px] text-ink-500">结论来自真实的任务、审批与运行记录。</p>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => go("/agents/new")}><Plus size={14} /> 接入 Agent</Button>
            <Button variant="primary" onClick={() => setCreateOpen(true)}><Plus size={14} /> 新建任务</Button>
          </div>
        </div>

        <div className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-brand-100 bg-brand-50/60 px-4 py-3 text-[15px] leading-7 text-ink-800">
          <span className="font-medium">{data.conclusion}</span>
          {c.failedRuns > 0 && <button onClick={() => go("/runs")} className="text-[12px] text-semantic-danger underline underline-offset-2">{c.failedRuns} 条运行异常</button>}
        </div>

        <div className="mb-6 grid gap-3 md:grid-cols-3">
          <ActionColumn
            title="等待你确认" count={needs.approvals.length} tone="warning" icon={CheckSquare}
            onAll={() => go("/approvals")}
            empty="当前没有需要你确认的操作。"
            rows={needs.approvals.map((a: any) => ({ key: a.id, title: a.summary, meta: a.risk === "high" ? "高风险" : a.risk === "medium" ? "中风险" : "低风险", onClick: () => go("/approvals") }))}
          />
          <ActionColumn
            title="运行异常" count={needs.failures.length} tone="danger" icon={CircleAlert}
            onAll={() => go("/runs")}
            empty="没有运行异常。"
            rows={needs.failures.map((r: any) => ({ key: r.id, title: `运行 ${r.id.slice(-8)} 失败`, meta: r.code ?? "运行失败", onClick: () => go(`/runs/${r.id}`) }))}
          />
          <ActionColumn
            title="待验收产物" count={needs.reviews.length} tone="brand" icon={FileText}
            onAll={() => go("/artifacts")}
            empty="暂无待验收产物。"
            rows={needs.reviews.map((a: any) => ({ key: a.id, title: a.name, meta: "待验收", onClick: () => go(`/artifacts/${a.id}`) }))}
          />
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
          <section>
            <SectionHeader title="进行中的任务" subtitle={`${c.active} 个活跃任务`} action={<button onClick={() => go("/tasks")} className="text-[12px] text-brand-600 hover:underline">查看全部</button>} />
            {data.tasks.length === 0 ? (
              <Card><EmptyState compact icon={<ListTodo size={20} />} title="还没有任务" description="创建第一个任务，给 Agent 一个明确目标。" action={<Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>新建任务</Button>} /></Card>
            ) : (
              <div className="space-y-2.5">
                {data.tasks.map((t: any) => (
                  <button key={t.id} onClick={() => go(`/tasks/${t.id}`)} className="surface block w-full p-4 text-left transition-colors hover:border-brand-300">
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="truncate text-[14px] font-semibold text-ink-900">{t.title}</h3>
                          <StatusPill status={t.status} />
                          {t.blockReason && <Badge tone="danger">阻塞</Badge>}
                        </div>
                        <p className="mt-1 line-clamp-1 text-[12px] text-ink-500">{t.goal}</p>
                        <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink-400">
                          <span className="flex items-center gap-1"><Users size={12} /> {t.agentCount} 个 Agent</span>
                          <span className="flex items-center gap-1"><Clock3 size={12} /> {relativeTime(t.updatedAt)}</span>
                          <span>第 {t.currentRound}/{t.maxRounds} 轮</span>
                          {t.pendingApprovals > 0 && <span className="text-semantic-warning">{t.pendingApprovals} 项待审批</span>}
                          {t.latestArtifact && <span>产物 {t.latestArtifact.name}</span>}
                        </div>
                      </div>
                      <ChevronRight size={15} className="mt-1 shrink-0 text-ink-300" />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>

          <div className="space-y-6">
            <section>
              <SectionHeader title="最近产物" action={<button onClick={() => go("/artifacts")} className="text-[12px] text-brand-600 hover:underline">产物库</button>} />
              <Card className="divide-y divide-ink-100">
                {data.artifacts.length === 0 && <div className="px-4 py-8 text-center text-[12px] text-ink-400">暂无产物</div>}
                {data.artifacts.map((a: any) => (
                  <button key={a.id} onClick={() => go(`/artifacts/${a.id}`)} className="flex w-full items-center gap-2.5 px-4 py-3 text-left hover:bg-ink-50">
                    <FileText size={15} className="shrink-0 text-ink-400" />
                    <span className="min-w-0 flex-1 truncate text-[12px] text-ink-700">{a.name}</span>
                    <StatusPill status={a.status} />
                  </button>
                ))}
              </Card>
            </section>
            <section>
              <SectionHeader title="Agent 在线情况" action={<button onClick={() => go("/agents")} className="text-[12px] text-brand-600 hover:underline">管理</button>} />
              <Card className="divide-y divide-ink-100">
                {data.agents.map((a: any) => (
                  <div key={a.id} className="flex items-center gap-2.5 px-4 py-2.5">
                    <Avatar name={a.name} color={a.color} size={24} />
                    <span className="min-w-0 flex-1 truncate text-[12px] text-ink-700">{a.name}</span>
                    {a.demo && <Badge tone="purple">演示</Badge>}
                    <span className="text-[11px] text-ink-400">{a.status === "offline" && a.lastSyncAt ? `最后同步 ${relativeTime(a.lastSyncAt)}` : ""}</span>
                    <StatusPill status={a.status} />
                  </div>
                ))}
              </Card>
            </section>
          </div>
        </div>
      </div>
      <TaskCreateDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}

function ActionColumn({ title, count, tone, icon: Icon, rows, empty, onAll }: {
  title: string; count: number; tone: "warning" | "danger" | "brand"; icon: any;
  rows: { key: string; title: string; meta: string; onClick: () => void }[]; empty: string; onAll: () => void;
}) {
  const toneClass = tone === "danger" ? "text-semantic-danger" : tone === "warning" ? "text-semantic-warning" : "text-brand-600";
  return (
    <Card className="flex min-h-[172px] flex-col p-4">
      <div className="mb-2 flex items-center gap-2">
        <Icon size={15} className={toneClass} />
        <h3 className="flex-1 text-[13px] font-semibold text-ink-800">{title}</h3>
        <span className={cn("rounded-full px-1.5 text-[11px] font-semibold", tone === "danger" ? "bg-red-50 text-semantic-danger" : tone === "warning" ? "bg-amber-50 text-semantic-warning" : "bg-brand-50 text-brand-600")}>{count}</span>
      </div>
      <div className="flex-1">
        {rows.length === 0 && <p className="pt-6 text-center text-[12px] text-ink-400">{empty}</p>}
        {rows.map((r) => (
          <button key={r.key} onClick={r.onClick} className="flex w-full items-center gap-2 border-b border-ink-50 py-1.5 text-left last:border-0 hover:text-brand-600">
            <span className="min-w-0 flex-1 truncate text-[12px] text-ink-700">{r.title}</span>
            <span className="shrink-0 text-[10px] text-ink-400">{r.meta}</span>
          </button>
        ))}
      </div>
      <button onClick={onAll} className="mt-2 self-start text-[11px] text-ink-500 hover:text-brand-600">查看全部 →</button>
    </Card>
  );
}

/* ---------------- Tasks ---------------- */
export function TasksView() {
  const router = useRouter();
  const { workspaceId } = useApp();
  const { data, loading, error, reload } = useLoad<any[]>(`/workspaces/${workspaceId}/tasks`);
  const [createOpen, setCreateOpen] = useState(false);
  const [status, setStatus] = useState("all");
  const [agent, setAgent] = useState("all");
  const [range, setRange] = useState("all");
  const [q, setQ] = useState("");

  const agents = useLoad<any[]>(`/workspaces/${workspaceId}/agents`);
  const list = useMemo(() => {
    let items = data ?? [];
    if (status !== "all") items = items.filter((t) => t.status === status);
    if (agent !== "all") items = items.filter((t) => t.participants.some((p: any) => p.agentId === agent));
    if (q.trim()) {
      const term = q.trim().toLowerCase();
      items = items.filter((t) => `${t.title} ${t.goal} ${t.artifacts.map((a: any) => a.name).join(" ")}`.toLowerCase().includes(term));
    }
    if (range !== "all") {
      const days = range === "today" ? 1 : range === "week" ? 7 : 30;
      const from = Date.now() - days * 86400_000;
      items = items.filter((t) => new Date(t.updatedAt).getTime() >= from);
    }
    return items;
  }, [data, status, agent, q, range]);

  const groups = useMemo(() => {
    const order = ["draft", "discussing", "executing", "review", "blocked", "done", "cancelled", "archived"];
    return order.map((s) => ({ status: s, items: list.filter((t) => t.status === s) })).filter((g) => g.items.length);
  }, [list]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1240px] px-6 py-6">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h1 className="text-[20px] font-semibold tracking-tight text-ink-900">任务工作区</h1>
            <p className="mt-0.5 text-[12px] text-ink-500">按状态分组，讨论、产物与审批围绕同一个任务。</p>
          </div>
          <Button variant="primary" onClick={() => setCreateOpen(true)}><Plus size={14} /> 新建任务</Button>
        </div>

        <Card className="mb-5 flex flex-wrap items-center gap-2 p-3">
          <div className="relative min-w-[180px] flex-1">
            <Search size={14} className="absolute left-2.5 top-2.5 text-ink-400" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索标题、目标或产物名称" className="pl-8" />
          </div>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto min-w-[110px]">
            <option value="all">全部状态</option>
            {Object.entries(STATUS_LABEL).filter(([k]) => ["draft", "discussing", "executing", "review", "done", "blocked", "cancelled", "archived"].includes(k)).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <Select value={agent} onChange={(e) => setAgent(e.target.value)} className="w-auto min-w-[110px]">
            <option value="all">全部 Agent</option>
            {(agents.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
          <Select value={range} onChange={(e) => setRange(e.target.value)} className="w-auto min-w-[100px]">
            <option value="all">全部时间</option><option value="today">今天</option><option value="week">本周</option><option value="month">本月</option>
          </Select>
          <span className="flex items-center gap-1 text-[11px] text-ink-400"><Filter size={12} /> {list.length} 项</span>
        </Card>

        {error && <ErrorBanner message={error} onRetry={reload} />}
        {loading && !data && <div className="space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full" />)}</div>}
        {data && groups.length === 0 && (
          <Card><EmptyState icon={<ListTodo size={20} />} title="没有匹配的任务" description="调整筛选条件，或创建第一个任务，给 Agent 一个明确目标。" action={<Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>新建任务</Button>} /></Card>
        )}
        <div className="space-y-6">
          {groups.map((g) => (
            <section key={g.status}>
              <div className="mb-2 flex items-center gap-2">
                <StatusPill status={g.status} />
                <span className="text-[11px] text-ink-400">{g.items.length} 个</span>
                <div className="h-px flex-1 bg-ink-200" />
              </div>
              <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
                {g.items.map((t: any) => (
                  <button key={t.id} onClick={() => router.push(`/workspaces/${workspaceId}/tasks/${t.id}`)} className="surface flex flex-col p-4 text-left transition-colors hover:border-brand-300">
                    <div className="flex items-start gap-2">
                      <h3 className="min-w-0 flex-1 truncate text-[14px] font-semibold text-ink-900">{t.title}</h3>
                      {t.approvals?.length > 0 && <Badge tone="warning">{t.approvals.length} 待审批</Badge>}
                    </div>
                    <p className="mt-1.5 line-clamp-2 min-h-[38px] text-[12px] leading-5 text-ink-500">{t.goal}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                      {t.participants.slice(0, 4).map((p: any) => p.agent && <Avatar key={p.agentId} name={p.agent.name} color={p.agent.color} size={20} />)}
                      {t.participants.length === 0 && <span className="text-[11px] text-ink-400">尚未加入 Agent</span>}
                    </div>
                    <div className="mt-3 flex items-center justify-between border-t border-ink-100 pt-2.5 text-[11px] text-ink-400">
                      <span>{relativeTime(t.updatedAt)}</span>
                      <span>{t.currentRound}/{t.maxRounds} 轮</span>
                      <span>{t.artifacts?.length ?? 0} 产物</span>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
      <TaskCreateDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}

/* ---------------- Task create ---------------- */
export function TaskCreateDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const { workspaceId, api, toast } = useApp();
  const agents = useLoad<any[]>(open ? `/workspaces/${workspaceId}/agents` : null);
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [constraints, setConstraints] = useState("");
  const [criteria, setCriteria] = useState("");
  const [maxRounds, setMaxRounds] = useState(5);
  const [hostMode, setHostMode] = useState("user");
  const [agentIds, setAgentIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (!title.trim() || !goal.trim()) { setError("标题和目标是必填项"); return; }
    setBusy(true); setError("");
    try {
      const task = await api<any>(`/workspaces/${workspaceId}/tasks`, {
        method: "POST",
        body: {
          title, goal,
          constraints: constraints.split("\n").map((s) => s.trim()).filter(Boolean),
          acceptanceCriteria: criteria.split("\n").map((s) => s.trim()).filter(Boolean),
          maxRounds, hostMode, agentIds,
        },
      });
      onClose();
      setTitle(""); setGoal(""); setConstraints(""); setCriteria(""); setAgentIds([]);
      toast("任务已创建", "success");
      router.push(`/workspaces/${workspaceId}/tasks/${task.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "创建失败");
    } finally { setBusy(false); }
  };

  return (
    <Modal
      open={open} onClose={onClose} title="新建任务"
      width="max-w-[640px]"
      footer={<><Button onClick={onClose}>取消</Button><Button variant="primary" onClick={submit} disabled={busy}>{busy ? "创建中…" : "创建任务"}</Button></>}
    >
      <div className="space-y-4">
        <Field label="标题" required><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如：产品发布文章" /></Field>
        <Field label="目标" required hint="一句话写清要交付什么"><Textarea rows={3} value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="例如：撰写一篇面向开发者的发布文章" /></Field>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="约束" hint="每行一条"><Textarea rows={3} value={constraints} onChange={(e) => setConstraints(e.target.value)} placeholder={"引用官方来源\n不夸大能力"} /></Field>
          <Field label="验收标准" hint="每行一条"><Textarea rows={3} value={criteria} onChange={(e) => setCriteria(e.target.value)} placeholder={"包含三个真实案例\n通过审校"} /></Field>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="主持人"><Select value={hostMode} onChange={(e) => setHostMode(e.target.value)}><option value="user">用户主持（推荐）</option><option value="agent">主持人 Agent</option></Select></Field>
          <Field label="最大轮数"><Input type="number" min={1} max={20} value={maxRounds} onChange={(e) => setMaxRounds(Number(e.target.value))} /></Field>
        </div>
        <Field label="参与 Agent" hint="可稍后在协作室添加">
          <div className="grid gap-2 rounded-lg border border-ink-200 p-3 md:grid-cols-2">
            {(agents.data ?? []).length === 0 && <p className="text-[12px] text-ink-400">还没有 Agent，可先创建任务再接入。</p>}
            {(agents.data ?? []).map((a) => (
              <label key={a.id} className="flex cursor-pointer items-center gap-2 text-[12px] text-ink-700">
                <input type="checkbox" checked={agentIds.includes(a.id)} onChange={(e) => setAgentIds((ids) => e.target.checked ? [...ids, a.id] : ids.filter((x) => x !== a.id))} className="accent-brand-500" />
                <Avatar name={a.name} color={a.color} size={18} /> {a.name}
                {a.demo && <Badge tone="purple">演示</Badge>}
              </label>
            ))}
          </div>
        </Field>
        {error && <ErrorBanner message={error} />}
      </div>
    </Modal>
  );
}
