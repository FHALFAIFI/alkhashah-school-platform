import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * C4–C5: سلوك HTTPS وPWA:
 * - ملف تعريف الجلسة يصدر بعلامة Secure عندما يصل الطلب عبر HTTPS (خلف Tailscale Serve).
 * - بيان PWA عربي RTL قابل للتثبيت وعامل الخدمة مقدم بنوع صحيح.
 * - عند تشغيل الاختبارات ضد عنوان HTTPS الفعلي (APP_URL=https://…) تفحص الميزات الآمنة أيضاً.
 */

function principalCredentials(): { username: string; password: string } {
  const file = path.resolve(process.env.E2E_STORAGE_DIR ?? "storage", "private/initial-credentials.txt");
  const content = readFileSync(file, "utf8");
  const line = content.split("\n").find((l) => l.includes("principal"))!;
  const password = line.split("كلمة المرور المؤقتة:")[1].trim();
  return { username: "principal", password };
}

test("خلف وسيط HTTPS يصدر ملف تعريف الجلسة بعلامة Secure (C4)", async ({ browser }) => {
  const ctx = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-proto": "https" } });
  const page = await ctx.newPage();
  const creds = principalCredentials();

  const setCookies: string[] = [];
  page.on("response", (res) => {
    void res
      .headersArray()
      .then((headers) => {
        for (const h of headers) {
          if (h.name.toLowerCase() === "set-cookie" && h.value.includes("madrasa_session=")) setCookies.push(h.value);
        }
      })
      .catch(() => {});
  });

  await page.goto("/login");
  await page.fill("#username", creds.username);
  await page.fill("#password", creds.password);
  await page.getByRole("button", { name: "تسجيل الدخول" }).click();
  await page.waitForTimeout(1500);

  expect(setCookies.length).toBeGreaterThan(0);
  for (const c of setCookies) {
    expect(c, "ملف الجلسة يجب أن يكون Secure عبر HTTPS").toMatch(/;\s*Secure/i);
    expect(c).toMatch(/HttpOnly/i);
  }
  await ctx.close();
});

test("بيان PWA عربي RTL وقابل للتثبيت (C4)", async ({ request }) => {
  const res = await request.get("/manifest.webmanifest");
  expect(res.ok()).toBe(true);
  const manifest = (await res.json()) as { dir: string; lang: string; display: string; start_url: string; icons: unknown[] };
  expect(manifest.dir).toBe("rtl");
  expect(manifest.lang).toBe("ar");
  expect(manifest.display).toBe("standalone");
  expect(manifest.start_url).toBe("/dashboard");
  expect(manifest.icons.length).toBeGreaterThanOrEqual(2);
});

test("عامل الخدمة مقدم من الجذر بنوع JavaScript (C4)", async ({ request }) => {
  const res = await request.get("/sw.js");
  expect(res.ok()).toBe(true);
  expect(res.headers()["content-type"]).toMatch(/javascript/);
  expect(await res.text()).toContain("madrasa-offline");
});

// تعمل فقط عند توجيه الاختبارات لعنوان HTTPS الفعلي: APP_URL=https://<device>.<tailnet>.ts.net npm run test:e2e
test("عبر HTTPS الفعلي: سياق آمن وعامل الخدمة والكاميرا متاحان (C5)", async ({ page, baseURL }) => {
  test.skip(!baseURL?.startsWith("https://"), "يتطلب APP_URL بعنوان HTTPS عبر Tailscale");
  const creds = principalCredentials();
  await page.goto("/login");
  await page.fill("#username", creds.username);
  await page.fill("#password", creds.password);
  await page.getByRole("button", { name: "تسجيل الدخول" }).click();
  await page.waitForURL("**/dashboard");

  const secure = await page.evaluate(() => ({
    isSecureContext: window.isSecureContext,
    serviceWorker: "serviceWorker" in navigator,
    mediaDevices: !!navigator.mediaDevices,
  }));
  expect(secure.isSecureContext).toBe(true);
  expect(secure.serviceWorker).toBe(true);
  expect(secure.mediaDevices).toBe(true);

  // صفحة الفحص دون اتصال تسجل عامل الخدمة وتخبئ نفسها
  await page.goto("/building/offline");
  await page.waitForTimeout(2500);
  const swReady = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    return !!reg?.active;
  });
  expect(swReady).toBe(true);
});
