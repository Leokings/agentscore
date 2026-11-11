"use client";

import { useEffect, useRef, useState } from "react";

const LINKS = [
  ["How it works", "/#how"],
  ["Defenses", "/#defenses"],
  ["Grades", "/#grades"],
  ["Developers", "/#developers"],
  ["skill.md", "/skill.md"],
  ["GitHub", "https://github.com/Leokings/agentscore"],
] as const;

/** The section links on phones and small tablets, behind a menu button. */
export function MobileMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative md:hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? "Close menu" : "Open menu"}
        className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[var(--border)] text-[var(--fg)]"
      >
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
          {open ? (
            <path d="M4 4 L14 14 M14 4 L4 14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          ) : (
            <path d="M3 5.5 H15 M3 9 H15 M3 12.5 H15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          )}
        </svg>
      </button>
      {open && (
        <nav className="absolute right-0 top-12 w-56 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] py-2 shadow-[var(--shadow)]">
          {LINKS.map(([label, href]) => (
            <a
              key={label}
              href={href}
              onClick={() => setOpen(false)}
              className="block px-4 py-3 text-[0.95rem] text-[var(--fg)] hover:bg-[var(--chip)]"
              {...(href.startsWith("http") ? { target: "_blank", rel: "noreferrer" } : {})}
            >
              {label}
            </a>
          ))}
        </nav>
      )}
    </div>
  );
}
