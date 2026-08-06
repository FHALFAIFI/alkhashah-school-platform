import { describe, it, expect } from "vitest";
import {
  requiredPositiveAmount,
  optionalPositiveAmountStrict,
  isHalalaPrecise,
  REQUIRED_AMOUNT_MESSAGE,
  AMOUNT_PRECISION_MESSAGE,
} from "@/lib/finance/amount";
import { MAX_MONEY_AMOUNT, MAX_MONEY_MESSAGE } from "@/lib/finance/calc";

/**
 * Corrective fix (post-v2.5.0 deployment), issue 2 — the financial amount is mandatory.
 *
 * These are the schema-level assertions. The Server Action assertions — that a forged request
 * is refused and that no business row and no audit row is written when validation fails — live
 * in `tests/integration/finance-required-amount.test.ts`, because only the action layer can
 * prove "nothing was written".
 *
 * The rejected set is written out case by case rather than as a loop over a table so that a
 * failure names the exact input that slipped through.
 */

const message = (value: unknown): string | undefined => {
  const r = requiredPositiveAmount.safeParse(value);
  return r.success ? undefined : r.error.issues[0].message;
};

describe("requiredPositiveAmount — rejects every form of «no amount»", () => {
  it("rejects an empty string", () => {
    expect(message("")).toBe(REQUIRED_AMOUNT_MESSAGE);
  });

  it("rejects whitespace only", () => {
    expect(message("   ")).toBe(REQUIRED_AMOUNT_MESSAGE);
    expect(message("\t\n ")).toBe(REQUIRED_AMOUNT_MESSAGE);
  });

  it("rejects null and undefined", () => {
    expect(message(null)).toBe(REQUIRED_AMOUNT_MESSAGE);
    expect(message(undefined)).toBe(REQUIRED_AMOUNT_MESSAGE);
  });

  it("rejects non-numeric text", () => {
    expect(message("غير رقم")).toBe(REQUIRED_AMOUNT_MESSAGE);
    expect(message("abc")).toBe(REQUIRED_AMOUNT_MESSAGE);
    expect(message("12abc")).toBe(REQUIRED_AMOUNT_MESSAGE);
    expect(message("--5")).toBe(REQUIRED_AMOUNT_MESSAGE);
  });

  it("rejects zero — a financial transaction of nothing is not a transaction", () => {
    expect(message("0")).toBe(REQUIRED_AMOUNT_MESSAGE);
    expect(message("0.00")).toBe(REQUIRED_AMOUNT_MESSAGE);
    expect(message(0)).toBe(REQUIRED_AMOUNT_MESSAGE);
  });

  it("rejects negative amounts", () => {
    expect(message("-1")).toBe(REQUIRED_AMOUNT_MESSAGE);
    expect(message(-0.01)).toBe(REQUIRED_AMOUNT_MESSAGE);
  });

  it("rejects NaN and Infinity, however they arrive", () => {
    expect(message(Number.NaN)).toBe(REQUIRED_AMOUNT_MESSAGE);
    expect(message(Number.POSITIVE_INFINITY)).toBe(REQUIRED_AMOUNT_MESSAGE);
    expect(message("NaN")).toBe(REQUIRED_AMOUNT_MESSAGE);
    expect(message("Infinity")).toBe(REQUIRED_AMOUNT_MESSAGE);
  });

  it("rejects non-scalar values — a forged request can send anything", () => {
    expect(message({})).toBe(REQUIRED_AMOUNT_MESSAGE);
    expect(message([])).toBe(REQUIRED_AMOUNT_MESSAGE);
    expect(message(["100"])).toBe(REQUIRED_AMOUNT_MESSAGE);
    expect(message(true)).toBe(REQUIRED_AMOUNT_MESSAGE);
  });

  it("rejects precision finer than one halalah instead of rounding it silently", () => {
    expect(message("3.456")).toBe(AMOUNT_PRECISION_MESSAGE);
    expect(message("0.001")).toBe(AMOUNT_PRECISION_MESSAGE);
  });

  it("rejects amounts beyond the safe monetary bound", () => {
    expect(message(String(MAX_MONEY_AMOUNT + 1))).toBe(MAX_MONEY_MESSAGE);
  });
});

describe("requiredPositiveAmount — accepts real amounts", () => {
  it("accepts a whole-riyal amount", () => {
    expect(requiredPositiveAmount.parse("5000")).toBe(5000);
    expect(requiredPositiveAmount.parse(250)).toBe(250);
  });

  it("accepts a halalah-precise amount", () => {
    expect(requiredPositiveAmount.parse("12.50")).toBe(12.5);
    expect(requiredPositiveAmount.parse("0.01")).toBe(0.01);
    expect(requiredPositiveAmount.parse("99.99")).toBe(99.99);
  });

  it("accepts the boundary amount exactly", () => {
    expect(requiredPositiveAmount.parse(String(MAX_MONEY_AMOUNT))).toBe(MAX_MONEY_AMOUNT);
  });

  it("tolerates surrounding whitespace", () => {
    expect(requiredPositiveAmount.parse("  25  ")).toBe(25);
  });

  it("accepts Arabic-Indic digits and the Arabic decimal separator — the UI is ar-SA", () => {
    expect(requiredPositiveAmount.parse("١٢٣")).toBe(123);
    expect(requiredPositiveAmount.parse("١٢٫٥٠")).toBe(12.5);
  });
});

describe("optionalPositiveAmountStrict — absence allowed, stated value still strict", () => {
  it("allows absence (an item may exist before its allocation is approved)", () => {
    expect(optionalPositiveAmountStrict.parse("")).toBeUndefined();
    expect(optionalPositiveAmountStrict.parse(undefined)).toBeUndefined();
    expect(optionalPositiveAmountStrict.parse("   ")).toBeUndefined();
  });

  it("still rejects zero and negatives when a value IS given", () => {
    expect(optionalPositiveAmountStrict.safeParse("0").success).toBe(false);
    expect(optionalPositiveAmountStrict.safeParse("-3").success).toBe(false);
  });

  it("accepts a valid stated amount", () => {
    expect(optionalPositiveAmountStrict.parse("1000")).toBe(1000);
  });
});

describe("isHalalaPrecise", () => {
  it("accepts values representable in whole halalas", () => {
    expect(isHalalaPrecise(12.5)).toBe(true);
    expect(isHalalaPrecise(0.01)).toBe(true);
    expect(isHalalaPrecise(1000)).toBe(true);
    // floating-point representation of 0.07 * 100 is not exactly 7 — the epsilon matters
    expect(isHalalaPrecise(0.07)).toBe(true);
    expect(isHalalaPrecise(1.15)).toBe(true);
  });

  it("rejects finer precision", () => {
    expect(isHalalaPrecise(0.001)).toBe(false);
    expect(isHalalaPrecise(3.456)).toBe(false);
  });
});
