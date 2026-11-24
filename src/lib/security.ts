import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { ApiError } from "./types";

const PRIVATE_V4 = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^0\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
];

/** Blocks SSRF targets: metadata, loopback, private, link-local, non-HTTPS. */
export function assertSafeEndpoint(raw: string, opts?: { allowHttp?: boolean; allowPrivate?: boolean }): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ApiError(400, "INVALID_URL", "服务地址不是合法 URL");
  }
  const allowHttp = Boolean(opts?.allowHttp && process.env.ALLOW_HTTP_AGENTS === "true" && process.env.NODE_ENV !== "production");
  if (url.protocol !== "https:" && !(allowHttp && url.protocol === "http:")) {
    throw new ApiError(400, "INSECURE_SCHEME", "只允许 HTTPS 端点；本地开发需显式开启 HTTP");
  }
  if (url.username || url.password) {
    throw new ApiError(400, "URL_CREDENTIALS_FORBIDDEN", "URL 中不允许包含凭据");
  }
  const allowPrivate = Boolean(opts?.allowPrivate || process.env.ALLOW_PRIVATE_NETWORK === "true");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!allowPrivate) {
    if (host === "localhost" || host.endsWith(".localhost") || host === "::1" || host === "[::1]") {
      throw new ApiError(400, "PRIVATE_ADDRESS_BLOCKED", "禁止访问回环地址");
    }
    if (host === "metadata.google.internal" || host === "metadata" || host === "169.254.169.254") {
      throw new ApiError(400, "METADATA_BLOCKED", "禁止访问云元数据地址");
    }
    if (PRIVATE_V4.some((re) => re.test(host))) {
      throw new ApiError(400, "PRIVATE_ADDRESS_BLOCKED", "禁止访问私网地址");
    }
    if (host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80")) {
      throw new ApiError(400, "PRIVATE_ADDRESS_BLOCKED", "禁止访问 IPv6 私网地址");
    }
  }
  return url;
}

/** Never store or return a full credential; show only a fingerprint. */
export function credentialFingerprint(value: string): string {
  const tail = value.slice(-4).replace(/[^A-Za-z0-9]/g, "");
  const head = value.slice(0, 3).replace(/[^A-Za-z0-9-]/g, "");
  return `${head || "key"}…${tail || "****"}`;
}

function credentialKey(): Buffer {
  const secret = process.env.CREDENTIAL_SECRET;
  if (!secret) {
    // Never encrypt with a well-known constant. Refuse instead of silently degrading.
    if (process.env.NODE_ENV === "production") {
      throw new ApiError(503, "SECRET_NOT_CONFIGURED", "生产环境必须设置 CREDENTIAL_SECRET，否则无法安全保存凭据");
    }
    throw new ApiError(
      503, "SECRET_NOT_CONFIGURED",
      "请设置环境变量 CREDENTIAL_SECRET 后再保存模型密钥（本地可执行 $env:CREDENTIAL_SECRET=\"<随机串>\")",
    );
  }
  return createHash("sha256").update(secret).digest();
}

/** AES-256-GCM. Ciphertext is stored separately from the agent and never returned by the API. */
export function encryptCredential(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", credentialKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((b) => b.toString("base64")).join(".");
}

export function decryptCredential(payload: string): string | null {
  try {
    const [ivB64, tagB64, dataB64] = payload.split(".");
    if (!ivB64 || !tagB64 || !dataB64) return null;
    const decipher = createDecipheriv("aes-256-gcm", credentialKey(), Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export function redact(text: string): string {
  return text
    .replace(/Authorization:\s*Bearer\s+[^\s"']+/gi, "Authorization: Bearer <redacted>")
    .replace(/(api[_-]?key|secret|token|password)["']?\s*[:=]\s*["']?[^\s,;"'}]+/gi, "$1=<redacted>")
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-<redacted>");
}

const SAFE_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

/** Called before rendering any agent/material link. */
export function safeLink(url: string): string | null {
  try {
    const u = new URL(url, "https://local.invalid");
    return SAFE_LINK_PROTOCOLS.has(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}

const FORBIDDEN_FILE_PATTERN = /\.(exe|msi|bat|cmd|sh|ps1|scr|dll|so|bin|apk|jar|pyc|com)$/i;

export function validateFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").trim().slice(0, 180);
  if (!cleaned) throw new ApiError(400, "INVALID_FILENAME", "文件名无效");
  if (FORBIDDEN_FILE_PATTERN.test(cleaned)) {
    throw new ApiError(400, "FILE_TYPE_FORBIDDEN", "不允许上传可执行文件或脚本");
  }
  return cleaned;
}

export const MAX_MATERIAL_BYTES = 20 * 1024 * 1024;
