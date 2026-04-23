import "./globals.css";
import type { ReactNode } from "react";
import Link from "next/link";
import { AuthProvider } from "./auth-provider";
import { AuthNav } from "./auth-nav";

const navigationItems = [
  { href: "/", label: "Home" },
  { href: "/library", label: "Library" },
  { href: "/practice-plans", label: "Practice Plans" },
  { href: "/calendar", label: "Calendar" },
  { href: "/tournaments", label: "Tournaments" },
  { href: "/wrestlers", label: "Wrestlers" },
];

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <div className="site-shell">
            <header className="site-header">
              <div className="site-header__inner">
                <Link href="/" className="brand-mark">
                  <span className="brand-mark__badge">WW</span>
                  <span>
                    <strong>WrestleWell</strong>
                    <span className="brand-mark__sub">Coach + Athlete Platform</span>
                  </span>
                </Link>

                <div className="site-header__actions">
                  <nav className="site-nav" aria-label="Primary">
                    {navigationItems.map((item) => (
                      <Link key={item.href} href={item.href} className="site-nav__link">
                        {item.label}
                      </Link>
                    ))}
                  </nav>

                  <AuthNav />
                </div>
              </div>
            </header>

            <main className="site-main">{children}</main>
          </div>
        </AuthProvider>
      </body>
    </html>
  );
}
