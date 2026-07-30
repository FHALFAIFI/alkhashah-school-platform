/**
 * حسابات عرض مخطط المبنى (تقريب/إبعاد/سحب/ملاءمة) — دوال نقية بلا DOM ليمكن اختبارها وحدةً.
 *
 * التصميم: التقريب والإزاحة يُطبَّقان عبر `viewBox` مباشرةً (وحدات SVG) بدل تحويل CSS —
 * فلا خلط بين بكسلات الشاشة ووحدات الرسم، ومركز التقريب دقيق مهما كان مقاس الحاوية.
 * `scale = 1` يعرض المخطط كاملاً؛ النافذة المعروضة تُقصّ دائماً بحيث لا يضيع الرسم خارج الإطار.
 */

export type ViewBase = { w: number; h: number };
export type ViewerView = { scale: number; cx: number; cy: number };
export type BBox = { x: number; y: number; w: number; h: number };

export const VIEWER_MIN_SCALE = 0.5;
export const VIEWER_MAX_SCALE = 8;
/** معامل التقريب لكل نقرة على زرّي + / − */
export const VIEWER_ZOOM_STEP = 1.4;

export function clampScale(scale: number): number {
  if (!Number.isFinite(scale) || scale <= 0) return 1;
  return Math.min(VIEWER_MAX_SCALE, Math.max(VIEWER_MIN_SCALE, scale));
}

/** العرض الابتدائي: المخطط كاملاً في المنتصف */
export function initialView(base: ViewBase): ViewerView {
  return { scale: 1, cx: base.w / 2, cy: base.h / 2 };
}

/**
 * قصّ العرض ضمن الحدود الآمنة: المقياس بين الحدّين، ومركز النافذة لا يخرج بها عن
 * حدود المخطط الأساسي. عند الإبعاد دون 1 تُثبَّت النافذة في المنتصف (لا معنى للسحب).
 */
export function clampView(view: ViewerView, base: ViewBase): ViewerView {
  const scale = clampScale(view.scale);
  const w = base.w / scale;
  const h = base.h / scale;
  const cx = w >= base.w ? base.w / 2 : Math.min(base.w - w / 2, Math.max(w / 2, view.cx));
  const cy = h >= base.h ? base.h / 2 : Math.min(base.h - h / 2, Math.max(h / 2, view.cy));
  return { scale, cx, cy };
}

/** قيمة `viewBox` المعروضة فعلياً لهذا العرض */
export function viewBoxOf(view: ViewerView, base: ViewBase): string {
  const v = clampView(view, base);
  const w = base.w / v.scale;
  const h = base.h / v.scale;
  const r = (n: number) => Math.round(n * 100) / 100;
  return `${r(v.cx - w / 2)} ${r(v.cy - h / 2)} ${r(w)} ${r(h)}`;
}

/** تقريب/إبعاد حول مركز النافذة الحالي (أزرار + / −) */
export function zoomCentered(view: ViewerView, base: ViewBase, factor: number): ViewerView {
  const v = clampView(view, base);
  return clampView({ scale: clampScale(v.scale * factor), cx: v.cx, cy: v.cy }, base);
}

/**
 * تقريب حول نقطة محددة (عجلة الفأرة أو قرص الأصابع): النقطة الواقعة تحت المؤشر
 * تبقى تحته بعد تغيير المقياس. `px/py` إزاحة المؤشر داخل الحاوية بالبكسل،
 * و`clientW/clientH` مقاس الحاوية بالبكسل.
 */
export function zoomAtPoint(
  view: ViewerView,
  base: ViewBase,
  factor: number,
  px: number,
  py: number,
  clientW: number,
  clientH: number,
): ViewerView {
  if (clientW <= 0 || clientH <= 0) return zoomCentered(view, base, factor);
  const v = clampView(view, base);
  const w = base.w / v.scale;
  const h = base.h / v.scale;
  // النقطة تحت المؤشر بوحدات SVG
  const sx = v.cx - w / 2 + (px / clientW) * w;
  const sy = v.cy - h / 2 + (py / clientH) * h;
  const scale = clampScale(v.scale * factor);
  const w2 = base.w / scale;
  const h2 = base.h / scale;
  return clampView({ scale, cx: sx - (px / clientW - 0.5) * w2, cy: sy - (py / clientH - 0.5) * h2 }, base);
}

/** سحب العرض بإزاحة مؤشر بالبكسل — يتحول إلى وحدات SVG حسب المقياس الحالي */
export function panBy(
  view: ViewerView,
  base: ViewBase,
  dxPx: number,
  dyPx: number,
  clientW: number,
  clientH: number,
): ViewerView {
  if (clientW <= 0 || clientH <= 0) return clampView(view, base);
  const v = clampView(view, base);
  const w = base.w / v.scale;
  const h = base.h / v.scale;
  return clampView({ scale: v.scale, cx: v.cx - dxPx * (w / clientW), cy: v.cy - dyPx * (h / clientH) }, base);
}

/**
 * ملاءمة المخطط للعرض: نافذة تحيط بصندوق المحتوى الفعلي (بهامش اختياري) —
 * تُظهر الرسم كاملاً وتزيل الهوامش الميتة عندما يكون المحتوى أصغر من الإطار الأساسي.
 */
export function fitToContent(base: ViewBase, bbox: BBox, pad = 0): ViewerView {
  const bw = bbox.w + pad * 2;
  const bh = bbox.h + pad * 2;
  if (!(bw > 0) || !(bh > 0) || !Number.isFinite(bw) || !Number.isFinite(bh)) return initialView(base);
  const scale = clampScale(Math.min(base.w / bw, base.h / bh));
  return clampView({ scale, cx: bbox.x + bbox.w / 2, cy: bbox.y + bbox.h / 2 }, base);
}
