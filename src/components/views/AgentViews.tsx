"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, ArrowRight, Boxes, Check, CheckCircle2, CircleHelp, KeyRound, PlugZap,
  Plus, RefreshCw, Settings2, Shield, Trash2, Wrench, XCircle,
} from "lucide-react";
import { useApp, useLoad } from "../AppProvider";
import { Avatar, Badge, Button, Card, EmptyState, ErrorBanner, Field, Input, KV, Modal, SectionHeader, Select, Skeleton, StatusPill, Stepper, Textarea } from "../ui";
import { cn, credentialFingerprintClient, formatDateTime, relativeTime } from "@/lib/utils";

/* ---------------- list ---------------- */
export function AgentsView() {
  const router = useRouter();
  const { workspaceId, api, toast, confirm, refresh } = useApp();
  const { data, loading, error, reload } = useLoad<any[]>(`/workspaces/${workspaceId}/agents`);
  const agents = useMemo(() => {
    const order: Record<string, number> = { error: 0, offline: 1, untested: 2, busy: 3, online: 4, disabled: 5 };
    return [...(data ?? [])].sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));
  }, [data]);

  const test = async (id: string) => {
    try {
      const result = await api<any>(`/agents/${id}/test`, { method: "POST", body: {} });
      toast(result.pass ? "连接测试通过" : "部分测试项未通过，请查看 Agent 详情", result.pass ? "success" : "info");
      refresh();
    } catch (e) { toast(e instanceof Error ? e.message : "测试失败", "error"); }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1240px] px-6 py-6">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h1 className="text-[20px] font-semibold tracking-tight text-ink-900">Agent 接入</h1>
            <p className="mt-0.5 text-[12px] text-ink-500">异常 Agent 优先显示。未连接时显示未接入，连接中断显示最后同步时间。</p>
          </div>
          <Button variant="primary" onClick={() => router.push(`/workspaces/${workspaceId}/agents/new`)}><Plus size={14} /> 新建连接</Button>
        </div>
        {error && <ErrorBanner message={error} onRetry={reload} />}
        {loading && !data && <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-44" />)}</div>}
        {data && agents.length === 0 && (
          <Card><EmptyState icon={<Boxes size={20} />} title="接入你的 Agent，或先用 Demo Agent 体验。" description="Demo Agent 在本地模拟完整流程；A2A 与 HTTP 回调适配器按标准协议接入。" action={<Button variant="primary" size="sm" onClick={() => router.push(`/workspaces/${workspaceId}/agents/new`)}>接入 Agent</Button>} /></Card>
        )}
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {agents.map((a) => (
            <Card key={a.id} className={cn("p-4 transition-colors hover:border-brand-300", ["error", "offline"].includes(a.status) && "border-amber-200")}>
              <div className="flex items-start gap-3">
                <Avatar name={a.name} color={a.color} size={34} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <h3 className="truncate text-[14px] font-semibold text-ink-900">{a.name}</h3>
                    {a.demo && <Badge tone="purple">演示</Badge>}
                  </div>
                  <p className="mt-0.5 text-[11px] text-ink-400">{a.adapterType === "demo" ? "Demo Agent" : a.adapterType === "model_api" ? `模型 API${a.modelId ? ` · ${a.modelId}` : ""}` : a.adapterType === "a2a" ? "A2A" : "HTTP 回调"} · {a.role}</p>
                </div>
                <StatusPill status={a.status} />
              </div>
              <div className="mt-3 flex flex-wrap gap-1">
                {a.capabilities?.map((c: string) => <Badge key={c} tone="neutral">{c}</Badge>)}
              </div>
              <div className="mt-3 space-y-1 border-t border-ink-100 pt-3 text-[11px] text-ink-500">
                <div className="flex justify-between"><span>最近测试</span><span>{a.lastHealthcheckAt ? relativeTime(a.lastHealthcheckAt) : "未测试"}</span></div>
                <div className="flex justify-between"><span>参与任务</span><span>{a.tasks?.length ?? 0} 个</span></div>
                <div className="flex justify-between"><span>权限</span><span>{a.permissionPolicy?.tools?.length ?? 0} 个工具白名单</span></div>
              </div>
              <div className="mt-3 flex gap-1.5">
                <Button size="sm" onClick={() => router.push(`/workspaces/${workspaceId}/agents/${a.id}`)}><Settings2 size={12} /> 详情</Button>
                <Button size="sm" onClick={() => test(a.id)}><PlugZap size={12} /> 测试</Button>
                {a.status !== "disabled" && <Button size="sm" variant="ghost" onClick={async () => { if (!(await confirm({ title: `停用 ${a.name}？`, body: "停用后无法加入新任务。", danger: true }))) return; try { await api(`/agents/${a.id}/disable`, { method: "POST", body: {} }); refresh(); toast("已停用", "info"); } catch (e) { toast(e instanceof Error ? e.message : "停用失败", "error"); } }}>停用</Button>}
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------------- wizard ---------------- */
const STEPS = ["选择方式", "填写连接", "测试与授权"];

export function AgentWizardView() {
  const router = useRouter();
  const { workspaceId, api, toast } = useApp();
  const [step, setStep] = useState(0);
  const [kind, setKind] = useState<"demo" | "model_api" | "a2a" | "http_callback" | null>(null);
  const [role, setRole] = useState("writer");
  const [name, setName] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [modelId, setModelId] = useState("doubao-seed-1-6-251015");
  const [useMock, setUseMock] = useState(true);
  const [authType, setAuthType] = useState("none");
  const [credential, setCredential] = useState("");
  const [capabilities, setCapabilities] = useState("写作, 长文生成");
  const [allowHttp, setAllowHttp] = useState(false);
  const [allowPrivate, setAllowPrivate] = useState(false);
  const [created, setCreated] = useState<any>(null);
  const [testResult, setTestResult] = useState<any>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const urlError = useMemo(() => {
    if (kind === "model_api" && useMock) return "";
    if (!endpoint || kind === "demo") return "";
    try {
      const u = new URL(endpoint);
      if (u.protocol !== "https:" && !(allowHttp && u.protocol === "http:")) return "只允许 HTTPS；本地开发可勾选允许 HTTP";
      if (!allowPrivate && (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(u.hostname))) return "默认禁止私网 / 回环地址，防止 SSRF";
      return "";
    } catch { return "请输入合法 URL"; }
  }, [endpoint, kind, allowHttp, allowPrivate]);

  const submit = async () => {
    setError(""); setBusy(true);
    try {
      const agent = await api<any>(`/workspaces/${workspaceId}/agents`, {
        method: "POST",
        body: {
          name: name.trim() || `${kind === "demo" ? "演示" : kind === "model_api" ? "模型" : kind === "a2a" ? "A2A" : "HTTP"} Agent`,
          adapterType: kind, role,
          endpoint: kind === "demo" ? "local://demo-agent" : kind === "model_api" && useMock ? "local://mock-openai" : endpoint,
          modelId: kind === "model_api" ? modelId : undefined,
          authType, credential, capabilities: capabilities.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
        },
      });
      setCreated(agent);
      const result = await api<any>(`/agents/${agent.id}/test`, { method: "POST", body: {} });
      setTestResult(result);
      setStep(2);
    } catch (e) { setError(e instanceof Error ? e.message : "保存失败"); }
    finally { setBusy(false); }
  };

  const kinds = [
    { id: "demo" as const, icon: SparklesIcon, title: "Demo Agent", desc: "本地实现，无外部服务即可演示完整流程。明确标注为演示。", needs: "选择角色模板" },
    { id: "model_api" as const, icon: SparklesIcon, title: "模型 API", desc: "OpenAI 兼容 chat/completions：火山方舟豆包、DeepSeek、GLM、Kimi 等。支持无密钥本地自测。", needs: "模型 ID、Base URL、密钥" },
    { id: "a2a" as const, icon: PlugZap, title: "A2A", desc: "支持标准 Agent 协议的独立服务：Agent Card、Task、Message、Artifact。", needs: "Agent Card URL、认证" },
    { id: "http_callback" as const, icon: RefreshCw, title: "HTTP 回调", desc: "自定义 Agent API。平台发送任务，Agent 签名回调事件。", needs: "任务接口、回调认证" },
  ];

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[860px] px-6 py-6">
        <button onClick={() => router.push(`/workspaces/${workspaceId}/agents`)} className="mb-3 flex items-center gap-1.5 text-[12px] text-ink-500 hover:text-ink-800"><ArrowLeft size={13} /> 返回 Agent 列表</button>
        <h1 className="text-[20px] font-semibold text-ink-900">接入 Agent</h1>
        <p className="mt-1 text-[12px] text-ink-500">三步完成：选择方式、填写连接、测试与授权。凭据只写入一次，页面永不回显完整密钥。</p>
        <div className="my-5"><Stepper current={step} steps={STEPS} /></div>

        <Card className="p-5">
          {step === 0 && (
            <>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {kinds.map((k) => {
                  const Icon = k.icon;
                  return (
                    <button key={k.id} onClick={() => { setKind(k.id); setName(k.title); }} className={cn("rounded-lg border p-4 text-left transition-colors", kind === k.id ? "border-brand-400 bg-brand-50/50" : "border-ink-200 hover:border-brand-200")}>
                      <Icon size={18} className={kind === k.id ? "text-brand-600" : "text-ink-400"} />
                      <h3 className="mt-2 text-[14px] font-semibold text-ink-800">{k.title}</h3>
                      <p className="mt-1 text-[12px] leading-5 text-ink-500">{k.desc}</p>
                      <p className="mt-3 text-[11px] text-ink-400">需要：{k.needs}</p>
                    </button>
                  );
                })}
              </div>
              <div className="mt-5 flex items-center justify-between border-t border-ink-100 pt-4">
                <span className="text-[12px] text-ink-400">{kind ? `已选择：${kinds.find((k) => k.id === kind)?.title}` : "请先选择一种接入方式"}</span>
                <Button variant="primary" disabled={!kind} onClick={() => setStep(1)}>下一步 <ArrowRight size={13} /></Button>
              </div>
            </>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="名称" required><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：审校 Agent" /></Field>
                <Field label="角色模板">
                  <Select value={role} onChange={(e) => setRole(e.target.value)}>
                    <option value="researcher">调研</option><option value="writer">写作</option><option value="reviewer">审校</option><option value="coder">编程</option><option value="custom">自定义</option>
                  </Select>
                </Field>
              </div>
              <Field label="能力描述" hint="用逗号分隔"><Input value={capabilities} onChange={(e) => setCapabilities(e.target.value)} /></Field>
              {kind === "model_api" && (
                <>
                  <div className="rounded-lg border border-brand-100 bg-brand-50/50 px-3 py-2.5 text-[12px] leading-5 text-ink-600">
                    无密钥自测使用本地模拟端点，消息会明确标记「本地模拟」，不会向外部发送任何请求。填写密钥后可切换到真实 Base URL。
                  </div>
                  <label className="flex items-center gap-2 text-[12px] text-ink-700">
                    <input type="checkbox" checked={useMock} onChange={(e) => setUseMock(e.target.checked)} className="accent-brand-500" />
                    使用本地模拟端点（无密钥自测）
                  </label>
                  <div className="flex flex-wrap gap-2 text-[11px]">
                    <button type="button" onClick={() => { setUseMock(false); setEndpoint("https://api.xiaomimimo.com/v1"); setModelId("mimo-v2.6-flash"); setAuthType("bearer"); }} className="rounded border border-ink-200 px-2 py-1 text-ink-600 hover:border-brand-300 hover:text-brand-600">小米 MiMo 实时（mimo-v2.6-flash）</button>
                    <button type="button" onClick={() => { setUseMock(false); setEndpoint("https://ark.cn-beijing.volces.com/api/v3"); setModelId("doubao-seed-1-6-251015"); setAuthType("bearer"); }} className="rounded border border-ink-200 px-2 py-1 text-ink-600 hover:border-brand-300 hover:text-brand-600">火山方舟豆包</button>
                    <span className="self-center text-ink-400">批量推理地址不支持实时对话</span>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field label="模型 ID / 接入点 ID" required>
                      <Input value={modelId} onChange={(e) => setModelId(e.target.value)} placeholder="doubao-seed-1-6-251015 或 ep-xxx" />
                    </Field>
                    <Field label="Base URL" hint="OpenAI 兼容">
                      <Input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} disabled={useMock} placeholder="https://ark.cn-beijing.volces.com/api/v3" />
                    </Field>
                  </div>
                  {!useMock && (
                    <>
                      {urlError && <p className="-mt-2 text-[12px] text-semantic-danger">{urlError}</p>}
                      <Field label="API Key" hint="AES-GCM 密文保存，仅显示指纹，不回显">
                        <Input type="password" value={credential} onChange={(e) => setCredential(e.target.value)} placeholder="ARK_API_KEY" />
                      </Field>
                      {credential && <p className="text-[11px] text-ink-400">将保存指纹：{credentialFingerprintClient(credential)}</p>}
                    </>
                  )}
                </>
              )}
              {(kind === "a2a" || kind === "http_callback") && (
                <>
                  <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2.5 text-[12px] leading-5 text-ink-600">
                    本地版本会保存配置并完成 URL / 认证 / SSRF 校验。HTTP 回调接口已可用（签名 + 去重）；A2A 的真实协议握手需部署后联调，产物提交不会在演示中被模拟。
                  </div>
                  <Field label={kind === "a2a" ? "Agent Card URL" : "任务接口 URL"} required>
                    <Input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="https://agent.example.com/.well-known/agent.json" />
                  </Field>
                  {urlError && <p className="-mt-2 text-[12px] text-semantic-danger">{urlError}</p>}
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field label="认证方式">
                      <Select value={authType} onChange={(e) => setAuthType(e.target.value)}><option value="none">无</option><option value="api_key">API Key</option><option value="bearer">Bearer Token</option></Select>
                    </Field>
                    <Field label="凭据" hint="仅保存指纹，不回显">
                      <Input type="password" value={credential} onChange={(e) => setCredential(e.target.value)} placeholder="sk-..." />
                    </Field>
                  </div>
                  <div className="flex flex-wrap gap-4 rounded-lg border border-ink-200 bg-ink-50 p-3 text-[12px] text-ink-600">
                    <label className="flex items-center gap-1.5"><input type="checkbox" checked={allowHttp} onChange={(e) => setAllowHttp(e.target.checked)} className="accent-brand-500" /> 允许本地 HTTP（仅开发环境）</label>
                    <label className="flex items-center gap-1.5"><input type="checkbox" checked={allowPrivate} onChange={(e) => setAllowPrivate(e.target.checked)} className="accent-brand-500" /> 允许私网访问（记录审计）</label>
                  </div>
                  {credential && <p className="text-[11px] text-ink-400">将保存指纹：{credentialFingerprintClient(credential)}</p>}
                </>
              )}
              {error && <ErrorBanner message={error} />}
              <div className="flex justify-end gap-2 border-t border-ink-100 pt-4">
                <Button onClick={() => setStep(0)}>上一步</Button>
                <Button variant="primary" disabled={!kind || Boolean(urlError) || busy} onClick={submit}>{busy ? "保存并测试中…" : "保存并测试"}</Button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <div className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50/60 p-4">
                {testResult?.pass ? <CheckCircle2 size={20} className="text-semantic-success" /> : <XCircle size={20} className="text-semantic-warning" />}
                <div>
                  <p className="text-[13px] font-medium text-ink-800">{testResult?.pass ? "连接测试通过，Agent 可用于任务" : "部分测试项未通过"}</p>
                  <p className="mt-0.5 text-[12px] text-ink-500">{testResult?.message ?? (testResult?.pass ? "默认权限：读取任务目标与发送消息允许；读取资料、提交产物首次询问；工具与外链默认拒绝。" : created?.lastError ?? "外部 Agent 需在实际部署中完成远端握手。")}</p>
                </div>
              </div>
              <div className="space-y-2">
                {(testResult?.checks ?? []).map((c: any) => (
                  <div key={c.name} className="flex items-center gap-2.5 rounded-md border border-ink-100 px-3 py-2 text-[12px]">
                    {c.ok ? <Check size={14} className="text-semantic-success" /> : <XCircle size={14} className="text-semantic-warning" />}
                    <span className="w-24 text-ink-700">{c.name}</span>
                    <span className="text-ink-500">{c.detail}</span>
                  </div>
                ))}
              </div>
              <div className="rounded-lg border border-ink-200 p-4">
                <h3 className="mb-2 flex items-center gap-1.5 text-[13px] font-medium text-ink-800"><Shield size={14} /> 权限策略</h3>
                <div className="grid gap-2 text-[12px] text-ink-600 md:grid-cols-2">
                  <p>读取任务目标：允许</p><p>发送讨论消息：允许</p>
                  <p>读取共享资料：首次询问</p><p>提交产物：首次询问</p>
                  <p>调用工具：默认拒绝</p><p>外部 URL：默认拒绝</p>
                  <p>修改任务状态：拒绝</p><p>完成 / 取消任务：拒绝</p>
                </div>
                <p className="mt-3 text-[11px] text-ink-400">可在 Agent 详情中逐项调整。所有权限变更都会写入审计日志。</p>
              </div>
              <div className="flex justify-end gap-2">
                <Button onClick={() => router.push(`/workspaces/${workspaceId}/agents`)}>返回列表</Button>
                <Button variant="primary" onClick={() => router.push(`/workspaces/${workspaceId}/agents/${created?.id}`)}>查看 Agent 详情</Button>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function SparklesIcon(props: any) { return <svg {...props} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" /></svg>; }

/* ---------------- detail ---------------- */
export function AgentDetailView({ agentId }: { agentId: string }) {
  const router = useRouter();
  const { workspaceId, api, toast, confirm, refresh } = useApp();
  const { data, loading, error, reload } = useLoad<any>(`/agents/${agentId}`);
  const [permOpen, setPermOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [tools, setTools] = useState("");
  const [domains, setDomains] = useState("");
  const [editEndpoint, setEditEndpoint] = useState("");
  const [editModel, setEditModel] = useState("");
  const [editCredential, setEditCredential] = useState("");
  const [testInfo, setTestInfo] = useState<any>(null);

  if (loading && !data) return <div className="p-6"><Skeleton className="h-80 w-full" /></div>;
  if (error && !data) return <div className="p-6"><ErrorBanner message={error} onRetry={reload} /></div>;
  if (!data) return null;
  const a = data;

  const saveModel = async () => {
    try {
      await api(`/agents/${a.id}`, { method: "PATCH", body: {
        endpoint: editEndpoint.trim().replace(/\/+$/, ""), modelId: editModel.trim(),
        ...(editCredential ? { credential: editCredential } : {}),
      } });
      setModelOpen(false); setEditCredential("");
      toast("模型连接已更新，正在远端验证…", "success");
      const result = await api<any>(`/agents/${a.id}/test`, { method: "POST", body: {} });
      setTestInfo(result);
      toast(result.pass ? (result.remoteVerified ? "远端验证通过" : "本地检查通过") : "远端验证失败，请查看测试详情", result.pass ? "success" : "error");
      refresh(); reload();
    } catch (e) { toast(e instanceof Error ? e.message : "保存失败", "error"); }
  };

  const savePerms = async () => {
    try {
      await api(`/agents/${a.id}`, { method: "PATCH", body: {
        permissionPolicy: { ...a.permissionPolicy, tools: tools.split(/[,，]/).map((s) => s.trim()).filter(Boolean), externalUrls: domains.split(/[,，]/).map((s) => s.trim()).filter(Boolean) },
      } });
      toast("权限已更新并记录审计", "success"); setPermOpen(false); refresh(); reload();
    } catch (e) { toast(e instanceof Error ? e.message : "更新失败", "error"); }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1000px] px-6 py-6">
        <button onClick={() => router.push(`/workspaces/${workspaceId}/agents`)} className="mb-3 flex items-center gap-1.5 text-[12px] text-ink-500 hover:text-ink-800"><ArrowLeft size={13} /> 返回 Agent 列表</button>
        <div className="mb-5 flex items-start gap-4">
          <Avatar name={a.name} color={a.color} size={44} />
          <div className="flex-1">
            <div className="flex items-center gap-2"><h1 className="text-[20px] font-semibold text-ink-900">{a.name}</h1>{a.demo && <Badge tone="purple">演示 Agent</Badge>}<StatusPill status={a.status} /></div>
            <p className="mt-1 text-[12px] text-ink-500">{a.adapterType === "demo" ? "本地演示适配器" : a.endpoint} · 最近同步 {a.lastSyncAt ? relativeTime(a.lastSyncAt) : "从未"}</p>
          </div>
          <div className="flex gap-2">
            <Button onClick={async () => { try { const r = await api<any>(`/agents/${a.id}/test`, { method: "POST", body: {} }); setTestInfo(r); toast(r.pass ? (r.remoteVerified ? "远端验证通过" : "测试通过") : "部分测试项未通过", r.pass ? "success" : "info"); refresh(); reload(); } catch (e) { toast(e instanceof Error ? e.message : "测试失败", "error"); } }}><PlugZap size={13} /> 测试</Button>
            {a.status !== "disabled" && <Button variant="danger" onClick={async () => { if (await confirm({ title: `停用 ${a.name}？`, body: "停用后无法加入新任务，已有记录保留。", danger: true })) { try { await api(`/agents/${a.id}/disable`, { method: "POST", body: {} }); toast("已停用", "info"); refresh(); reload(); } catch (e) { toast(e instanceof Error ? e.message : "停用失败", "error"); } } }}>停用</Button>}
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
          <div className="space-y-5">
            <Card className="p-5">
              <SectionHeader title="基本信息与连接配置" action={a.adapterType === "model_api" ? <button onClick={() => { setEditEndpoint(a.endpoint); setEditModel(a.modelId ?? ""); setModelOpen(true); }} className="text-[12px] text-brand-600 hover:underline">编辑模型连接</button> : undefined} />
              <div className="divide-y divide-ink-50">
                <KV label="接入方式" value={a.adapterType === "demo" ? "Demo Agent" : a.adapterType === "model_api" ? `模型 API${a.modelId ? ` · ${a.modelId}` : ""}` : a.adapterType === "a2a" ? "A2A" : "HTTP 回调"} />
                <KV label="服务地址" value={<span className="font-mono text-[11px]">{a.endpoint}</span>} />
                {a.adapterType === "model_api" && <KV label="模型 ID" value={<span className="font-mono text-[11px]">{a.modelId ?? "—"}</span>} />}
                <KV label="认证方式" value={a.authType === "none" ? "无" : a.authType === "api_key" ? "API Key" : "Bearer Token"} />
                <KV label="凭据指纹" value={<span className="flex items-center gap-1 font-mono text-[11px]"><KeyRound size={11} /> {a.credentialFingerprint ?? "未配置"}</span>} />
                <KV label="超时 / 并发 / 重试" value={`${a.timeoutMs}ms / ${a.maxConcurrency} / ${a.retryCount}`} />
                <KV label="最近测试" value={a.lastHealthcheckAt ? formatDateTime(a.lastHealthcheckAt) : "未测试"} />
              </div>
            </Card>
            <Card className="p-5">
              <SectionHeader title="能力标签" action={<Button size="sm" variant="ghost" onClick={() => router.push(`/workspaces/${workspaceId}/agents/new`)}>接入新 Agent</Button>} />
              <div className="flex flex-wrap gap-1.5">{a.capabilities?.map((c: string) => <Badge key={c} tone="brand">{c}</Badge>)}{!a.capabilities?.length && <span className="text-[12px] text-ink-400">未设置</span>}</div>
            </Card>
            <Card className="p-5">
              <SectionHeader title="最近运行" action={<button onClick={() => router.push(`/workspaces/${workspaceId}/runs`)} className="text-[12px] text-brand-600 hover:underline">全部记录</button>} />
              {(a.runs ?? []).length === 0 && <p className="py-4 text-center text-[12px] text-ink-400">暂无运行记录</p>}
              {(a.runs ?? []).map((r: any) => (
                <button key={r.id} onClick={() => router.push(`/workspaces/${workspaceId}/runs/${r.id}`)} className="flex w-full items-center gap-2 border-b border-ink-50 py-2 text-left last:border-0">
                  <span className="flex-1 truncate font-mono text-[11px] text-ink-600">{r.id}</span>
                  <StatusPill status={r.status} /><span className="text-[11px] text-ink-400">{relativeTime(r.createdAt)}</span>
                </button>
              ))}
            </Card>
          </div>
          <div className="space-y-5">
            <Card className="p-5">
              <SectionHeader title="权限矩阵" action={<button onClick={() => { setTools((a.permissionPolicy?.tools ?? []).join(", ")); setDomains((a.permissionPolicy?.externalUrls ?? []).join(", ")); setPermOpen(true); }} className="text-[12px] text-brand-600 hover:underline">编辑</button>} />
              <div className="space-y-1.5 text-[12px]">
                <PermRow label="读取任务目标与约束" value="允许" ok />
                <PermRow label="发送讨论消息" value="允许" ok />
                <PermRow label="读取共享资料" value={a.permissionPolicy?.readMaterials === "ask" ? "首次询问" : a.permissionPolicy?.readMaterials === "allow" ? "允许" : "拒绝"} />
                <PermRow label="提交产物" value={a.permissionPolicy?.submitArtifact === "ask" ? "首次询问" : a.permissionPolicy?.submitArtifact === "auto" ? "自动" : "拒绝"} />
                <PermRow label="调用已配置工具" value={a.permissionPolicy?.tools?.length ? `${a.permissionPolicy.tools.length} 项白名单` : "拒绝"} />
                <PermRow label="访问外部 URL" value={a.permissionPolicy?.externalUrls?.length ? `${a.permissionPolicy.externalUrls.length} 个域名` : "拒绝"} />
                <PermRow label="修改任务状态" value="拒绝" />
                <PermRow label="完成 / 取消任务" value="拒绝" />
                <PermRow label="删除资料或产物" value="拒绝" />
              </div>
            </Card>
            <Card className="p-5">
              <SectionHeader title="安全说明" />
              <p className="text-[12px] leading-6 text-ink-500">
                默认为 HTTPS，私网、回环和云元数据地址被阻止。回调必须签名验证并按 event_id 去重。Agent 消息与工具返回视为不可信数据，不直接执行脚本。所有管理操作写入审计日志。
              </p>
            </Card>
            <Button variant="danger" className="w-full" onClick={async () => { if (await confirm({ title: `删除 ${a.name}？`, body: "连接配置将从工作区移除，已有运行与产物记录保留。", danger: true, confirmText: "删除" })) { try { await api(`/agents/${a.id}`, { method: "DELETE", body: {} }); toast("已删除", "info"); router.push(`/workspaces/${workspaceId}/agents`); } catch (e) { toast(e instanceof Error ? e.message : "删除失败", "error"); } } }}><Trash2 size={13} /> 删除连接配置</Button>
          </div>
        </div>
      </div>
      {testInfo && (
        <div className="fixed bottom-5 left-5 z-[70] w-[360px] rounded-lg border border-ink-200 bg-white p-4 shadow-pop">
          <div className="mb-2 flex items-center justify-between"><span className="text-[13px] font-semibold text-ink-800">测试结果</span><button onClick={() => setTestInfo(null)} className="text-ink-400 hover:text-ink-800">✕</button></div>
          {testInfo.message && <p className="mb-2 text-[12px] text-ink-600">{testInfo.message}</p>}
          <div className="space-y-1.5">
            {(testInfo.checks ?? []).map((c: any) => (
              <div key={c.name} className="text-[11px] leading-5"><span className={c.ok ? "text-semantic-success" : "text-semantic-danger"}>{c.ok ? "✓" : "✕"}</span> <span className="text-ink-700">{c.name}</span> · <span className="text-ink-500">{c.detail}</span></div>
            ))}
          </div>
          {testInfo.models?.length > 0 && <p className="mt-2 text-[10px] text-ink-400">可用模型：{testInfo.models.slice(0, 8).join(", ")}</p>}
        </div>
      )}
      <Modal open={modelOpen} onClose={() => setModelOpen(false)} title="编辑模型连接" footer={<><Button onClick={() => setModelOpen(false)}>取消</Button><Button variant="primary" onClick={saveModel}>保存并验证</Button></>}>
        <div className="space-y-4">
          <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2.5 text-[12px] leading-5 text-ink-600">
            实时推理 Base URL 示例：小米 MiMo <code className="font-mono">https://api.xiaomimimo.com/v1</code>；火山方舟 <code className="font-mono">https://ark.cn-beijing.volces.com/api/v3</code>。批量推理地址（含 /batch）不支持实时对话。
          </div>
          <Field label="Base URL" required><Input value={editEndpoint} onChange={(e) => setEditEndpoint(e.target.value)} placeholder="https://api.xiaomimimo.com/v1" /></Field>
          <Field label="模型 ID" required hint="MiMo 可用：mimo-v2.6-flash / mimo-v2.6-pro"><Input value={editModel} onChange={(e) => setEditModel(e.target.value)} placeholder="mimo-v2.6-flash" /></Field>
          <Field label="更换 API Key" hint="留空则沿用当前密钥；密文保存，仅显示指纹"><Input type="password" value={editCredential} onChange={(e) => setEditCredential(e.target.value)} placeholder="留空不修改" /></Field>
          {editCredential && <p className="text-[11px] text-ink-400">将保存指纹：{credentialFingerprintClient(editCredential)}</p>}
        </div>
      </Modal>
      <Modal open={permOpen} onClose={() => setPermOpen(false)} title="编辑权限矩阵" footer={<><Button onClick={() => setPermOpen(false)}>取消</Button><Button variant="primary" onClick={savePerms}>保存</Button></>}>
        <div className="space-y-4">
          <Field label="工具白名单" hint="逗号分隔，默认全部拒绝"><Textarea rows={3} value={tools} onChange={(e) => setTools(e.target.value)} placeholder="web_verify, code_run" /></Field>
          <Field label="允许的外部域名" hint="逗号分隔，默认全部拒绝"><Textarea rows={3} value={domains} onChange={(e) => setDomains(e.target.value)} placeholder="docs.example.com" /></Field>
          <p className="flex items-start gap-1.5 text-[11px] leading-5 text-ink-500"><CircleHelp size={12} className="mt-0.5 shrink-0" /> 写操作工具每次审批；高风险操作单次有效；撤销权限后未执行操作立即失效。</p>
        </div>
      </Modal>
    </div>
  );
}

function PermRow({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return <div className="flex items-center justify-between gap-2 border-b border-ink-50 py-1.5 last:border-0"><span className="text-ink-600">{label}</span><span className={cn("text-[11px]", ok ? "text-semantic-success" : "text-ink-500")}>{value}</span></div>;
}
