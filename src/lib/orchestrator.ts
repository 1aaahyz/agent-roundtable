import { getDb, persist } from "./db";
import { publish } from "./events";
import { assertSafeEndpoint, decryptCredential, providerFallbackKey, redact } from "./security";
import { canTransitionTask } from "./state-machines";
import type { AgentConnection, Message, Run, Task } from "./types";
import { newId, now } from "./utils";

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function addEvent(db: Awaited<ReturnType<typeof getDb>>, run: Run, type: string, payload: Record<string, unknown>) {
  const seq = db.runEvents.filter((e) => e.runId === run.id).length + 1;
  db.runEvents.push({ id: newId("re"), runId: run.id, sequence: seq, type, payload, createdAt: now() });
}

function demoText(agent: AgentConnection, task: Task, round: number): string {
  const goal = task.goal.length > 44 ? `${task.goal.slice(0, 44)}…` : task.goal;
  switch (agent.role) {
    case "researcher":
      return `围绕「${goal}」，本轮我整理了三点：①先把验收标准拆成可检查的条目；②公开资料只采用能标注日期与来源的内容；③分歧点保留原文，不替用户下结论。建议下一轮由写手按「结论—证据」结构落笔。`;
    case "writer":
      return `收到。第 ${round} 轮按讨论结论推进：开头用一个具体失败场景引入，正文分三节展开，每节先给结论再给一句证据；结尾只写已确认的决定，不补未经核实的数据。草稿已整理成可预览版本。`;
    case "reviewer":
      return `本轮审校发现两处需要修正：一处是「自动验收」的表述，与人工最终负责冲突，应改为「人工验收」；另一处是案例二缺少来源标注。其余部分结构与验收标准一致，可以进入产物提交。`;
    case "coder":
      return `接口侧建议：写操作统一带 Idempotency-Key，列表用游标分页；错误响应保持 code / message / details / request_id 四字段。回调需要签名校验与 event_id 去重，重试不得重复提交已接受的产物。`;
    default:
      return `本轮围绕「${goal}」补充了一条可执行建议，并把未确认的部分单独标出，等待你决定。`;
  }
}

function chunks(text: string, size = 14): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

/** Starts the orchestration in background. Never throws into the request path. */
export function kickRun(runId: string): void {
  void execute(runId).catch((error) => {
    void (async () => {
      const db = await getDb();
      const run = db.runs.find((r) => r.id === runId);
      if (!run || ["succeeded", "failed", "cancelled", "timed_out", "waiting_approval", "waiting_input"].includes(run.status)) return;
      run.status = "failed";
      run.errorCode = "ORCHESTRATOR_ERROR";
      run.errorMessage = error instanceof Error ? error.message.slice(0, 200) : "编排失败";
      run.finishedAt = now();
      addEvent(db, run, "run.failed", { code: run.errorCode });
      const agent = db.agents.find((a) => a.id === run.agentId);
      if (agent) agent.status = "online";
      await persist();
      publish(run.workspaceId, "run.updated", { runId });
      if (agent) publish(run.workspaceId, "agent.status_changed", { agentId: agent.id, status: "online" });
      publish(run.workspaceId, "notification.created", { type: "agent_failed" });
    })();
  });
}

type ModelResult = { text: string; mock: boolean };

/** Calls an OpenAI-compatible model API. No key => local mock only, never an external request. */
async function modelText(agent: AgentConnection, task: Task, run: Run): Promise<ModelResult> {
  const modelId = agent.modelId ?? "doubao-seed-1-6-251015";
  if (agent.endpoint === "local://mock-openai") {
    return {
      mock: true,
      text: `【本地模拟 · ${modelId}】已收到任务「${task.title}」与第 ${run.round} 轮讨论。这是无密钥自测输出，未调用真实模型服务；配置密钥后同一链路会请求 OpenAI 兼容的 chat/completions 并把结果写入当前任务时间线。`,
    };
  }
  const db = await getDb();
  const key = decryptCredential(db.credentials[agent.id] ?? "") || providerFallbackKey(agent.endpoint);
  if (!key) throw Object.assign(new Error("未配置模型密钥，真实调用未执行"), { code: "MODEL_KEY_MISSING" });
  const base = assertSafeEndpoint(agent.endpoint).toString().replace(/\/+$/, "");
  const url = base.endsWith("/chat/completions") ? base : `${base}/chat/completions`;
  const system = [
    `你是任务「${task.title}」中的协作 Agent，角色：${agent.role}。`,
    `任务目标：${task.goal}`,
    task.constraints?.length ? `约束：${task.constraints.join("；")}` : "",
    task.acceptanceCriteria?.length ? `验收标准：${task.acceptanceCriteria.join("；")}` : "",
    "只输出对当前任务的回复，不要宣称已完成任务或产物。",
  ].filter(Boolean).join("\n");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(agent.timeoutMs, 120_000));
  try {
    const response = await fetch(url, {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: modelId,
        messages: [
          { role: "system", content: system },
          { role: "user", content: `当前轮次：${run.round}/${task.maxRounds}\n请给出本轮回复。` },
        ],
        stream: false,
      }),
      signal: controller.signal,
    });
    if (response.status >= 300 && response.status < 400) throw Object.assign(new Error("模型端点发生跳转，已阻止"), { code: "UNSAFE_REDIRECT" });
    if (!response.ok) {
      const hint = response.status === 404
        ? "：HTTP 404 通常表示 Base URL 错误（批量推理地址不支持实时 chat/completions）或模型 ID 无效；请在 Agent 详情里编辑模型连接并重新测试"
        : "";
      throw Object.assign(new Error(`模型服务返回 ${response.status}${hint}`), { code: "MODEL_HTTP_ERROR" });
    }
    const json = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const text = json.choices?.[0]?.message?.content?.trim();
    if (!text) throw Object.assign(new Error("模型响应为空"), { code: "MODEL_EMPTY_RESPONSE" });
    return { text: redact(text).slice(0, 6000), mock: false };
  } catch (error) {
    if ((error as Error & { code?: string }).code) throw error;
    throw Object.assign(new Error(redact(String((error as Error).message ?? error)).slice(0, 200)), { code: "MODEL_REQUEST_FAILED" });
  } finally {
    clearTimeout(timer);
  }
}

async function failRun(db: Awaited<ReturnType<typeof getDb>>, run: Run, agent: AgentConnection, code: string, message: string): Promise<void> {
  run.status = "failed";
  run.errorCode = code;
  run.errorMessage = message;
  run.finishedAt = now();
  agent.status = "online";
  addEvent(db, run, "run.failed", { code, message });
  db.messages.push({
    id: newId("msg"), workspaceId: run.workspaceId, taskId: run.taskId, runId: run.id,
    senderType: "system", senderId: "system", type: "error",
    content: `模型调用失败（${code}）：${message}`,
    mentions: [], replyToId: null, pinned: false, errorCode: code, createdAt: now(),
  });
  await persist();
  publish(run.workspaceId, "run.updated", { runId: run.id, status: "failed" });
  publish(run.workspaceId, "message.created", { taskId: run.taskId, runId: run.id });
  publish(run.workspaceId, "notification.created", { type: "agent_failed" });
}

async function execute(runId: string): Promise<void> {
  const db = await getDb();
  const run = db.runs.find((r) => r.id === runId);
  if (!run || ["succeeded", "failed", "cancelled", "timed_out", "waiting_approval"].includes(run.status)) return;
  const task = db.tasks.find((t) => t.id === run.taskId);
  const agent = db.agents.find((a) => a.id === run.agentId);
  if (!task || !agent) {
    run.status = "failed";
    run.errorCode = "AGENT_NOT_FOUND";
    run.finishedAt = now();
    await persist();
    return;
  }

  // External adapters wait for real callbacks / polling; they are not faked here.
  if (!agent.demo && agent.adapterType !== "model_api") {
    agent.lastSyncAt = now();
    await persist();
    publish(run.workspaceId, "agent.status_changed", { agentId: agent.id, status: agent.status });
    return;
  }

  if (task.status === "draft" && canTransitionTask("draft", "discussing")) {
    task.status = "discussing";
    task.updatedAt = now();
    publish(task.workspaceId, "task.updated", { taskId: task.id, status: task.status });
  }
  run.status = "running";
  run.startedAt = now();
  addEvent(db, run, "run.started", { agentId: agent.id, round: run.round });
  agent.status = "busy";
  agent.lastSyncAt = now();
  await persist();
  publish(run.workspaceId, "run.updated", { runId });
  publish(run.workspaceId, "agent.status_changed", { agentId: agent.id, status: "busy" });

  await delay(360);

  let text: string;
  let mock = false;
  if (agent.adapterType === "model_api") {
    try {
      const result = await modelText(agent, task, run);
      text = result.text;
      mock = result.mock;
    } catch (error) {
      const err = error as Error & { code?: string };
      await failRun(db, run, agent, err.code ?? "MODEL_CALL_FAILED", err.message.slice(0, 200));
      return;
    }
  } else {
    text = demoText(agent, task, run.round);
  }
  addEvent(db, run, "model.call", { adapterType: agent.adapterType, mock, modelId: agent.modelId ?? null });
  for (const piece of chunks(text)) {
    const live = db.runs.find((r) => r.id === runId);
    if (!live || ["cancelled", "failed", "timed_out"].includes(live.status)) {
      agent.status = "online";
      await persist();
      publish(run.workspaceId, "agent.status_changed", { agentId: agent.id, status: "online" });
      return;
    }
    addEvent(db, run, "message.delta", { delta: piece, agentId: agent.id });
    publish(run.workspaceId, "message.delta", { runId, taskId: run.taskId, agentId: agent.id, delta: piece });
    await delay(70);
  }

  const message: Message = {
    id: newId("msg"),
    workspaceId: run.workspaceId,
    taskId: run.taskId,
    runId: run.id,
    senderType: "agent",
    senderId: agent.id,
    agentId: agent.id,
    type: "agent",
    content: text,
    mentions: [],
    replyToId: null,
    pinned: false,
    createdAt: now(),
  };
  // Re-check after the async persist above: cancel/stop may have landed mid-stream.
  const beforeCommit = db.runs.find((r) => r.id === runId);
  if (!beforeCommit || ["cancelled", "failed", "timed_out"].includes(beforeCommit.status)) {
    agent.status = "online";
    await persist();
    publish(run.workspaceId, "agent.status_changed", { agentId: agent.id, status: "online" });
    return;
  }
  db.messages.push(message);
  addEvent(db, run, "message.completed", { messageId: message.id });
  await persist();
  publish(run.workspaceId, "message.created", { taskId: run.taskId, messageId: message.id, runId: run.id });

  // Demo artifact appears after the second round, subject to approval policy.
  const existing = db.artifacts.find((a) => a.taskId === run.taskId);
  if (run.round >= 2 && !existing) {
    const artifactId = newId("art");
    const versionId = newId("ver");
    const content = `# ${task.title}\n\n## 目标\n${task.goal}\n\n## 已确认决定\n${db.messages
      .filter((m) => m.taskId === task.id && m.pinned)
      .map((m) => `- ${m.content}`)
      .join("\n") || "- 暂无"}\n\n## 验收标准\n${task.acceptanceCriteria.map((c) => `- ${c}`).join("\n")}\n\n## 结论\n${text}\n`;
    db.artifacts.push({
      id: artifactId, workspaceId: run.workspaceId, taskId: run.taskId, name: `${task.title}.md`,
      type: "markdown", status: "draft", currentVersionId: versionId, finalVersionId: null,
      createdByType: "agent", createdById: agent.id, createdAt: now(), updatedAt: now(),
    });
    db.artifactVersions.push({
      id: versionId, artifactId, version: 1, content,
      changeSummary: "演示 Agent 根据讨论生成初稿",
      createdByType: "agent", createdById: agent.id, createdAt: now(),
    });
    db.messages.push({
      id: newId("msg"), workspaceId: run.workspaceId, taskId: run.taskId, runId: run.id,
      senderType: "agent", senderId: agent.id, agentId: agent.id, type: "artifact",
      content: `提交产物《${task.title}.md》v1，等待你预览。`, mentions: [], replyToId: message.id,
      pinned: false, artifactId, createdAt: now(),
    });
    const approvalId = newId("apr");
    db.approvals.push({
      id: approvalId, workspaceId: run.workspaceId, taskId: task.id, runId: run.id, agentId: agent.id,
      type: "artifact_submit", requestSummary: `提交《${task.title}.md》v1 供验收`,
      riskLevel: "low", permissions: ["artifact:submit"], status: "pending",
      expiresAt: new Date(Date.now() + 4 * 3600_000).toISOString(),
      decidedBy: null, decidedAt: null, decisionNote: null, createdAt: now(),
    });
    run.status = "waiting_approval";
    addEvent(db, run, "artifact.submitted", { artifactId, versionId });
    addEvent(db, run, "approval.requested", { approvalId });
    await persist();
    publish(run.workspaceId, "artifact.submitted", { taskId: task.id, artifactId });
    publish(run.workspaceId, "approval.requested", { approvalId, taskId: task.id });
    publish(run.workspaceId, "notification.created", { type: "approval" });
    return;
  }

  const atFinish = db.runs.find((r) => r.id === runId);
  if (!atFinish || ["cancelled", "failed", "timed_out", "waiting_approval"].includes(atFinish.status)) {
    agent.status = "online";
    await persist();
    publish(run.workspaceId, "agent.status_changed", { agentId: agent.id, status: "online" });
    return;
  }
  run.status = "succeeded";
  run.finishedAt = now();
  agent.status = "online";
  agent.lastSyncAt = now();
  addEvent(db, run, "run.succeeded", {});
  await persist();
  publish(run.workspaceId, "run.updated", { runId });
  publish(run.workspaceId, "agent.status_changed", { agentId: agent.id, status: "online" });
}
