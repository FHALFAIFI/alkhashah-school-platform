import { z } from "zod";
import { isValidIsoDate } from "@/lib/dates";

/**
 * مخططات zod الموحّدة لتواريخ الإدخال (D-033):
 * القيمة القانونية الوحيدة ميلادي ISO (YYYY-MM-DD)، والتاريخ المستحيل يُرفض
 * برسالة عربية بدل أن يُسقَط صامتاً من التجميعات لاحقاً.
 */

const INVALID_DATE_MSG = "التاريخ غير صحيح — اختر التاريخ من الحقل";

/** تاريخ اختياري: الفراغ يصبح undefined، وأي قيمة يجب أن تكون ISO صحيحاً */
export const optionalIsoDate = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? undefined : v),
  z
    .string()
    .refine((s) => isValidIsoDate(s), INVALID_DATE_MSG)
    .optional(),
);

/** تاريخ إلزامي بصيغة ISO صحيحة */
export const requiredIsoDate = z.string().refine((s) => isValidIsoDate(s), INVALID_DATE_MSG);
