import Link from "next/link";
import type { ReactNode } from "react";

export const SITE = {
  github: "https://github.com/Leokings/agentscore",
  api: "https://agentscore-seven.vercel.app/api",
  mcp: "https://agentscore-seven.vercel.app/api/mcp",
  skill: "https://agentscore-seven.vercel.app/skill.md",
  contract: "0xC7CBE19697ce01581b9F32514014A8ABC0f03A76",
  internetCourt: "https://internetcourt.org",
  genlayer: "https://www.genlayer.com",
  nansen: "https://www.nansen.ai",
};

/**
 * The AgentScore mark: two wallets (the feet) joined by one owner (the apex) form an A, the top
 * grade. The record follows the owner, not the wallet. Source: public/brand/agentscore-mark.svg.
 */
export function Logo({ size = 30 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/agentscore-mark.svg" width={size} height={size} alt="" aria-hidden="true" className="rounded-[9px]" />
      <span className="text-[1.08rem] font-semibold tracking-tight">AgentScore</span>
    </span>
  );
}

function GitHubIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

export function Nav() {
  return (
    <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--bg)_82%,transparent)] backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" aria-label="AgentScore home">
          <Logo />
        </Link>
        <nav className="hidden items-center gap-7 text-sm text-[var(--muted)] md:flex">
          <a href="/#how" className="hover:text-[var(--fg)]">How it works</a>
          <a href="/#defenses" className="hover:text-[var(--fg)]">Defenses</a>
          <a href="/#developers" className="hover:text-[var(--fg)]">Developers</a>
          <a href="/#grades" className="hover:text-[var(--fg)]">Grades</a>
        </nav>
        <div className="flex items-center gap-2">
          <a
            href={SITE.github}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-9 items-center gap-2 rounded-full border border-[var(--border)] px-3.5 text-sm text-[var(--muted)] hover:border-[var(--border-strong)] hover:text-[var(--fg)]"
          >
            <GitHubIcon />
            <span className="hidden sm:inline">GitHub</span>
          </a>
          <a href="/#check" className="inline-flex h-9 items-center rounded-full bg-[var(--accent)] px-4 text-sm font-medium text-[var(--accent-fg)] hover:opacity-90">
            Check an agent
          </a>
        </div>
      </div>
    </header>
  );
}

export function SectionHeader({ eyebrow, title, children, center = false }: { eyebrow: string; title: ReactNode; children?: ReactNode; center?: boolean }) {
  return (
    <div className={center ? "mx-auto max-w-2xl text-center" : "max-w-2xl"}>
      <p className="eyebrow">{eyebrow}</p>
      <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-[2.6rem] sm:leading-[1.08]">{title}</h2>
      {children && <p className="mt-4 text-[1.05rem] leading-relaxed text-[var(--muted)]">{children}</p>}
    </div>
  );
}

/** Official partner logos, shown as one monochrome strip (white on dark, ink on light). */
export const PARTNER_LOGOS = [
  { name: "Internet Court", src: "/partners/internet-court.svg", href: SITE.internetCourt, role: "Rulings", h: 26 },
  { name: "GenLayer", src: "/partners/genlayer.svg", href: SITE.genlayer, role: "Judgment", h: 30 },
  { name: "Nansen", src: "/partners/nansen.png", href: SITE.nansen, role: "Wallet links", h: 26 },
];

/** Built on: the three projects AgentScore runs on. */
export function PartnerMarks() {
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-14 gap-y-8">
      {PARTNER_LOGOS.map((p) => (
        <a key={p.name} href={p.href} target="_blank" rel="noreferrer" className="group flex flex-col items-center gap-2.5" aria-label={p.name}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={p.src} alt={p.name} style={{ height: p.h }} className="partner-logo w-auto opacity-75 transition group-hover:opacity-100" />
          <span className="font-mono text-[0.66rem] uppercase tracking-[0.16em] text-[var(--faint)]">{p.role}</span>
        </a>
      ))}
    </div>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-[var(--border)]">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <Logo />
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-[var(--muted)]">
            Credit scores for AI agents. Built for the Internet Court Builders mission. Test networks only: Base Sepolia and GenLayer StudioNet.
          </p>
        </div>
        <FooterCol title="Product" links={[["Check an agent", "/#check"], ["How it works", "/#how"], ["Grades", "/#grades"]]} />
        <FooterCol title="Developers" links={[["REST API", "/#developers"], ["MCP server", "/#developers"], ["skill.md", "/skill.md"], ["GitHub", SITE.github]]} />
        <FooterCol title="Built on" links={[["Internet Court", SITE.internetCourt], ["GenLayer", SITE.genlayer], ["Nansen", SITE.nansen]]} />
      </div>
      <div className="mx-auto max-w-6xl px-4 pb-10 font-mono text-[0.72rem] text-[var(--faint)] sm:px-6">
        GenLayer contract {SITE.contract} · StudioNet
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: Array<[string, string]> }) {
  return (
    <div>
      <p className="text-sm font-medium">{title}</p>
      <ul className="mt-3 grid gap-2 text-sm text-[var(--muted)]">
        {links.map(([label, href]) => (
          <li key={label}>
            <a href={href} className="hover:text-[var(--fg)]" {...(href.startsWith("http") ? { target: "_blank", rel: "noreferrer" } : {})}>
              {label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
