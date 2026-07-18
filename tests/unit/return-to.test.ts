import { describe, it, expect } from "vitest";
import { safeImportsReturnTo } from "@/lib/auth/return-to";

describe("safeImportsReturnTo — تحقق returnTo لمنع التوجيه المفتوح", () => {
  const uuid = "12673bed-c6ae-4f28-af9d-c311fb2e7a3d";

  it("يقبل مسار دفعة استيراد داخلي صحيح فقط", () => {
    expect(safeImportsReturnTo(`/imports/${uuid}`)).toBe(`/imports/${uuid}`);
  });

  it("يرفض المسارات الخارجية والبروتوكول النسبي ومحاولات التوجيه المفتوح", () => {
    for (const bad of [
      "https://evil.example/imports/" + uuid,
      "//evil.example",
      "/dashboard",
      "/imports/not-a-uuid",
      "/imports/" + uuid + "/../../etc",
      "imports/" + uuid,
      "javascript:alert(1)",
      "",
      null,
      undefined,
    ]) {
      expect(safeImportsReturnTo(bad as string | null | undefined)).toBeNull();
    }
  });
});
