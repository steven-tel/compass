"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/tutor", label: "Tutor" },
  { href: "/sessions", label: "Sessions" },
  { href: "/concepts", label: "Profile" },
];

export function BottomNav() {
  const pathname = usePathname();
  if (
    pathname === "/sessions" ||
    pathname.startsWith("/sessions/") ||
    pathname === "/concepts" ||
    pathname.startsWith("/concepts/")
  ) {
    return null;
  }
  return (
    <nav className="bottom-nav">
      {items.map((item) => {
        const active =
          item.href === "/tutor" ? pathname === "/tutor" : pathname.startsWith(item.href);
        return (
          <Link key={item.href} href={item.href} className={active ? "active" : ""}>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
