import { asc, eq } from "drizzle-orm";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/db";
import { users, roles, userRoles } from "@/db/schema";
import { PageHeader, Table, Badge, Card } from "@/components/ui";
import { ChangePasswordForm } from "./users-ui";

export const metadata = { title: "المستخدمون والأدوار" };
export const dynamic = "force-dynamic";

export default async function UsersPage() {
  await requirePermission("admin.users");
  const allUsers = await db.select().from(users).orderBy(asc(users.username));
  const allRoles = await db.select().from(roles);
  const links = await db.select().from(userRoles);
  const roleName = new Map(allRoles.map((r) => [r.id, r.nameAr]));
  const userRoleNames = new Map<string, string[]>();
  for (const l of links) {
    const arr = userRoleNames.get(l.userId) ?? [];
    arr.push(roleName.get(l.roleId) ?? "");
    userRoleNames.set(l.userId, arr);
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="المستخدمون والأدوار"
        subtitle="الإصدار الأول يقتصر على حسابي مدير المدرسة ومسؤول النظام — الأدوار المستقبلية تضاف دون تعديل برمجي"
      />
      <Table headers={["اسم المستخدم", "الاسم", "الأدوار", "التحقق الثنائي", "الحالة"]}>
        {allUsers.map((u) => (
          <tr key={u.id}>
            <td className="px-3 py-2 font-medium" dir="ltr">{u.username}</td>
            <td className="px-3 py-2">{u.displayName}</td>
            <td className="px-3 py-2 text-xs">{(userRoleNames.get(u.id) ?? []).join("، ")}</td>
            <td className="px-3 py-2 text-xs">{u.totpEnabled ? "مفعل" : "غير مفعل"}</td>
            <td className="px-3 py-2">{u.active ? <Badge value="نشطة" /> : <Badge value="ملغاة" />}</td>
          </tr>
        ))}
      </Table>
      <Card>
        <h2 className="mb-3 font-bold text-brand-900">تغيير كلمة المرور</h2>
        <ChangePasswordForm usernames={allUsers.map((u) => u.username)} />
      </Card>
      <Card>
        <h2 className="mb-2 font-bold text-brand-900">الأدوار والأذونات</h2>
        <p className="text-sm text-gray-500">
          {allRoles.map((r) => r.nameAr).join("، ")} — تفاصيل الأداء الفردي حكر على دور مدير المدرسة، ولا يمنح أي دور مستقبلي هذه الصلاحية إلا صراحة.
        </p>
      </Card>
    </div>
  );
}
