"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle, ArrowLeft, BookOpen, Check, ChevronDown, ChevronUp, CirclePause, CircleStop,
  Clock3, Copy, CornerUpLeft, Eye, FileText, Info, Link2, MessageSquare, MoreHorizontal,
  PanelLeft, Pin, Play, Plus, RefreshCw, Send, ShieldAlert, Sparkles, Users, X,
} from "lucide-react";
import { useApp, useLoad } from "../AppProvider";
import { AgentChip, Avatar, Badge, Button, Card, Drawer, EmptyState, ErrorBanner, Field, Input, MarkdownView, Modal, Progress, SectionHeader, Select, Skeleton, StatusPill, Stepper, Textarea } from "../ui";
import { cn, formatDateTime, relativeTime, STATUS_LABEL } from "@/lib/utils";

const FLOW = ["草稿", "讨论中", "执行中", "待验收", "已完成"];

export function TaskRoomView({ taskId }: { taskId: string }) {
  const router = useRouter();
  const { workspaceId, api, toast, confirm, streams, refresh, refreshKey } = useApp();
  const { data: task, loading, error, reload } = useLoad<any>(`/tasks/${taskId}`);
  const messages = useLoad<any[]>(`/tasks/${taskId}/messages?limit=300`);
  const [draft, setDraft] = useState("");
  const [mentions, setMentions] = useState<string[]>([]);
  const [target, setTarget] = useState("all");
  const [contextOpen, setContextOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [addAgentOpen, setAddAgentOpen] = useState(false);
  const [previewArtifact, setPreviewArtifact] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [showMention, setShowMention] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedBottom = useRef(true);

  const participants = task?.participants ?? [];
  const activeRun = task?.runs?.find((r: any) => ["queued", "running", "waiting_input", "waiting_approval"].includes(r.status));
  const agents = useLoad<any[]>(`/workspaces/${workspaceId}/agents`);

  const liveStreams = useMemo(
    () => Object.values(streams).filter((s) => s.taskId === taskId),
    [streams, taskId],
  );

  useEffect(() => {
    if (liveStreams.length && pinnedBottom.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [liveStreams, messages.data]);

  useEffect(() => {
    if (pinnedBottom.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.data]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    pinnedBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const send = async () => {
    const content = draft.trim();
    if (!content || busy) return;
    setBusy(true);
    try {
      const result = await api<any>(`/tasks/${taskId}/messages`, {
        method: "POST",
        body: { content, mentions, autoRun: true },
      });
      setDraft(""); setMentions([]); setTarget("all");
      refresh();
      if (!result?.run) {
        toast("消息已保存；任务里没有可用 Agent，本轮不会自动回复。可点「+」添加 Agent。", "info");
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : "发送失败", "error");
    } finally { setBusy(false); }
  };

  const runAction = async (action: string, label: string) => {
    if (!activeRun) return;
    try {
      await api(`/runs/${activeRun.id}/${action}`, { method: "POST", body: {} });
      toast(`${label}成功`, "success");
      refresh(); reload();
    } catch (e) { toast(e instanceof Error ? e.message : "操作失败", "error"); }
  };

  const decide = async (approvalId: string, decision: "approved" | "rejected") => {
    try {
      await api(`/approvals/${approvalId}/decision`, { method: "POST", body: { decision, note: "" } });
      toast(decision === "approved" ? "已批准，操作继续执行" : "已拒绝，操作未执行", decision === "approved" ? "success" : "info");
      refresh(); reload();
    } catch (e) { toast(e instanceof Error ? e.message : "审批失败", "error"); }
  };

  const transition = async (to: string) => {
    try {
      await api(`/tasks/${taskId}/transition`, { method: "POST", body: { to } });
      toast("状态已更新", "success"); refresh(); reload();
    } catch (e) { toast(e instanceof Error ? e.message : "状态更新失败", "error"); }
  };

  if (loading && !task) return <div className="p-6"><Skeleton className="h-20 w-full" /><Skeleton className="mt-4 h-[500px] w-full" /></div>;
  if (error && !task) return <div className="p-6"><ErrorBanner message={error} onRetry={reload} /></div>;
  if (!task) return null;

  const stepIndex = task.status === "done" ? 4 : task.status === "review" ? 3 : task.status === "executing" ? 2 : task.status === "discussing" ? 1 : 0;
  const latestArtifact = task.artifacts?.[task.artifacts.length - 1];

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Task header */}
      <div className="shrink-0 border-b border-ink-200 bg-white px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <button onClick={() => router.push(`/workspaces/${workspaceId}/tasks`)} className="text-ink-400 hover:text-ink-800" aria-label="返回任务列表"><ArrowLeft size={16} /></button>
          <div className="min-w-[180px] flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <h1 className="min-w-0 truncate text-[16px] font-semibold text-ink-900">{task.title}</h1>
              <StatusPill status={task.status} />
              {task.blockReason && <Badge tone="danger">阻塞：{task.blockReason}</Badge>}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink-500">
              <span className="hidden lg:inline-flex"><Stepper current={stepIndex} steps={FLOW} /></span>
              <span className="lg:hidden">阶段：{STATUS_LABEL[task.status]}</span>
              <span>第 {task.currentRound}/{task.maxRounds} 轮</span>
              <span>{task.hostMode === "user" ? "用户主持" : "主持人 Agent"}</span>
            </div>
          </div>
          <div className="flex w-full flex-wrap items-center justify-end gap-1.5 lg:w-auto">
            <div className="mr-1 flex items-center gap-1">
              {participants.slice(0, 5).map((p: any) => p.agent && <Avatar key={p.agentId} name={p.agent.name} color={p.agent.color} size={22} />)}
              <button onClick={() => setAddAgentOpen(true)} className="flex h-[22px] w-[22px] items-center justify-center rounded-md border border-dashed border-ink-300 text-ink-400 hover:border-brand-400 hover:text-brand-600" title="添加 Agent"><Plus size={12} /></button>
            </div>
            <Button size="sm" onClick={() => setEditOpen(true)}><Info size={13} /> 编辑</Button>
            <Button size="sm" onClick={() => setContextOpen(true)} className="xl:hidden"><PanelLeft size={13} /> 上下文</Button>
            {activeRun?.status === "running" && <Button size="sm" onClick={() => runAction("pause", "暂停")}><CirclePause size={13} /> 暂停</Button>}
            {activeRun?.status === "waiting_input" && <Button size="sm" onClick={() => runAction("resume", "恢复")}><Play size={13} /> 恢复</Button>}
            {activeRun && !["succeeded", "failed", "cancelled"].includes(activeRun.status) && <Button size="sm" variant="danger" onClick={() => runAction("cancel", "停止")}><CircleStop size={13} /> 停止</Button>}
            {task.status === "discussing" && <Button size="sm" variant="primary" onClick={() => transition("executing")}>进入执行</Button>}
            {task.status === "review" && <Button size="sm" variant="success" onClick={() => router.push(`/workspaces/${workspaceId}/artifacts/${latestArtifact?.id ?? ""}`)}><Check size={13} /> 验收产物</Button>}
          </div>
        </div>
        <Progress value={task.currentRound} max={task.maxRounds} />
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Left context */}
        <aside className="hidden w-[270px] shrink-0 overflow-y-auto border-r border-ink-200 bg-white p-4 xl:block">
          <ContextPanel task={{ ...task, decisions: (messages.data ?? []).filter((m: any) => m.pinned) }} workspaceId={workspaceId} />
        </aside>

        {/* Center timeline */}
        <section className="flex min-w-0 flex-1 flex-col bg-ink-50/50">
          <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-4 py-4" aria-live="polite">
            <div className="mx-auto max-w-[780px] space-y-3">
              {(messages.data ?? []).length === 0 && liveStreams.length === 0 && (
                <EmptyState icon={<MessageSquare size={20} />} title="发出第一条消息，讨论会从这里开始。" description="写下目标或指令，加入任务的 Agent 会按顺序回应。主持人欢迎语不会伪造 Agent 已工作。" />
              )}
              {(messages.data ?? []).map((m: any) => <MessageRow key={m.id} message={m} task={task} onDecision={decide} onPreview={setPreviewArtifact} />)}
              {liveStreams.map((s) => {
                const agent = agents.data?.find((a: any) => a.id === s.agentId);
                return (
                  <div key={s.runId} className="flex gap-2.5 animate-fade-in">
                    <Avatar name={agent?.name ?? "Agent"} color={agent?.color} size={28} />
                    <div className="max-w-[760px] rounded-lg border border-brand-200 bg-white px-3.5 py-2.5 shadow-card">
                      <div className="mb-1 text-[11px] font-medium text-brand-600">{agent?.name ?? "Agent"} · 正在输出 <span className="ml-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-brand-500" /></div>
                      <p className="whitespace-pre-wrap text-[13px] leading-6 text-ink-700">{s.text}<span className="ml-0.5 inline-block h-3 w-[2px] animate-pulse bg-ink-400 align-middle" /></p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Composer */}
          <div className="shrink-0 border-t border-ink-200 bg-white px-4 py-3">
            <div className="mx-auto max-w-[780px]">
              {showMention && (
                <div className="mb-2 rounded-lg border border-ink-200 bg-white p-1.5 shadow-pop">
                  <p className="px-2 py-1 text-[10px] text-ink-400">选择要 @ 的 Agent</p>
                  {participants.map((p: any) => p.agent && (
                    <button key={p.agentId} onClick={() => { setMentions((m) => m.includes(p.agentId) ? m : [...m, p.agentId]); setShowMention(false); setDraft((d) => `${d}@${p.agent.name} `); }} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] hover:bg-ink-50">
                      <Avatar name={p.agent.name} color={p.agent.color} size={18} /> {p.agent.name}
                    </button>
                  ))}
                  {participants.length === 0 && <p className="px-2 py-2 text-[12px] text-ink-400">先添加 Agent</p>}
                </div>
              )}
              <div className="rounded-lg border border-ink-200 bg-white focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-100">
                <Textarea
                  rows={2}
                  value={draft}
                  onChange={(e) => {
                    setDraft(e.target.value);
                    if (e.target.value.endsWith("@")) setShowMention(true);
                  }}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void send(); }
                    if (e.key === "Escape") setShowMention(false);
                  }}
                  placeholder="写下指令… 输入 @ 提及 Agent，Ctrl/⌘ + Enter 发送"
                  className="min-h-[64px] border-0 px-3 py-2.5 focus:ring-0"
                />
                <div className="flex flex-wrap items-center gap-2 border-t border-ink-100 px-3 py-2">
                  <Select value={target} onChange={(e) => setTarget(e.target.value)} className="h-7 w-auto !py-0 text-[11px]">
                    <option value="all">发送给全员</option>
                    <option value="host">发送给主持人</option>
                    {participants.map((p: any) => p.agent && <option key={p.agentId} value={p.agentId}>发送给 {p.agent.name}</option>)}
                  </Select>
                  {mentions.map((id) => {
                    const a = agents.data?.find((x: any) => x.id === id);
                    return a ? <AgentChip key={id} name={a.name} color={a.color} onClick={() => setMentions((m) => m.filter((x) => x !== id))} /> : null;
                  })}
                  <span className="ml-auto text-[10px] text-ink-400">Ctrl/⌘ + Enter</span>
                  <Button variant="primary" size="sm" onClick={send} disabled={busy || !draft.trim()}>
                    <Send size={13} /> {busy ? "发送中" : "发送"}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Right panel */}
        <aside className="hidden w-[320px] shrink-0 overflow-y-auto border-l border-ink-200 bg-white p-4 lg:block 2xl:w-[340px]">
          <RightPanel task={task} onDecision={decide} onPreview={setPreviewArtifact} />
        </aside>
      </div>

      <Drawer open={contextOpen} onClose={() => setContextOpen(false)} title="任务上下文"><ContextPanel task={{ ...task, decisions: (messages.data ?? []).filter((m: any) => m.pinned) }} workspaceId={workspaceId} /></Drawer>
      <TaskEditDialog open={editOpen} onClose={() => setEditOpen(false)} task={task} />
      <AddAgentDialog open={addAgentOpen} onClose={() => setAddAgentOpen(false)} task={task} />
      <ArtifactPreview artifactId={previewArtifact?.id} onClose={() => setPreviewArtifact(null)} />
    </div>
  );
}

/* ---------- context / right panels ---------- */
function ContextPanel({ task, workspaceId }: { task: any; workspaceId: string }) {
  return (
    <div className="space-y-5">
      <section>
        <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-400">任务目标</h3>
        <p className="text-[12px] leading-6 text-ink-700">{task.goal}</p>
      </section>
      <section>
        <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-400">约束</h3>
        {task.constraints?.length ? <ul className="space-y-1">{task.constraints.map((c: string, i: number) => <li key={i} className="flex gap-1.5 text-[12px] leading-5 text-ink-600"><span className="text-ink-300">•</span>{c}</li>)}</ul> : <p className="text-[12px] text-ink-400">暂无约束</p>}
      </section>
      <section>
        <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-400">验收标准</h3>
        {task.acceptanceCriteria?.length ? <ul className="space-y-1">{task.acceptanceCriteria.map((c: string, i: number) => <li key={i} className="flex gap-1.5 text-[12px] leading-5 text-ink-600"><Check size={12} className="mt-0.5 shrink-0 text-semantic-success" />{c}</li>)}</ul> : <p className="text-[12px] text-ink-400">暂无验收标准</p>}
      </section>
      <section>
        <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-400">共享资料</h3>
        {task.materials?.length ? task.materials.map((m: any) => (
          <a key={m.id} href={m.url ?? undefined} target="_blank" rel="noopener noreferrer" className="mb-1 flex items-center gap-1.5 rounded px-1.5 py-1 text-[12px] text-ink-600 hover:bg-ink-50 hover:text-brand-600">
            <Link2 size={12} className="shrink-0 text-ink-400" /><span className="truncate">{m.name}</span>
          </a>
        )) : <p className="text-[12px] text-ink-400">尚未关联资料</p>}
      </section>
      <section>
        <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-400">已确认决定</h3>
        {task.decisions?.length ? task.decisions.map((d: any) => <p key={d.id} className="mb-1 rounded border-l-2 border-brand-300 bg-brand-50/50 px-2 py-1 text-[11px] leading-5 text-ink-600">{d.content}</p>) : (
          <p className="text-[12px] leading-5 text-ink-400">将时间线中的消息标记为「关键决定」后，会进入后续上下文包。</p>
        )}
      </section>
      <button onClick={() => window.location.assign(`/api/v1/export?workspaceId=${workspaceId}&type=task&taskId=${task.id}`)} className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md border border-ink-200 py-1.5 text-[11px] text-ink-500 hover:bg-ink-50">
        <BookOpen size={12} /> 导出任务记录
      </button>
    </div>
  );
}

function RightPanel({ task, onDecision, onPreview }: { task: any; onDecision: (id: string, d: "approved" | "rejected") => void; onPreview: (a: any) => void }) {
  const router = useRouter();
  const { workspaceId } = useApp();
  const latest = task.artifacts?.[task.artifacts.length - 1];
  return (
    <div className="space-y-5">
      <section>
        <SectionHeader title="参与者" subtitle={`${task.participants?.length ?? 0} 个 Agent`} />
        <div className="space-y-1.5">
          {task.participants?.map((p: any) => p.agent && (
            <div key={p.agentId} className="flex items-center gap-2 rounded-md border border-ink-100 px-2.5 py-2">
              <Avatar name={p.agent.name} color={p.agent.color} size={24} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12px] font-medium text-ink-800">{p.agent.name}</div>
                <div className="text-[10px] text-ink-400">{p.agent.demo ? "演示 Agent" : p.agent.adapterType} · {p.agent.status === "offline" && p.agent.lastSyncAt ? `最后同步 ${relativeTime(p.agent.lastSyncAt)}` : STATUS_LABEL[p.agent.status] ?? p.agent.status}</div>
              </div>
              <StatusPill status={p.agent.status} />
            </div>
          ))}
          {!task.participants?.length && <p className="text-[12px] text-ink-400">尚未加入 Agent</p>}
        </div>
      </section>

      <section>
        <SectionHeader title="最新产物" />
        {latest ? (
          <div className="rounded-lg border border-ink-200 p-3">
            <div className="flex items-center gap-2">
              <FileText size={15} className="text-ink-400" />
              <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-ink-800">{latest.name}</span>
              <StatusPill status={latest.status} />
            </div>
            <p className="mt-1.5 text-[11px] text-ink-400">{relativeTime(latest.updatedAt)}更新 · 点击查看版本</p>
            <div className="mt-2.5 flex gap-1.5">
              <Button size="sm" onClick={() => onPreview(latest)}><Eye size={12} /> 预览</Button>
              <Button size="sm" onClick={() => router.push(`/workspaces/${workspaceId}/artifacts/${latest.id}`)}>版本比较</Button>
            </div>
          </div>
        ) : <EmptyState compact icon={<FileText size={18} />} title="还没有产物" description="Agent 提交后会显示在这里。" />}
      </section>

      <section>
        <SectionHeader title="审批待办" action={<button onClick={() => router.push(`/workspaces/${workspaceId}/approvals`)} className="text-[11px] text-brand-600 hover:underline">全部</button>} />
        {task.approvals?.length ? task.approvals.map((a: any) => (
          <div key={a.id} className="mb-2 rounded-lg border border-amber-200 bg-amber-50/60 p-3">
            <div className="flex items-center gap-1.5"><ShieldAlert size={13} className="text-semantic-warning" /><span className="text-[11px] font-medium text-amber-800">{a.type}</span><Badge tone={a.riskLevel === "high" ? "danger" : "warning"}>{a.riskLevel}</Badge></div>
            <p className="mt-1.5 text-[12px] leading-5 text-ink-700">{a.requestSummary}</p>
            <div className="mt-2 flex gap-1.5">
              <Button size="sm" variant="success" onClick={() => onDecision(a.id, "approved")}><Check size={12} /> 批准</Button>
              <Button size="sm" variant="danger" onClick={() => onDecision(a.id, "rejected")}><X size={12} /> 拒绝</Button>
            </div>
          </div>
        )) : <p className="text-[12px] text-ink-400">当前没有需要你确认的操作。</p>}
      </section>
    </div>
  );
}

/* ---------- messages ---------- */
function MessageRow({ message: m, task, onDecision, onPreview }: { message: any; task: any; onDecision: (id: string, d: "approved" | "rejected") => void; onPreview: (a: any) => void }) {
  const { api, toast, refresh } = useApp();
  const [expanded, setExpanded] = useState(false);
  const agent = m.agentId ? task.participants?.find((p: any) => p.agentId === m.agentId)?.agent : null;
  const isHuman = m.senderType === "human";

  if (m.type === "system") {
    return <div className="flex justify-center"><span className="rounded-full bg-ink-100 px-3 py-1 text-[11px] text-ink-500">{m.content}</span></div>;
  }

  const pin = async () => {
    try {
      await api(`/messages/${m.id}/pin`, { method: m.pinned ? "DELETE" : "POST", body: {} });
      refresh(); toast(m.pinned ? "已取消关键决定" : "已标记为关键决定", "success");
    } catch (e) { toast(e instanceof Error ? e.message : "操作失败", "error"); }
  };

  return (
    <div className={cn("group flex gap-2.5 animate-fade-in", isHuman && "flex-row-reverse")}>
      {isHuman ? <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-ink-800 text-[11px] font-semibold text-white">我</div> : <Avatar name={agent?.name ?? "Agent"} color={agent?.color} size={28} />}
      <div className={cn("min-w-0 max-w-[760px]", isHuman && "items-end text-right")}>
        <div className={cn("mb-1 flex items-center gap-2 text-[11px] text-ink-500", isHuman && "justify-end")}>
          <span className="font-medium text-ink-700">{isHuman ? "你" : agent?.name ?? (m.type === "error" ? "系统错误" : "Agent")}</span>
          {m.pinned && <Badge tone="brand"><Pin size={9} /> 关键决定</Badge>}
          <span>{formatDateTime(m.createdAt)}</span>
        </div>
        <div className={cn(
          "inline-block rounded-lg border px-3.5 py-2.5 text-left text-[13px] leading-6",
          isHuman ? "border-brand-200 bg-brand-50" : m.type === "error" ? "border-red-200 bg-red-50 text-red-800" : "border-ink-200 bg-white",
        )}>
          {m.type === "tool" ? (
            <div>
              <div className="flex items-center gap-2 text-[12px] font-medium text-ink-800"><span className="rounded bg-ink-100 px-1.5 py-0.5 font-mono text-[11px]">{m.toolCall?.name}</span><StatusPill status={m.toolCall?.status === "succeeded" ? "succeeded" : "failed"} /></div>
              <p className="mt-1.5 text-[12px] text-ink-600">参数：{m.toolCall?.argsSummary}</p>
              <button onClick={() => setExpanded((v) => !v)} className="mt-1 flex items-center gap-1 text-[11px] text-brand-600">{expanded ? "收起" : "展开详情"} {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}</button>
              {expanded && <div className="mt-2 rounded bg-ink-50 p-2 text-[11px] leading-5 text-ink-600"><p>结果：{m.toolCall?.resultSummary ?? "—"}</p><p>耗时：{m.toolCall?.durationMs ?? "—"} ms</p><p>状态：{m.toolCall?.status}</p></div>}
            </div>
          ) : m.type === "artifact" ? (
            <div>
              <FileText size={16} className="mb-1 text-brand-500" />
              <p className="text-[13px] text-ink-700">{m.content}</p>
              <button onClick={() => onPreview({ id: m.artifactId })} className="mt-1.5 text-[11px] text-brand-600 hover:underline">预览产物 →</button>
            </div>
          ) : m.type === "approval" ? (
            <div>
              <p className="text-[13px] text-ink-700">{m.content}</p>
              <button onClick={() => window.location.assign(`/workspaces/${task.workspaceId}/approvals`)} className="mt-1.5 text-[11px] text-brand-600 hover:underline">前往审批中心处理 →</button>
            </div>
          ) : (
            <p className="whitespace-pre-wrap">{m.content}</p>
          )}
        </div>
        <div className={cn("mt-1 flex flex-wrap items-center gap-2 text-[10px] text-ink-400", isHuman && "justify-end")}>
          <button onClick={pin} className="hover:text-brand-600"><Pin size={10} className="mr-0.5 inline" />{m.pinned ? "取消决定" : "标记决定"}</button>
          <button onClick={() => { void navigator.clipboard?.writeText(m.content); toast("已复制", "info"); }} className="hover:text-brand-600"><Copy size={10} className="mr-0.5 inline" />复制</button>
          {m.mentions?.length > 0 && <span className="flex items-center gap-1"><Users size={10} /> 提及 {m.mentions.length} 个 Agent</span>}
          {m.errorCode && <span className="text-semantic-danger">{m.errorCode}</span>}
        </div>
      </div>
    </div>
  );
}

/* ---------- dialogs ---------- */
function TaskEditDialog({ open, onClose, task }: { open: boolean; onClose: () => void; task: any }) {
  const { api, toast, refresh } = useApp();
  const [title, setTitle] = useState(task?.title ?? "");
  const [goal, setGoal] = useState(task?.goal ?? "");
  const [constraints, setConstraints] = useState<string>((task?.constraints ?? []).join("\n"));
  const [criteria, setCriteria] = useState<string>((task?.acceptanceCriteria ?? []).join("\n"));
  const [maxRounds, setMaxRounds] = useState(task?.maxRounds ?? 5);

  useEffect(() => {
    setTitle(task?.title ?? ""); setGoal(task?.goal ?? "");
    setConstraints((task?.constraints ?? []).join("\n")); setCriteria((task?.acceptanceCriteria ?? []).join("\n"));
    setMaxRounds(task?.maxRounds ?? 5);
  }, [task]);

  const save = async () => {
    try {
      await api(`/tasks/${task.id}`, { method: "PATCH", body: {
        title, goal,
        constraints: constraints.split("\n").map((s) => s.trim()).filter(Boolean),
        acceptanceCriteria: criteria.split("\n").map((s) => s.trim()).filter(Boolean),
        maxRounds,
      } });
      toast("任务已更新", "success"); refresh(); onClose();
    } catch (e) { toast(e instanceof Error ? e.message : "更新失败", "error"); }
  };

  return (
    <Modal open={open} onClose={onClose} title="编辑任务" footer={<><Button onClick={onClose}>取消</Button><Button variant="primary" onClick={save}>保存</Button></>}>
      <div className="space-y-4">
        <Field label="标题"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="目标"><Textarea rows={3} value={goal} onChange={(e) => setGoal(e.target.value)} /></Field>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="约束"><Textarea rows={3} value={constraints} onChange={(e) => setConstraints(e.target.value)} /></Field>
          <Field label="验收标准"><Textarea rows={3} value={criteria} onChange={(e) => setCriteria(e.target.value)} /></Field>
        </div>
        <Field label="最大轮数"><Input type="number" min={1} max={20} value={maxRounds} onChange={(e) => setMaxRounds(Number(e.target.value))} /></Field>
      </div>
    </Modal>
  );
}

function AddAgentDialog({ open, onClose, task }: { open: boolean; onClose: () => void; task: any }) {
  const { workspaceId, api, toast, refresh } = useApp();
  const agents = useLoad<any[]>(open ? `/workspaces/${workspaceId}/agents` : null);
  const [busy, setBusy] = useState("");
  const joined = new Set((task?.participants ?? []).map((p: any) => p.agentId));

  const add = async (id: string) => {
    setBusy(id);
    try {
      await api(`/tasks/${task.id}/agents`, { method: "POST", body: { agentId: id } });
      toast("已提交加入审批", "success"); refresh(); onClose();
    } catch (e) { toast(e instanceof Error ? e.message : "添加失败", "error"); }
    finally { setBusy(""); }
  };

  return (
    <Modal open={open} onClose={onClose} title="添加 Agent 到任务">
      <div className="space-y-2">
        {(agents.data ?? []).map((a) => (
          <div key={a.id} className="flex items-center gap-2.5 rounded-lg border border-ink-200 p-3">
            <Avatar name={a.name} color={a.color} size={28} />
            <div className="min-w-0 flex-1"><div className="text-[13px] font-medium text-ink-800">{a.name}</div><div className="text-[11px] text-ink-400">{a.capabilities?.join(" / ") || "未设置能力"}</div></div>
            <StatusPill status={a.status} />
            <Button size="sm" disabled={joined.has(a.id) || a.status === "disabled"} onClick={() => add(a.id)}>{joined.has(a.id) ? "已在任务中" : busy === a.id ? "提交中" : "加入"}</Button>
          </div>
        ))}
        {(agents.data ?? []).length === 0 && <EmptyState compact title="还没有 Agent" description="先接入一个 Agent 再加入任务。" />}
      </div>
    </Modal>
  );
}

function ArtifactPreview({ artifactId, onClose }: { artifactId?: string; onClose: () => void }) {
  const { data, loading, error } = useLoad<any>(artifactId ? `/artifacts/${artifactId}` : null);
  return (
    <Modal open={Boolean(artifactId)} onClose={onClose} title={data?.name ?? "产物预览"} width="max-w-[760px]">
      {loading && <Skeleton className="h-60 w-full" />}
      {error && <ErrorBanner message={error} />}
      {data?.current && <MarkdownView content={data.current.content} />}
    </Modal>
  );
}
