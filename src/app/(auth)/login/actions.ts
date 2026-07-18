"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { verifyTotp } from "@/lib/auth/totp";
import { db } from "@/db";
import { users } from "@/db/schema";
import { verifyPassword } from "@/lib/auth/password";
import { createSession, destroySession, clientIp } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";
import { safeImportsReturnTo } from "@/lib/auth/return-to";

type LoginState = { error: string } | null;

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const username = String(formData.get("username") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const totp = String(formData.get("totp") ?? "").trim();
  const ip = await clientIp();

  if (!username || !password) return { error: "أدخل اسم المستخدم وكلمة المرور" };
  // الحد الافتراضي 10/دقيقة للإنتاج؛ قابل للتهيئة بمتغير بيئة حتى لا تتراكم عمليات
  // الدخول المتتابعة في بيئة الاختبار المعزولة وتُفعّل المحدد خطأً (لا يغيّر سلوك الإنتاج).
  const loginRateLimit = Number(process.env.LOGIN_RATE_LIMIT_PER_MIN ?? 10);
  if (!rateLimit(`login:${ip ?? "local"}`, loginRateLimit)) {
    return { error: "محاولات كثيرة — انتظر دقيقة ثم أعد المحاولة" };
  }

  const [user] = await db.select().from(users).where(eq(users.username, username));
  const genericError = { error: "اسم المستخدم أو كلمة المرور غير صحيحة" };

  if (!user || !user.active) {
    await audit({ action: "login.failed", summary: `محاولة دخول فاشلة: ${username}`, ip });
    return genericError;
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    return { error: "الحساب موقوف مؤقتاً بسبب محاولات فاشلة — حاول لاحقاً" };
  }

  const ok = await verifyPassword(user.passwordHash, password);
  if (!ok) {
    const failed = user.failedLogins + 1;
    const lockedUntil = failed >= 5 ? new Date(Date.now() + Math.min(failed - 4, 6) * 5 * 60 * 1000) : null;
    await db.update(users).set({ failedLogins: failed, lockedUntil }).where(eq(users.id, user.id));
    await audit({ actorId: user.id, action: "login.failed", summary: "كلمة مرور خاطئة", ip });
    return genericError;
  }

  if (user.totpEnabled && user.totpSecret) {
    if (!totp) return { error: "أدخل رمز التحقق الثنائي" };
    const validTotp = verifyTotp(totp, user.totpSecret);
    if (!validTotp) {
      const codes = (user.recoveryCodes ?? []) as string[];
      const { createHash } = await import("node:crypto");
      const totpHash = createHash("sha256").update(totp).digest("hex");
      const idx = codes.indexOf(totpHash);
      if (idx === -1) {
        await audit({ actorId: user.id, action: "login.failed", summary: "رمز تحقق ثنائي خاطئ", ip });
        return { error: "رمز التحقق الثنائي غير صحيح" };
      }
      codes.splice(idx, 1);
      await db.update(users).set({ recoveryCodes: codes }).where(eq(users.id, user.id));
      await audit({ actorId: user.id, action: "login.recovery_code_used", ip });
    }
  }

  await db.update(users).set({ failedLogins: 0, lockedUntil: null }).where(eq(users.id, user.id));
  await createSession(user.id, ip);
  await audit({ actorId: user.id, action: "login.success", ip });
  // returnTo مُتحقَّق منه فقط (دفعة استيراد داخلية) — وإلا اللوحة الرئيسية
  const returnTo = safeImportsReturnTo(String(formData.get("returnTo") ?? ""));
  redirect(returnTo ?? "/dashboard");
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}
