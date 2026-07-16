// دخان مقترحات الكتابة: طلب إنشاء مهمة → معاينة → تأكيد → نتيجة بروابط
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
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ar-SA" });
const page = await ctx.newPage();

await page.goto(BASE + "/login");
await page.fill("#username", "principal");
await page.fill("#password", password);
await page.getByRole("button", { name: "تسجيل الدخول" }).click();
await page.waitForURL("**/dashboard");
await page.goto(BASE + "/assistant", { waitUntil: "networkidle" });

await page.getByRole("textbox", { name: "رسالتك للمساعد" }).fill("أنشئ مهمة جديدة بعنوان: مراجعة نظافة الفصول، بأولوية عالية");
await page.getByRole("button", { name: "إرسال" }).click();

const proposalCard = page.getByText("إجراء مقترح:", { exact: false });
await proposalCard.waitFor({ timeout: 120_000 });
console.log("proposal-shown: true");
const previewText = await page.locator("dl").first().textContent();
console.log("preview-contains-title:", previewText.includes("مراجعة نظافة الفصول"));
await page.screenshot({ path: path.join(OUT, "proposal-preview.png"), fullPage: true });

await page.getByRole("button", { name: "تأكيد التنفيذ" }).click();
await page.getByText("✔", { exact: false }).first().waitFor({ timeout: 30_000 });
const result = await page.locator('[role="status"]').last().textContent();
console.log("result:", result.trim().slice(0, 200));
await page.screenshot({ path: path.join(OUT, "proposal-executed.png"), fullPage: true });

// تحقق أن المهمة ظهرت فعلاً في سجل المهام
await page.goto(BASE + "/tasks", { waitUntil: "networkidle" });
const taskVisible = await page.getByText("مراجعة نظافة الفصول").first().isVisible().catch(() => false);
console.log("task-in-register:", taskVisible);

await browser.close();
