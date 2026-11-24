import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { Database, Session, User } from "./types";
import { newId, now } from "./utils";

const SESSION_TTL_MS = 7 * 24 * 3600_000;
export const SESSION_COOKIE = "acw_session";

/** scrypt with a per-password random salt. Format: scrypt$N$r$salt$hash */
export function hashPassword(password: string): string {
  const N = 16384, r = 8, p = 1;
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32, { N, r, p });
  return `scrypt$${N}$${r}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [scheme, nStr, rStr, saltB64, hashB64] = stored.split("$");
    if (scheme !== "scrypt") return false;
    const salt = Buffer.from(saltB64, "base64");
    const expected = Buffer.from(hashB64, "base64");
    const actual = scryptSync(password, salt, expected.length, { N: Number(nStr), r: Number(rStr), p: 1 });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Issues a new session. Returns the raw token to place in the httpOnly cookie. */
export function createSession(db: Database, userId: string): { token: string; expiresAt: string } {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  db.sessions = db.sessions.filter((s) => new Date(s.expiresAt).getTime() > Date.now());
  const session: Session = {
    tokenHash: hashToken(token),
    userId,
    createdAt: now(),
    expiresAt,
    lastSeenAt: now(),
  };
  db.sessions.push(session);
  return { token, expiresAt };
}

export function destroySession(db: Database, token: string): void {
  const tokenHash = hashToken(token);
  db.sessions = db.sessions.filter((s) => s.tokenHash !== tokenHash);
}

export function getSessionUser(db: Database, token: string | null | undefined): User | null {
  if (!token) return null;
  const tokenHash = hashToken(token);
  const session = db.sessions.find((s) => s.tokenHash === tokenHash);
  if (!session) return null;
  if (new Date(session.expiresAt).getTime() <= Date.now()) {
    db.sessions = db.sessions.filter((s) => s.tokenHash !== tokenHash);
    return null;
  }
  session.lastSeenAt = now();
  return db.users.find((u) => u.id === session.userId) ?? null;
}

/** Parse a Cookie header without any framework dependency. */
export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

export function sessionCookieHeader(token: string, maxAgeMs: number = SESSION_TTL_MS): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAgeMs / 1000)}`;
}

export function clearCookieHeader(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function newSessionId(): string {
  return newId("sess");
}
