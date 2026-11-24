export type ID = string;
export type ISODate = string;

export interface User {
  id: ID;
  email: string;
  name: string;
  avatarColor: string;
  /** scrypt$N$r$salt$hash — never returned by any API. */
  passwordHash: string;
  createdAt: ISODate;
}

export interface Session {
  /** sha256 of the raw token; the raw token only ever lives in the httpOnly cookie. */
  tokenHash: ID;
  userId: ID;
  createdAt: ISODate;
  expiresAt: ISODate;
  lastSeenAt: ISODate;
}

export interface Workspace {
  id: ID;
  name: string;
  ownerId: ID;
  timezone: string;
  createdAt: ISODate;
  updatedAt: ISODate;
  pendingDeleteAt?: ISODate | null;
}

export type TaskStatus =
  | "draft"
  | "discussing"
  | "executing"
  | "review"
  | "done"
  | "blocked"
  | "cancelled"
  | "archived";

export type HostMode = "user" | "agent";

export interface Task {
  id: ID;
  workspaceId: ID;
  title: string;
  goal: string;
  constraints: string[];
  acceptanceCriteria: string[];
  status: TaskStatus;
  currentRound: number;
  maxRounds: number;
  hostMode: HostMode;
  hostAgentId?: ID | null;
  createdBy: ID;
  createdAt: ISODate;
  updatedAt: ISODate;
  archivedAt?: ISODate | null;
  blockReason?: string | null;
}

export type PermissionChoice = "allow" | "ask" | "deny";

export interface AgentPermissions {
  readGoal: boolean;
  readMaterials: PermissionChoice;
  sendMessages: boolean;
  submitArtifact: PermissionChoice;
  tools: string[];
  externalUrls: string[];
  changeTaskStatus: boolean;
  completeTask: boolean;
  deleteArtifacts: boolean;
}

export type AdapterType = "demo" | "model_api" | "a2a" | "http_callback";
export type AgentStatus = "untested" | "online" | "busy" | "offline" | "error" | "disabled";
export type DemoRole = "researcher" | "writer" | "reviewer" | "coder" | "custom";

export interface AgentConnection {
  id: ID;
  workspaceId: ID;
  name: string;
  role: DemoRole;
  adapterType: AdapterType;
  endpoint: string;
  /** For model_api: model ID or inference endpoint ID, e.g. doubao-seed-1-6-251015 */
  modelId?: string | null;
  authType: "none" | "api_key" | "bearer";
  credentialRef?: string | null;
  credentialFingerprint?: string | null;
  capabilities: string[];
  permissionPolicy: AgentPermissions;
  timeoutMs: number;
  maxConcurrency: number;
  retryCount: number;
  allowedDomains: string[];
  status: AgentStatus;
  lastHealthcheckAt?: ISODate | null;
  lastSyncAt?: ISODate | null;
  lastError?: string | null;
  demo: boolean;
  color?: string;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export interface TaskParticipant {
  taskId: ID;
  agentId: ID;
  role: "host" | "member";
  permissions: AgentPermissions;
  joinedAt: ISODate;
}

export type MessageType =
  | "human"
  | "agent"
  | "system"
  | "tool"
  | "approval"
  | "artifact"
  | "error";

export interface ToolCallInfo {
  name: string;
  argsSummary: string;
  resultSummary?: string;
  durationMs?: number;
  status: "requested" | "running" | "succeeded" | "failed" | "denied";
}

export interface Message {
  id: ID;
  workspaceId: ID;
  taskId: ID;
  runId?: ID | null;
  senderType: "human" | "agent" | "system";
  senderId: ID;
  agentId?: ID | null;
  type: MessageType;
  content: string;
  mentions: ID[];
  replyToId?: ID | null;
  pinned: boolean;
  toolCall?: ToolCallInfo | null;
  artifactId?: ID | null;
  errorCode?: string | null;
  createdAt: ISODate;
}

export type RunStatus =
  | "queued"
  | "running"
  | "waiting_input"
  | "waiting_approval"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "timed_out";

export interface Run {
  id: ID;
  workspaceId: ID;
  taskId: ID;
  agentId?: ID | null;
  status: RunStatus;
  triggerType: "user" | "agent" | "system";
  contextSnapshotId: ID;
  round: number;
  startedAt?: ISODate | null;
  finishedAt?: ISODate | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  createdAt: ISODate;
}

export interface RunEvent {
  id: ID;
  runId: ID;
  sequence: number;
  type: string;
  payload: Record<string, unknown>;
  createdAt: ISODate;
}

export interface ContextSnapshot {
  id: ID;
  runId: ID;
  taskId: ID;
  data: Record<string, unknown>;
  createdAt: ISODate;
}

export type ArtifactType = "markdown" | "text" | "code" | "link" | "json" | "file";
export type ArtifactStatus = "draft" | "review" | "accepted" | "changes" | "archived";

export interface Artifact {
  id: ID;
  workspaceId: ID;
  taskId: ID;
  name: string;
  type: ArtifactType;
  status: ArtifactStatus;
  currentVersionId: ID;
  finalVersionId?: ID | null;
  createdByType: "human" | "agent";
  createdById: ID;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export interface ArtifactVersion {
  id: ID;
  artifactId: ID;
  version: number;
  content: string;
  changeSummary: string;
  createdByType: "human" | "agent";
  createdById: ID;
  createdAt: ISODate;
}

export type MaterialType = "file" | "url" | "text";

export interface Material {
  id: ID;
  workspaceId: ID;
  name: string;
  type: MaterialType;
  content?: string | null;
  url?: string | null;
  mime?: string | null;
  size?: number | null;
  visibility: "all" | "restricted";
  taskIds: ID[];
  createdBy: ID;
  createdAt: ISODate;
}

export type ApprovalType =
  | "agent_join"
  | "material_read"
  | "tool_call"
  | "external_url"
  | "artifact_submit"
  | "task_complete"
  | "permission_expand";

export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired" | "revoked";

export interface Approval {
  id: ID;
  workspaceId: ID;
  taskId?: ID | null;
  runId?: ID | null;
  agentId?: ID | null;
  type: ApprovalType;
  requestSummary: string;
  riskLevel: "low" | "medium" | "high";
  permissions: string[];
  status: ApprovalStatus;
  expiresAt: ISODate;
  decidedBy?: ID | null;
  decidedAt?: ISODate | null;
  decisionNote?: string | null;
  createdAt: ISODate;
}

export interface Notification {
  id: ID;
  workspaceId: ID;
  userId: ID;
  type: string;
  title: string;
  body: string;
  targetRef: string;
  readAt?: ISODate | null;
  createdAt: ISODate;
}

export interface AuditLog {
  id: ID;
  workspaceId: ID;
  actorType: "user" | "agent" | "system";
  actorId: ID;
  action: string;
  targetRef: string;
  metadata: Record<string, unknown>;
  createdAt: ISODate;
}

export interface WorkspaceSettings {
  workspace: { timezone: string; taskTemplate: string };
  discussion: {
    hostMode: HostMode;
    maxRounds: number;
    roundTimeoutSec: number;
    responseTimeoutSec: number;
    allowCrossRefs: boolean;
    recentMessages: number;
  };
  approval: { artifactFirst: boolean; toolWrite: boolean; completion: boolean };
  security: { allowPrivateNetwork: boolean; logRetentionDays: number };
  appearance: { theme: "light" | "dark"; density: "compact" | "comfortable" };
  notifications: Record<string, boolean>;
}

export interface Database {
  users: User[];
  sessions: Session[];
  workspaces: Workspace[];
  tasks: Task[];
  participants: TaskParticipant[];
  agents: AgentConnection[];
  /** agentId -> AES-GCM ciphertext of the credential. Never returned by any API. */
  credentials: Record<ID, string>;
  messages: Message[];
  runs: Run[];
  runEvents: RunEvent[];
  contextSnapshots: ContextSnapshot[];
  artifacts: Artifact[];
  artifactVersions: ArtifactVersion[];
  materials: Material[];
  approvals: Approval[];
  notifications: Notification[];
  auditLogs: AuditLog[];
  settings: Record<ID, WorkspaceSettings>;
  seq: number;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
}
