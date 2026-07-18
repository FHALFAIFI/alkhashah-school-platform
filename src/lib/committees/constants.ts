/** فئات مرفقات الاجتماع (عربية) — ثابت مشترك بين الإجراءات والواجهة. */
export const MEETING_ATTACHMENT_CATEGORIES = ["مادة جدول أعمال", "مستندات داعمة", "مراسلات خارجية", "أخرى"] as const;
export type MeetingAttachmentCategory = (typeof MEETING_ATTACHMENT_CATEGORIES)[number];
