/**
 * أدوات تحقق مشتركة. `isUuid` تمنع تمرير معرّف غير صالح إلى استعلام على عمود uuid
 * (وإلا يرمي Postgres «invalid input syntax for type uuid» فيظهر كخطأ خادم بدل 404).
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}
