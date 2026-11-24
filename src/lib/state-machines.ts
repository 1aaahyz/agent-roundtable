import { ApiError, type RunStatus, type TaskStatus } from "./types";

export const TASK_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  draft: ["discussing", "cancelled"],
  discussing: ["executing", "blocked", "cancelled"],
  executing: ["review", "blocked", "cancelled"],
  review: ["executing", "done", "blocked", "cancelled"],
  blocked: ["discussing", "executing", "cancelled"],
  done: ["archived"],
  cancelled: ["archived"],
  archived: ["discussing"],
};

export const RUN_TRANSITIONS: Record<RunStatus, RunStatus[]> = {
  queued: ["running", "cancelled"],
  running: ["waiting_input", "waiting_approval", "succeeded", "failed", "cancelled", "timed_out"],
  waiting_input: ["running", "cancelled", "timed_out"],
  waiting_approval: ["running", "failed", "cancelled", "timed_out"],
  succeeded: [],
  failed: [],
  cancelled: [],
  timed_out: [],
};

export function canTransitionTask(from: TaskStatus, to: TaskStatus): boolean {
  return TASK_TRANSITIONS[from]?.includes(to) ?? false;
}

export function canTransitionRun(from: RunStatus, to: RunStatus): boolean {
  return RUN_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTaskTransition(from: TaskStatus, to: TaskStatus): void {
  if (!canTransitionTask(from, to)) {
    throw new ApiError(409, "INVALID_TASK_TRANSITION", `任务状态不能从「${from}」变为「${to}」`);
  }
}

export function assertRunTransition(from: RunStatus, to: RunStatus): void {
  if (!canTransitionRun(from, to)) {
    throw new ApiError(409, "INVALID_RUN_TRANSITION", `Run 状态不能从「${from}」变为「${to}」`);
  }
}

export const ACTIVE_TASK_STATUSES: TaskStatus[] = ["discussing", "executing", "review", "blocked"];
