import { LinkButton } from "./ui";
import { reportHref, type CategoryKey } from "@/lib/reports/catalog";

/**
 * زر «تقارير القسم» الموحّد (v2.2 §D).
 *
 * كل قسم يربط إلى مركز التقارير على فئته مباشرةً (ومع تقرير ومرشّحات ابتدائية حين
 * تُمرَّر) بدل أن يبني القسم محرّك تقارير خاصاً به.
 */
export function SectionReportsLink({
  category,
  report,
  params,
  label = "تقارير القسم",
}: {
  category: CategoryKey;
  report?: string;
  params?: Record<string, string | undefined>;
  label?: string;
}) {
  return (
    <LinkButton href={reportHref(category, report, params)} variant="secondary">
      {label}
    </LinkButton>
  );
}
