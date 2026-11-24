import type { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { latestSeq, replay, subscribe, type WorkspaceEvent } from "@/lib/events";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<Response> {
  const workspaceId = req.nextUrl.searchParams.get("workspaceId");
  if (!workspaceId) {
    return Response.json({ error: { code: "REQUIRED", message: "缺少 workspaceId", details: {}, request_id: "" } }, { status: 400 });
  }
  const db = await getDb();
  const workspace = db.workspaces.find((w) => w.id === workspaceId);
  if (!workspace || workspace.ownerId !== "u_owner") {
    return Response.json({ error: { code: "FORBIDDEN", message: "无权订阅该工作区", details: {}, request_id: "" } }, { status: 403 });
  }
  // Last-Event-ID is the browser's reconnect cursor. Only replay after a real
  // disconnect. A fresh page mount (navigating to another route) must NOT replay
  // old message.delta events or the composer renders the same message twice.
  const headerId = req.headers.get("last-event-id");
  const mode = req.nextUrl.searchParams.get("mode");
  const raw = headerId ?? req.nextUrl.searchParams.get("since");
  const since = mode === "live" && !headerId
    ? latestSeq(workspaceId)
    : raw && /^\d+$/.test(raw) ? Number(raw) : 0;
  const shouldReplay = headerId !== null || (raw !== null && mode !== "live");
  const encoder = new TextEncoder();
  let unsubscribe = () => {};
  let keepAlive: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: WorkspaceEvent) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`),
          );
        } catch {
          closed = true;
        }
      };
      controller.enqueue(encoder.encode("retry: 3000\n\n"));
      // Never replay streaming deltas: they are incremental text fragments, so
      // replaying them double-appends. The final message.created carries the
      // complete text and triggers a full list reload.
      if (shouldReplay) replay(workspaceId, since).filter((e) => e.type !== "message.delta").forEach(send);
      unsubscribe = subscribe(workspaceId, send);
      keepAlive = setInterval(() => {
        if (!closed) {
          try {
            controller.enqueue(encoder.encode(": ping\n\n"));
          } catch {
            closed = true;
          }
        }
      }, 15_000);
      const close = () => {
        if (closed) return;
        closed = true;
        if (keepAlive) clearInterval(keepAlive);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      req.signal.addEventListener("abort", close);
    },
    cancel() {
      closed = true;
      if (keepAlive) clearInterval(keepAlive);
      unsubscribe();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
