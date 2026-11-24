import type {
  AgentConnection,
  Database,
  WorkspaceSettings,
} from "./types";
import { hashPassword } from "./auth";
import { agentColor } from "./utils";

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const ahead = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();

export function defaultSettings(): WorkspaceSettings {
  return {
    workspace: { timezone: "Asia/Shanghai", taskTemplate: "default" },
    discussion: {
      hostMode: "user",
      maxRounds: 5,
      roundTimeoutSec: 600,
      responseTimeoutSec: 120,
      allowCrossRefs: true,
      recentMessages: 30,
    },
    approval: { artifactFirst: true, toolWrite: true, completion: true },
    security: { allowPrivateNetwork: false, logRetentionDays: 90 },
    appearance: { theme: "light", density: "comfortable" },
    notifications: {
      approval: true,
      agent_failed: true,
      artifact_review: true,
      task_completed: true,
      permission_changed: true,
      export_ready: true,
    },
  };
}

function defaultAgentPermissions() {
  return {
    readGoal: true,
    readMaterials: "ask" as const,
    sendMessages: true,
    submitArtifact: "ask" as const,
    tools: [] as string[],
    externalUrls: [] as string[],
    changeTaskStatus: false,
    completeTask: false,
    deleteArtifacts: false,
  };
}

function demoAgent(
  id: string,
  workspaceId: string,
  name: string,
  role: AgentConnection["role"],
  capabilities: string[],
  status: AgentConnection["status"],
  lastSyncMinutes: number | null,
  index: number,
): AgentConnection {
  return {
    id,
    workspaceId,
    name,
    role,
    adapterType: "demo",
    endpoint: "local://demo-agent",
    authType: "none",
    capabilities,
    permissionPolicy: defaultAgentPermissions(),
    timeoutMs: 120_000,
    maxConcurrency: 1,
    retryCount: 2,
    allowedDomains: [],
    status,
    lastHealthcheckAt: lastSyncMinutes === null ? null : ago(lastSyncMinutes),
    lastSyncAt: lastSyncMinutes === null ? null : ago(lastSyncMinutes),
    lastError: null,
    demo: true,
    color: agentColor(index),
    createdAt: ago(60 * 24 * 7),
    updatedAt: ago(lastSyncMinutes ?? 60 * 24),
  };
}

/** Deterministic demo seed. All agents are explicitly marked as demos. */
export function buildSeed(): Database {
  const nowIso = new Date().toISOString();
  const ws = "ws_demo";
  const owner = "u_owner";

  const agents: AgentConnection[] = [
    demoAgent("ag_research", ws, "调研 Agent", "researcher", ["调研", "资料整理"], "online", 3, 0),
    demoAgent("ag_writer", ws, "写手 Agent", "writer", ["写作", "长文生成"], "busy", 2, 1),
    demoAgent("ag_review", ws, "审校 Agent", "reviewer", ["审校", "事实核查"], "busy", 1, 2),
  ];

  return {
    users: [
      { id: owner, email: "demo@agent.local", name: "工作区所有者", avatarColor: agentColor(1), passwordHash: hashPassword(process.env.AUTH_PASSWORD ?? "demo-2026"), createdAt: ago(60 * 24 * 9) },
    ],
    sessions: [],
    workspaces: [
      { id: ws, name: "我的工作区", ownerId: owner, timezone: "Asia/Shanghai", createdAt: ago(60 * 24 * 7), updatedAt: ago(4), pendingDeleteAt: null },
    ],
    tasks: [
      {
        id: "task_launch", workspaceId: ws, title: "产品发布文章",
        goal: "撰写一篇面向开发者的 Agent 协作平台发布文章，讲清多 Agent 分工与人工验收的价值。",
        constraints: ["引用官方来源", "不夸大能力", "控制在 2000 字以内"],
        acceptanceCriteria: ["包含三个真实案例", "结构完整，含小结", "通过审校 Agent 的事实核查"],
        status: "executing", currentRound: 3, maxRounds: 5, hostMode: "user", hostAgentId: null,
        createdBy: owner, createdAt: ago(60 * 5), updatedAt: ago(2), archivedAt: null, blockReason: null,
      },
      {
        id: "task_research", workspaceId: ws, title: "竞品调研与产品定位",
        goal: "梳理同类多 Agent 产品的定位差异，输出一页调研结论。",
        constraints: ["只看公开资料", "标注信息日期"],
        acceptanceCriteria: ["至少 4 个产品", "给出差异化建议"],
        status: "discussing", currentRound: 2, maxRounds: 5, hostMode: "agent", hostAgentId: "ag_research",
        createdBy: owner, createdAt: ago(60 * 26), updatedAt: ago(18), archivedAt: null, blockReason: null,
      },
      {
        id: "task_api", workspaceId: ws, title: "API 文档梳理",
        goal: "整理 OpenAPI 结构说明，供前端接入使用。",
        constraints: ["与 /api/v1 契约一致"],
        acceptanceCriteria: ["覆盖任务与产物接口", "含错误码表"],
        status: "review", currentRound: 4, maxRounds: 5, hostMode: "user", hostAgentId: null,
        createdBy: owner, createdAt: ago(60 * 48), updatedAt: ago(42), archivedAt: null, blockReason: null,
      },
    ],
    participants: [
      { taskId: "task_launch", agentId: "ag_research", role: "member", permissions: defaultAgentPermissions(), joinedAt: ago(60 * 5) },
      { taskId: "task_launch", agentId: "ag_writer", role: "member", permissions: defaultAgentPermissions(), joinedAt: ago(60 * 5) },
      { taskId: "task_launch", agentId: "ag_review", role: "member", permissions: defaultAgentPermissions(), joinedAt: ago(60 * 4) },
      { taskId: "task_research", agentId: "ag_research", role: "host", permissions: defaultAgentPermissions(), joinedAt: ago(60 * 26) },
      { taskId: "task_research", agentId: "ag_writer", role: "member", permissions: defaultAgentPermissions(), joinedAt: ago(60 * 25) },
      { taskId: "task_api", agentId: "ag_writer", role: "member", permissions: defaultAgentPermissions(), joinedAt: ago(60 * 48) },
    ],
    agents,
    credentials: {},
    messages: [
      { id: "msg_1", workspaceId: ws, taskId: "task_launch", runId: "run_l1", senderType: "human", senderId: owner, type: "human", content: "先确定文章结构：问题、方案、三个案例、边界，最后给小结。", mentions: [], replyToId: null, pinned: true, createdAt: ago(60 * 4) },
      { id: "msg_2", workspaceId: ws, taskId: "task_launch", runId: "run_l1", senderType: "agent", senderId: "ag_research", agentId: "ag_research", type: "agent", content: "调研结论：现有产品大多只解决「单个 Agent 调用」，缺少多 Agent 在同一任务里分工与验收的过程。建议把「人类最终负责」放在开头。", mentions: [], replyToId: "msg_1", pinned: false, createdAt: ago(60 * 3 - 40) },
      { id: "msg_3", workspaceId: ws, taskId: "task_launch", runId: "run_l1", senderType: "agent", senderId: "ag_writer", agentId: "ag_writer", type: "agent", content: "同意。第 1 节用一个失败场景开场：三个 Agent 各自产出，没人知道哪个是最终版。", mentions: ["ag_research"], replyToId: "msg_2", pinned: false, createdAt: ago(60 * 3 - 25) },
      { id: "msg_4", workspaceId: ws, taskId: "task_launch", runId: "run_l2", senderType: "agent", senderId: "ag_review", agentId: "ag_review", type: "agent", content: "提醒：第 2 节提到的「自动验收」与产品原则冲突，需要改成「人工验收」。", mentions: ["ag_writer"], replyToId: "msg_3", pinned: true, createdAt: ago(60 * 2 - 30) },
      { id: "msg_5", workspaceId: ws, taskId: "task_launch", runId: "run_l2", senderType: "human", senderId: owner, type: "human", content: "按审校意见改，三个案例各控制在一句结论加一句证据。", mentions: ["ag_review"], replyToId: "msg_4", pinned: false, createdAt: ago(60 * 2 - 10) },
      { id: "msg_6", workspaceId: ws, taskId: "task_launch", runId: "run_l3", senderType: "agent", senderId: "ag_review", agentId: "ag_review", type: "agent", content: "正在修改第 4 节：把案例二的来源标注补齐，并删掉一处无法核实的数字。", mentions: [], replyToId: "msg_5", pinned: false, createdAt: ago(2) },
      { id: "msg_r1", workspaceId: ws, taskId: "task_research", runId: "run_r1", senderType: "human", senderId: owner, type: "human", content: "从公开资料出发，看看别人怎么组织多 Agent 的产出。", mentions: [], replyToId: null, pinned: false, createdAt: ago(60 * 26) },
      { id: "msg_r2", workspaceId: ws, taskId: "task_research", runId: "run_r1", senderType: "agent", senderId: "ag_research", agentId: "ag_research", type: "agent", content: "先把候选产品列成表，再按「讨论可见 / 产物可验收 / 权限可控」三个维度打分。", mentions: [], replyToId: "msg_r1", pinned: false, createdAt: ago(18) },
      { id: "msg_a1", workspaceId: ws, taskId: "task_api", runId: "run_a1", senderType: "agent", senderId: "ag_writer", agentId: "ag_writer", type: "agent", content: "已补齐错误码表，v2 提交待验收。", mentions: [], replyToId: null, pinned: false, createdAt: ago(42) },
    ],
    runs: [
      { id: "run_l1", workspaceId: ws, taskId: "task_launch", agentId: "ag_research", status: "succeeded", triggerType: "user", contextSnapshotId: "ctx_l1", round: 1, startedAt: ago(60 * 4), finishedAt: ago(60 * 3 - 20), createdAt: ago(60 * 4) },
      { id: "run_l2", workspaceId: ws, taskId: "task_launch", agentId: "ag_review", status: "succeeded", triggerType: "user", contextSnapshotId: "ctx_l2", round: 2, startedAt: ago(60 * 2 - 35), finishedAt: ago(60 * 2 - 5), createdAt: ago(60 * 2 - 35) },
      { id: "run_l3", workspaceId: ws, taskId: "task_launch", agentId: "ag_review", status: "running", triggerType: "agent", contextSnapshotId: "ctx_l3", round: 3, startedAt: ago(5), finishedAt: null, createdAt: ago(5) },
      { id: "run_r1", workspaceId: ws, taskId: "task_research", agentId: "ag_research", status: "succeeded", triggerType: "user", contextSnapshotId: "ctx_r1", round: 2, startedAt: ago(60 * 26), finishedAt: ago(18), createdAt: ago(60 * 26) },
      { id: "run_a1", workspaceId: ws, taskId: "task_api", agentId: "ag_writer", status: "waiting_approval", triggerType: "agent", contextSnapshotId: "ctx_a1", round: 4, startedAt: ago(48), finishedAt: null, createdAt: ago(48) },
    ],
    runEvents: [
      { id: "evt_1", runId: "run_l3", sequence: 1, type: "run.queued", payload: {}, createdAt: ago(5) },
      { id: "evt_2", runId: "run_l3", sequence: 2, type: "run.started", payload: { agentId: "ag_review" }, createdAt: ago(5) },
      { id: "evt_3", runId: "run_l3", sequence: 3, type: "message.completed", payload: { messageId: "msg_6" }, createdAt: ago(2) },
    ],
    contextSnapshots: [
      { id: "ctx_l1", runId: "run_l1", taskId: "task_launch", data: { goal: "撰写发布文章", currentRound: 1, maxRounds: 5, recentMessages: 1 }, createdAt: ago(60 * 4) },
      { id: "ctx_l2", runId: "run_l2", taskId: "task_launch", data: { goal: "撰写发布文章", currentRound: 2, maxRounds: 5, recentMessages: 4 }, createdAt: ago(60 * 2 - 35) },
      { id: "ctx_l3", runId: "run_l3", taskId: "task_launch", data: { goal: "撰写发布文章", currentRound: 3, maxRounds: 5, recentMessages: 5 }, createdAt: ago(5) },
      { id: "ctx_r1", runId: "run_r1", taskId: "task_research", data: { goal: "竞品调研", currentRound: 2, maxRounds: 5, recentMessages: 2 }, createdAt: ago(60 * 26) },
      { id: "ctx_a1", runId: "run_a1", taskId: "task_api", data: { goal: "API 文档", currentRound: 4, maxRounds: 5, recentMessages: 1 }, createdAt: ago(48) },
    ],
    artifacts: [
      { id: "art_launch", workspaceId: ws, taskId: "task_launch", name: "产品发布文章.md", type: "markdown", status: "draft", currentVersionId: "ver_launch_1", finalVersionId: null, createdByType: "agent", createdById: "ag_writer", createdAt: ago(60), updatedAt: ago(30) },
      { id: "art_api", workspaceId: ws, taskId: "task_api", name: "API 契约说明.md", type: "markdown", status: "review", currentVersionId: "ver_api_2", finalVersionId: null, createdByType: "agent", createdById: "ag_writer", createdAt: ago(60 * 40), updatedAt: ago(42) },
    ],
    artifactVersions: [
      { id: "ver_launch_1", artifactId: "art_launch", version: 1, content: "# 让多个 Agent 在同一任务里协作\n\n## 1. 问题\n\n三个 Agent 各自产出，没有人知道哪个才是最终版本。\n\n## 2. 方案\n\n同一任务、同一上下文；讨论可见；人类最终负责。\n\n## 3. 案例\n\n待补充三个真实案例。\n\n## 4. 小结\n\n待补充。\n", changeSummary: "初稿结构", createdByType: "agent", createdById: "ag_writer", createdAt: ago(60) },
      { id: "ver_api_1", artifactId: "art_api", version: 1, content: "# API 契约说明 v1\n\n## 任务接口\n\n- GET /tasks/:id\n- PATCH /tasks/:id\n", changeSummary: "初版接口清单", createdByType: "agent", createdById: "ag_writer", createdAt: ago(60 * 40) },
      { id: "ver_api_2", artifactId: "art_api", version: 2, content: "# API 契约说明 v2\n\n## 任务接口\n\n- GET /tasks/:id\n- PATCH /tasks/:id\n- POST /tasks/:id/transition\n\n## 错误码\n\n- INVALID_TASK_TRANSITION 409\n- FORBIDDEN 403\n", changeSummary: "补齐错误码表", createdByType: "agent", createdById: "ag_writer", createdAt: ago(42) },
    ],
    materials: [
      { id: "mat_guideline", workspaceId: ws, name: "写作规范.txt", type: "text", content: "段落不超过 4 行；结论先行；不夸大能力；引用需标注来源。", url: null, mime: "text/plain", size: 88, visibility: "all", taskIds: ["task_launch"], createdBy: owner, createdAt: ago(60 * 5) },
      { id: "mat_a2a", workspaceId: ws, name: "A2A 官方文档", type: "url", content: null, url: "https://a2a-protocol.org/latest/", mime: null, size: null, visibility: "all", taskIds: ["task_launch", "task_research"], createdBy: owner, createdAt: ago(60 * 4) },
      { id: "mat_spec", workspaceId: ws, name: "接口约定摘录", type: "text", content: "基础路径 /api/v1；时间 ISO 8601 UTC；写操作支持 Idempotency-Key。", url: null, mime: "text/plain", size: 64, visibility: "all", taskIds: ["task_api"], createdBy: owner, createdAt: ago(60 * 46) },
    ],
    approvals: [
      { id: "apr_tool", workspaceId: ws, taskId: "task_launch", runId: "run_l3", agentId: "ag_review", type: "tool_call", requestSummary: "调用 web_verify 校验第 4 节引用的两个来源", riskLevel: "medium", permissions: ["tool:web_verify"], status: "pending", expiresAt: ahead(45), decidedBy: null, decidedAt: null, decisionNote: null, createdAt: ago(4) },
      { id: "apr_artifact", workspaceId: ws, taskId: "task_api", runId: "run_a1", agentId: "ag_writer", type: "artifact_submit", requestSummary: "提交《API 契约说明》v2 供验收", riskLevel: "low", permissions: ["artifact:submit"], status: "pending", expiresAt: ahead(180), decidedBy: null, decidedAt: null, decisionNote: null, createdAt: ago(42) },
    ],
    notifications: [
      { id: "nt_1", workspaceId: ws, userId: owner, type: "approval", title: "需要你确认", body: "审校 Agent 申请调用 web_verify 校验第 4 节来源", targetRef: "/workspaces/ws_demo/approvals", readAt: null, createdAt: ago(4) },
      { id: "nt_2", workspaceId: ws, userId: owner, type: "approval", title: "需要你确认", body: "写手 Agent 提交《API 契约说明》v2", targetRef: "/workspaces/ws_demo/approvals", readAt: null, createdAt: ago(42) },
      { id: "nt_3", workspaceId: ws, userId: owner, type: "artifact_review", title: "新产物待验收", body: "API 契约说明 v2 已提交", targetRef: "/workspaces/ws_demo/artifacts/art_api", readAt: null, createdAt: ago(42) },
      { id: "nt_4", workspaceId: ws, userId: owner, type: "task_completed", title: "任务已完成", body: "《上线检查清单》已验收", targetRef: "/workspaces/ws_demo/tasks", readAt: ago(60 * 20), createdAt: ago(60 * 21) },
    ],
    auditLogs: [
      { id: "aud_1", workspaceId: ws, actorType: "system", actorId: "system", action: "workspace.created", targetRef: ws, metadata: {}, createdAt: ago(60 * 24 * 7) },
      { id: "aud_2", workspaceId: ws, actorType: "user", actorId: owner, action: "task.created", targetRef: "task_launch", metadata: { title: "产品发布文章" }, createdAt: ago(60 * 5) },
      { id: "aud_3", workspaceId: ws, actorType: "user", actorId: owner, action: "agent.joined_task", targetRef: "task_launch", metadata: { agentId: "ag_review" }, createdAt: ago(60 * 4) },
      { id: "aud_4", workspaceId: ws, actorType: "agent", actorId: "ag_review", action: "approval.requested", targetRef: "apr_tool", metadata: { type: "tool_call" }, createdAt: ago(4) },
    ],
    settings: { [ws]: defaultSettings() },
    seq: 10,
  };
}
