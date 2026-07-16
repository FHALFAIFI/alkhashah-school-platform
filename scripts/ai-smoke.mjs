// دخان المساعد: دخول → /assistant → سؤال حقيقي عبر أولاما → التحقق من الرد والمصادر
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const BASE = process.env.APP_URL ?? "http://localhost:3080";
const OUT = path.resolve(process.argv[2] ?? "ai-smoke-shots");
mkdirSync(OUT, { recursive: true });

const credsFile = "/Users/fahedalfify/Developer/School/Father's File/storage/private/initial-credentials.txt";
const line = readFileSync(credsFile, "utf8").split("\n").find((l) => l.includes("principal"));
const password = line.split("كلمة المرور المؤقتة:")[1].trim();

const browser = await chromium.launch();
const mobile = process.env.MOBILE === "1";
const ctx = await browser.newContext(
  mobile
    ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "ar-SA" }
    : { viewport: { width: 1440, height: 900 }, locale: "ar-SA" },
);
const page = await ctx.newPage();
page.on("console", (m) => { if (m.type() === "error") console.log("console-error:", m.text().slice(0, 200)); });

await page.goto(BASE + "/login");
await page.fill("#username", "principal");
await page.fill("#password", password);
await page.getByRole("button", { name: "تسجيل الدخول" }).click();
await page.waitForURL("**/dashboard");

// المرساة العائمة موجودة على لوحة المتابعة
const dockVisible = await page.getByRole("button", { name: "فتح مساعد المدير الذكي" }).isVisible().catch(() => false);
console.log("dock-visible:", dockVisible);
await page.screenshot({ path: path.join(OUT, "dashboard-with-dock.png") });

// صفحة المساعد الكاملة
await page.goto(BASE + "/assistant", { waitUntil: "networkidle" });
await page.screenshot({ path: path.join(OUT, "assistant-empty.png") });

const question = process.env.Q ?? "ما الغرف التي تحتاج إلى فحص؟";
await page.getByRole("textbox", { name: "رسالتك للمساعد" }).fill(question);
await page.getByRole("button", { name: "إرسال" }).click();

// انتظر رد المساعد (فقاعة بيضاء بنص) حتى 180 ثانية
const t0 = Date.now();
let answered = false;
while (Date.now() - t0 < 180_000) {
  await page.waitForTimeout(2000);
  const stopVisible = await page.getByRole("button", { name: "إيقاف التوليد" }).isVisible().catch(() => false);
  const errText = await page.locator('[role="alert"]').first().textContent().catch(() => null);
  if (errText) { console.log("ERROR-BUBBLE:", errText.trim().slice(0, 300)); break; }
  if (!stopVisible) {
    const bubbles = await page.locator(".whitespace-pre-wrap").allTextContents();
    if (bubbles.some((b) => b.trim().length > 0)) { answered = true; break; }
  }
}
console.log("answered:", answered, "elapsed-s:", Math.round((Date.now() - t0) / 1000));
const bubbles = await page.locator(".whitespace-pre-wrap").allTextContents();
console.log("answer:", (bubbles.at(-1) ?? "").slice(0, 500));
const sources = await page.locator("a.underline").allTextContents().catch(() => []);
console.log("sources:", sources.slice(0, 6).join(" | "));
const badge = await page.locator("text=معالجة محلية").first().textContent().catch(() => null);
console.log("local-badge:", badge?.trim() ?? "none");
await page.screenshot({ path: path.join(OUT, "assistant-answer.png"), fullPage: true });

await browser.close();
