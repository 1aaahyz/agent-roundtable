"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle, Check, CheckCircle2, Clock3, Download, ExternalLink, FileText,
  Link2, Plus, RotateCcw, ScrollText, ShieldAlert, Trash2, X,
} from "lucide-react";
import { useApp, useLoad } from "../AppProvider";
import { Avatar, Badge, Button, Card, EmptyState, ErrorBanner, Field, Input, KV, Modal, SectionHeader, Select, Skeleton, StatusPill, Textarea } from "../ui";
import { cn, formatDateTime, relativeTime } from "@/lib/utils";

/* ---------------- materials ---------------- */
export function MaterialsView() {
  const { workspaceId, api, toast, confirm, refresh } = useApp();
  const tasks = useLoad<any[]>(`/workspaces/${workspaceId}/tasks`);
  const { data, loading, error, reload } = useLoad<any[]>(`/workspaces/${workspaceId}/materials`);
  const [open, setOpen] = useState(false);
  const [type, setType] = useState("text");
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [url, setUrl] = useState("");
  const [taskIds, setTaskIds] = useState<string[]>([]);

  const add = async () => {
    try {
      await api(`/workspaces/${workspaceId}/materials`, { method: "POST", body: { name, type, content, url, taskIds } });
      toast("资料已添加", "success"); setOpen(false); setName(""); setContent(""); setUrl(""); setTaskIds([]); refresh(); reload();
    } catch (e) { toast(e instanceof Error ? e.message : "添加失败", "error"); }
  };

  const remove = async (id: string) => {
    try {
      await api(`/materials/${id}`, { method: "DELETE", body: { force: true } });
      toast("资料已删除", "info"); refresh(); reload();
    } catch (e) { toast(e instanceof Error ? e.message : "删除失败", "error"); }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1240px] px-6 py-6">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h1 className="text-[20px] font-semibold tracking-tight text-ink-900">共享资料</h1>
            <p className="mt-0.5 text-[12px] text-ink-500">文件、链接与文本片段，关联到任务后进入上下文引用。单文件上限 20MB。</p>
          </div>
          <Button variant="primary" onClick={() => setOpen(true)}><Plus size={14} /> 添加资料</Button>
        </div>
        {error && <ErrorBanner message={error} onRetry={reload} />}
        {loading && !data && <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-36" />)}</div>}
        {data && data.length === 0 && <Card><EmptyState icon={<FileText size={20} />} title="添加文件或链接，让 Agent 基于同一份材料工作。" action={<Button size="sm" variant="primary" onClick={() => setOpen(true)}>添加资料</Button>} /></Card>}
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {(data ?? []).map((m) => (
            <Card key={m.id} className="p-4">
              <div className="flex items-start gap-2.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-ink-100 text-ink-500">{m.type === "url" ? <Link2 size={16} /> : <FileText size={16} />}</div>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-[14px] font-semibold text-ink-900">{m.name}</h3>
                  <p className="mt-0.5 text-[11px] text-ink-400">{m.type === "url" ? "链接" : m.type === "file" ? "文件" : "文本"} · {m.visibility === "all" ? "所有 Agent 可见" : "受限"} · {relativeTime(m.createdAt)}</p>
                </div>
              </div>
              {m.content && <p className="mt-3 line-clamp-2 rounded bg-ink-50 p-2 text-[11px] leading-5 text-ink-600">{m.content}</p>}
              <div className="mt-3 flex flex-wrap gap-1">
                {m.taskIds.map((id: string) => <Badge key={id} tone="brand">{(tasks.data ?? []).find((t) => t.id === id)?.title ?? id}</Badge>)}
              </div>
              <div className="mt-3 flex gap-1.5 border-t border-ink-100 pt-2.5">
                {m.url && <a href={m.url} target="_blank" rel="noopener noreferrer" className="btn-base h-7 px-2.5 text-ink-600 hover:bg-ink-50"><ExternalLink size={12} /> 打开</a>}
                <Button size="sm" variant="danger" onClick={async () => { if (await confirm({ title: `删除「${m.name}」？`, body: "删除前会显示引用该资料的任务和产物。记录不可恢复。", danger: true, confirmText: "删除" })) await remove(m.id); }}><Trash2 size={12} /> 删除</Button>
              </div>
            </Card>
          ))}
        </div>
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title="添加共享资料" footer={<><Button onClick={() => setOpen(false)}>取消</Button><Button variant="primary" onClick={add}>添加</Button></>}>
        <div className="space-y-4">
          <Field label="类型"><Select value={type} onChange={(e) => setType(e.target.value)}><option value="text">文本片段</option><option value="url">链接</option><option value="file">文件（元信息）</option></Select></Field>
          <Field label="名称" required><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：写作规范" /></Field>
          {type === "url" ? <Field label="URL" required hint="仅 HTTPS，私网地址默认阻止"><Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/doc" /></Field> : <Field label="内容" required><Textarea rows={4} value={content} onChange={(e) => setContent(e.target.value)} /></Field>}
          <Field label="关联任务" hint="可多选"><div className="grid max-h-40 gap-1.5 overflow-y-auto rounded-lg border border-ink-200 p-3">
            {(tasks.data ?? []).map((t) => <label key={t.id} className="flex items-center gap-2 text-[12px] text-ink-700"><input type="checkbox" checked={taskIds.includes(t.id)} onChange={(e) => setTaskIds((ids) => e.target.checked ? [...ids, t.id] : ids.filter((x) => x !== t.id))} className="accent-brand-500" />{t.title}</label>)}
            {(tasks.data ?? []).length === 0 && <span className="text-[12px] text-ink-400">暂无任务</span>}
          </div></Field>
          <p className="text-[11px] leading-5 text-ink-400">演示版只保存文本与元信息，不落地二进制文件；上传类型校验、文件名清洗与 20MB 限制已在服务端实现。</p>
        </div>
      </Modal>
    </div>
  );
}

/* ---------------- approvals ---------------- */
export function ApprovalsView() {
  const router = useRouter();
  const { workspaceId, api, toast, confirm, refresh } = useApp();
  const tasks = useLoad<any[]>(`/workspaces/${workspaceId}/tasks`);
  const { data, loading, error, reload } = useLoad<any[]>(`/approvals?workspaceId=${workspaceId}`);
  const [tab, setTab] = useState("pending");
  const [note, setNote] = useState<Record<string, string>>({});

  const list = (data ?? []).filter((a) => tab === "all" || a.status === tab);
  const decide = async (id: string, decision: "approved" | "rejected") => {
    try {
      await api(`/approvals/${id}/decision`, { method: "POST", body: { decision, note: note[id] ?? "" } });
      toast(decision === "approved" ? "已批准" : "已拒绝，操作未执行", decision === "approved" ? "success" : "info");
      refresh(); reload();
    } catch (e) { toast(e instanceof Error ? e.message : "审批失败", "error"); }
  };

  const tabs = [
    { id: "pending", label: "待处理", count: (data ?? []).filter((a) => a.status === "pending").length },
    { id: "approved", label: "已批准", count: (data ?? []).filter((a) => a.status === "approved").length },
    { id: "rejected", label: "已拒绝", count: (data ?? []).filter((a) => a.status === "rejected").length },
    { id: "expired", label: "已过期", count: (data ?? []).filter((a) => a.status === "expired").length },
    { id: "all", label: "全部", count: data?.length ?? 0 },
  ];

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1000px] px-6 py-6">
        <div className="mb-5">
          <h1 className="text-[20px] font-semibold tracking-tight text-ink-900">审批中心</h1>
          <p className="mt-0.5 text-[12px] text-ink-500">高风险操作默认单次有效；批准记录不可删除，只能追加撤销记录；过期后操作不得继续。</p>
        </div>
        <div className="mb-4 flex gap-1 border-b border-ink-200">
          {tabs.map((t) => <button key={t.id} onClick={() => setTab(t.id)} className={cn("border-b-2 px-3 py-2 text-[12px]", tab === t.id ? "border-brand-500 font-medium text-brand-700" : "border-transparent text-ink-500 hover:text-ink-800")}>{t.label} <span className="ml-1 text-[10px] text-ink-400">{t.count}</span></button>)}
        </div>
        {error && <ErrorBanner message={error} onRetry={reload} />}
        {loading && !data && <div className="space-y-2">{[1, 2].map((i) => <Skeleton key={i} className="h-32" />)}</div>}
        {data && list.length === 0 && <Card><EmptyState icon={<ShieldAlert size={20} />} title="当前没有需要你确认的操作。" description="Agent 提交产物、调用工具或加入任务时会在这里出现。" /></Card>}
        <div className="space-y-3">
          {list.map((a) => {
            const task = (tasks.data ?? []).find((t) => t.id === a.taskId);
            return (
              <Card key={a.id} className="p-5">
                <div className="flex items-start gap-3">
                  <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", a.riskLevel === "high" ? "bg-red-50 text-semantic-danger" : "bg-amber-50 text-semantic-warning")}><ShieldAlert size={17} /></div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-[14px] font-semibold text-ink-900">{a.requestSummary}</h3>
                      <Badge tone={a.riskLevel === "high" ? "danger" : a.riskLevel === "medium" ? "warning" : "neutral"}>{a.riskLevel === "high" ? "高风险" : a.riskLevel === "medium" ? "中风险" : "低风险"}</Badge>
                      <StatusPill status={a.status} />
                    </div>
                    <p className="mt-1 text-[11px] text-ink-400">
                      {task?.title ?? a.taskId ?? "工作区"} · 申请者 {a.agentId ?? "系统"} · {formatDateTime(a.createdAt)} · 过期于 {formatDateTime(a.expiresAt)}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1">{a.permissions.map((p: string) => <Badge key={p} tone="neutral">{p}</Badge>)}</div>
                  </div>
                </div>
                {a.status === "pending" && (
                  <>
                    <div className="mt-3"><Input value={note[a.id] ?? ""} onChange={(e) => setNote((n) => ({ ...n, [a.id]: e.target.value }))} placeholder="决策说明（可选）" /></div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button size="sm" variant="success" onClick={() => decide(a.id, "approved")}><Check size={13} /> 批准</Button>
                      <Button size="sm" variant="danger" onClick={() => decide(a.id, "rejected")}><X size={13} /> 拒绝</Button>
                      <Button size="sm" onClick={() => toast("缩小权限后批准：请在权限矩阵中调整，再执行批准", "info")}>修改权限后批准</Button>
                      {a.taskId && <Button size="sm" variant="ghost" onClick={() => router.push(`/workspaces/${workspaceId}/tasks/${a.taskId}`)}>查看任务</Button>}
                    </div>
                  </>
                )}
                {a.decidedAt && <p className="mt-3 border-t border-ink-100 pt-2 text-[11px] text-ink-500">{a.status === "approved" ? "批准" : a.status === "rejected" ? "拒绝" : "决策"}于 {formatDateTime(a.decidedAt)} · {a.decisionNote || "无说明"}</p>}
                {a.status === "approved" && <Button size="sm" variant="danger" className="mt-2" onClick={async () => { if (!(await confirm({ title: "撤销该批准？", body: "会追加一条撤销记录，原授权不再有效。", danger: true, confirmText: "撤销" }))) return; try { await api(`/approvals/${a.id}/revoke`, { method: "POST", body: {} }); toast("已追加撤销记录", "info"); refresh(); reload(); } catch (e) { toast(e instanceof Error ? e.message : "撤销失败", "error"); } }}>撤销批准</Button>}
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ---------------- settings ---------------- */
export function SettingsView() {
  const { workspaceId, api, toast, confirm, refresh } = useApp();
  const { data, loading, error, reload } = useLoad<any>(`/workspaces/${workspaceId}/settings`);
  const ws = useLoad<any>(`/workspaces/${workspaceId}`);
  const [tab, setTab] = useState("discussion");
  const [audit, setAudit] = useState<any[]>([]);
  const [auditQ, setAuditQ] = useState("");
  const [name, setName] = useState("");

  const loadAudit = async () => {
    try { setAudit(await api<any[]>(`/audit?workspaceId=${workspaceId}&q=${encodeURIComponent(auditQ)}`)); }
    catch (e) { toast(e instanceof Error ? e.message : "审计检索失败", "error"); }
  };

  if (loading && !data) return <div className="p-6"><Skeleton className="h-96 w-full" /></div>;
  if (error && !data) return <div className="p-6"><ErrorBanner message={error} onRetry={reload} /></div>;
  if (!data) return null;

  const save = async (patch: any, message = "设置已保存") => {
    try { await api(`/workspaces/${workspaceId}/settings`, { method: "PATCH", body: patch }); toast(message, "success"); refresh(); reload(); }
    catch (e) { toast(e instanceof Error ? e.message : "保存失败", "error"); }
  };

  const tabs = [
    ["workspace", "工作区"], ["discussion", "讨论"], ["approval", "审批"],
    ["security", "安全"], ["appearance", "外观"], ["notifications", "通知"], ["audit", "审计"],
  ];

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1000px] px-6 py-6">
        <div className="mb-5"><h1 className="text-[20px] font-semibold tracking-tight text-ink-900">设置</h1><p className="mt-0.5 text-[12px] text-ink-500">工作区、讨论、审批、安全、通知与审计。</p></div>
        <div className="flex gap-5">
          <nav className="w-[150px] shrink-0 space-y-0.5">
            {tabs.map(([id, label]) => <button key={id} onClick={() => setTab(id)} className={cn("w-full rounded-md px-2.5 py-1.5 text-left text-[12px]", tab === id ? "bg-brand-50 font-medium text-brand-700" : "text-ink-600 hover:bg-ink-100")}>{label}</button>)}
          </nav>
          <div className="min-w-0 flex-1">
            {tab === "workspace" && <Card className="p-5"><SectionHeader title="工作区" /><div className="space-y-4">
              <Field label="名称"><Input defaultValue={ws.data?.name} onChange={(e) => setName(e.target.value)} /></Field>
              <Button variant="primary" onClick={async () => { if (!name) return; try { await api(`/workspaces/${workspaceId}`, { method: "PATCH", body: { name } }); toast("已保存", "success"); refresh(); } catch (e) { toast(e instanceof Error ? e.message : "保存失败", "error"); } }}>保存名称</Button>
              <div className="border-t border-ink-100 pt-4">
                <div className="divide-y divide-ink-50"><KV label="工作区 ID" value={<span className="font-mono text-[11px]">{workspaceId}</span>} /><KV label="时区" value={data.workspace.timezone} /><KV label="默认任务模板" value={data.workspace.taskTemplate} /></div>
              </div>
              <div className="rounded-lg border border-red-200 bg-red-50/50 p-4">
                <h3 className="text-[13px] font-semibold text-semantic-danger">危险操作</h3>
                <p className="mt-1 text-[12px] leading-5 text-ink-600">删除工作区后进入 7 天宽限期，业务数据不会立即物理删除。</p>
                <Button size="sm" variant="danger" className="mt-3" onClick={async () => { if (await confirm({ title: "请求删除工作区？", body: "7 天宽限期内可恢复；需要二次认证（P1）。", danger: true, confirmText: "提交请求" })) { try { await api(`/workspaces/${workspaceId}`, { method: "DELETE", body: {} }); toast("删除请求已提交", "info"); } catch (e) { toast(e instanceof Error ? e.message : "提交失败", "error"); } } }}>请求删除工作区</Button>
              </div>
            </div></Card>}

            {tab === "discussion" && <Card className="p-5"><SectionHeader title="讨论规则" /><div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="默认主持人"><Select value={data.discussion.hostMode} onChange={(e) => save({ discussion: { hostMode: e.target.value } })}><option value="user">用户主持</option><option value="agent">主持人 Agent</option></Select></Field>
                <Field label="最大轮数"><Input type="number" min={1} max={20} value={data.discussion.maxRounds} onChange={(e) => save({ discussion: { maxRounds: Number(e.target.value) } })} /></Field>
                <Field label="单轮超时（秒）"><Input type="number" value={data.discussion.roundTimeoutSec} onChange={(e) => save({ discussion: { roundTimeoutSec: Number(e.target.value) } })} /></Field>
                <Field label="单次响应超时（秒）"><Input type="number" value={data.discussion.responseTimeoutSec} onChange={(e) => save({ discussion: { responseTimeoutSec: Number(e.target.value) } })} /></Field>
                <Field label="上下文最近消息数"><Input type="number" value={data.discussion.recentMessages} onChange={(e) => save({ discussion: { recentMessages: Number(e.target.value) } })} /></Field>
              </div>
              <label className="flex items-center gap-2 text-[12px] text-ink-700"><input type="checkbox" checked={data.discussion.allowCrossRefs} onChange={(e) => save({ discussion: { allowCrossRefs: e.target.checked } })} className="accent-brand-500" /> 允许 Agent 互相引用消息</label>
              <p className="text-[11px] leading-5 text-ink-400">达到轮数上限后自动停止，不无限讨论；连续 2 轮无进展会暂停并请求用户决定。</p>
            </div></Card>}

            {tab === "approval" && <Card className="p-5"><SectionHeader title="默认审批策略" /><div className="space-y-3">
              {[
                ["artifactFirst", "产物首次提交需要审批", data.approval.artifactFirst],
                ["toolWrite", "写操作工具每次审批", data.approval.toolWrite],
                ["completion", "完成任务必须人工确认", data.approval.completion],
              ].map(([key, label, value]: any) => (
                <label key={key} className="flex items-center justify-between rounded-lg border border-ink-100 px-3 py-2.5 text-[12px] text-ink-700">
                  {label}
                  <input type="checkbox" checked={value} onChange={(e) => save({ approval: { [key]: e.target.checked } })} className="h-4 w-4 accent-brand-500" />
                </label>
              ))}
              <p className="text-[11px] leading-5 text-ink-400">完成任务始终需要人工确认，此开关只控制提示强度；Agent 无权自行完成。</p>
            </div></Card>}

            {tab === "security" && <Card className="p-5"><SectionHeader title="安全设置" /><div className="space-y-4">
              <label className="flex items-center justify-between rounded-lg border border-ink-100 px-3 py-2.5 text-[12px] text-ink-700">
                <span>允许私网 / 回环地址（自托管显式开启，会记录审计）</span>
                <input type="checkbox" checked={data.security.allowPrivateNetwork} onChange={(e) => save({ security: { allowPrivateNetwork: e.target.checked } })} className="accent-brand-500" />
              </label>
              <Field label="日志保留天数"><Input type="number" value={data.security.logRetentionDays} onChange={(e) => save({ security: { logRetentionDays: Number(e.target.value) } })} /></Field>
              <div className="grid gap-2 md:grid-cols-2">
                <Button onClick={() => window.location.assign(`/api/v1/export?workspaceId=${workspaceId}&type=task`)}><Download size={13} /> 导出任务数据</Button>
                <Button onClick={() => window.location.assign(`/api/v1/export?workspaceId=${workspaceId}&type=runs`)}><Download size={13} /> 导出运行记录</Button>
              </div>
              <div className="rounded-lg border border-ink-200 bg-ink-50 p-3 text-[11px] leading-5 text-ink-500">
                SSRF 防护：默认只允许 HTTPS，禁止云元数据、回环与私网地址；每次跳转重新校验。Markdown 渲染前清洗 HTML；外链使用 noopener noreferrer。
              </div>
            </div></Card>}

            {tab === "appearance" && <Card className="p-5"><SectionHeader title="外观" /><div className="space-y-4">
              <Field label="主题"><Select value={data.appearance.theme} onChange={(e) => save({ appearance: { theme: e.target.value } })}><option value="light">浅色</option><option value="dark">深色（后续版本）</option></Select></Field>
              <Field label="消息密度"><Select value={data.appearance.density} onChange={(e) => save({ appearance: { density: e.target.value } })}><option value="comfortable">舒适</option><option value="compact">紧凑</option></Select></Field>
              <p className="text-[11px] leading-5 text-ink-400">尊重系统「减少动态效果」设置；所有状态不只靠颜色表达。</p>
            </div></Card>}

            {tab === "notifications" && <Card className="p-5"><SectionHeader title="站内通知类型" /><div className="space-y-2">
              {Object.entries(data.notifications).map(([key, value]: any) => (
                <label key={key} className="flex items-center justify-between rounded-lg border border-ink-100 px-3 py-2 text-[12px] text-ink-700">
                  {({ approval: "需要审批", agent_failed: "Agent 失败或离线", artifact_review: "新产物待验收", task_completed: "任务完成", permission_changed: "权限变更", export_ready: "数据导出完成" } as any)[key] ?? key}
                  <input type="checkbox" checked={value} onChange={(e) => save({ notifications: { [key]: e.target.checked } })} className="accent-brand-500" />
                </label>
              ))}
              <p className="mt-2 text-[11px] text-ink-400">第一版不发送邮件或浏览器推送。</p>
            </div></Card>}

            {tab === "audit" && <Card className="p-5"><SectionHeader title="审计日志" subtitle="登录、配置变更、权限申请、审批、导出与删除记录" /><div className="mb-3 flex gap-2"><Input value={auditQ} onChange={(e) => setAuditQ(e.target.value)} placeholder="检索动作或对象" onKeyDown={(e) => e.key === "Enter" && loadAudit()} /><Button onClick={loadAudit}>检索</Button></div>
              <div className="max-h-[420px] overflow-y-auto divide-y divide-ink-50">
                {audit.length === 0 && <p className="py-8 text-center text-[12px] text-ink-400">点击「检索」查看记录</p>}
                {audit.map((a) => <div key={a.id} className="flex items-start gap-2 py-2 text-[11px]"><ScrollText size={12} className="mt-0.5 shrink-0 text-ink-400" /><span className="w-[150px] shrink-0 font-mono text-ink-600">{a.action}</span><span className="flex-1 truncate text-ink-500">{a.targetRef}</span><span className="shrink-0 text-ink-400">{formatDateTime(a.createdAt)}</span></div>)}
              </div>
            </Card>}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------- honest placeholders ---------------- */
export function PlaceholderView({ title }: { title: string }) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <Card className="max-w-[520px] p-8 text-center">
        <AlertTriangle size={24} className="mx-auto mb-3 text-semantic-warning" />
        <h1 className="text-[16px] font-semibold text-ink-900">{title}</h1>
        <p className="mt-2 text-[13px] leading-6 text-ink-500">该功能属于 P1 里程碑，当前版本未开放。导航保留入口，但不伪装成已完成功能。</p>
        <p className="mt-4 text-[12px] text-ink-400">第一版提供单所有者工作区、任务协作、Agent 接入、产物版本、审批、运行记录、共享资料与基础安全审计。</p>
      </Card>
    </div>
  );
}
