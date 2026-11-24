import { newId } from "./utils";

export interface WorkspaceEvent {
  id: string;
  seq: number;
  workspaceId: string;
  type: string;
  data: Record<string, unknown>;
  createdAt: string;
}

type Listener = (event: WorkspaceEvent) => void;

const listeners = new Map<string, Set<Listener>>();
const history = new Map<string, WorkspaceEvent[]>();
const seqByWorkspace = new Map<string, number>();
const MAX_HISTORY = 300;

export function publish(workspaceId: string, type: string, data: Record<string, unknown> = {}): WorkspaceEvent {
  const seq = (seqByWorkspace.get(workspaceId) ?? 0) + 1;
  seqByWorkspace.set(workspaceId, seq);
  const event: WorkspaceEvent = {
    id: newId("evt"),
    seq,
    workspaceId,
    type,
    data,
    createdAt: new Date().toISOString(),
  };
  const list = history.get(workspaceId) ?? [];
  list.push(event);
  if (list.length > MAX_HISTORY) list.splice(0, list.length - MAX_HISTORY);
  history.set(workspaceId, list);
  listeners.get(workspaceId)?.forEach((fn) => {
    try {
      fn(event);
    } catch {
      // a broken client must not break the publisher
    }
  });
  return event;
}

export function subscribe(workspaceId: string, listener: Listener): () => void {
  const set = listeners.get(workspaceId) ?? new Set<Listener>();
  set.add(listener);
  listeners.set(workspaceId, set);
  return () => set.delete(listener);
}

/** Replay events after Last-Event-ID for SSE reconnects. */
export function replay(workspaceId: string, lastSeq: number): WorkspaceEvent[] {
  return (history.get(workspaceId) ?? []).filter((e) => e.seq > lastSeq);
}

export function latestSeq(workspaceId: string): number {
  return seqByWorkspace.get(workspaceId) ?? 0;
}
