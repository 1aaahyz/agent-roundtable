/**
 * 端到端冒烟自测。先启动服务：npm run start（或 npm run dev）。
 * 用法：node scripts/smoke.mjs [baseUrl]
 */
import crypto from "node:crypto";

const BASE = process.argv[2] ?? "http://127.0.0.1:3000";
const WS = "ws_demo";
const AUTH_EMAIL = process.env.AUTH_EMAIL ?? "demo@agent.local";
const AUTH_PASSWORD = process.env.AUTH_PASSWORD ?? "demo-2026";
let pass = 0;
let fail = 0;
let sessionCookie = "";

function check(name, ok, detail = "") {
  if (ok) { pass++; console.log(`  OK   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
}

async function call(path, { method = "GET", body, headers = {}, anonymous = false } = {}) {
  const res = await fetch(`${BASE}/api/v1${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(anonymous || !sessionCookie ? {} : { Cookie: sessionCookie }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) {
    const pair = setCookie.split(";")[0];
    if (pair.includes("acw_session=") && !pair.includes("Max-Age=0")) sessionCookie = pair;
  }
  let json = {};
  try { json = await res.json(); } catch { /* non-json */ }
  return { status: res.status, json };
}

async function waitFor(fn, timeoutMs = 15000, intervalMs = 300) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const value = await fn();
    if (value) return value;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return null;
}

console.log(`\nSmoke test -> ${BASE}\n`);

let r;
// 0. auth: unauthenticated access must be rejected, then login establishes a session
r = await call("/auth/me", { anonymous: true });
check("未登录访问被拒绝", r.status === 401, `status=${r.status}`);
r = await call("/auth/login", { method: "POST", body: { email: AUTH_EMAIL, password: "wrong-password" }, anonymous: true });
check("错误密码被拒绝", r.status === 401 && r.json.error?.code === "INVALID_CREDENTIALS", `status=${r.status}`);
r = await call("/auth/login", { method: "POST", body: { email: AUTH_EMAIL, password: AUTH_PASSWORD }, anonymous: true });
check("正确密码登录成功", r.status === 200 && Boolean(sessionCookie), `status=${r.status} cookie=${Boolean(sessionCookie)}`);
check("登录响应不含密码哈希", !JSON.stringify(r.json).includes("passwordHash") && !JSON.stringify(r.json).includes("scrypt$"), "");

// 1. baseline
r = await call("/auth/me");
check("auth/me 200", r.status === 200 && r.json.user?.id === "u_owner");

r = await call(`/workspaces/${WS}/overview`);
check("overview 结论条来自真实记录", r.status === 200 && r.json.conclusion.includes("3 个任务进行中") && r.json.conclusion.includes("2 个等待你确认"), r.json.conclusion);
check("overview 待办三列结构", Boolean(r.json.needsAction?.approvals && r.json.needsAction?.failures && r.json.needsAction?.reviews));

// 2. create task + demo run
r = await call(`/workspaces/${WS}/tasks`, {
  method: "POST",
  body: {
    title: "冒烟测试任务",
    goal: "验证创建、讨论、产物与审批链路",
    constraints: ["仅本地演示"],
    acceptanceCriteria: ["收到 Agent 回复", "生成产物"],
    agentIds: ["ag_writer", "ag_review"],
  },
});
check("创建任务 201", r.status === 201 && r.json.id?.startsWith("task_"), JSON.stringify(r.json).slice(0, 120));
const taskId = r.json.id;

r = await call(`/tasks/${taskId}`);
check("新任务初始为草稿", r.status === 200 && r.json.status === "draft" && r.json.participants.length === 2);

r = await call(`/tasks/${taskId}/messages`, { method: "POST", body: { content: "请给出第一版方案，并说明验收方式。", autoRun: true } });
check("发送消息并启动 Run", r.status === 201 && Boolean(r.json.run?.id), JSON.stringify(r.json).slice(0, 160));

const agentMessage = await waitFor(async () => {
  const res = await call(`/tasks/${taskId}/messages`);
  return res.json.find((m) => m.senderType === "agent");
});
check("Demo Agent 回复进入同一时间线", Boolean(agentMessage?.content?.length), JSON.stringify(agentMessage ?? {}).slice(0, 120));

r = await call(`/tasks/${taskId}`);
check("任务状态推进且轮次受控", r.status === 200 && r.json.status === "discussing" && r.json.currentRound >= 1 && r.json.currentRound <= r.json.maxRounds);

// 3. bounded rounds
for (let i = 0; i < 8; i++) {
  await call(`/tasks/${taskId}/runs`, { method: "POST", body: {} });
}
r = await call(`/tasks/${taskId}`);
check("最大轮数上限生效", r.json.currentRound <= r.json.maxRounds, `round=${r.json.currentRound}/${r.json.maxRounds}`);

// 4. approval flow
r = await call(`/tasks/${taskId}/agents`, { method: "POST", body: { agentId: "ag_research" } });
check("添加 Agent 生成审批", r.status === 201 && r.json.type === "agent_join", JSON.stringify(r.json).slice(0, 120));
const approvalId = r.json.id;
r = await call(`/approvals/${approvalId}/decision`, { method: "POST", body: { decision: "approved", note: "smoke" } });
check("批准审批", r.status === 200 && r.json.status === "approved");
r = await call(`/tasks/${taskId}`);
check("批准后 Agent 加入任务", r.json.participants.some((p) => p.agentId === "ag_research"));
const again = await call(`/approvals/${approvalId}/decision`, { method: "POST", body: { decision: "approved" } });
check("重复决策被拒绝", again.status === 409);

// 5. agent create + SSRF protection
r = await call(`/workspaces/${WS}/agents`, {
  method: "POST",
  body: { name: "回调 Agent", adapterType: "http_callback", endpoint: "https://agent.example.com/task", authType: "api_key", credential: "sk-abcdefgh1234" },
});
check("创建 HTTP 回调 Agent 201", r.status === 201 && r.json.id?.startsWith("ag_"));
const httpAgentId = r.json.id;
check("凭据只保存指纹", r.json.credentialFingerprint === "sk-…1234" && !JSON.stringify(r.json).includes("sk-abcdefgh1234"), r.json.credentialFingerprint);
r = await call(`/workspaces/${WS}/agents`, { method: "POST", body: { name: "bad", adapterType: "a2a", endpoint: "https://169.254.169.254/latest/meta-data" } });
check("云元数据地址被阻止", r.status === 400 && r.json.error.code === "METADATA_BLOCKED", JSON.stringify(r.json).slice(0, 120));
r = await call(`/workspaces/${WS}/agents`, { method: "POST", body: { name: "bad2", adapterType: "a2a", endpoint: "http://agent.example.com" } });
check("非 HTTPS 被阻止", r.status === 400 && r.json.error.code === "INSECURE_SCHEME");

// 6. signed webhook with dedup + sequence (fresh task: the first one already hit its round limit)
r = await call(`/workspaces/${WS}/tasks`, { method: "POST", body: { title: "回调测试任务", goal: "验证签名回调与幂等去重", agentIds: [httpAgentId] } });
const webhookTaskId = r.json.id;
r = await call(`/tasks/${webhookTaskId}/runs`, { method: "POST", body: { agentId: httpAgentId } });
check("为回调 Agent 创建 Run", r.status === 201 && Boolean(r.json.id), JSON.stringify(r.json).slice(0, 140));
const runId = r.json.id;
const payload = {
  event_id: "evt_smoke_001",
  run_id: runId,
  type: "message.completed",
  sequence: 1,
  data: { content: "来自 HTTP 回调的回复" },
};
const timestamp = String(Date.now());
const signature = crypto.createHmac("sha256", process.env.CREDENTIAL_SECRET ?? "change-me-in-production")
  .update(`${timestamp}.${JSON.stringify(payload)}`).digest("hex");
const secretForSmoke = process.env.CREDENTIAL_SECRET ?? "change-me-in-production";
const headers = { "x-agent-signature": signature, "x-agent-timestamp": timestamp };
r = await call(`/webhooks/agents/${httpAgentId}/runs/${runId}`, { method: "POST", body: payload, headers });
check("签名回调被接受", r.status === 200 && r.json.ok === true, JSON.stringify(r.json).slice(0, 120));
r = await call(`/webhooks/agents/${httpAgentId}/runs/${runId}`, { method: "POST", body: payload, headers });
check("重复 event_id 幂等去重", r.status === 200 && r.json.duplicate === true);
r = await call(`/webhooks/agents/${httpAgentId}/runs/${runId}`, { method: "POST", body: payload, headers: { "x-agent-signature": "bad", "x-agent-timestamp": timestamp } });
check("伪造签名被拒绝", r.status === 401 && r.json.error.code === "INVALID_SIGNATURE");
r = await call(`/tasks/${webhookTaskId}/messages`);
check("回调消息写入正确任务", r.json.some((m) => m.content === "来自 HTTP 回调的回复"));

// 7. artifact version + diff + acceptance
const beforeVersions = (await call("/artifacts/art_api/versions")).json.length;
r = await call("/artifacts/art_api/versions", { method: "POST", body: { content: "# 新内容\n\n新增一段用于 diff 验证。", changeSummary: "冒烟测试新增版本" } });
check("产物追加版本", r.status === 201 && r.json.version === beforeVersions + 1, JSON.stringify(r.json).slice(0, 120));
r = await call("/artifacts/art_api/diff");
check("文本 diff 返回行级结果", r.status === 200 && Array.isArray(r.json.lines) && r.json.lines.some((l) => l.kind === "add"));
r = await call("/artifacts/art_api/accept", { method: "POST", body: {} });
check("接受产物", r.status === 200 && r.json.status === "accepted");

// 8. task completion only by user
r = await call(`/tasks/${taskId}/transition`, { method: "POST", body: { to: "review" } });
const canComplete = r.status === 200;
if (canComplete) {
  r = await call(`/tasks/${taskId}/complete`, { method: "POST", body: { artifactId: "art_api" } });
  check("用户可完成任务", r.status === 200 && r.json.status === "done");
}

// 9. tenant isolation & unknown route
r = await call("/workspaces/ws_missing/overview");
check("不存在工作区返回 404", r.status === 404);
r = await call("/not-a-route");
check("未知接口返回统一错误格式", r.status === 404 && Boolean(r.json.error?.request_id));

// 10. audit + export
r = await call(`/audit?workspaceId=${WS}&q=approval`);
check("审计日志可检索", r.status === 200 && Array.isArray(r.json) && r.json.length > 0);
r = await call(`/export?workspaceId=${WS}&type=task`);
check("导出返回结构化数据", r.status === 200 && Boolean(r.json.payload));

// 11. model_api adapter: credential-free local self-test with a fixed model id
r = await call(`/workspaces/${WS}/agents`, {
  method: "POST",
  body: { name: "豆包模型 Agent", adapterType: "model_api", role: "writer", modelId: "doubao-seed-1-6-251015", endpoint: "local://mock-openai", capabilities: ["写作"] },
});
check("创建模型 API Agent（无密钥自测）", r.status === 201 && r.json.adapterType === "model_api" && r.json.modelId === "doubao-seed-1-6-251015", JSON.stringify(r.json).slice(0, 140));
const modelAgentId = r.json.id;
r = await call(`/agents/${modelAgentId}/test`, { method: "POST", body: {} });
check("模型自测通过且明确为模拟", r.status === 200 && r.json.pass === true && r.json.mock === true && r.json.remoteVerified === false, JSON.stringify(r.json).slice(0, 180));
r = await call(`/workspaces/${WS}/tasks`, { method: "POST", body: { title: "模型无密钥自测", goal: "验证模型适配器输出进入任务时间线", agentIds: [modelAgentId] } });
const modelTaskId = r.json.id;
r = await call(`/tasks/${modelTaskId}/messages`, { method: "POST", body: { content: "给出一版方案", autoRun: true } });
check("模型 Agent 启动 Run", r.status === 201 && Boolean(r.json.run?.id));
const modelReply = await waitFor(async () => {
  const res = await call(`/tasks/${modelTaskId}/messages`);
  return res.json.find((m) => m.senderType === "agent" && String(m.content).includes("doubao-seed-1-6-251015"));
});
check("模拟输出标注模型 ID 且未调用真实服务", Boolean(modelReply?.content?.includes("本地模拟")), JSON.stringify(modelReply ?? {}).slice(0, 160));
r = await call(`/runs?workspaceId=${WS}&taskId=${modelTaskId}`);
check("模型运行事件含 model.call", r.status === 200 && r.json.some((run) => run.status === "succeeded"), JSON.stringify(r.json).slice(0, 120));
r = await call(`/workspaces/${WS}/agents`, {
  method: "POST",
  body: { name: "无密钥真实模型", adapterType: "model_api", endpoint: "https://ark.cn-beijing.volces.com/api/v3", modelId: "doubao-seed-1-6-251015" },
});
{
  const testResult = await call(`/agents/${r.json.id}/test`, { method: "POST", body: { probe: false } });
  const envKeyPresent = Boolean(process.env.ARK_API_KEY);
  check("真实端点密钥检查与环境变量一致且不宣称远端已验证", r.status === 201 && testResult.json.pass === envKeyPresent && testResult.json.remoteVerified === false,
    `envKey=${envKeyPresent} pass=${testResult.json.pass}`);
}

r = await call(`/workspaces/${WS}/agents`, {
  method: "POST",
  body: { name: "批量地址", adapterType: "model_api", endpoint: "https://batch-api-cn.xiaomimimo.com/v1", modelId: "mimo-v2.6-flash" },
});
check("批量推理地址被拒绝", r.status === 400 && r.json.error.code === "BATCH_ENDPOINT_UNSUPPORTED", JSON.stringify(r.json).slice(0, 120));
r = await call(`/workspaces/${WS}/agents`, {
  method: "POST",
  body: { name: "可编辑模型连接", adapterType: "model_api", endpoint: "https://api.xiaomimimo.com/v1", modelId: "mimo-v2.6-flash" },
});
r = await call(`/agents/${r.json.id}`, { method: "PATCH", body: { endpoint: "https://batch-api-cn.xiaomimimo.com/v1" } });
check("编辑时同样拦截批量地址", r.status === 400 && r.json.error.code === "BATCH_ENDPOINT_UNSUPPORTED");

// 12. regression: no duplicate messages after repeated SSE-style refreshes
r = await call(`/workspaces/${WS}/tasks`, { method: "POST", body: { title: "重复消息回归", goal: "验证消息不重复", agentIds: ["ag_writer"] } });
const dedupeTaskId = r.json.id;
r = await call(`/tasks/${dedupeTaskId}/messages`, { method: "POST", body: { content: "只回复一次", autoRun: true } });
const dedupeRunId = r.json.run?.id;
await waitFor(async () => {
  const res = await call(`/tasks/${dedupeTaskId}/messages`);
  return res.json.some((m) => m.runId === dedupeRunId && m.senderType === "agent");
});
r = await call(`/tasks/${dedupeTaskId}/messages`);
const agentCopies = r.json.filter((m) => m.runId === dedupeRunId && m.senderType === "agent");
check("单个 Run 只产生一条 Agent 消息", agentCopies.length === 1, `count=${agentCopies.length}`);
r = await call(`/tasks/${dedupeTaskId}`);
const dedupeAgent = r.json.participants.find((p) => p.agentId === "ag_writer")?.agent;
check("Run 完成后 Agent 状态复位", dedupeAgent?.status === "online", `status=${dedupeAgent?.status}`);

// 13. regression: artifact locking after acceptance
r = await call("/artifacts/art_api/versions", { method: "POST", body: { content: "# locked", changeSummary: "should fail" } });
check("已验收产物拒绝追加版本", r.status === 409 && r.json.error.code === "ARTIFACT_LOCKED", JSON.stringify(r.json).slice(0, 120));

// 14. regression: SSE workspace auth
r = await fetch(`${BASE.replace("/api/v1", "")}/api/v1/events?workspaceId=ws_missing`, { headers: {} });
check("SSE 拒绝无权工作区", r.status === 403);

// 15. regression: webhook adapter guard
r = await call(`/webhooks/agents/ag_writer/runs/${dedupeRunId}`, { method: "POST", body: { event_id: "bad_adapter" }, headers: { "x-agent-signature": "x", "x-agent-timestamp": String(Date.now()) } });
check("非 HTTP 回调 Agent 拒绝 webhook", r.status === 403 && r.json.error.code === "WRONG_ADAPTER", JSON.stringify(r.json).slice(0, 120));

// 16. regression: round bound on human messages
r = await call(`/workspaces/${WS}/tasks`, { method: "POST", body: { title: "轮数上限回归", goal: "验证消息不绕过轮数", maxRounds: 1, agentIds: ["ag_writer"] } });
const boundTaskId = r.json.id;
await call(`/tasks/${boundTaskId}/messages`, { method: "POST", body: { content: "第一轮", autoRun: true } });
r = await call(`/tasks/${boundTaskId}/messages`, { method: "POST", body: { content: "第二轮应保留消息但不生成 Run", autoRun: true } });
check("超过轮数上限仍保留人类消息", r.status === 201 && r.json.run === null && r.json.message?.content?.includes("第二轮"), JSON.stringify(r.json).slice(0, 140));

// 17. regression: prototype pollution on settings PATCH
// Build the body via JSON.parse so __proto__ becomes an own property (object literal would set the prototype).
const pollutionBody = JSON.parse('{"__proto__":{"polluted":true},"constructor":{"bad":1},"discussion":{"__proto__":{"x":1},"maxRounds":7,"unknownField":1}}');
r = await call(`/workspaces/${WS}/settings`, { method: "PATCH", body: pollutionBody });
const polluted = Object.prototype.polluted === true || ({}).polluted === true;
check("设置接口拒绝原型污染", r.status === 200 && !polluted, `polluted=${polluted}`);
r = await call(`/workspaces/${WS}/settings`);
check("未知设置字段被忽略", r.json.discussion.maxRounds === 7 && r.json.discussion.unknownField === undefined, JSON.stringify(r.json.discussion).slice(0, 160));

// 18. regression: task PATCH type coercion
r = await call(`/tasks/${taskId}`, { method: "PATCH", body: { maxRounds: 0, title: "", constraints: "not-an-array", goal: 12345 } });
const patched = r.json;
check("任务更新做类型与边界校验", r.status === 200 && patched.maxRounds === 1 && typeof patched.goal === "string" && Array.isArray(patched.constraints), `maxRounds=${patched.maxRounds} goalType=${typeof patched.goal}`);

// 19. regression: logout revokes the session
const cookieBeforeLogout = sessionCookie;
r = await call("/auth/logout", { method: "POST", body: {} });
check("登出成功", r.status === 200);
sessionCookie = cookieBeforeLogout; // reuse the old token to prove it is now dead
r = await call("/auth/me");
check("登出后旧会话失效", r.status === 401, `status=${r.status}`);
r = await call("/auth/login", { method: "POST", body: { email: AUTH_EMAIL, password: AUTH_PASSWORD }, anonymous: true });
check("重新登录恢复会话", r.status === 200 && Boolean(sessionCookie));

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail === 0 ? 0 : 1);
