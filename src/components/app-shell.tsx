"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { logoutAction } from "@/app/(auth)/login/actions";
import { OfflineBanner } from "./offline-banner";
import { BackNav } from "./back-nav";
import { FeedbackDock } from "./feedback/feedback-dock";

type NavItem = { href: string; label: string; permission?: string; icon: string };

// مفاتيح تذكّر حالة الشريط الجانبي في المتصفح — التذكّر تحسين تدريجي فقط
const SIDEBAR_SCROLL_KEY = "madrasa-sidebar-scroll-v1";
const navSectionKey = (id: string) => `madrasa-nav-section-${id}-v1`;

const NAV: { id: string; section: string; items: NavItem[] }[] = [
  {
    id: "general",
    section: "عام",
    items: [
      { href: "/dashboard", label: "مركز عمل مدير المدرسة", icon: "◧" },
      { href: "/pilot", label: "مركز التشغيل التجريبي", icon: "✦" },
      { href: "/tasks", label: "المهام والإجراءات", permission: "tasks.read", icon: "☑" },
      { href: "/notifications", label: "الإشعارات", icon: "🔔" },
    ],
  },
  {
    id: "plan",
    section: "الخطة التشغيلية",
    items: [
      { href: "/plan", label: "البرامج والمبادرات", permission: "plan.read", icon: "▤" },
      { href: "/plan/kpis", label: "مؤشرات الأداء", permission: "plan.read", icon: "◔" },
      { href: "/plan/risks", label: "سجل المخاطر", permission: "plan.read", icon: "⚠" },
      { href: "/plan/swot", label: "التحليل الرباعي", permission: "plan.read", icon: "◫" },
      { href: "/budget", label: "الميزانية والمصروفات", permission: "budget.read", icon: "₪" },
      { href: "/evidence", label: "الشواهد", permission: "evidence.read", icon: "▣" },
    ],
  },
  {
    id: "performance",
    section: "الأداء الوظيفي",
    items: [
      { href: "/performance", label: "دورات الأداء", permission: "performance.read", icon: "◉" },
      { href: "/performance/models", label: "نماذج الأداء", permission: "performance.models.manage", icon: "▦" },
    ],
  },
  {
    id: "committees",
    section: "اللجان والمجالس",
    items: [
      { href: "/committees", label: "اللجان والفرق", permission: "committees.read", icon: "◫" },
      { href: "/committees/templates", label: "القوالب", permission: "committees.read", icon: "▢" },
    ],
  },
  {
    id: "building",
    section: "المبنى المدرسي",
    items: [
      { href: "/building", label: "مخطط المبنى", permission: "building.read", icon: "⌂" },
      { href: "/building/facilities", label: "المرافق المطلوب توفيرها", permission: "building.read", icon: "▦" },
      { href: "/building/assets", label: "العهدة والأصول", permission: "assets.read", icon: "▥" },
      { href: "/building/inspections", label: "الفحص والجاهزية", permission: "inspections.read", icon: "✓" },
      { href: "/building/maintenance", label: "بلاغات الصيانة", permission: "maintenance.read", icon: "🛠" },
    ],
  },
  {
    id: "people",
    section: "الأشخاص والتقارير",
    items: [
      { href: "/people", label: "سجل المعلمين والموظفين", permission: "people.read", icon: "☺" },
      { href: "/calendar", label: "التقويم", permission: "calendar.read", icon: "▦" },
      { href: "/reports", label: "التقارير", permission: "reports.read", icon: "▤" },
      { href: "/documents", label: "الوثائق الصادرة", permission: "documents.read", icon: "▩" },
    ],
  },
  {
    id: "admin",
    section: "الإدارة",
    items: [
      { href: "/imports", label: "الاستيراد", permission: "imports.read", icon: "⇪" },
      { href: "/admin/users", label: "المستخدمون والأدوار", permission: "admin.users", icon: "⚙" },
      { href: "/admin/settings", label: "الإعدادات", permission: "admin.settings", icon: "⚙" },
      { href: "/admin/templates", label: "إدارة القوالب", permission: "documents.read", icon: "▤" },
      { href: "/admin/feedback", label: "ملاحظات التشغيل", permission: "feedback.manage", icon: "✎" },
      { href: "/admin/audit", label: "سجل التدقيق", permission: "admin.audit.read", icon: "≡" },
      { href: "/admin/cleanup", label: "تنظيف السجلات التجريبية", permission: "admin.settings", icon: "⌫" },
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
  const [lastPath, setLastPath] = useState(pathname);
  const permSet = new Set(permissions);
  const asideRef = useRef<HTMLElement | null>(null);
  const scrollFrame = useRef(0);

  // إغلاق القائمة عند التنقل بين الصفحات (تعديل حالة أثناء التصيير — النمط الموصى به)
  if (lastPath !== pathname) {
    setLastPath(pathname);
    if (open) setOpen(false);
  }

  // قفل تمرير الصفحة أثناء فتح القائمة + إغلاق بزر Escape
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // استرجاع حالة الشريط الجانبي بعد الترطيب — تعديل DOM عبر ref لا setState (استقرار الترطيب D-029):
  // إغلاق الأقسام التي طواها المستخدم (ما عدا قسم الصفحة الحالية)، ثم استرجاع موضع التمرير،
  // ثم أدنى تمرير لازم لإظهار العنصر النشط إن كان خارج النطاق المرئي.
  useEffect(() => {
    const aside = asideRef.current;
    if (!aside) return;
    try {
      for (const details of aside.querySelectorAll<HTMLDetailsElement>("details[data-nav-section]")) {
        if (
          window.localStorage.getItem(navSectionKey(details.dataset.navSection ?? "")) === "closed" &&
          !details.querySelector('[aria-current="page"]')
        ) {
          details.open = false;
        }
      }
      const saved = Number(window.sessionStorage.getItem(SIDEBAR_SCROLL_KEY));
      if (Number.isFinite(saved) && saved > 0) aside.scrollTop = saved;
    } catch {
      // التذكّر تحسين فقط
    }
    const active = aside.querySelector('[aria-current="page"]');
    if (active) {
      const a = active.getBoundingClientRect();
      const b = aside.getBoundingClientRect();
      if (a.top < b.top || a.bottom > b.bottom) active.scrollIntoView({ block: "nearest" });
    }
    // مرة واحدة عند التحميل فقط — التنقل داخل التطبيق يحافظ على الموضع لأن الغلاف لا يعاد تركيبه
  }, []);

  // عند التنقل: إبقاء قسم الصفحة الحالية مفتوحاً حتى لا يختفي العنصر النشط داخل قسم مطوي
  useEffect(() => {
    const details = asideRef.current
      ?.querySelector('[aria-current="page"]')
      ?.closest("details");
    if (details && !details.open) details.open = true;
  }, [pathname]);

  const nav = NAV.map((s) => ({
    ...s,
    items: s.items.filter((i) => !i.permission || permSet.has(i.permission)),
  })).filter((s) => s.items.length > 0);

  return (
    <div className="flex min-h-dvh">
      {/* خلفية معتمة خلف القائمة على الجوال */}
      {open && (
        <button
          aria-label="إغلاق القائمة"
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      {/* الشريط الجانبي — يلتصق بالحافة اليمنى في الاتجاه العربي وينزلق خارج الشاشة عند الإغلاق */}
      <aside
        ref={asideRef}
        role="navigation"
        aria-label="القائمة الرئيسية"
        className={`no-print fixed inset-y-0 start-0 z-50 flex w-[min(86vw,360px)] transform flex-col overflow-y-auto overscroll-contain bg-brand-900 text-white transition-transform duration-200 lg:sticky lg:top-0 lg:h-dvh lg:z-auto lg:w-64 lg:translate-x-0 ${
          open ? "translate-x-0" : "translate-x-full lg:translate-x-0"
        }`}
        style={{
          paddingTop: "env(safe-area-inset-top)",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
        onScroll={(e) => {
          // حفظ موضع التمرير للاسترجاع بعد إعادة التحميل — مخنوق بإطار رسم واحد
          const top = e.currentTarget.scrollTop;
          cancelAnimationFrame(scrollFrame.current);
          scrollFrame.current = requestAnimationFrame(() => {
            try {
              window.sessionStorage.setItem(SIDEBAR_SCROLL_KEY, String(top));
            } catch {
              // التذكّر تحسين فقط
            }
          });
        }}
      >
        <div className="border-b border-brand-800 p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-lg font-bold">خ</div>
              <div className="min-w-0">
                <div className="text-sm font-bold leading-tight">منصة الإدارة المدرسية المتكاملة</div>
                <div className="mt-0.5 text-xs text-brand-200">مجمع الخشعة التعليمي للبنين</div>
              </div>
            </div>
            <button
              aria-label="إغلاق القائمة"
              className="-me-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-xl text-brand-200 hover:bg-brand-800 lg:hidden"
              onClick={() => setOpen(false)}
            >
              ✕
            </button>
          </div>
        </div>
        <nav className="flex-1 p-3">
          {nav.map((section) => (
            // أقسام قابلة للطي بعنصر <details> أصلي (يعمل بلوحة المفاتيح وبلا JavaScript)،
            // مفتوحة افتراضياً حتى لا يختفي أي رابط؛ طيّ المستخدم يُتذكّر لكل قسم
            <details
              key={section.id}
              data-nav-section={section.id}
              open
              className="group/nav mb-4"
              onToggle={(e) => {
                try {
                  window.localStorage.setItem(navSectionKey(section.id), e.currentTarget.open ? "open" : "closed");
                } catch {
                  // التذكّر تحسين فقط
                }
              }}
            >
              <summary className="mb-1 flex min-h-11 cursor-pointer select-none items-center gap-1 rounded-lg px-2 text-xs font-medium text-brand-300 hover:bg-brand-800 lg:min-h-0 lg:py-1">
                <span aria-hidden className="text-[10px] transition group-open/nav:rotate-90">◂</span>
                {section.section}
              </summary>
              {section.items.map((item) => {
                const active = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href + "/"));
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    aria-current={active ? "page" : undefined}
                    className={`mb-0.5 flex min-h-11 items-center gap-2 rounded-lg px-2 py-2 text-sm transition focus-visible:outline-2 focus-visible:outline-white lg:min-h-0 lg:py-1.5 ${
                      active ? "bg-brand-600 font-medium text-white" : "text-brand-100 hover:bg-brand-800"
                    }`}
                  >
                    <span aria-hidden className="w-5 shrink-0 text-center text-xs opacity-70">{item.icon}</span>
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {item.href === "/notifications" && unreadCount > 0 && (
                      <span className="rounded-full bg-red-500 px-1.5 text-xs tabular-nums">{unreadCount}</span>
                    )}
                  </Link>
                );
              })}
            </details>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header
          className="no-print sticky top-0 z-20 flex items-center justify-between gap-2 border-b border-sand-200 bg-white px-3 py-1.5 sm:px-4"
          style={{ paddingTop: "max(0.375rem, env(safe-area-inset-top))" }}
        >
          <button
            aria-label="فتح القائمة"
            aria-expanded={open}
            className="flex min-h-11 items-center gap-2 rounded-lg border border-sand-200 px-3 text-sm lg:hidden"
            onClick={() => setOpen(true)}
          >
            <span aria-hidden className="text-base leading-none">☰</span>
            القائمة
          </button>
          {/* التاريخ الهجري مشتق من new Date() ويختلف بين الخادم والعميل حسب المنطقة الزمنية/حدود اليوم؛
              suppressHydrationWarning يمنع عدم تطابق الترطيب من زعزعة مطابقة DOM في الغلاف (D-029). */}
          <div className="hidden text-sm text-gray-500 lg:block" suppressHydrationWarning>
            {new Intl.DateTimeFormat("ar-SA-u-ca-islamic-umalqura", { dateStyle: "full" }).format(new Date())}
          </div>
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            {/* «إرسال ملاحظة» في الشريط العلوي (v2.3 §19) — لا زر عائم فوق المحتوى */}
            {permSet.has("feedback.create") && <FeedbackDock enabled />}
            <span className="truncate text-sm font-medium text-gray-700">{displayName}</span>
            <form action={logoutAction}>
              <button className="min-h-11 rounded-lg border border-sand-200 px-3 text-sm text-gray-600 hover:bg-sand-100 lg:min-h-0 lg:py-1.5">
                خروج
              </button>
            </form>
          </div>
        </header>
        <OfflineBanner />
        {/* لا أزرار عائمة بعد v2.3 (§19 + إزالة المساعد) — حاشية سفلية عادية */}
        <main className="min-w-0 flex-1 p-3 pb-6 sm:p-4 sm:pb-6 lg:p-6 lg:pb-6">
          {/* زر «العودة» الموحّد — يظهر تلقائياً في كل صفحة فرعية (v2.2 §C) */}
          <BackNav />
          {children}
        </main>
      </div>
    </div>
  );
}
