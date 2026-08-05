import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * D-053 — the streaming-abort rule, pinned.
 *
 * D-049 established that a Server Action must not `revalidatePath` the route it was invoked
 * from: the router refetches that route immediately and cancels the still-streaming action
 * response, so the write lands but the screen never updates. v2.4.1 fixed two call sites by
 * hand; the v2.5.0 sweep removed all 202 of them, because
 *
 *   • invalidating an *ancestor* path invalidates the open route's tree just the same, and
 *   • one action can be reached from several routes, so "the current route" is not knowable
 *     at the call site.
 *
 * Every page here is `force-dynamic` and no `experimental.staleTimes` is configured, so the
 * client router keeps no payload for a dynamic route — revalidation was buying nothing and
 * costing the race. Refreshing is the client's job, after the result settles.
 *
 * These assertions exist so the rule cannot come back one file at a time. Each allowlist
 * entry names *why* that file is exempt; an unexplained exemption is a failing test.
 */

const root = process.cwd();
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(path.join(root, dir))) {
    const rel = `${dir}/${entry}`;
    if (statSync(path.join(root, rel)).isDirectory()) walk(rel, out);
    else if (/\.tsx?$/.test(entry)) out.push(rel);
  }
  return out;
}

const APP_FILES = [...walk("src/app"), ...walk("src/components")];

describe("D-053 — لا إبطال مسارات من طبقة التطبيق", () => {
  it("لا استدعاء لـ revalidatePath في أي صفحة أو إجراء", () => {
    const offenders = APP_FILES.filter((f) => /^\s*revalidatePath\(/m.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it("لا استيراد لـ revalidatePath من next/cache في طبقة التطبيق", () => {
    const offenders = APP_FILES.filter((f) => /import \{[^}]*revalidatePath[^}]*\} from "next\/cache"/.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it("الوحدة المشتركة تمنع الإبطال صراحةً بدل السماح به بصمت", () => {
    const src = read("src/lib/revalidate.ts");
    expect(src).toContain("D-053");
    expect(src).toMatch(/throw new Error/);
  });
});

describe("D-053 — التحديث مسؤولية العميل", () => {
  /** نماذج إجراؤها ينتهي دائماً بـ`redirect`، فالوجهة تُصيَّر من جديد ولا يلزم تحديث. */
  const REDIRECTING_FORMS = new Map<string, string>([
    ["src/app/(auth)/login/login-form.tsx", "الدخول ينتهي بتحويل إلى الوجهة المطلوبة"],
    ["src/app/(app)/imports/new/upload-form.tsx", "الرفع ينتهي بتحويل إلى صفحة الدفعة"],
  ]);

  it("كل نموذج يملك حالة إجراء يحدّث صفحته بنفسه", () => {
    const offenders: string[] = [];
    for (const f of APP_FILES) {
      const src = read(f);
      if (!src.includes("useActionState")) continue;
      if (REDIRECTING_FORMS.has(f)) continue;
      if (!src.includes("useRefreshOnSuccess")) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });

  it("كل انتقال يحمل إجراء خادم يحدّث صفحته بعد اكتماله", () => {
    /** واجهات تدير التحديث بنفسها بعد انتهاء الانتقال — تُقرأ في مواضعها. */
    const SELF_MANAGED = new Map<string, string>([
      ["src/app/(app)/committees/[id]/task-distribution-ui.tsx", "تحديث صريح بعد انخفاض pending (D-049 ق3)"],
      ["src/app/(app)/building/inspections/templates/template-controls.tsx", "تحديث بعد انتهاء الانتقال في موضعه"],
    ]);
    const offenders: string[] = [];
    for (const f of APP_FILES) {
      const src = read(f);
      if (!/const \[[A-Za-z0-9_]+, [A-Za-z0-9_]+\] = useTransition\(\)/.test(src)) continue;
      if (SELF_MANAGED.has(f)) continue;
      if (!src.includes("useRefreshAfterTransition")) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });

  it("لا يُستدعى router.refresh داخل انتقال — القاعدة الثالثة في D-049", () => {
    const offenders: string[] = [];
    for (const f of APP_FILES) {
      const src = read(f);
      // `startTransition(... router.refresh() ...)` على سطر واحد أو عبر أسطر داخل النداء
      if (/startTransition\(\s*(?:\(\)|async \(\))\s*=>\s*\{?[^}]*router\.refresh\(\)/s.test(src)) offenders.push(f);
      if (/startTransition\(\(\) => router\.refresh\(\)\)/.test(src)) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });
});
