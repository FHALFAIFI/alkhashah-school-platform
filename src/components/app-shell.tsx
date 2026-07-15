"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { logoutAction } from "@/app/(auth)/login/actions";

type NavItem = { href: string; label: string; permission?: string; icon: string };

const NAV: { section: string; items: NavItem[] }[] = [
  {
    section: "عام",
    items: [
      { href: "/dashboard", label: "لوحة المتابعة", icon: "◧" },
      { href: "/tasks", label: "المهام والإجراءات", permission: "tasks.read", icon: "☑" },
      { href: "/notifications", label: "الإشعارات", icon: "🔔" },
    ],
  },
  {
    section: "الخطة التشغيلية",
    items: [
      { href: "/plan", label: "البرامج والمبادرات", permission: "plan.read", icon: "▤" },
      { href: "/plan/kpis", label: "مؤشرات الأداء", permission: "plan.read", icon: "◔" },
      { href: "/plan/risks", label: "سجل المخاطر", permission: "plan.read", icon: "⚠" },
      { href: "/evidence", label: "الشواهد", permission: "evidence.read", icon: "▣" },
    ],
  },
  {
    section: "الأداء الوظيفي",
    items: [
      { href: "/performance", label: "دورات الأداء", permission: "performance.read", icon: "◉" },
      { href: "/performance/models", label: "نماذج الأداء", permission: "performance.models.manage", icon: "▦" },
    ],
  },
  {
    section: "اللجان والمجالس",
    items: [
      { href: "/committees", label: "اللجان والفرق", permission: "committees.read", icon: "◫" },
      { href: "/committees/templates", label: "القوالب", permission: "committees.read", icon: "▢" },
    ],
  },
  {
    section: "المبنى المدرسي",
    items: [
      { href: "/building", label: "مخطط المبنى", permission: "building.read", icon: "⌂" },
      { href: "/building/assets", label: "العهدة والأصول", permission: "assets.read", icon: "▥" },
      { href: "/building/inspections", label: "الفحص والجاهزية", permission: "inspections.read", icon: "✓" },
      { href: "/building/maintenance", label: "الصيانة", permission: "maintenance.read", icon: "🛠" },
    ],
  },
  {
    section: "الأشخاص والتقارير",
    items: [
      { href: "/people", label: "سجل المعلمين والموظفين", permission: "people.read", icon: "☺" },
      { href: "/calendar", label: "التقويم", permission: "calendar.read", icon: "▦" },
      { href: "/reports", label: "التقارير", permission: "reports.read", icon: "▤" },
      { href: "/documents", label: "الوثائق الصادرة", permission: "documents.read", icon: "▩" },
    ],
  },
  {
    section: "الإدارة",
    items: [
      { href: "/imports", label: "الاستيراد", permission: "imports.read", icon: "⇪" },
      { href: "/admin/users", label: "المستخدمون والأدوار", permission: "admin.users", icon: "⚙" },
      { href: "/admin/settings", label: "الإعدادات", permission: "admin.settings", icon: "⚙" },
      { href: "/admin/audit", label: "سجل التدقيق", permission: "admin.audit.read", icon: "≡" },
      { href: "/admin/backup", label: "النسخ الاحتياطي", permission: "admin.backup", icon: "⛁" },
    ],
  },
];

export function AppShell({
  displayName,
  permissions,
  unreadCount,
  children,
}: {
  displayName: string;
  permissions: string[];
  unreadCount: number;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const permSet = new Set(permissions);

  const nav = NAV.map((s) => ({
    ...s,
    items: s.items.filter((i) => !i.permission || permSet.has(i.permission)),
  })).filter((s) => s.items.length > 0);

  return (
    <div className="flex min-h-screen">
      {/* الشريط الجانبي */}
      <aside
        className={`no-print fixed inset-y-0 end-0 z-40 w-64 transform overflow-y-auto bg-brand-900 text-white transition-transform lg:static lg:translate-x-0 ${
          open ? "translate-x-0" : "translate-x-full lg:translate-x-0"
        }`}
      >
        <div className="border-b border-brand-800 p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600 text-lg font-bold">خ</div>
            <div>
              <div className="text-sm font-bold leading-tight">منصة الإدارة المدرسية المتكاملة</div>
              <div className="mt-0.5 text-xs text-brand-200">مجمع الخشعة التعليمي للبنين</div>
            </div>
          </div>
        </div>
        <nav className="p-3">
          {nav.map((section) => (
            <div key={section.section} className="mb-4">
              <div className="mb-1 px-2 text-xs font-medium text-brand-300">{section.section}</div>
              {section.items.map((item) => {
                const active = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href + "/"));
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className={`mb-0.5 flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition ${
                      active ? "bg-brand-600 font-medium text-white" : "text-brand-100 hover:bg-brand-800"
                    }`}
                  >
                    <span aria-hidden className="w-5 text-center text-xs opacity-70">{item.icon}</span>
                    <span className="flex-1">{item.label}</span>
                    {item.href === "/notifications" && unreadCount > 0 && (
                      <span className="rounded-full bg-red-500 px-1.5 text-xs tabular-nums">{unreadCount}</span>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
      </aside>

      {open && (
        <button
          aria-label="إغلاق القائمة"
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-20 flex items-center justify-between border-b border-sand-200 bg-white px-4 py-2.5">
          <button
            className="rounded-lg border border-sand-200 px-3 py-1.5 text-sm lg:hidden"
            onClick={() => setOpen(true)}
          >
            القائمة
          </button>
          <div className="hidden text-sm text-gray-500 lg:block">
            {new Intl.DateTimeFormat("ar-SA-u-ca-islamic-umalqura", { dateStyle: "full" }).format(new Date())}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-gray-700">{displayName}</span>
            <form action={logoutAction}>
              <button className="rounded-lg border border-sand-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-sand-100">
                خروج
              </button>
            </form>
          </div>
        </header>
        <main className="flex-1 p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
