import { NextResponse, type NextRequest } from "next/server";
import { redact } from "@/lib/security";
import { finalizeRequest, dispatch } from "@/lib/service";
import { ApiError } from "@/lib/types";
import { newId } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Fail fast if the credential encryption secret is missing, before any request is served.
if (!process.env.CREDENTIAL_SECRET) {
  console.warn("[agent-workspace] 警告：未设置 CREDENTIAL_SECRET，保存模型密钥与接收回调都会被拒绝。");
}

async function handler(req: NextRequest, ctx: { params: Promise<{ path?: string[] }> }): Promise<NextResponse> {
  const requestId = newId("req");
  const { path = [] } = await ctx.params;
  try {
    let body: Record<string, unknown> = {};
    if (!["GET", "HEAD"].includes(req.method)) {
      const raw = await req.text();
      if (raw) {
        try {
          body = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          throw new ApiError(400, "INVALID_JSON", "请求体不是合法 JSON");
        }
      }
    }
    const result = await dispatch({
      method: req.method,
      segments: path,
      body,
      query: req.nextUrl.searchParams,
      headers: req.headers,
    });
    const final = await finalizeRequest(req.method, result);
    const headers: Record<string, string> = { "X-Request-ID": requestId, "Cache-Control": "no-store" };
    if (final.cookie) headers["Set-Cookie"] = final.cookie;
    return NextResponse.json(final.data, { status: final.status, headers });
  } catch (error) {
    const apiError = error instanceof ApiError
      ? error
      : new ApiError(500, "INTERNAL_ERROR", "服务暂时不可用，已有数据未受影响");
    if (!(error instanceof ApiError)) {
      console.error(`[${requestId}]`, redact(error instanceof Error ? error.stack ?? error.message : String(error)));
    }
    return NextResponse.json(
      {
        error: {
          code: apiError.code,
          message: apiError.message,
          details: apiError.details,
          request_id: requestId,
        },
      },
      { status: apiError.status, headers: { "X-Request-ID": requestId, "Cache-Control": "no-store" } },
    );
  }
}

export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const DELETE = handler;
export const PUT = handler;
