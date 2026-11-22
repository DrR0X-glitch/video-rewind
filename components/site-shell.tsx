"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { ThemeToggle } from "@/components/theme-toggle";

export function SiteShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isInventory = pathname.startsWith("/inventory");

  return (
    <>
      <header className="site-header">
        <div className="container masthead">
          <div className="site-brand">
            <Link href={isInventory ? "/inventory" : "/"} className="site-title">
              <span className="site-logo-placeholder" aria-hidden="true">Video Rewind</span>
              <span className="sr-only">Video Rewind</span>
            </Link>
          </div>
          <div className="header-tools">
            <ThemeToggle />
          </div>
        </div>
        <div className="container nav-row">
          <nav className="nav" aria-label={isInventory ? "Inventory" : "Primary"}>
            {isInventory ? (
              <>
                <Link href="/">Homepage</Link>
                <Link href="/inventory">Titles</Link>
                <Link href="/inventory/stock">Stock</Link>
                <Link href="/inventory/review">Review</Link>
                <Link href="/inventory/new">New</Link>
              </>
            ) : (
              <>
                <Link href="/">Browse</Link>
                <Link href="/search">Search</Link>
              </>
            )}
          </nav>
        </div>
      </header>
      <main className="container page-shell">{children}</main>
      <footer className="container site-footer">
        <div className="footer-row">
          <p>Video Rewind catalogue and rental archive.</p>
          <Link href="/inventory">Staff Login</Link>
        </div>
      </footer>
    </>
  );
}
