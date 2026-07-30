import { describe, it, expect } from "vitest";
import {
  VIEWER_MIN_SCALE, VIEWER_MAX_SCALE, VIEWER_ZOOM_STEP,
  clampScale, initialView, clampView, viewBoxOf, zoomCentered, zoomAtPoint, panBy, fitToContent,
} from "@/lib/building/viewer-view";

// أبعاد مطابقة لمخطط دور حقيقي تقريباً (وحدات SVG)
const BASE = { w: 420, h: 308 };

describe("حسابات عارض المخطط — الحدود والقص", () => {
  it("المقياس يُقص بين الحد الأدنى والأقصى", () => {
    expect(clampScale(0.01)).toBe(VIEWER_MIN_SCALE);
    expect(clampScale(100)).toBe(VIEWER_MAX_SCALE);
    expect(clampScale(2)).toBe(2);
  });

  it("قيمة مقياس غير صالحة تعود إلى 1 بدل كسر العرض", () => {
    expect(clampScale(NaN)).toBe(1);
    expect(clampScale(Infinity)).toBe(1);
    expect(clampScale(0)).toBe(1);
    expect(clampScale(-3)).toBe(1);
  });

  it("العرض الابتدائي يظهر المخطط كاملاً من المنتصف", () => {
    const v = initialView(BASE);
    expect(v).toEqual({ scale: 1, cx: BASE.w / 2, cy: BASE.h / 2 });
    expect(viewBoxOf(v, BASE)).toBe(`0 0 ${BASE.w} ${BASE.h}`);
  });

  it("السحب لا يُخرج النافذة عن حدود المخطط (لا يضيع الرسم)", () => {
    const zoomed = { scale: 2, cx: BASE.w / 2, cy: BASE.h / 2 };
    const v = clampView({ ...zoomed, cx: 10_000, cy: -10_000 }, BASE);
    // نصف عرض النافذة عند مقياس 2 هو ربع العرض الأساسي
    expect(v.cx).toBe(BASE.w - BASE.w / 4);
    expect(v.cy).toBe(BASE.h / 4);
  });

  it("عند الإبعاد دون 1 تثبت النافذة في منتصف المخطط", () => {
    const v = clampView({ scale: 0.5, cx: 0, cy: 9999 }, BASE);
    expect(v.cx).toBe(BASE.w / 2);
    expect(v.cy).toBe(BASE.h / 2);
  });
});

describe("أزرار + / − / إعادة الضبط", () => {
  it("التقريب يصغّر نافذة العرض بمعامل الخطوة", () => {
    const v1 = zoomCentered(initialView(BASE), BASE, VIEWER_ZOOM_STEP);
    expect(v1.scale).toBeCloseTo(VIEWER_ZOOM_STEP);
    const [, , w] = viewBoxOf(v1, BASE).split(" ").map(Number);
    expect(w).toBeCloseTo(BASE.w / VIEWER_ZOOM_STEP, 1);
  });

  it("الإبعاد من العرض الابتدائي يغيّر العرض فعلاً (لا زر ميت)", () => {
    const v = zoomCentered(initialView(BASE), BASE, 1 / VIEWER_ZOOM_STEP);
    expect(v.scale).toBeLessThan(1);
    expect(viewBoxOf(v, BASE)).not.toBe(viewBoxOf(initialView(BASE), BASE));
  });

  it("نقرات متكررة على + تتوقف عند الحد الأقصى", () => {
    let v = initialView(BASE);
    for (let i = 0; i < 30; i++) v = zoomCentered(v, BASE, VIEWER_ZOOM_STEP);
    expect(v.scale).toBe(VIEWER_MAX_SCALE);
    const frozen = zoomCentered(v, BASE, VIEWER_ZOOM_STEP);
    expect(frozen).toEqual(v);
  });

  it("نقرات متكررة على − تتوقف عند الحد الأدنى", () => {
    let v = initialView(BASE);
    for (let i = 0; i < 30; i++) v = zoomCentered(v, BASE, 1 / VIEWER_ZOOM_STEP);
    expect(v.scale).toBe(VIEWER_MIN_SCALE);
  });

  it("إعادة الضبط تعيد العرض الابتدائي بعد أي تلاعب", () => {
    let v = zoomCentered(initialView(BASE), BASE, 3);
    v = panBy(v, BASE, 55, -80, 800, 600);
    expect(initialView(BASE)).toEqual({ scale: 1, cx: BASE.w / 2, cy: BASE.h / 2 });
  });
});

describe("التقريب حول نقطة (عجلة الفأرة / القرص)", () => {
  it("النقطة تحت المؤشر تبقى تحته بعد التقريب", () => {
    const client = { w: 840, h: 616 }; // ضعف وحدات SVG
    const px = 210; // ربع العرض
    const py = 154;
    const before = initialView(BASE);
    const after = zoomAtPoint(before, BASE, 2, px, py, client.w, client.h);
    // النقطة بوحدات SVG قبل: (105, 77). بعدها يجب أن تقع عند ربع نافذة العرض الجديدة.
    const [x, y, w, h] = viewBoxOf(after, BASE).split(" ").map(Number);
    expect(x + (px / client.w) * w).toBeCloseTo(105, 1);
    expect(y + (py / client.h) * h).toBeCloseTo(77, 1);
  });

  it("مقاس حاوية صفري لا يقسم على صفر", () => {
    const v = zoomAtPoint(initialView(BASE), BASE, 2, 0, 0, 0, 0);
    expect(v.scale).toBe(2);
    expect(Number.isFinite(v.cx)).toBe(true);
  });
});

describe("السحب", () => {
  it("السحب بعد التقريب يحرّك النافذة عكس اتجاه الإصبع (المحتوى يتبع الإصبع)", () => {
    const zoomed = zoomCentered(initialView(BASE), BASE, 2);
    const v = panBy(zoomed, BASE, 100, 50, 800, 600);
    expect(v.cx).toBeLessThan(zoomed.cx);
    expect(v.cy).toBeLessThan(zoomed.cy);
  });

  it("السحب عند مقياس 1 لا يحرّك شيئاً (النافذة مقصوصة على الحدود)", () => {
    const v = panBy(initialView(BASE), BASE, 200, 200, 800, 600);
    expect(v).toEqual(initialView(BASE));
  });

  it("سحب متطرف لا يفقد الرسم — النافذة تبقى داخل الحدود", () => {
    let v = zoomCentered(initialView(BASE), BASE, 4);
    for (let i = 0; i < 50; i++) v = panBy(v, BASE, 500, 500, 800, 600);
    const [x, y, w, h] = viewBoxOf(v, BASE).split(" ").map(Number);
    expect(x).toBeGreaterThanOrEqual(0);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(x + w).toBeLessThanOrEqual(BASE.w);
    expect(y + h).toBeLessThanOrEqual(BASE.h);
  });
});

describe("ملاءمة المخطط للشاشة", () => {
  it("تعرض صندوق المحتوى كاملاً وتقصّ الهوامش الميتة", () => {
    // محتوى في الربع الأسفل من إطار فيه هوامش كبيرة (كحال دور الموقع site)
    const bbox = { x: 28, y: 154, w: 200, h: 120 };
    const v = fitToContent(BASE, bbox, 14);
    const [x, y, w, h] = viewBoxOf(v, BASE).split(" ").map(Number);
    expect(v.scale).toBeGreaterThan(1);
    // النافذة تغطي الصندوق كاملاً
    expect(x).toBeLessThanOrEqual(bbox.x);
    expect(y).toBeLessThanOrEqual(bbox.y);
    expect(x + w).toBeGreaterThanOrEqual(bbox.x + bbox.w);
    expect(y + h).toBeGreaterThanOrEqual(bbox.y + bbox.h);
  });

  it("صندوق فارغ أو غير صالح يعيد العرض الابتدائي بدل الانهيار", () => {
    expect(fitToContent(BASE, { x: 0, y: 0, w: 0, h: 0 })).toEqual(initialView(BASE));
    expect(fitToContent(BASE, { x: 0, y: 0, w: NaN, h: 10 })).toEqual(initialView(BASE));
  });

  it("محتوى يملأ الإطار أصلاً → الملاءمة تكافئ العرض الكامل تقريباً", () => {
    const v = fitToContent(BASE, { x: 0, y: 0, w: BASE.w, h: BASE.h });
    expect(v.scale).toBe(1);
  });
});
