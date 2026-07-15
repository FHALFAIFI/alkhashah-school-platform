import { requirePermission } from "@/lib/auth/session";
import { PageHeader, Card } from "@/components/ui";
import { PersonForm } from "../person-form";

export const metadata = { title: "إضافة شخص" };

export default async function NewPersonPage() {
  await requirePermission("people.write");
  return (
    <div className="max-w-2xl">
      <PageHeader title="إضافة شخص" subtitle="معلم أو موظف جديد في سجل المجمع" />
      <Card>
        <PersonForm />
      </Card>
    </div>
  );
}
