"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useRef } from "react";
import { supabase } from "@/lib/supabase";
import type { User } from "@supabase/supabase-js";
import Logo from "./Logo";

const NAV_ITEMS = [
  { label: "Subnets", href: "/" },
  { label: "Signals", href: "/signals" },
  { label: "Performance", href: "/performance" },
  { label: "Portfolio", href: "/portfolio" },
];

export default function Navbar() {
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, []);

  async function handleSignOut() {
    await supabase.auth.signOut();
    setDropdownOpen(false);
  }

  return (
    <nav className="border-b border-border bg-surface sticky top-0 z-[200] px-5 h-12 flex items-center justify-between">
      <div className="flex items-center gap-0">
        <Link href="/" className="no-underline">
          <Logo />
        </Link>
        {NAV_ITEMS.map((item) => {
          const isActive = item.href === "/"
            ? pathname === "/"
            : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`font-mono text-[10px] tracking-[0.12em] uppercase px-[18px] h-12 flex items-center border-b-2 transition-all duration-150 no-underline whitespace-nowrap ${
                isActive
                  ? "text-cyan border-cyan"
                  : "text-muted border-transparent hover:text-text"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5 font-mono text-[10px] text-green">
          <div className="w-1.5 h-1.5 rounded-full bg-green animate-pulse" />
          CHAIN NATIVE
        </div>

        {/* Account dropdown */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className={`font-mono text-[10px] tracking-[0.08em] uppercase px-3 py-1.5 border cursor-pointer flex items-center gap-1.5 transition-all duration-150 ${
              user
                ? "border-cyan text-cyan"
                : "border-border2 text-muted hover:border-cyan hover:text-cyan"
            }`}
          >
            {user ? (user.email && user.email.length > 20 ? user.email.slice(0, 18) + "..." : user.email) : "Account"}
            <span className={`text-[8px] transition-transform duration-150 ${dropdownOpen ? "rotate-180" : ""}`}>
              &#9662;
            </span>
          </button>

          {dropdownOpen && (
            <div className="absolute top-[calc(100%+4px)] right-0 bg-surface2 border border-border2 min-w-[180px] z-[9999]">
              {user ? (
                <>
                  <Link
                    href="/portfolio"
                    onClick={() => setDropdownOpen(false)}
                    className="block font-mono text-[10px] tracking-[0.06em] uppercase text-muted px-3.5 py-2.5 border-b border-border hover:text-text hover:bg-surface transition-all no-underline"
                  >
                    Portfolio
                  </Link>
                  <Link
                    href="/portfolio"
                    onClick={() => setDropdownOpen(false)}
                    className="block font-mono text-[10px] tracking-[0.06em] uppercase text-muted px-3.5 py-2.5 border-b border-border hover:text-text hover:bg-surface transition-all no-underline"
                  >
                    Settings
                  </Link>
                  <button
                    onClick={handleSignOut}
                    className="w-full text-left font-mono text-[10px] tracking-[0.06em] uppercase text-red px-3.5 py-2.5 hover:bg-surface transition-all cursor-pointer border-0 bg-transparent"
                  >
                    Sign Out
                  </button>
                </>
              ) : (
                <>
                  <Link
                    href="/portfolio?mode=signin"
                    onClick={() => setDropdownOpen(false)}
                    className="block font-mono text-[10px] tracking-[0.06em] uppercase text-muted px-3.5 py-2.5 border-b border-border hover:text-cyan hover:bg-surface transition-all no-underline"
                  >
                    Sign In
                  </Link>
                  <Link
                    href="/portfolio?mode=signup"
                    onClick={() => setDropdownOpen(false)}
                    className="block font-mono text-[10px] tracking-[0.06em] uppercase text-muted px-3.5 py-2.5 hover:text-cyan hover:bg-surface transition-all no-underline"
                  >
                    Create Account
                  </Link>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}
