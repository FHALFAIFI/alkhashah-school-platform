import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { RELEASE_VERSION, releaseIdentity, releaseLabel } from "@/lib/release";

/**
 * v2.4.1 §8: رقم الإصدار له مصدر واحد. هذا الاختبار يمنع الانحراف بين `package.json`
 * و`src/lib/release.ts` — وهو الانحراف الذي يجعل علامة الإصدار تكذب على المستخدم.
 */
describe("هوية الإصدار", () => {
  it("رقم الإصدار يطابق package.json بالضبط", () => {
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf-8"));
    expect(RELEASE_VERSION).toBe(pkg.version);
  });

  it("الهوية تحمل الحقول الثلاثة ولا تكشف غيرها", () => {
    const id = releaseIdentity();
    expect(Object.keys(id).sort()).toEqual(["commit", "environment", "version"]);
    expect(id.version).toBe(RELEASE_VERSION);
  });

  it("النص المعروض عربي ويحمل الرقم", () => {
    expect(releaseLabel()).toBe(`الإصدار ${RELEASE_VERSION}`);
  });

  it("لا يسرّب أي سر أو مسار في الهوية", () => {
    const serialized = JSON.stringify(releaseIdentity());
    expect(serialized).not.toMatch(/password|secret|passphrase|DATABASE_URL|\/data\//i);
  });
});
