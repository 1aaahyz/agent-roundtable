import { getDb, persist } from "./db";
import { publish } from "./events";
import { kickRun } from "./orchestrator";
import { createSession, destroySession, getSessionUser, hashPassword, hashToken, readCookie, sessionCookieHeader, clearCookieHeader, SESSION_COOKIE, verifyPassword } from "./auth";
import { assertSafeEndpoint, credentialFingerprint, encryptCredential, decryptCredential, providerFallbackKey, redact, validateFileName, MAX_MATERIAL_BYTES } from "./security";
import { canTransitionTask } from "./state-machines";
import { ApiError, type AgentConnection, type Approval, type Artifact, type Database, type Message, type Run, type Task } from "./types";
import { defaultSettings } from "./seed";
import { diffLines, newId, now, truncate } from "./utils";

export interface ApiResult {
  status: number;
  data: unknown;
  /** Optional Set-Cookie value for session establishment. */
  cookie?: string;
}

/** Strips the password hash before any response leaves the server. */
function publicUser(user: { id: string; email: string; name: string; avatarColor: string; createdAt: string }) {
  return { id: user.id, email: user.email, name: user.name, avatarColor: user.avatarColor, createdAt: user.createdAt };
}

function hashTokenSafe(token: string): string {
  return token ? hashToken(token) : "\u0000";
}

interface Ctx {
  method: string;
  segments: string[];
  body: Record<string, any>;
  query: URLSearchParams;
  headers: Headers;
}

const done = (data: unknown, status = 200): ApiResult => ({ status, data });

function requireWs(db: Database, id: string, ownerId: string) {
  const ws = db.workspaces.find((w) => w.id === id);
  if (!ws) throw new ApiError(404, "NOT_FOUND", "工作区不存在");
  if (ws.ownerId !== ownerId) throw new ApiError(403, "FORBIDDEN", "你没有访问该工作区的权限");
  return ws;
}

function requireTask(db: Database, id: string, ownerId: string, workspaceId?: string) {
  const task = db.tasks.find((t) => t.id === id);
  if (!task) throw new ApiError(404, "NOT_FOUND", "任务不存在");
  requireWs(db, workspaceId ?? task.workspaceId, ownerId);
  if (workspaceId && task.workspaceId !== workspaceId) throw new ApiError(404, "NOT_FOUND", "任务不存在");
  return task;
}

function requireAgent(db: Database, id: string, ownerId: string) {
  const agent = db.agents.find((a) => a.id === id);
  if (!agent) throw new ApiError(404, "NOT_FOUND", "Agent 不存在");
  requireWs(db, agent.workspaceId, ownerId);
  return agent;
}

function requireArtifact(db: Database, id: string, ownerId: string) {
  const item = db.artifacts.find((a) => a.id === id);
  if (!item) throw new ApiError(404, "NOT_FOUND", "产物不存在");
  requireWs(db, item.workspaceId, ownerId);
  return item;
}

function audit(db: Database, wsId: string, actorType: "user" | "agent" | "system", actorId: string, action: string, targetRef: string, metadata: Record<string, unknown> = {}) {
  db.auditLogs.push({ id: newId("aud"), workspaceId: wsId, actorType, actorId, action, targetRef, metadata, createdAt: now() });
}

function notify(db: Database, wsId: string, type: string, title: string, body: string, targetRef: string) {
  db.notifications.push({ id: newId("nt"), workspaceId: wsId, userId: "u_owner", type, title, body, targetRef, readAt: null, createdAt: now() });
  publish(wsId, "notification.created", { type, title });
}

function addRunEvent(db: Database, run: Run, type: string, payload: Record<string, unknown> = {}) {
  const sequence = db.runEvents.filter((e) => e.runId === run.id).length + 1;
  db.runEvents.push({ id: newId("re"), runId: run.id, sequence, type, payload, createdAt: now() });
}

function createRun(db: Database, task: Task, agentId: string | null, round: number): Run {
  const snapshotId = newId("ctx");
  const recent = db.messages.filter((m) => m.taskId === task.id).slice(-30);
  db.contextSnapshots.push({
    id: snapshotId,
    runId: "pending",
    taskId: task.id,
    data: {
      task_id: task.id,
      title: task.title,
      goal: task.goal,
      constraints: task.constraints,
      acceptance_criteria: task.acceptanceCriteria,
      confirmed_decisions: db.messages.filter((m) => m.taskId === task.id && m.pinned).map((m) => m.content),
      material_refs: db.materials.filter((m) => m.taskIds.includes(task.id)).map((m) => m.id),
      artifact_refs: db.artifacts.filter((a) => a.taskId === task.id).map((a) => a.id),
      participant_agents: db.participants.filter((p) => p.taskId === task.id).map((p) => p.agentId),
      recent_messages: recent.map((m) => ({ id: m.id, sender: m.senderId, content: truncate(m.content, 200) })),
      current_round: round,
      max_rounds: task.maxRounds,
      permissions: agentId ? db.agents.find((a) => a.id === agentId)?.permissionPolicy ?? {} : {},
    },
    createdAt: now(),
  });
  const run: Run = {
    id: newId("run"), workspaceId: task.workspaceId, taskId: task.id, agentId,
    status: "queued", triggerType: "user", contextSnapshotId: snapshotId,
    round, startedAt: null, finishedAt: null, createdAt: now(),
  };
  db.runs.push(run);
  const snapshot = db.contextSnapshots.find((s) => s.id === snapshotId);
  if (snapshot) snapshot.runId = run.id;
  addRunEvent(db, run, "run.queued", { round, agentId });
  return run;
}

function defaultPermissions() {
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

function overview(db: Database, wsId: string) {
  const tasks = db.tasks.filter((t) => t.workspaceId === wsId);
  const approvals = db.approvals.filter((a) => a.workspaceId === wsId && a.status === "pending");
  const reviewArtifacts = db.artifacts.filter((a) => a.workspaceId === wsId && a.status === "review");
  const failedRuns = db.runs.filter((r) => r.workspaceId === wsId && (r.status === "failed" || r.status === "timed_out"));
  const active = tasks.filter((t) => ["discussing", "executing", "review", "blocked"].includes(t.status));
  const latestTask = [...active].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  const latestMessage = db.messages.filter((m) => m.workspaceId === wsId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const agent = latestMessage?.agentId ? db.agents.find((a) => a.id === latestMessage.agentId) : null;
  // Derive the third clause from the latest run state — never a hardcoded claim.
  const latestRun = db.runs.filter((r) => r.workspaceId === wsId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const runVerb = latestRun?.status === "running" ? "正在输出" : latestRun?.status === "waiting_approval" ? "等待你审批" : latestRun?.status === "waiting_input" ? "已暂停等待你" : latestRun?.status === "succeeded" ? "已完成本轮" : latestRun?.status === "failed" ? "上轮失败" : null;
  const third = latestTask && agent && runVerb ? `《${latestTask.title}》的${agent.name} ${runVerb}` : null;
  const pieces = [
    `${active.length} 个任务进行中`,
    `${approvals.length} 个等待你确认`,
    third,
  ].filter(Boolean);
  return {
    conclusion: pieces.join(" · "),
    counts: {
      active: active.length,
      pendingApprovals: approvals.length,
      reviewArtifacts: reviewArtifacts.length,
      failedRuns: failedRuns.length,
      agents: db.agents.filter((a) => a.workspaceId === wsId && a.status !== "disabled").length,
    },
    needsAction: {
      approvals: approvals.slice(0, 5).map((a) => ({ id: a.id, type: a.type, summary: a.requestSummary, risk: a.riskLevel, expiresAt: a.expiresAt })),
      failures: failedRuns.slice(0, 5).map((r) => ({ id: r.id, taskId: r.taskId, code: r.errorCode })),
      reviews: reviewArtifacts.slice(0, 5).map((a) => ({ id: a.id, taskId: a.taskId, name: a.name })),
    },
    tasks: [...active].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((t) => ({
      ...t,
      agentCount: db.participants.filter((p) => p.taskId === t.id).length,
      pendingApprovals: approvals.filter((a) => a.taskId === t.id).length,
      latestArtifact: db.artifacts.filter((a) => a.taskId === t.id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null,
    })),
    artifacts: db.artifacts.filter((a) => a.workspaceId === wsId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 5),
    agents: db.agents.filter((a) => a.workspaceId === wsId).map((a) => ({
      id: a.id, name: a.name, status: a.status, demo: a.demo, color: a.color,
      lastSyncAt: a.lastSyncAt, capabilities: a.capabilities,
    })),
    notifications: db.notifications.filter((n) => n.workspaceId === wsId && !n.readAt).slice(0, 8),
  };
}

function taskDetail(db: Database, task: Task) {
  const participants = db.participants.filter((p) => p.taskId === task.id).map((p) => ({
    ...p, agent: db.agents.find((a) => a.id === p.agentId) ?? null,
  }));
  const runs = db.runs.filter((r) => r.taskId === task.id);
  const artifacts = db.artifacts.filter((a) => a.taskId === task.id);
  const approvals = db.approvals.filter((a) => a.taskId === task.id && a.status === "pending");
  const materials = db.materials.filter((m) => m.taskIds.includes(task.id));
  return { ...task, participants, runs, artifacts, approvals, materials };
}

export async function dispatch(ctx: Ctx): Promise<ApiResult> {
  const db = await getDb();
  const { method, segments: s, body, query } = ctx;
  const sessionToken = readCookie(ctx.headers.get("cookie"), SESSION_COOKIE);
  const sessionUser = getSessionUser(db, sessionToken);

  // ---- auth (login/logout/me are the only unauthenticated routes) ----
  if (s[0] === "auth") {
    if (s[1] === "login" && method === "POST") {
      const email = String(body.email ?? "").trim().toLowerCase();
      const password = String(body.password ?? "");
      const user = db.users.find((u) => u.email.toLowerCase() === email);
      // Constant-ish work and a single generic message avoid account enumeration.
      const ok = user ? verifyPassword(password, user.passwordHash) : verifyPassword(password, hashPassword("invalid"));
      if (!ok || !user) throw new ApiError(401, "INVALID_CREDENTIALS", "邮箱或密码不正确");
      const { token, expiresAt } = createSession(db, user.id);
      audit(db, db.workspaces[0]?.id ?? "", "user", user.id, "login", user.id, {});
      await persist();
      return {
        status: 200,
        data: { user: publicUser(user), workspaceId: db.workspaces.find((w) => w.ownerId === user.id)?.id ?? null, expiresAt },
        cookie: sessionCookieHeader(token),
      };
    }
    if (s[1] === "logout" && method === "POST") {
      if (sessionToken) {
        destroySession(db, sessionToken);
        await persist();
      }
      return { status: 200, data: { ok: true }, cookie: clearCookieHeader() };
    }
    if (s[1] === "me" && method === "GET") {
      if (!sessionUser) throw new ApiError(401, "UNAUTHENTICATED", "请先登录");
      return done({ user: publicUser(sessionUser), workspaceId: db.workspaces.find((w) => w.ownerId === sessionUser.id)?.id ?? null });
    }
    if (s[1] === "password" && method === "POST") {
      if (!sessionUser) throw new ApiError(401, "UNAUTHENTICATED", "请先登录");
      const current = String(body.currentPassword ?? "");
      const next = String(body.newPassword ?? "");
      if (!verifyPassword(current, sessionUser.passwordHash)) throw new ApiError(403, "INVALID_CREDENTIALS", "当前密码不正确");
      if (next.length < 8) throw new ApiError(400, "WEAK_PASSWORD", "新密码至少 8 位");
      sessionUser.passwordHash = hashPassword(next);
      // Revoke every other session after a password change.
      db.sessions = db.sessions.filter((sess) => sess.userId !== sessionUser.id || sess.tokenHash === hashTokenSafe(sessionToken ?? ""));
      audit(db, db.workspaces.find((w) => w.ownerId === sessionUser.id)?.id ?? "", "user", sessionUser.id, "password.changed", sessionUser.id, {});
      await persist();
      return done({ ok: true });
    }
    throw new ApiError(404, "ROUTE_NOT_FOUND", "未实现的接口");
  }

  // Everything below requires an authenticated session.
  if (!sessionUser) throw new ApiError(401, "UNAUTHENTICATED", "请先登录");
  const owner = sessionUser;

  // ---- workspaces ----
  if (s[0] === "workspaces" && s.length === 1) {
    if (method === "GET") return done(db.workspaces);
    if (method === "POST") {
      const name = String(body.name ?? "我的工作区").trim().slice(0, 60) || "我的工作区";
      const id = newId("ws");
      const ts = now();
      db.workspaces.push({ id, name, ownerId: owner.id, timezone: "Asia/Shanghai", createdAt: ts, updatedAt: ts, pendingDeleteAt: null });
      db.settings[id] = defaultSettings();
      audit(db, id, "user", owner.id, "workspace.created", id, { name });
      return done(db.workspaces.find((w) => w.id === id), 201);
    }
  }

  if (s[0] === "workspaces" && s.length >= 2) {
    const wsId = s[1];
    const ws = requireWs(db, wsId, owner.id);

    if (s.length === 2) {
      if (method === "GET") return done(ws);
      if (method === "PATCH") {
        if (body.name !== undefined) ws.name = String(body.name).trim().slice(0, 60) || ws.name;
        if (body.timezone !== undefined) ws.timezone = String(body.timezone);
        ws.updatedAt = now();
        audit(db, wsId, "user", owner.id, "workspace.updated", wsId, { name: ws.name });
        return done(ws);
      }
      if (method === "DELETE") {
        ws.pendingDeleteAt = new Date(Date.now() + 7 * 86400_000).toISOString();
        audit(db, wsId, "user", owner.id, "workspace.delete_requested", wsId, {});
        return done({ ok: true, purgeAfter: ws.pendingDeleteAt });
      }
    }

    if (s[2] === "overview" && method === "GET") return done(overview(db, wsId));

    if (s[2] === "settings") {
      const settings = db.settings[wsId] ?? defaultSettings();
      if (method === "GET") return done(settings);
      if (method === "PATCH") {
        const SAFE_SETTINGS_GROUPS = new Set(["workspace", "discussion", "approval", "security", "appearance", "notifications"]);
        for (const group of Object.keys(body)) {
          // Reject prototype-polluting keys and unknown groups outright.
          if (!SAFE_SETTINGS_GROUPS.has(group) || group === "__proto__" || group === "constructor" || group === "prototype") continue;
          const incoming = body[group];
          if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) continue;
          const target = group === "notifications"
            ? (settings.notifications ?? {})
            : (settings[group as keyof typeof settings] as object);
          if (!target || typeof target !== "object") continue;
          for (const field of Object.keys(incoming)) {
            if (field === "__proto__" || field === "constructor" || field === "prototype") continue;
            if (!Object.hasOwn(target, field)) continue; // only patch known fields
            (target as Record<string, unknown>)[field] = incoming[field];
          }
        }
        db.settings[wsId] = settings;
        audit(db, wsId, "user", owner.id, "settings.updated", wsId, { groups: Object.keys(body) });
        return done(settings);
      }
    }

    if (s[2] === "tasks") {
      if (method === "GET") {
        let list = db.tasks.filter((t) => t.workspaceId === wsId);
        const status = query.get("status");
        const agentId = query.get("agent");
        const q = query.get("q")?.trim().toLowerCase();
        if (status && status !== "all") list = list.filter((t) => t.status === status);
        if (agentId && agentId !== "all") list = list.filter((t) => db.participants.some((p) => p.taskId === t.id && p.agentId === agentId));
        if (q) list = list.filter((t) => [t.title, t.goal, ...db.artifacts.filter((a) => a.taskId === t.id).map((a) => a.name)].join(" ").toLowerCase().includes(q));
        return done(list.map((t) => taskDetail(db, t)));
      }
      if (method === "POST") {
        const title = String(body.title ?? "").trim();
        const goal = String(body.goal ?? "").trim();
        if (!title || !goal) throw new ApiError(400, "REQUIRED_FIELDS", "标题和目标是必填项");
        const agentIds: string[] = Array.isArray(body.agentIds) ? body.agentIds.filter((id: string) => db.agents.some((a) => a.id === id && a.workspaceId === wsId)) : [];
        const ts = now();
        const task: Task = {
          id: newId("task"), workspaceId: wsId, title, goal,
          constraints: Array.isArray(body.constraints) ? body.constraints.map(String) : [],
          acceptanceCriteria: Array.isArray(body.acceptanceCriteria) ? body.acceptanceCriteria.map(String) : [],
          status: "draft", currentRound: 0,
          maxRounds: Math.min(20, Math.max(1, Number(body.maxRounds) || 5)),
          hostMode: body.hostMode === "agent" ? "agent" : "user",
          hostAgentId: body.hostAgentId ?? null,
          createdBy: owner.id, createdAt: ts, updatedAt: ts, archivedAt: null, blockReason: null,
        };
        db.tasks.push(task);
        agentIds.forEach((id, index) => db.participants.push({
          taskId: task.id, agentId: id, role: index === 0 && task.hostMode === "agent" ? "host" : "member",
          permissions: defaultPermissions(), joinedAt: ts,
        }));
        audit(db, wsId, "user", owner.id, "task.created", task.id, { title });
        publish(wsId, "task.updated", { taskId: task.id, status: task.status });
        return done(taskDetail(db, task), 201);
      }
    }

    if (s[2] === "agents") {
      if (method === "GET") return done(db.agents.filter((a) => a.workspaceId === wsId));
      if (method === "POST") {
        const name = String(body.name ?? "").trim();
        if (!name) throw new ApiError(400, "REQUIRED_FIELDS", "Agent 名称必填");
        const adapterType = ["demo", "model_api", "a2a", "http_callback"].includes(body.adapterType) ? body.adapterType : "demo";
        let endpoint = String(body.endpoint ?? "");
        if (adapterType === "demo") endpoint = endpoint || "local://demo-agent";
        else         if (adapterType === "model_api" && endpoint === "local://mock-openai") {
          // Explicit local mock for credential-free self-test. Always labeled as a demo.
        } else {
          assertSafeEndpoint(endpoint);
          if (adapterType === "model_api" && /\/batch/i.test(endpoint)) {
            throw new ApiError(400, "BATCH_ENDPOINT_UNSUPPORTED", "批量推理地址不支持实时 chat/completions；请使用实时推理 Base URL");
          }
        }
        const credential = String(body.credential ?? "");
        const index = db.agents.filter((a) => a.workspaceId === wsId).length;
        const agent: AgentConnection = {
          id: newId("ag"), workspaceId: wsId, name,
          role: ["researcher", "writer", "reviewer", "coder", "custom"].includes(body.role) ? body.role : "custom",
          adapterType, endpoint,
          modelId: adapterType === "model_api" ? String(body.modelId ?? "doubao-seed-1-6-251015").trim().slice(0, 120) : null,
          authType: ["none", "api_key", "bearer"].includes(body.authType) ? body.authType : "none",
          credentialRef: credential ? newId("cred") : null,
          credentialFingerprint: credential ? credentialFingerprint(credential) : null,
          capabilities: Array.isArray(body.capabilities) ? body.capabilities.map(String) : [],
          permissionPolicy: defaultPermissions(),
          timeoutMs: Number(body.timeoutMs) || 120_000,
          maxConcurrency: Math.max(1, Number(body.maxConcurrency) || 1),
          retryCount: Math.min(5, Math.max(0, Number(body.retryCount) ?? 2)),
          allowedDomains: Array.isArray(body.allowedDomains) ? body.allowedDomains.map(String) : [],
          status: "untested",
          lastHealthcheckAt: null, lastSyncAt: null, lastError: null,
          demo: adapterType === "demo" || endpoint.startsWith("local://"),
          color: body.color ?? undefined,
          createdAt: now(), updatedAt: now(),
        };
        db.agents.push(agent);
        if (credential && !agent.demo) db.credentials[agent.id] = encryptCredential(credential);
        audit(db, wsId, "user", owner.id, "agent.created", agent.id, { adapterType });
        return done(agent, 201);
      }
    }

    if (s[2] === "artifacts" && method === "GET") {
      let list = db.artifacts.filter((a) => a.workspaceId === wsId);
      if (query.get("task") && query.get("task") !== "all") list = list.filter((a) => a.taskId === query.get("task"));
      if (query.get("status") && query.get("status") !== "all") list = list.filter((a) => a.status === query.get("status"));
      const q = query.get("q")?.toLowerCase();
      if (q) list = list.filter((a) => a.name.toLowerCase().includes(q));
      return done(list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
    }

    if (s[2] === "materials") {
      if (method === "GET") return done(db.materials.filter((m) => m.workspaceId === wsId));
      if (method === "POST") {
        const name = validateFileName(String(body.name ?? ""));
        const type = ["file", "url", "text"].includes(body.type) ? body.type : "text";
        const content = String(body.content ?? "");
        const url = String(body.url ?? "");
        if (type === "text" && !content) throw new ApiError(400, "REQUIRED_FIELDS", "文本内容不能为空");
        if (type === "url") assertSafeEndpoint(url);
        if (type === "file" && content.length > MAX_MATERIAL_BYTES) throw new ApiError(413, "FILE_TOO_LARGE", "单文件上限 20MB");
        const material = {
          id: newId("mat"), workspaceId: wsId, name, type,
          content: type === "url" ? null : content,
          url: type === "url" ? url : null,
          mime: type === "file" ? String(body.mime ?? "application/octet-stream") : type === "text" ? "text/plain" : null,
          size: content.length, visibility: body.visibility === "restricted" ? "restricted" as const : "all" as const,
          taskIds: Array.isArray(body.taskIds) ? body.taskIds.filter((id: string) => db.tasks.some((t) => t.id === id && t.workspaceId === wsId)) : [],
          createdBy: owner.id, createdAt: now(),
        };
        db.materials.push(material);
        audit(db, wsId, "user", owner.id, "material.created", material.id, { type });
        return done(material, 201);
      }
    }
  }

  // ---- tasks ----
  if (s[0] === "tasks" && s.length >= 2) {
    const task = requireTask(db, s[1], owner.id);
    const wsId = task.workspaceId;

    if (s.length === 2) {
      if (method === "GET") return done(taskDetail(db, task));
      if (method === "PATCH") {
        if (body.title !== undefined) task.title = String(body.title).trim().slice(0, 120) || task.title;
        if (body.goal !== undefined) task.goal = String(body.goal).trim().slice(0, 2000);
        if (Array.isArray(body.constraints)) task.constraints = body.constraints.map((c: unknown) => String(c).slice(0, 300)).slice(0, 30);
        if (Array.isArray(body.acceptanceCriteria)) task.acceptanceCriteria = body.acceptanceCriteria.map((c: unknown) => String(c).slice(0, 300)).slice(0, 30);
        if (body.maxRounds !== undefined) {
          const n = Number(body.maxRounds);
          task.maxRounds = Number.isFinite(n) ? Math.min(20, Math.max(1, Math.trunc(n))) : task.maxRounds;
        }
        if (body.hostMode !== undefined) task.hostMode = body.hostMode === "agent" ? "agent" : "user";
        if (body.hostAgentId !== undefined) task.hostAgentId = body.hostAgentId ? String(body.hostAgentId) : null;
        if (body.blockReason !== undefined) task.blockReason = body.blockReason ? String(body.blockReason).slice(0, 300) : null;
        task.updatedAt = now();
        audit(db, wsId, "user", owner.id, "task.updated", task.id, {});
        publish(wsId, "task.updated", { taskId: task.id });
        return done(taskDetail(db, task));
      }
    }

    if (s[2] === "archive" && method === "POST") {
      if (!canTransitionTask(task.status, "archived")) throw new ApiError(409, "INVALID_TASK_TRANSITION", "当前状态不能归档");
      task.status = "archived"; task.archivedAt = now(); task.updatedAt = now();
      audit(db, wsId, "user", owner.id, "task.archived", task.id, {});
      publish(wsId, "task.updated", { taskId: task.id, status: task.status });
      return done(taskDetail(db, task));
    }

    if (s[2] === "cancel" && method === "POST") {
      if (!canTransitionTask(task.status, "cancelled")) throw new ApiError(409, "INVALID_TASK_TRANSITION", "当前状态不能取消");
      task.status = "cancelled"; task.updatedAt = now();
      db.runs.filter((r) => r.taskId === task.id && ["queued", "running", "waiting_input", "waiting_approval"].includes(r.status))
        .forEach((r) => { r.status = "cancelled"; r.finishedAt = now(); addRunEvent(db, r, "run.cancelled", {}); });
      audit(db, wsId, "user", owner.id, "task.cancelled", task.id, { reason: body.reason ?? "" });
      publish(wsId, "task.updated", { taskId: task.id, status: task.status });
      return done(taskDetail(db, task));
    }

    if (s[2] === "transition" && method === "POST") {
      const to = String(body.to ?? "");
      if (!canTransitionTask(task.status, to as any)) throw new ApiError(409, "INVALID_TASK_TRANSITION", `任务状态不能从「${task.status}」变为「${to}」`);
      const from = task.status;
      task.status = to as any; task.updatedAt = now();
      if (to === "blocked") task.blockReason = String(body.reason ?? "外部依赖失败");
      if (to !== "blocked") task.blockReason = null;
      audit(db, wsId, "user", owner.id, "task.transitioned", task.id, { from, to });
      publish(wsId, "task.updated", { taskId: task.id, status: to });
      return done(taskDetail(db, task));
    }

    if (s[2] === "complete" && method === "POST") {
      if (!canTransitionTask(task.status, "done")) throw new ApiError(409, "INVALID_TASK_TRANSITION", "只有待验收任务可以完成");
      const artifactId = String(body.artifactId ?? "");
      const artifact = db.artifacts.find((a) => a.id === artifactId && a.taskId === task.id);
      if (!artifact) throw new ApiError(400, "FINAL_ARTIFACT_REQUIRED", "请先指定最终产物");
      const version = db.artifactVersions.find((v) => v.id === artifact.currentVersionId);
      artifact.status = "accepted"; artifact.finalVersionId = artifact.currentVersionId; artifact.updatedAt = now();
      task.status = "done"; task.updatedAt = now();
      audit(db, wsId, "user", owner.id, "task.completed", task.id, { artifactId, version: version?.version });
      notify(db, wsId, "task_completed", "任务已完成", `《${task.title}》已验收`, `/workspaces/${wsId}/tasks/${task.id}`);
      publish(wsId, "task.updated", { taskId: task.id, status: task.status });
      return done(taskDetail(db, task));
    }

    if (s[2] === "agents") {
      if (method === "POST") {
        const agent = requireAgent(db, String(body.agentId ?? ""), owner.id);
        if (agent.workspaceId !== wsId) throw new ApiError(400, "WORKSPACE_MISMATCH", "Agent 不属于该工作区");
        if (db.participants.some((p) => p.taskId === task.id && p.agentId === agent.id)) throw new ApiError(409, "ALREADY_JOINED", "Agent 已在任务中");
        const approval = {
          id: newId("apr"), workspaceId: wsId, taskId: task.id, runId: null, agentId: agent.id,
          type: "agent_join" as const, requestSummary: `将 ${agent.name} 加入《${task.title}》`,
          riskLevel: "low" as const, permissions: ["task:read"], status: "pending" as const,
          expiresAt: new Date(Date.now() + 3600_000).toISOString(),
          decidedBy: null, decidedAt: null, decisionNote: null, createdAt: now(),
        };
        db.approvals.push(approval);
        audit(db, wsId, "user", owner.id, "agent.join_requested", task.id, { agentId: agent.id });
        publish(wsId, "approval.requested", { approvalId: approval.id, taskId: task.id });
        return done(approval, 201);
      }
      if (method === "GET") return done(db.participants.filter((p) => p.taskId === task.id));
      if (method === "DELETE" && s[3]) {
        db.participants = db.participants.filter((p) => !(p.taskId === task.id && p.agentId === s[3]));
        audit(db, wsId, "user", owner.id, "agent.removed", task.id, { agentId: s[3] });
        publish(wsId, "task.updated", { taskId: task.id });
        return done({ ok: true });
      }
    }

    if (s[2] === "messages") {
      if (method === "GET") {
        let list = db.messages.filter((m) => m.taskId === task.id);
        const since = query.get("since");
        if (since) list = list.filter((m) => m.createdAt > since);
        const limit = Math.min(500, Number(query.get("limit")) || 200);
        return done(list.slice(-limit));
      }
      if (method === "POST") {
        const content = String(body.content ?? "").trim();
        if (!content) throw new ApiError(400, "EMPTY_MESSAGE", "消息不能为空");
        const mentions: string[] = Array.isArray(body.mentions) ? body.mentions.filter((id: string) => db.agents.some((a) => a.id === id)) : [];
        const message: Message = {
          id: newId("msg"), workspaceId: wsId, taskId: task.id, runId: null,
          senderType: "human", senderId: owner.id, type: "human", content,
          mentions, replyToId: body.replyToId ?? null, pinned: false, createdAt: now(),
        };
        db.messages.push(message);
        audit(db, wsId, "user", owner.id, "message.created", message.id, { taskId: task.id });
        publish(wsId, "message.created", { taskId: task.id, messageId: message.id, runId: null });
        let started: Run | null = null;
        if (body.autoRun !== false) {
          const candidates = mentions.length ? mentions : db.participants.filter((p) => p.taskId === task.id).map((p) => p.agentId);
          let agentId = candidates.find((id) => {
            const a = db.agents.find((x) => x.id === id);
            return a && a.status !== "disabled" && a.status !== "offline";
          }) ?? null;
          if (agentId && task.currentRound >= task.maxRounds) {
            // Keep the human message, but stop spawning runs past the bound.
            agentId = null;
          }
          if (agentId && !["done", "cancelled", "archived", "draft"].includes(task.status)) {
            const round = task.currentRound + 1;
            task.currentRound = round; task.updatedAt = now();
            started = createRun(db, task, agentId, round);
          } else if (agentId && task.status === "draft") {
            task.status = "discussing"; task.currentRound = 1; task.updatedAt = now();
            started = createRun(db, task, agentId, 1);
          }
        }
        await persist();
        if (started) kickRun(started.id);
        return done({ message, run: started }, 201);
      }
    }

    if (s[2] === "runs" && method === "POST") {
      if (task.currentRound >= task.maxRounds) throw new ApiError(409, "ROUND_LIMIT_REACHED", "已达到最大讨论轮数，请人工接管");
      const agentId = String(body.agentId ?? "") || (db.participants.find((p) => p.taskId === task.id)?.agentId ?? null);
      if (!agentId) throw new ApiError(400, "NO_AGENT", "任务中还没有可用 Agent");
      const round = Math.min(task.maxRounds, task.currentRound + 1);
      task.currentRound = round; task.updatedAt = now();
      const run = createRun(db, task, agentId, round);
      audit(db, wsId, "system", owner.id, "run.queued", run.id, { taskId: task.id, agentId, round });
      await persist();
      kickRun(run.id);
      return done(run, 201);
    }
  }

  // ---- messages ----
  if (s[0] === "messages" && s[2] === "pin") {
    const message = db.messages.find((m) => m.id === s[1]);
    if (!message) throw new ApiError(404, "NOT_FOUND", "消息不存在");
    requireWs(db, message.workspaceId, owner.id);
    if (method === "POST") {
      message.pinned = true;
      audit(db, message.workspaceId, "user", owner.id, "message.pinned", message.id, {});
      publish(message.workspaceId, "message.updated", { taskId: message.taskId, messageId: message.id, pinned: message.pinned });
    } else if (method === "DELETE") {
      message.pinned = false;
      audit(db, message.workspaceId, "user", owner.id, "message.unpinned", message.id, {});
    }
    return done(message);
  }

  // ---- runs ----
  if (s[0] === "runs" && s.length === 1 && method === "GET") {
    let list = db.runs.filter((r) => {
      const wsId = r.workspaceId;
      const qWs = query.get("workspaceId");
      return (!qWs || qWs === wsId) && requireWsSafe(db, wsId, owner.id);
    });
    if (query.get("taskId")) list = list.filter((r) => r.taskId === query.get("taskId"));
    if (query.get("status") && query.get("status") !== "all") list = list.filter((r) => r.status === query.get("status"));
    const priority: Record<string, number> = { failed: 0, timed_out: 0, running: 1, waiting_approval: 1, queued: 2 };
    return done(list.sort((a, b) => (priority[a.status] ?? 3) - (priority[b.status] ?? 3) || b.createdAt.localeCompare(a.createdAt)));
  }

  if (s[0] === "runs" && s.length >= 2) {
    const run = db.runs.find((r) => r.id === s[1]);
    if (!run) throw new ApiError(404, "NOT_FOUND", "运行记录不存在");
    requireWs(db, run.workspaceId, owner.id);
    if (s.length === 2 && method === "GET") {
      return done({ ...run, events: db.runEvents.filter((e) => e.runId === run.id).sort((a, b) => a.sequence - b.sequence), context: db.contextSnapshots.find((c) => c.id === run.contextSnapshotId) ?? null });
    }
    if (s[2] === "events" && method === "GET") return done(db.runEvents.filter((e) => e.runId === run.id).sort((a, b) => a.sequence - b.sequence));
    if (s[2] === "pause" && method === "POST") {
      if (run.status !== "running") throw new ApiError(409, "INVALID_RUN_STATE", "只有运行中的任务可以暂停");
      run.status = "waiting_input"; addRunEvent(db, run, "run.waiting_input", {});
      audit(db, run.workspaceId, "user", owner.id, "run.paused", run.id, {});
      publish(run.workspaceId, "run.updated", { runId: run.id, status: run.status });
      return done(run);
    }
    if (s[2] === "resume" && method === "POST") {
      if (run.status !== "waiting_input") throw new ApiError(409, "INVALID_RUN_STATE", "只有已暂停的运行可以恢复");
      run.status = "running"; addRunEvent(db, run, "run.started", { resumed: true });
      publish(run.workspaceId, "run.updated", { runId: run.id, status: run.status });
      return done(run);
    }
    if (s[2] === "cancel" && method === "POST") {
      if (["succeeded", "failed", "cancelled", "timed_out"].includes(run.status)) throw new ApiError(409, "INVALID_RUN_STATE", "该运行已结束");
      run.status = "cancelled"; run.finishedAt = now(); addRunEvent(db, run, "run.cancelled", {});
      audit(db, run.workspaceId, "user", owner.id, "run.cancelled", run.id, {});
      publish(run.workspaceId, "run.updated", { runId: run.id, status: run.status });
      return done(run);
    }
    if (s[2] === "retry" && method === "POST") {
      const task = requireTask(db, run.taskId, owner.id);
      if (task.currentRound >= task.maxRounds) throw new ApiError(409, "ROUND_LIMIT_REACHED", "已达到最大轮数，无法重试");
      task.currentRound += 1;
      const fresh = createRun(db, task, run.agentId ?? null, task.currentRound);
      addRunEvent(db, fresh, "run.started", { retryOf: run.id });
      audit(db, run.workspaceId, "user", owner.id, "run.retried", fresh.id, { originalRunId: run.id });
      await persist();
      kickRun(fresh.id);
      return done(fresh, 201);
    }
  }

  // ---- agents ----
  if (s[0] === "agents" && s.length >= 2) {
    const agent = requireAgent(db, s[1], owner.id);
    if (s.length === 2) {
      if (method === "GET") return done({ ...agent, tasks: db.participants.filter((p) => p.agentId === agent.id).map((p) => p.taskId), runs: db.runs.filter((r) => r.agentId === agent.id).slice(-5) });
      if (method === "PATCH") {
        if (body.name !== undefined) agent.name = String(body.name).trim().slice(0, 60) || agent.name;
        if (body.role !== undefined) agent.role = ["researcher", "writer", "reviewer", "coder", "custom"].includes(body.role) ? body.role : agent.role;
        if (Array.isArray(body.capabilities)) agent.capabilities = body.capabilities.map((c: unknown) => String(c).slice(0, 40)).slice(0, 12);
        if (body.timeoutMs !== undefined) agent.timeoutMs = Math.min(300_000, Math.max(1_000, Number(body.timeoutMs) || agent.timeoutMs));
        if (body.maxConcurrency !== undefined) agent.maxConcurrency = Math.min(8, Math.max(1, Number(body.maxConcurrency) || 1));
        if (body.retryCount !== undefined) agent.retryCount = Math.min(5, Math.max(0, Number(body.retryCount) || 0));
        if (Array.isArray(body.allowedDomains)) agent.allowedDomains = body.allowedDomains.map((d: unknown) => String(d).slice(0, 120)).slice(0, 20);
        if (body.permissionPolicy && typeof body.permissionPolicy === "object") {
          const p = body.permissionPolicy as Record<string, unknown>;
          agent.permissionPolicy = {
            ...agent.permissionPolicy,
            ...(typeof p.readGoal === "boolean" ? { readGoal: p.readGoal } : {}),
            ...(["allow", "ask", "deny"].includes(p.readMaterials as string) ? { readMaterials: p.readMaterials as "allow" | "ask" | "deny" } : {}),
            ...(typeof p.sendMessages === "boolean" ? { sendMessages: p.sendMessages } : {}),
            ...(["allow", "ask", "deny"].includes(p.submitArtifact as string) ? { submitArtifact: p.submitArtifact as "allow" | "ask" | "deny" } : {}),
            ...(Array.isArray(p.tools) ? { tools: p.tools.map((t: unknown) => String(t).slice(0, 60)).slice(0, 20) } : {}),
            ...(Array.isArray(p.externalUrls) ? { externalUrls: p.externalUrls.map((u: unknown) => String(u).slice(0, 120)).slice(0, 20) } : {}),
            ...(typeof p.changeTaskStatus === "boolean" ? { changeTaskStatus: p.changeTaskStatus } : {}),
            ...(typeof p.completeTask === "boolean" ? { completeTask: p.completeTask } : {}),
            ...(typeof p.deleteArtifacts === "boolean" ? { deleteArtifacts: p.deleteArtifacts } : {}),
          };
        }
        if (agent.adapterType === "model_api") {
          if (body.modelId !== undefined) agent.modelId = String(body.modelId).trim().slice(0, 120);
          if (body.endpoint !== undefined) {
            const nextEndpoint = String(body.endpoint).trim().replace(/\/+$/, "");
            if (nextEndpoint === "local://mock-openai") agent.endpoint = nextEndpoint;
            else {
              assertSafeEndpoint(nextEndpoint);
              if (/\/batch/i.test(nextEndpoint)) {
                throw new ApiError(400, "BATCH_ENDPOINT_UNSUPPORTED", "批量推理地址不支持实时 chat/completions；请使用实时推理 Base URL");
              }
              agent.endpoint = nextEndpoint;
            }
          }
        }
        if (body.credential) {
          agent.credentialFingerprint = credentialFingerprint(String(body.credential));
          if (!agent.demo) db.credentials[agent.id] = encryptCredential(String(body.credential));
        }
        agent.updatedAt = now();
        audit(db, agent.workspaceId, "user", owner.id, "agent.updated", agent.id, {});
        return done(agent);
      }
      if (method === "DELETE") {
        db.agents = db.agents.filter((a) => a.id !== agent.id);
        delete db.credentials[agent.id];
        db.participants = db.participants.filter((p) => p.agentId !== agent.id);
        audit(db, agent.workspaceId, "user", owner.id, "agent.deleted", agent.id, {});
        publish(agent.workspaceId, "agent.status_changed", { agentId: agent.id, status: "offline" });
        return done({ ok: true });
      }
    }
    if (s[2] === "test" && method === "POST") {
      const isModel = agent.adapterType === "model_api";
      const isMock = isModel && agent.endpoint === "local://mock-openai";
      const secret = isModel ? (decryptCredential(db.credentials[agent.id] ?? "") || providerFallbackKey(agent.endpoint)) : null;
      const hasKey = Boolean(secret);
      let remote: { ok: boolean; detail: string; models?: string[] } | null = null;
      if (isModel && !isMock && hasKey && body.probe !== false) {
        try {
          const base = assertSafeEndpoint(agent.endpoint).toString().replace(/\/+$/, "");
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), Math.min(agent.timeoutMs, 20_000));
          try {
            const res = await fetch(`${base}/models`, {
              headers: { Authorization: `Bearer ${secret}`, "api-key": secret as string },
              redirect: "manual",
              signal: controller.signal,
            });
            if (res.status === 404) {
              remote = { ok: false, detail: "HTTP 404：该地址没有 /models 或 /chat/completions。批量推理地址不能用于实时对话，请改用实时推理 Base URL" };
            } else if (!res.ok) {
              remote = { ok: false, detail: `远端返回 HTTP ${res.status}，请检查密钥与模型权限` };
            } else {
              const json = await res.json() as { data?: Array<{ id: string }> };
              const models = (json.data ?? []).map((m) => m.id);
              const modelOk = models.length === 0 || models.includes(agent.modelId ?? "");
              remote = {
                ok: modelOk,
                models,
                detail: modelOk
                  ? `远端模型列表已验证${models.length ? `，共 ${models.length} 个模型` : ""}`
                  : `模型 ID「${agent.modelId}」不在远端列表中；可用：${models.slice(0, 8).join(", ") || "无"}`,
              };
            }
          } finally { clearTimeout(timer); }
        } catch (error) {
          remote = { ok: false, detail: `远端探测失败：${redact(String((error as Error).message ?? error)).slice(0, 160)}` };
        }
      }
      const checks = [
        { name: "端点与协议", ok: true, detail: agent.demo ? "本地模拟端点" : new URL(agent.endpoint).protocol },
        { name: isModel ? "模型 ID" : "认证", ok: isModel ? Boolean(agent.modelId) : (agent.authType === "none" || Boolean(agent.credentialFingerprint)), detail: isModel ? (agent.modelId ?? "未配置") : (agent.authType === "none" ? "无需认证" : "仅保存凭据指纹") },
        { name: isModel ? "请求构造" : "消息接收", ok: true, detail: isModel ? (isMock ? "本地模拟 chat/completions 可用" : "OpenAI 兼容格式已就绪") : (agent.demo ? "本地消息通道可用" : "回调端点已登记") },
        { name: isModel ? "密钥" : "产物提交", ok: isModel ? (isMock || hasKey) : agent.demo, detail: isModel ? (isMock ? "无密钥自测模式，未验证真实服务" : hasKey ? "已配置（密文保存）" : "缺少密钥；真实调用不会执行") : (agent.demo ? "演示提交可用" : "需实际运行后确认") },
        ...(remote ? [{ name: "远端探测", ok: remote.ok, detail: remote.detail }] : []),
      ];
      const pass = checks.every((c) => c.ok);
      agent.status = pass ? "online" : "untested";
      agent.lastHealthcheckAt = now();
      agent.lastSyncAt = pass ? now() : agent.lastSyncAt;
      agent.lastError = pass ? null : remote ? remote.detail : isModel ? "未配置模型密钥；本地自测可用，真实调用不会执行" : "外部 Agent 需在实际部署中完成远端握手";
      audit(db, agent.workspaceId, "user", owner.id, "agent.tested", agent.id, { pass, mock: isMock, remote: Boolean(remote?.ok) });
      publish(agent.workspaceId, "agent.status_changed", { agentId: agent.id, status: agent.status });
      return done({
        checks, pass, mock: isMock,
        remoteVerified: Boolean(remote?.ok),
        models: remote?.models,
        message: isMock ? "本地模拟自测通过；未调用真实模型服务" : remote ? remote.detail : undefined,
        agent,
      });
    }
    if (s[2] === "disable" && method === "POST") {
      agent.status = "disabled"; agent.updatedAt = now();
      audit(db, agent.workspaceId, "user", owner.id, "agent.disabled", agent.id, {});
      publish(agent.workspaceId, "agent.status_changed", { agentId: agent.id, status: "disabled" });
      return done(agent);
    }
  }

  // ---- artifacts ----
  if (s[0] === "artifacts" && s.length >= 2) {
    const artifact = requireArtifact(db, s[1], owner.id);
    const versions = db.artifactVersions.filter((v) => v.artifactId === artifact.id).sort((a, b) => a.version - b.version);
    if (s.length === 2 && method === "GET") return done({ ...artifact, versions, current: versions.find((v) => v.id === artifact.currentVersionId) ?? null });
    if (s[2] === "versions") {
      if (method === "GET") return done(versions);
      if (method === "POST") {
        if (["accepted", "archived"].includes(artifact.status) || artifact.finalVersionId) {
          throw new ApiError(409, "ARTIFACT_LOCKED", "该产物已验收或已指定最终版本，不能再追加新版本");
        }
        const content = String(body.content ?? "");
        if (!content.trim()) throw new ApiError(400, "EMPTY_CONTENT", "产物内容不能为空");
        const version: Artifact["currentVersionId"] = newId("ver");
        db.artifactVersions.push({
          id: version, artifactId: artifact.id, version: versions.length + 1, content,
          changeSummary: String(body.changeSummary ?? "更新内容"),
          createdByType: "human", createdById: owner.id, createdAt: now(),
        });
        artifact.currentVersionId = version; artifact.status = "review"; artifact.updatedAt = now();
        audit(db, artifact.workspaceId, "user", owner.id, "artifact.version_created", artifact.id, { version: versions.length + 1 });
        publish(artifact.workspaceId, "artifact.updated", { artifactId: artifact.id, version: versions.length + 1 });
        return done({ artifact, versionId: version, version: versions.length + 1 }, 201);
      }
    }
    if (s[2] === "diff" && method === "GET") {
      const from = versions.find((v) => v.id === query.get("from")) ?? versions[Math.max(0, versions.length - 2)];
      const to = versions.find((v) => v.id === query.get("to")) ?? versions[versions.length - 1];
      if (!from || !to) throw new ApiError(404, "NOT_FOUND", "版本不存在");
      return done({ from, to, lines: diffLines(from.content, to.content) });
    }
    if (s[2] === "accept" && method === "POST") {
      const versionId = String(body.versionId ?? artifact.currentVersionId);
      if (!versions.some((v) => v.id === versionId)) throw new ApiError(404, "NOT_FOUND", "版本不存在");
      artifact.currentVersionId = versionId; artifact.status = "accepted"; artifact.finalVersionId = versionId; artifact.updatedAt = now();
      audit(db, artifact.workspaceId, "user", owner.id, "artifact.accepted", artifact.id, { versionId });
      publish(artifact.workspaceId, "artifact.updated", { artifactId: artifact.id, status: artifact.status });
      return done(artifact);
    }
    if (s[2] === "request-changes" && method === "POST") {
      const note = String(body.note ?? "").trim();
      if (!note) throw new ApiError(400, "REQUIRED_FIELDS", "请填写修改要求");
      artifact.status = "changes"; artifact.updatedAt = now();
      const task = requireTask(db, artifact.taskId, owner.id);
      db.messages.push({
        id: newId("msg"), workspaceId: artifact.workspaceId, taskId: task.id, runId: null,
        senderType: "human", senderId: owner.id, type: "human",
        content: `【修改要求】《${artifact.name}》v${versions.length}：${note}`,
        mentions: [artifact.createdById], replyToId: null, pinned: false, createdAt: now(),
      });
      if (canTransitionTask(task.status, "executing")) {
        task.status = "executing"; task.updatedAt = now();
      }
      audit(db, artifact.workspaceId, "user", owner.id, "artifact.changes_requested", artifact.id, { note });
      notify(db, artifact.workspaceId, "artifact_review", "已退回修改", `《${artifact.name}》已附修改要求`, `/workspaces/${artifact.workspaceId}/artifacts/${artifact.id}`);
      publish(artifact.workspaceId, "artifact.updated", { artifactId: artifact.id, status: artifact.status });
      return done(artifact);
    }
    if (s[2] === "finalize" && method === "POST") {
      const versionId = String(body.versionId ?? artifact.currentVersionId);
      if (!versions.some((v) => v.id === versionId)) throw new ApiError(404, "NOT_FOUND", "版本不存在");
      artifact.finalVersionId = versionId; artifact.updatedAt = now();
      audit(db, artifact.workspaceId, "user", owner.id, "artifact.finalized", artifact.id, { versionId });
      return done(artifact);
    }
    if (s[2] === "archive" && method === "POST") {
      artifact.status = "archived"; artifact.updatedAt = now();
      audit(db, artifact.workspaceId, "user", owner.id, "artifact.archived", artifact.id, {});
      return done(artifact);
    }
  }

  // ---- materials ----
  if (s[0] === "materials" && s.length >= 2) {
    const material = db.materials.find((m) => m.id === s[1]);
    if (!material) throw new ApiError(404, "NOT_FOUND", "资料不存在");
    requireWs(db, material.workspaceId, owner.id);
    if (s.length === 2 && method === "GET") {
      return done({ ...material, references: {
        tasks: db.tasks.filter((t) => material.taskIds.includes(t.id)).map((t) => ({ id: t.id, title: t.title })),
        artifacts: db.artifacts.filter((a) => material.taskIds.includes(a.taskId)).map((a) => ({ id: a.id, name: a.name })),
      } });
    }
    if (s.length === 2 && method === "PATCH") {
      if (body.name) material.name = validateFileName(String(body.name));
      if (Array.isArray(body.taskIds)) {
        material.taskIds = body.taskIds.filter((id: unknown) => db.tasks.some((t) => t.id === id && t.workspaceId === material.workspaceId));
      }
      if (body.visibility && ["all", "restricted"].includes(body.visibility)) material.visibility = body.visibility;
      audit(db, material.workspaceId, "user", owner.id, "material.updated", material.id, {});
      return done(material);
    }
    if (s.length === 2 && method === "DELETE") {
      const refs = {
        tasks: db.tasks.filter((t) => material.taskIds.includes(t.id)).map((t) => t.title),
        artifacts: db.artifacts.filter((a) => material.taskIds.includes(a.taskId)).map((a) => a.name),
      };
      if (!body.force && (refs.tasks.length || refs.artifacts.length)) throw new ApiError(409, "MATERIAL_REFERENCED", "该资料仍被引用", refs);
      db.materials = db.materials.filter((m) => m.id !== material.id);
      audit(db, material.workspaceId, "user", owner.id, "material.deleted", material.id, { refs });
      return done({ ok: true });
    }
  }

  // ---- approvals ----
  if (s[0] === "approvals") {
    if (s.length === 1 && method === "GET") {
      let list = db.approvals.filter((a) => {
        const qWs = query.get("workspaceId");
        return (!qWs || qWs === a.workspaceId) && requireWsSafe(db, a.workspaceId, owner.id);
      });
      const status = query.get("status");
      if (status && status !== "all") list = list.filter((a) => a.status === status);
      const nowTs = Date.now();
      let changed = false;
      db.approvals.forEach((a) => {
        if (a.status === "pending" && new Date(a.expiresAt).getTime() < nowTs) { a.status = "expired"; changed = true; }
      });
      if (changed) await persist();
      return done(list.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    }
    if (s.length >= 2) {
      const approval = db.approvals.find((a) => a.id === s[1]);
      if (!approval) throw new ApiError(404, "NOT_FOUND", "审批不存在");
      requireWs(db, approval.workspaceId, owner.id);
      if (s.length === 2 && method === "GET") return done(approval);
      if (s[2] === "decision" && method === "POST") {
        if (approval.status !== "pending") throw new ApiError(409, "APPROVAL_CLOSED", "该审批已处理或过期");
        if (new Date(approval.expiresAt).getTime() < Date.now()) {
          approval.status = "expired";
          await persist();
          return done({ error: { code: "APPROVAL_EXPIRED", message: "审批已过期，操作不得继续", details: {}, request_id: "" } }, 409);
        }
        const decision = String(body.decision ?? "");
        if (!["approved", "rejected"].includes(decision)) throw new ApiError(400, "INVALID_DECISION", "决策无效");
        approval.status = decision as Approval["status"];
        approval.decidedBy = owner.id; approval.decidedAt = now(); approval.decisionNote = String(body.note ?? "").slice(0, 500);
        audit(db, approval.workspaceId, "user", owner.id, `approval.${decision}`, approval.id, { type: approval.type });

        if (approval.type === "agent_join" && decision === "approved" && approval.taskId && approval.agentId) {
          const task = requireTask(db, approval.taskId, owner.id);
          const closed = ["cancelled", "archived"].includes(task.status);
          if (!closed && !db.participants.some((p) => p.taskId === task.id && p.agentId === approval.agentId)) {
            db.participants.push({ taskId: task.id, agentId: approval.agentId!, role: "member", permissions: defaultPermissions(), joinedAt: now() });
            db.messages.push({
              id: newId("msg"), workspaceId: task.workspaceId, taskId: task.id, runId: null,
              senderType: "system", senderId: "system", type: "system",
              content: `${db.agents.find((a) => a.id === approval.agentId)?.name ?? "Agent"} 加入了任务`,
              mentions: [], replyToId: null, pinned: false, createdAt: now(),
            });
          }
        }
        if (approval.runId) {
          const run = db.runs.find((r) => r.id === approval.runId);
          if (run && run.status === "waiting_approval") {
            if (decision === "approved") {
              run.status = "running"; addRunEvent(db, run, "approval.resolved", { approved: true });
              if (approval.type === "artifact_submit") {
                const art = approval.taskId ? db.artifacts.find((a) => a.taskId === approval.taskId) : null;
                if (art) {
                  art.status = "review"; art.updatedAt = now();
                  const task = db.tasks.find((t) => t.id === art.taskId);
                  if (task && canTransitionTask(task.status, "review")) {
                    task.status = "review"; task.updatedAt = now();
                    publish(task.workspaceId, "task.updated", { taskId: task.id, status: "review" });
                  }
                  notify(db, art.workspaceId, "artifact_review", "新产物待验收", `《${art.name}》等待你预览`, `/workspaces/${art.workspaceId}/artifacts/${art.id}`);
                }
              }
              if (approval.type === "tool_call" && approval.taskId) {
                const task = db.tasks.find((t) => t.id === approval.taskId);
                if (task) {
                  db.messages.push({
                    id: newId("msg"), workspaceId: task.workspaceId, taskId: task.id, runId: run.id,
                    senderType: "agent", senderId: approval.agentId ?? "agent", agentId: approval.agentId,
                    type: "tool", content: "工具调用完成：已核对该节引用的来源标注。",
                    mentions: [], replyToId: null, pinned: false,
                    toolCall: { name: "web_verify", argsSummary: "校验 2 个来源", resultSummary: "2 项已标注", durationMs: 640, status: "succeeded" },
                    createdAt: now(),
                  });
                  publish(task.workspaceId, "message.created", { taskId: task.id, runId: run.id });
                }
              }
              run.status = "succeeded"; run.finishedAt = now(); addRunEvent(db, run, "run.succeeded", { afterApproval: true });
              kickAfterApproval(run.id);
            } else {
              run.status = "failed"; run.errorCode = "APPROVAL_REJECTED"; run.finishedAt = now();
              addRunEvent(db, run, "run.failed", { approvalId: approval.id });
              if (approval.taskId && approval.agentId) {
                const task = db.tasks.find((t) => t.id === approval.taskId);
                if (task) {
                  db.messages.push({
                    id: newId("msg"), workspaceId: task.workspaceId, taskId: task.id, runId: run.id,
                    senderType: "system", senderId: "system", type: "error",
                    content: `审批被拒绝，操作未执行：${approval.requestSummary}`,
                    mentions: [], replyToId: null, pinned: false, errorCode: "APPROVAL_REJECTED", createdAt: now(),
                  });
                }
              }
            }
            const resolvedAgent = db.agents.find((a) => a.id === (run.agentId ?? approval.agentId));
            if (resolvedAgent) {
              resolvedAgent.status = "online";
              resolvedAgent.lastSyncAt = now();
              publish(run.workspaceId, "agent.status_changed", { agentId: resolvedAgent.id, status: "online" });
            }
            publish(run.workspaceId, "run.updated", { runId: run.id, status: run.status });
          }
        }
        const approvalAgent = db.agents.find((a) => a.id === approval.agentId);
        if (approvalAgent && approvalAgent.status === "busy" && !approval.runId) {
          approvalAgent.status = "online";
          publish(approval.workspaceId, "agent.status_changed", { agentId: approvalAgent.id, status: "online" });
        }
        publish(approval.workspaceId, "approval.resolved", { approvalId: approval.id, decision });
        return done(approval);
      }
      if (s[2] === "revoke" && method === "POST") {
        if (approval.status !== "approved") throw new ApiError(409, "APPROVAL_NOT_APPROVED", "只有已批准记录可以撤销");
        approval.status = "revoked";
        audit(db, approval.workspaceId, "user", owner.id, "approval.revoked", approval.id, {});
        publish(approval.workspaceId, "approval.resolved", { approvalId: approval.id, decision: "revoked" });
        return done(approval);
      }
    }
  }

  // ---- notifications / audit / export ----
  if (s[0] === "notifications" && method === "GET") {
    const wsId = query.get("workspaceId");
    if (!wsId) throw new ApiError(400, "REQUIRED", "缺少 workspaceId");
    requireWs(db, wsId, owner.id);
    return done(db.notifications.filter((n) => n.workspaceId === wsId && n.userId === owner.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  }
  if (s[0] === "notifications" && s[2] === "read" && method === "POST") {
    const n = db.notifications.find((x) => x.id === s[1]);
    if (n && n.userId === owner.id) n.readAt = now();
    return done(n ?? { ok: true });
  }
  if (s[0] === "notifications" && s[1] === "read-all" && method === "POST") {
    db.notifications.filter((n) => n.userId === owner.id && !n.readAt).forEach((n) => { n.readAt = now(); });
    return done({ ok: true });
  }
  if (s[0] === "audit" && method === "GET") {
    const wsId = query.get("workspaceId");
    if (!wsId) throw new ApiError(400, "REQUIRED", "缺少 workspaceId");
    requireWs(db, wsId, owner.id);
    const q = query.get("q")?.toLowerCase();
    let list = db.auditLogs.filter((a) => a.workspaceId === wsId);
    if (q) list = list.filter((a) => `${a.action} ${a.targetRef}`.toLowerCase().includes(q));
    return done(list.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 500));
  }
  if (s[0] === "export" && method === "GET") {
    const wsId = query.get("workspaceId");
    if (!wsId) throw new ApiError(400, "REQUIRED", "缺少 workspaceId");
    requireWs(db, wsId, owner.id);
    const type = query.get("type") ?? "task";
    let payload: unknown;
    if (type === "task") {
      const taskId = query.get("taskId");
      payload = {
        task: db.tasks.filter((t) => t.workspaceId === wsId && (!taskId || t.id === taskId)),
        messages: db.messages.filter((m) => m.workspaceId === wsId && (!taskId || m.taskId === taskId)),
        runs: db.runs.filter((r) => r.workspaceId === wsId && (!taskId || r.taskId === taskId)),
        artifacts: db.artifacts.filter((a) => a.workspaceId === wsId && (!taskId || a.taskId === taskId)),
      };
    } else {
      payload = type === "artifacts"
        ? db.artifacts.filter((a) => a.workspaceId === wsId).map((a) => ({ ...a, versions: db.artifactVersions.filter((v) => v.artifactId === a.id) }))
        : db.runs.filter((r) => r.workspaceId === wsId).map((r) => ({ ...r, events: db.runEvents.filter((e) => e.runId === r.id) }));
    }
    audit(db, wsId, "user", owner.id, "data.exported", wsId, { type });
    await persist();
    return done({ exportedAt: now(), workspaceId: wsId, type, payload });
  }

  // ---- webhook: HTTP callback agent ----
  if (s[0] === "webhooks" && s[1] === "agents" && s[3] === "runs" && method === "POST") {
    return handleWebhook(db, s[2], s[4], ctx) as unknown as Promise<ApiResult>;
  }

  // ---- P1 placeholders (honest, not faked) ----
  if ((s[0] === "workspaces" && (s[2] === "members" || s[2] === "security"))) {
    return done({ p1: true, message: "该功能在 P1 里程碑实现，当前版本未开放。" }, 501);
  }

  throw new ApiError(404, "ROUTE_NOT_FOUND", `未实现的接口：${ctx.method} /${s.join("/")}`);
}

function requireWsSafe(db: Database, wsId: string, ownerId: string): boolean {
  return db.workspaces.some((w) => w.id === wsId && w.ownerId === ownerId);
}

function kickAfterApproval(runId: string): void {
  // publish only; orchestration for approved runs is finalized by the decision handler
  void runId;
}

async function handleWebhook(db: Database, agentId: string, runId: string, ctx: Ctx): Promise<ApiResult> {
  const agent = db.agents.find((a) => a.id === agentId);
  if (!agent) throw new ApiError(404, "AGENT_NOT_FOUND", "Agent 不存在");
  if (agent.adapterType !== "http_callback") throw new ApiError(403, "WRONG_ADAPTER", "只有 HTTP 回调 Agent 支持此接口");
  if (agent.status === "disabled") throw new ApiError(403, "AGENT_DISABLED", "Agent 已停用");
  // Webhook is agent-authenticated (HMAC), not session-authenticated. The agent's own
  // workspace is the trust boundary; verify the run belongs to that same workspace.
  const run = db.runs.find((r) => r.id === runId && r.agentId === agentId);
  if (!run) throw new ApiError(404, "RUN_NOT_FOUND", "Run 不属于该 Agent");
  if (run.workspaceId !== agent.workspaceId) throw new ApiError(403, "WORKSPACE_MISMATCH", "Agent 与 Run 不属于同一工作区");
  // The webhook is agent-authenticated; scope task lookups to that workspace's owner.
  const webhookOwnerId = db.workspaces.find((w) => w.id === agent.workspaceId)?.ownerId ?? "";
  const signature = ctx.headers.get("x-agent-signature") ?? "";
  const timestamp = ctx.headers.get("x-agent-timestamp") ?? "";
  if (!signature || !timestamp) throw new ApiError(401, "SIGNATURE_MISSING", "缺少回调签名");
  if (Math.abs(Date.now() - Number(timestamp)) > 5 * 60_000) throw new ApiError(401, "TIMESTAMP_EXPIRED", "回调时间戳已过期");
  // Demo-mode shared secret is derived from the server secret; no credential is logged.
  const crypto = await import("node:crypto");
  const secret = process.env.CREDENTIAL_SECRET;
  if (!secret) {
    throw new ApiError(503, "SECRET_NOT_CONFIGURED", "必须配置 CREDENTIAL_SECRET 才能接收回调签名");
  }
  const signingSecret = secret;
  const expected = crypto.createHmac("sha256", signingSecret).update(`${timestamp}.${JSON.stringify(ctx.body)}`).digest("hex");
  if (expected !== signature) throw new ApiError(401, "INVALID_SIGNATURE", "回调签名校验失败");

  const eventId = String(ctx.body.event_id ?? "");
  const sequence = Number(ctx.body.sequence ?? 0);
  if (!eventId) throw new ApiError(400, "EVENT_ID_REQUIRED", "缺少 event_id");
  if (db.runEvents.some((e) => e.runId === runId && e.payload?.eventId === eventId)) return done({ ok: true, duplicate: true });
  // Agent sequence is its own stream; platform run events have a separate sequence.
  const agentSequences = db.runEvents
    .filter((e) => e.runId === runId && typeof e.payload?.agentSequence === "number")
    .map((e) => e.payload.agentSequence as number);
  const last = agentSequences.length ? Math.max(...agentSequences) : 0;
  if (sequence && sequence <= last) return done({ ok: true, out_of_order: true });

  const type = String(ctx.body.type ?? "message.completed");
  const data = (ctx.body.data ?? {}) as Record<string, unknown>;
  addRunEvent(db, run, type, { ...data, eventId, sequence, agentSequence: sequence });
  if (type === "message.completed" && data.content) {
    const task = requireTask(db, run.taskId, webhookOwnerId);
    db.messages.push({
      id: newId("msg"), workspaceId: run.workspaceId, taskId: task.id, runId: run.id,
      senderType: "agent", senderId: agent.id, agentId: agent.id, type: "agent",
      content: String(data.content), mentions: [], replyToId: null, pinned: false, createdAt: now(),
    });
    publish(run.workspaceId, "message.created", { taskId: task.id, runId: run.id });
  }
  if (type === "artifact.submitted" && data.name && data.content) {
    const task = requireTask(db, run.taskId, webhookOwnerId);
    const artifactId = newId("art");
    const versionId = newId("ver");
    db.artifacts.push({
      id: artifactId, workspaceId: run.workspaceId, taskId: task.id, name: String(data.name),
      type: "markdown", status: "review", currentVersionId: versionId, finalVersionId: null,
      createdByType: "agent", createdById: agent.id, createdAt: now(), updatedAt: now(),
    });
    db.artifactVersions.push({
      id: versionId, artifactId, version: 1, content: String(data.content),
      changeSummary: "HTTP 回调提交", createdByType: "agent", createdById: agent.id, createdAt: now(),
    });
    if (canTransitionTask(task.status, "review")) { task.status = "review"; task.updatedAt = now(); }
    publish(run.workspaceId, "artifact.submitted", { taskId: task.id, artifactId });
  }
  if (type === "run.failed") {
    run.status = "failed"; run.errorCode = String(data.code ?? "REMOTE_ERROR"); run.finishedAt = now();
  }
  agent.lastSyncAt = now();
  if (["message.completed", "artifact.submitted"].includes(type) && !["cancelled", "failed", "timed_out"].includes(run.status)) {
    run.status = "succeeded";
  }
  if (run.status === "succeeded") run.finishedAt = now();
  publish(run.workspaceId, "run.updated", { runId: run.id, status: run.status });
  audit(db, run.workspaceId, "agent", agent.id, "webhook.received", run.id, { type, eventId });
  return done({ ok: true, eventId, sequence });
}

export async function finalizeRequest(method: string, result: ApiResult): Promise<ApiResult> {
  if (method !== "GET") await persist();
  return result;
}
