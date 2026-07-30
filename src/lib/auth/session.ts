import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { and, eq, gt, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  sessions,
  users,
  userRoles,
  roles,
  rolePermissions,
  permissions as permissionsTable,
} from "@/db/schema";

const COOKIE_NAME = "madrasa_session";
const IDLE_HOURS = 12;
const ABSOLUTE_DAYS = 30;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** هل وصل الطلب الحالي عبر HTTPS (مباشرة أو خلف وسيط مثل Tailscale Serve)? */
async function requestIsHttps(): Promise<boolean> {
  const h = await headers();
  return h.get("x-forwarded-proto")?.split(",")[0]?.trim() === "https";
}

export async function createSession(userId: string, ip?: string, userAgent?: string) {
  const token = randomBytes(32).toString("hex");
  const csrfToken = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + ABSOLUTE_DAYS * 24 * 3600 * 1000);
  await db.insert(sessions).values({
    userId,
    tokenHash: hashToken(token),
    csrfToken,
    expiresAt,
    ip,
    userAgent,
  });
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    // آمن دائماً في الإنتاج، وفي التطوير عندما يصل الطلب عبر HTTPS (مثل Tailscale Serve).
    // TEMPORARY escape hatch: ALLOW_INSECURE_LAN_HTTP=true lets a plain-HTTP request on the
    // trusted LAN (no x-forwarded-proto=https) receive a non-Secure cookie so login works over
    // http://<LAN-IP>:3080 during the principal retest. HTTPS requests stay always-Secure, so the
    // Tailscale Serve path is unaffected. Remove the env flag to restore always-Secure in production.
    secure:
      (await requestIsHttps()) ||
      (process.env.NODE_ENV === "production" && process.env.ALLOW_INSECURE_LAN_HTTP !== "true"),
    path: "/",
    maxAge: ABSOLUTE_DAYS * 24 * 3600,
  });
  return { token, csrfToken };
}

export async function destroySession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (token) {
    await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
  }
  cookieStore.delete(COOKIE_NAME);
}

export type CurrentUser = {
  id: string;
  username: string;
  displayName: string;
  personId: string | null;
  permissions: Set<string>;
  /** مفاتيح أدوار المستخدم (مثل principal / sysadmin) — أساس قرارات «هل هو المدير؟» على الخادم (D-032) */
  roleKeys: Set<string>;
  csrfToken: string;
  sessionId: string;
};

export { PRINCIPAL_ROLE_KEY } from "./roles";

/** cached per request */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const now = new Date();
  const rows = await db
    .select({
      sessionId: sessions.id,
      csrfToken: sessions.csrfToken,
      lastSeenAt: sessions.lastSeenAt,
      userId: users.id,
      username: users.username,
      displayName: users.displayName,
      personId: users.personId,
      active: users.active,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, now)));

  const row = rows[0];
  if (!row || !row.active) return null;

  // idle timeout
  const idleLimit = new Date(Date.now() - IDLE_HOURS * 3600 * 1000);
  if (row.lastSeenAt < idleLimit) {
    await db.delete(sessions).where(eq(sessions.id, row.sessionId));
    return null;
  }
  // refresh last seen (throttled: only when older than 5 minutes)
  if (row.lastSeenAt < new Date(Date.now() - 5 * 60 * 1000)) {
    await db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, row.sessionId));
  }

  const roleRows = await db
    .select({ roleId: userRoles.roleId, roleKey: roles.key })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(eq(userRoles.userId, row.userId));
  const roleIds = roleRows.map((r) => r.roleId);

  let permKeys: string[] = [];
  if (roleIds.length > 0) {
    permKeys = (
      await db
        .select({ key: permissionsTable.key })
        .from(rolePermissions)
        .innerJoin(permissionsTable, eq(rolePermissions.permissionId, permissionsTable.id))
        .where(inArray(rolePermissions.roleId, roleIds))
    ).map((r) => r.key);
  }

  return {
    id: row.userId,
    username: row.username,
    displayName: row.displayName,
    personId: row.personId,
    permissions: new Set(permKeys),
    roleKeys: new Set(roleRows.map((r) => r.roleKey)),
    csrfToken: row.csrfToken,
    sessionId: row.sessionId,
  };
});

export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 403) {
    super(message);
    this.status = status;
  }
}

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requirePermission(...keys: string[]): Promise<CurrentUser> {
  const user = await requireUser();
  for (const key of keys) {
    if (!user.permissions.has(key)) {
      throw new AuthError("لا تملك الصلاحية اللازمة لهذا الإجراء", 403);
    }
  }
  return user;
}

/** CSRF check for mutating requests coming through route handlers */
export async function requireCsrf(user: CurrentUser): Promise<void> {
  const h = await headers();
  const token = h.get("x-csrf-token");
  if (!token || token !== user.csrfToken) {
    throw new AuthError("رمز الحماية غير صالح، حدث الصفحة وأعد المحاولة", 403);
  }
}

export async function clientIp(): Promise<string | undefined> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined;
}
