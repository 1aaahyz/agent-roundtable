"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Activity, ArrowLeft, Check, CheckCircle2, Clock3, Download, FileText, GitCompare,
  History, MessageSquareWarning, RotateCcw, Search, X,
} from "lucide-react";
import { useApp, useLoad } from "../AppProvider";
import { Avatar, Badge, Button, Card, DiffView, EmptyState, ErrorBanner, Field, Input, KV, MarkdownView, Modal, SectionHeader, Select, Skeleton, StatusPill, Textarea } from "../ui";
import { cn, formatDateTime, relativeTime } from "@/lib/utils";

/* ---------------- artifacts ---------------- */
export function ArtifactsView() {
  const router = useRouter();
  const { workspaceId } = useApp();
  const tasks = useLoad<any[]>(`/workspaces/${workspaceId}/tasks`);
  const [task, setTask] = useState("all");
  const [status, setStatus] = useState("all");
  const [q, setQ] = useState("");
  const { data, loading, error, reload } = useLoad<any[]>(`/workspaces/${workspaceId}/artifacts?task=${task}&status=${status}&q=${encodeURIComponent(q)}`);

  const counts = useMemo(() => {
    const list = data ?? [];
    return { all: list.length, review: list.filter((a) => a.status === "review").length, accepted: list.filter((a) => a.status === "accepted").length };
  }, [data]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1240px] px-6 py-6">
        <div className="mb-5">
          <h1 className="text-[20px] font-semibold tracking-tight text-ink-900">交付物</h1>
          <p className="mt-0.5 text-[12px] text-ink-500">按任务和类型筛选。二进制产物只显示元信息与版本列表，不伪造 diff。</p>
        </div>
        <Card className="mb-4 flex flex-wrap items-center gap-2 p-3">
          <div className="relative min-w-[180px] flex-1">
            <Search size={14} className="absolute left-2.5 top-2.5 text-ink-400" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索产物名称" className="pl-8" />
          </div>
          <Select value={task} onChange={(e) => setTask(e.target.value)} className="w-auto min-w-[150px]">
            <option value="all">全部任务</option>
            {(tasks.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
          </Select>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto min-w-[110px]">
            <option value="all">全部状态</option><option value="review">待验收</option><option value="accepted">已接受</option><option value="draft">草稿</option><option value="changes">需修改</option><option value="archived">已归档</option>
          </Select>
          <span className="text-[11px] text-ink-400">{counts.all} 项 · {counts.review} 待验收</span>
        </Card>
        {error && <ErrorBanner message={error} onRetry={reload} />}
        {loading && !data && <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-36" />)}</div>}
        {data && data.length === 0 && <Card><EmptyState icon={<FileText size={20} />} title="Agent 提交的文档、代码和文件会保存在这里。" action={<Button size="sm" onClick={() => router.push(`/workspaces/${workspaceId}/tasks`)}>去任务中请求产物</Button>} /></Card>}
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {(data ?? []).map((a) => (
            <button key={a.id} onClick={() => router.push(`/workspaces/${workspaceId}/artifacts/${a.id}`)} className="surface p-4 text-left transition-colors hover:border-brand-300">
              <div className="flex items-start gap-2.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600"><FileText size={17} /></div>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-[14px] font-semibold text-ink-900">{a.name}</h3>
                  <p className="mt-0.5 truncate text-[11px] text-ink-400">{(tasks.data ?? []).find((t) => t.id === a.taskId)?.title ?? a.taskId} · {a.type}</p>
                </div>
                <StatusPill status={a.status} />
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-ink-100 pt-2.5 text-[11px] text-ink-400">
                <span>{a.finalVersionId ? "已指定最终版本" : "未指定最终版本"}</span>
                <span>{relativeTime(a.updatedAt)}</span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------------- artifact detail ---------------- */
export function ArtifactDetailView({ artifactId }: { artifactId: string }) {
  const router = useRouter();
  const { workspaceId, api, toast, confirm, refresh } = useApp();
  const { data, loading, error, reload } = useLoad<any>(`/artifacts/${artifactId}`);
  const tasks = useLoad<any[]>(`/workspaces/${workspaceId}/tasks`);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [mode, setMode] = useState<"preview" | "diff">("preview");
  const [changeOpen, setChangeOpen] = useState(false);
  const [note, setNote] = useState("");

  const diff = useLoad<any>(mode === "diff" ? `/artifacts/${artifactId}/diff?from=${from}&to=${to}` : null);

  if (loading && !data) return <div className="p-6"><Skeleton className="h-96 w-full" /></div>;
  if (error && !data) return <div className="p-6"><ErrorBanner message={error} onRetry={reload} /></div>;
  if (!data) return null;
  const versions = data.versions ?? [];
  const current = versions.find((v: any) => v.id === data.currentVersionId) ?? versions[versions.length - 1];
  const effectiveFrom = from || versions[Math.max(0, versions.length - 2)]?.id;
  const effectiveTo = to || current?.id;

  const act = async (action: string, body: any, message: string) => {
    try {
      await api(`/artifacts/${artifactId}/${action}`, { method: "POST", body });
      toast(message, "success"); refresh(); reload();
    } catch (e) { toast(e instanceof Error ? e.message : "操作失败", "error"); }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1240px] px-6 py-6">
        <button onClick={() => router.push(`/workspaces/${workspaceId}/artifacts`)} className="mb-3 flex items-center gap-1.5 text-[12px] text-ink-500 hover:text-ink-800"><ArrowLeft size={13} /> 返回产物库</button>
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2"><h1 className="text-[20px] font-semibold text-ink-900">{data.name}</h1><StatusPill status={data.status} />{data.finalVersionId && <Badge tone="success">最终版本</Badge>}</div>
            <p className="mt-1 text-[12px] text-ink-500">提交者 {data.createdByType === "agent" ? "Agent" : "你"} · {formatDateTime(data.updatedAt)} · 共 {versions.length} 个版本</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setMode(mode === "preview" ? "diff" : "preview")}><GitCompare size={13} /> {mode === "preview" ? "版本比较" : "内容预览"}</Button>
            <Button onClick={async () => {
              if (!(await confirm({ title: "请求修改？", body: "将创建一条带修改要求的消息，任务回到执行中。" }))) return;
              setChangeOpen(true);
            }}><MessageSquareWarning size={13} /> 请求修改</Button>
            <Button variant="success" onClick={() => act("accept", { versionId: current?.id }, "已接受该版本")}><Check size={13} /> 接受</Button>
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-[220px_1fr_240px]">
          <Card className="h-fit p-3">
            <h3 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-ink-400">版本列表</h3>
            <div className="space-y-1">
              {versions.map((v: any) => (
                <button key={v.id} onClick={() => { setTo(v.id); setMode("preview"); }} className={cn("w-full rounded-md border px-2.5 py-2 text-left", v.id === (to || current?.id) ? "border-brand-300 bg-brand-50/60" : "border-transparent hover:bg-ink-50")}>
                  <div className="flex items-center justify-between"><span className="text-[12px] font-medium text-ink-800">v{v.version}</span>{v.id === data.finalVersionId && <Badge tone="success">最终</Badge>}</div>
                  <p className="mt-0.5 truncate text-[11px] text-ink-500">{v.changeSummary}</p>
                  <p className="mt-0.5 text-[10px] text-ink-400">{relativeTime(v.createdAt)}</p>
                </button>
              ))}
            </div>
            <p className="mt-3 border-t border-ink-100 px-1 pt-2 text-[10px] leading-4 text-ink-400">已发布版本不可修改，只能追加新版本。</p>
          </Card>

          <Card className="min-h-[420px] p-5">
            {mode === "preview" ? (
              <>
                <div className="mb-4 flex items-center gap-2 border-b border-ink-100 pb-3 text-[12px] text-ink-500">
                  <FileText size={14} /> 版本 v{versions.find((v: any) => v.id === (to || current?.id))?.version ?? current?.version} · {versions.find((v: any) => v.id === (to || current?.id))?.changeSummary ?? current?.changeSummary}
                </div>
                <MarkdownView content={versions.find((v: any) => v.id === (to || current?.id))?.content ?? current?.content ?? ""} />
              </>
            ) : (
              <>
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <span className="text-[12px] text-ink-500">从</span>
                  <Select value={effectiveFrom} onChange={(e) => setFrom(e.target.value)} className="w-auto !py-1 text-[12px]">
                    {versions.map((v: any) => <option key={v.id} value={v.id}>v{v.version}</option>)}
                  </Select>
                  <span className="text-[12px] text-ink-500">到</span>
                  <Select value={effectiveTo} onChange={(e) => setTo(e.target.value)} className="w-auto !py-1 text-[12px]">
                    {versions.map((v: any) => <option key={v.id} value={v.id}>v{v.version}</option>)}
                  </Select>
                  <span className="ml-auto text-[11px] text-ink-400">统一 diff · 未变化行可折叠</span>
                </div>
                {diff.loading && <Skeleton className="h-64 w-full" />}
                {diff.error && <ErrorBanner message={diff.error} />}
                {diff.data && <DiffView lines={diff.data.lines} />}
              </>
            )}
          </Card>

          <div className="space-y-4">
            <Card className="p-4">
              <SectionHeader title="元信息" />
              <div className="divide-y divide-ink-50">
                <KV label="任务" value={<span className="truncate">{(tasks.data ?? []).find((t) => t.id === data.taskId)?.title ?? data.taskId}</span>} />
                <KV label="类型" value={data.type} />
                <KV label="当前版本" value={`v${current?.version ?? 1}`} />
                <KV label="最终版本" value={data.finalVersionId ? "已指定" : "未指定"} />
                <KV label="验收状态" value={<StatusPill status={data.status} />} />
              </div>
            </Card>
            <Card className="p-4">
              <SectionHeader title="版本操作" />
              <div className="space-y-2">
                <Button className="w-full" onClick={() => act("finalize", { versionId: current?.id }, "已设为最终版本")}><CheckCircle2 size={13} /> 设为最终版本</Button>
                <Button className="w-full" onClick={() => {
                  const blob = new Blob([current?.content ?? ""], { type: "text/markdown;charset=utf-8" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a"); a.href = url; a.download = data.name; a.click(); URL.revokeObjectURL(url);
                  toast("已下载并记录审计", "success");
                }}><Download size={13} /> 下载当前版本</Button>
                <Button className="w-full" variant="danger" onClick={async () => { if (await confirm({ title: "归档产物？", body: "将从活跃列表移除，历史保留。", danger: true })) await act("archive", {}, "已归档"); }}>归档</Button>
              </div>
            </Card>
            <Card className="p-4">
              <SectionHeader title="审批记录" />
              <p className="text-[11px] leading-5 text-ink-500">产物提交、接受与最终版本指定均已写入不可变审计日志，可在设置的安全与审计入口检索。</p>
            </Card>
          </div>
        </div>
      </div>
      <Modal open={changeOpen} onClose={() => setChangeOpen(false)} title="请求修改" footer={<><Button onClick={() => setChangeOpen(false)}>取消</Button><Button variant="primary" onClick={async () => { await act("request-changes", { note }, "已退回修改并附修改要求"); setChangeOpen(false); setNote(""); }}>提交修改要求</Button></>}>
        <Field label="修改要求" required hint="会作为一条人类消息进入任务时间线"><Textarea rows={4} value={note} onChange={(e) => setNote(e.target.value)} placeholder="例如：第 4 节补充来源标注，删除无法核实的数字" /></Field>
      </Modal>
    </div>
  );
}

/* ---------------- runs ---------------- */
export function RunsView() {
  const router = useRouter();
  const { workspaceId } = useApp();
  const { data, loading, error, reload } = useLoad<any[]>(`/runs?workspaceId=${workspaceId}`);
  const tasks = useLoad<any[]>(`/workspaces/${workspaceId}/tasks`);
  const agents = useLoad<any[]>(`/workspaces/${workspaceId}/agents`);
  const [status, setStatus] = useState("all");
  const list = (data ?? []).filter((r) => status === "all" || r.status === status);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1240px] px-6 py-6">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h1 className="text-[20px] font-semibold tracking-tight text-ink-900">执行记录</h1>
            <p className="mt-0.5 text-[12px] text-ink-500">默认异常优先。失败记录不覆盖旧数据，重试生成新的 Run ID。</p>
          </div>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto min-w-[120px]">
            <option value="all">全部状态</option><option value="failed">失败</option><option value="running">运行中</option><option value="waiting_approval">等待审批</option><option value="succeeded">成功</option><option value="cancelled">已取消</option><option value="timed_out">已超时</option>
          </Select>
        </div>
        {error && <ErrorBanner message={error} onRetry={reload} />}
        {loading && !data && <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}</div>}
        {data && list.length === 0 && <Card><EmptyState icon={<Activity size={20} />} title="启动一次任务后，这里会显示完整执行过程。" action={<Button size="sm" onClick={() => router.push(`/workspaces/${workspaceId}/tasks`)}>查看任务</Button>} /></Card>}
        <Card className="divide-y divide-ink-100">
          {list.map((r) => {
            const task = (tasks.data ?? []).find((t) => t.id === r.taskId);
            const agent = (agents.data ?? []).find((a) => a.id === r.agentId);
            return (
              <button key={r.id} onClick={() => router.push(`/workspaces/${workspaceId}/runs/${r.id}`)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-ink-50">
                <div className={cn("h-8 w-1 shrink-0 rounded-full", ["failed", "timed_out"].includes(r.status) ? "bg-semantic-danger" : ["running", "waiting_approval"].includes(r.status) ? "bg-amber-500" : "bg-ink-200")} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2"><span className="truncate text-[13px] font-medium text-ink-800">{task?.title ?? r.taskId}</span><StatusPill status={r.status} /></div>
                  <p className="mt-0.5 truncate font-mono text-[11px] text-ink-400">{r.id} · {agent?.name ?? "系统"} · 第 {r.round} 轮 · {r.errorCode ?? ""}</p>
                </div>
                <span className="shrink-0 text-[11px] text-ink-400">{relativeTime(r.createdAt)}</span>
              </button>
            );
          })}
        </Card>
      </div>
    </div>
  );
}

/* ---------------- run detail ---------------- */
export function RunDetailView({ runId }: { runId: string }) {
  const router = useRouter();
  const { workspaceId, api, toast, refresh } = useApp();
  const { data, loading, error, reload } = useLoad<any>(`/runs/${runId}`);
  const [busy, setBusy] = useState("");

  if (loading && !data) return <div className="p-6"><Skeleton className="h-96 w-full" /></div>;
  if (error && !data) return <div className="p-6"><ErrorBanner message={error} onRetry={reload} /></div>;
  if (!data) return null;
  const eventIcon: Record<string, string> = { "run.queued": "排队", "run.started": "开始", "message.delta": "流式片段", "message.completed": "消息完成", "artifact.submitted": "产物提交", "approval.requested": "审批申请", "approval.resolved": "审批完成", "run.succeeded": "成功", "run.failed": "失败", "run.cancelled": "取消" };

  const action = async (name: string, label: string) => {
    setBusy(name);
    try { await api(`/runs/${runId}/${name}`, { method: "POST", body: {} }); toast(`${label}成功`, "success"); refresh(); reload(); }
    catch (e) { toast(e instanceof Error ? e.message : "操作失败", "error"); }
    finally { setBusy(""); }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1100px] px-6 py-6">
        <button onClick={() => router.push(`/workspaces/${workspaceId}/runs`)} className="mb-3 flex items-center gap-1.5 text-[12px] text-ink-500 hover:text-ink-800"><ArrowLeft size={13} /> 返回执行记录</button>
        <div className="mb-5 flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2"><h1 className="text-[20px] font-semibold text-ink-900">运行详情</h1><StatusPill status={data.status} /></div>
            <p className="mt-1 font-mono text-[11px] text-ink-400">{data.id} · 第 {data.round} 轮 · {formatDateTime(data.createdAt)}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {data.status === "running" && <Button size="sm" onClick={() => action("pause", "暂停")} disabled={Boolean(busy)}>暂停</Button>}
            {data.status === "waiting_input" && <Button size="sm" onClick={() => action("resume", "恢复")} disabled={Boolean(busy)}>恢复</Button>}
            {["queued", "running", "waiting_input", "waiting_approval"].includes(data.status) && <Button size="sm" variant="danger" onClick={() => action("cancel", "取消")} disabled={Boolean(busy)}>取消</Button>}
            <Button size="sm" onClick={() => action("retry", "重试")} disabled={Boolean(busy)}><RotateCcw size={13} /> 新建 Run 重试</Button>
          </div>
        </div>
        {data.errorMessage && <ErrorBanner message={`${data.errorCode ?? "运行失败"}：${data.errorMessage}`} />}

        <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
          <Card className="p-5">
            <SectionHeader title="完整事件时间线" subtitle={`${data.events?.length ?? 0} 个事件`} />
            <div className="relative space-y-0 pl-5">
              <div className="absolute bottom-2 left-[5px] top-2 w-px bg-ink-200" />
              {(data.events ?? []).map((e: any) => (
                <div key={e.id} className="relative py-2">
                  <span className="absolute -left-[15px] top-3.5 h-[9px] w-[9px] rounded-full border-2 border-white bg-brand-400 ring-1 ring-brand-200" />
                  <div className="flex items-center gap-2"><span className="text-[12px] font-medium text-ink-800">{eventIcon[e.type] ?? e.type}</span><span className="font-mono text-[10px] text-ink-400">#{e.sequence} · {formatDateTime(e.createdAt)}</span></div>
                  {Object.keys(e.payload ?? {}).length > 0 && <pre className="mt-1 overflow-x-auto rounded bg-ink-50 p-2 text-[10px] leading-4 text-ink-500">{JSON.stringify(e.payload, null, 2).slice(0, 400)}</pre>}
                </div>
              ))}
              {(data.events ?? []).length === 0 && <p className="py-6 text-center text-[12px] text-ink-400">暂无事件</p>}
            </div>
          </Card>
          <div className="space-y-5">
            <Card className="p-5">
              <SectionHeader title="运行概览" />
              <div className="divide-y divide-ink-50">
                <KV label="运行 ID" value={<span className="font-mono text-[11px]">{data.id}</span>} />
                <KV label="任务 ID" value={<span className="font-mono text-[11px]">{data.taskId}</span>} />
                <KV label="触发方式" value={data.triggerType === "user" ? "用户" : data.triggerType === "agent" ? "Agent" : "系统"} />
                <KV label="开始时间" value={data.startedAt ? formatDateTime(data.startedAt) : "未开始"} />
                <KV label="结束时间" value={data.finishedAt ? formatDateTime(data.finishedAt) : "—"} />
                <KV label="错误码" value={data.errorCode ?? "—"} />
              </div>
            </Card>
            <Card className="p-5">
              <SectionHeader title="输入上下文快照" subtitle="不可被后续修改覆盖" />
              <pre className="max-h-[300px] overflow-auto rounded-lg bg-ink-900 p-3 text-[10px] leading-4 text-ink-100">
                {JSON.stringify(data.context?.data ?? {}, null, 2)}
              </pre>
            </Card>
            <Card className="p-5">
              <SectionHeader title="导出" />
              <Button className="w-full" onClick={() => window.location.assign(`/api/v1/export?workspaceId=${workspaceId}&type=runs`)}><Download size={13} /> 导出运行记录</Button>
              <p className="mt-2 text-[11px] leading-5 text-ink-400">外部凭据、Authorization Header 与密钥永不写入日志。</p>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
