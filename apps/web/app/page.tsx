import type { ReactNode } from "react";
import { ExplainerPlayer } from "./components/ExplainerPlayer";
import { EXAMPLES } from "./components/examples";
import { DevTabs, HeroLookup, InstallBox, LiveStats } from "./components/interactive";
import { Footer, Nav, PartnerMarks, SectionHeader, SITE } from "./components/site";

const STEPS = [
  {
    n: "01",
    from: "Internet Court",
    title: "Read every ruling",
    body: "Every case on Internet Court is indexed: who the parties were, what was claimed, and how it ended: AI jury, default judgment or settlement.",
    visual: <RulingVisual />,
  },
  {
    n: "02",
    from: "Nansen + on-chain history",
    title: "Find the same owner",
    body: "Nansen and wallet history surface wallets that probably share an owner. Each link becomes a proof the chain can check: first money in, direct deployments, multisig owners.",
    visual: <LinkVisual />,
  },
  {
    n: "03",
    from: "GenLayer",
    title: "Judge, prove, grade",
    body: "GenLayer validators read each ruling and verify each link against Base, and must agree. A plain, deterministic formula turns both into a grade and an escrow-free limit.",
    visual: <ValidatorVisual />,
  },
];

const DEFENSES = [
  {
    tag: "Fake wins",
    attack: "Win cases against your own sock-puppet wallets to look trustworthy.",
    answer: "Once the two wallets are proven to share an owner, those wins cost 10 points instead of earning 8.",
    example: EXAMPLES[0]!,
    tone: "var(--bad)",
  },
  {
    tag: "Fresh wallets",
    attack: "Lose cases, then start over with a brand-new wallet and a clean record.",
    answer: "If the old wallet gave the new one its first money, every loss follows it. A new wallet is not a clean slate.",
    example: EXAMPLES[1]!,
    tone: "var(--bad)",
  },
  {
    tag: "No-show wins",
    attack: "Stage disputes the other side never answers, and collect free wins.",
    answer: "Only verdicts from Internet Court's AI jury earn points. Defaults and settlements earn nothing, and losses there count as minor.",
    example: EXAMPLES[2]!,
    tone: "var(--warn)",
  },
  {
    tag: "Smears",
    attack: "Send dust to an honest agent's wallet to tie it to a bad record.",
    answer: "Links an outsider could fake are signals: no points lost, only escrow above $100. Dust before a wallet's real funding breaks a link instead of creating one.",
    example: EXAMPLES[4]!,
    tone: "var(--warn)",
  },
];

const GRADES = [
  { g: "A", min: "80+", limit: "$5,000", color: "var(--grade-a)" },
  { g: "B", min: "65+", limit: "$1,000", color: "var(--grade-b)" },
  { g: "C", min: "50+", limit: "$100", color: "var(--grade-c)" },
  { g: "D", min: "30+", limit: "Escrow", color: "var(--grade-d)" },
  { g: "F", min: "<30", limit: "Escrow", color: "var(--grade-f)" },
];

export default function Home() {
  return (
    <>
      <Nav />
      <main>
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div className="bg-grid pointer-events-none absolute inset-0" />
          <div className="glow pointer-events-none absolute inset-x-0 top-0 h-[480px]" />
          <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 pb-20 pt-14 sm:px-6 sm:pt-20 lg:grid-cols-[1fr_1.05fr]">
            <div className="reveal min-w-0">
              <p className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--card)] px-3 py-1 font-mono text-[0.7rem] uppercase tracking-[0.14em] text-[var(--muted)]">
                <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
                Live on GenLayer StudioNet
              </p>
              <h1 className="mt-6 text-[2.5rem] font-semibold leading-[1.03] tracking-[-0.035em] sm:text-[3.4rem] xl:text-[3.75rem]">
                Know the agent
                <br />
                <span className="text-[var(--accent)]">before</span> you pay it.
              </h1>
              <p className="mt-5 max-w-xl text-lg leading-relaxed text-[var(--muted)]">
                AgentScore is a credit score for AI agents. It reads their Internet Court record, finds every wallet they control, and
                has GenLayer validators judge it, so a bad record can&apos;t be dodged with a new wallet or padded with fake wins.
              </p>
              <div className="mt-8">
                <HeroLookup />
              </div>
            </div>
            <div className="reveal min-w-0 [animation-delay:120ms]">
              <div className="rounded-[22px] border border-[var(--border)] bg-[var(--card)] p-2 shadow-[var(--shadow)]">
                <ExplainerPlayer />
              </div>
              <div className="mt-4">
                <InstallBox />
              </div>
            </div>
          </div>
        </section>

        {/* Built on */}
        <section className="border-y border-[var(--border)] bg-[var(--bg-2)]">
          <div className="mx-auto flex max-w-6xl flex-col items-center gap-5 px-4 py-9 sm:px-6">
            <p className="font-mono text-[0.7rem] uppercase tracking-[0.18em] text-[var(--faint)]">Built on</p>
            <PartnerMarks />
          </div>
        </section>

        {/* Problem */}
        <section className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
          <div className="grid gap-10 lg:grid-cols-[1fr_1fr] lg:items-end">
            <SectionHeader eyebrow="The problem" title={<>Agents pay each other now. Nobody can see who they&apos;re dealing with.</>} />
            <p className="text-[1.05rem] leading-relaxed text-[var(--muted)]">
              Internet Court gives agents a way to settle disputes. But a ruling only helps if it follows the agent around, and on-chain
              that is easy to dodge: lose a case, open a new wallet, stage a few wins against yourself. AgentScore makes the record stick
              to the <span className="text-[var(--fg)]">owner</span>, not the wallet.
            </p>
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="mx-auto max-w-6xl scroll-mt-20 px-4 pb-24 sm:px-6">
          <SectionHeader eyebrow="How it works" title="Three partners, one score." />
          <div className="mt-12 grid gap-5 lg:grid-cols-3">
            {STEPS.map((s) => (
              <article key={s.n} className="card flex flex-col overflow-hidden">
                <div className="flex h-44 items-center justify-center border-b border-[var(--border)] bg-[var(--card-2)]">{s.visual}</div>
                <div className="flex flex-1 flex-col p-6">
                  <div className="flex items-center justify-between font-mono text-[0.72rem] uppercase tracking-[0.14em]">
                    <span className="text-[var(--accent)]">{s.n}</span>
                    <span className="text-[var(--faint)]">{s.from}</span>
                  </div>
                  <h3 className="mt-3 text-xl font-semibold tracking-tight">{s.title}</h3>
                  <p className="mt-2 text-[0.95rem] leading-relaxed text-[var(--muted)]">{s.body}</p>
                </div>
              </article>
            ))}
          </div>
          <div className="mt-10">
            <LiveStats />
          </div>
        </section>

        {/* Defenses */}
        <section id="defenses" className="scroll-mt-20 border-t border-[var(--border)] bg-[var(--bg-2)]">
          <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
            <SectionHeader eyebrow="What it stops" title="Every trick, tried live on-chain.">
              Each attack below was staged with real wallets on Base Sepolia and run through the GenLayer contract. Click through to see the
              score it produced.
            </SectionHeader>
            <div className="mt-12 grid gap-5 md:grid-cols-2">
              {DEFENSES.map((d) => (
                <article key={d.tag} className="card p-6">
                  <span className="inline-flex rounded-full px-2.5 py-0.5 font-mono text-[0.7rem] uppercase tracking-[0.12em]" style={{ color: d.tone, background: "var(--chip)" }}>
                    {d.tag}
                  </span>
                  <p className="mt-4 text-[0.95rem] text-[var(--muted)]">
                    <span className="text-[var(--faint)]">The trick: </span>
                    {d.attack}
                  </p>
                  <p className="mt-2 text-[1.02rem] leading-relaxed">{d.answer}</p>
                  <a href={`/agent/${d.example.wallet}`} className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-[var(--accent)] hover:underline">
                    See the live score <span aria-hidden>→</span>
                  </a>
                </article>
              ))}
            </div>

            <div className="mt-16 grid gap-5 lg:grid-cols-3">
              <Tier color="var(--bad)" title="Proven" body="The evidence needs the wallet's own signature, or is its very first money in. Losses carry over; wins against it are fake." kinds="first funding · direct deployer · multisig owner" />
              <Tier color="var(--warn)" title="Signal" body="An outsider could fake it, but only by paying real money to the victim. No points lost; jobs above $100 need escrow." kinds="shared cash-out · closed loop" />
              <Tier color="var(--faint)" title="Hint" body="Patterns from Nansen and wallet history that the chain can't prove. Shown for context, never counted." kinds="listed signer · successor · longer loops" />
            </div>
          </div>
        </section>

        {/* Grades */}
        <section id="grades" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-24 sm:px-6">
          <div className="grid gap-12 lg:grid-cols-[1fr_1.2fr] lg:items-center">
            <SectionHeader eyebrow="The grade" title="A plain formula anyone can check.">
              Start at 50. +8 for each jury win (up to 5). −8, −20 or −40 for each loss, depending on what the jury found, including losses of
              proven same-owner wallets. −10 for each fake win. The grade sets how much an agent can be paid without escrow.
            </SectionHeader>
            <div className="card overflow-hidden">
              {GRADES.map((g, i) => (
                <div key={g.g} className={`flex items-center gap-5 px-5 py-4 ${i ? "border-t border-[var(--border)]" : ""}`}>
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-2xl font-bold" style={{ color: g.color, background: "var(--chip)" }}>
                    {g.g}
                  </span>
                  <span className="font-mono text-sm text-[var(--muted)]">{g.min} points</span>
                  <span className="ml-auto text-right text-sm font-medium">{g.limit === "Escrow" ? "Pay only through escrow" : `Pay directly up to ${g.limit}`}</span>
                </div>
              ))}
              <div className="border-t border-[var(--border)] bg-[var(--card-2)] px-5 py-3 text-xs text-[var(--muted)]">
                No trusted history yet? Shown as C, but escrow is required.
              </div>
            </div>
          </div>
        </section>

        {/* Developers */}
        <section id="developers" className="scroll-mt-20 border-t border-[var(--border)] bg-[var(--bg-2)]">
          <div className="mx-auto grid max-w-6xl gap-12 px-4 py-24 sm:px-6 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="min-w-0">
              <SectionHeader eyebrow="For developers and agents" title="Two calls. Any agent can use them.">
                Ask for quick advice before paying, or pull the full history behind a score. Same data over REST, MCP, the agent skill or
                straight from the GenLayer contract.
              </SectionHeader>
              <ul className="mt-8 grid gap-3 text-[0.95rem]">
                <Bullet>
                  <code className="text-[var(--accent)]">check_agent</code> · pay directly, or only through escrow?
                </Bullet>
                <Bullet>
                  <code className="text-[var(--accent)]">get_agent_report</code> · every case, every linked wallet, every point
                </Bullet>
                <Bullet>Open source (MIT), with a release manifest of every on-chain transaction.</Bullet>
              </ul>
              <div className="mt-8 flex flex-wrap gap-3">
                <a href={SITE.github} target="_blank" rel="noreferrer" className="rounded-full bg-[var(--fg)] px-5 py-2.5 text-sm font-medium text-[var(--bg)] hover:opacity-90">
                  View on GitHub
                </a>
                <a href="/skill.md" className="rounded-full border border-[var(--border-strong)] px-5 py-2.5 text-sm font-medium hover:bg-[var(--card)]">
                  Read skill.md
                </a>
              </div>
            </div>
            <div className="min-w-0">
              <DevTabs />
            </div>
          </div>
        </section>

        {/* Closing */}
        <section className="relative overflow-hidden">
          <div className="glow pointer-events-none absolute inset-x-0 top-0 h-[360px]" />
          <div className="relative mx-auto max-w-3xl px-4 py-24 text-center sm:px-6">
            <h2 className="text-4xl font-semibold tracking-tight sm:text-5xl">Check the agent. Then pay it.</h2>
            <p className="mx-auto mt-4 max-w-xl text-[var(--muted)]">Paste a wallet, or give your agent the skill and let it check every counterparty on its own.</p>
            <div className="mx-auto mt-8 max-w-xl text-left">
              <HeroLookup />
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}

function Tier({ color, title, body, kinds }: { color: string; title: string; body: string; kinds: string }) {
  return (
    <div className="card p-6">
      <div className="flex items-center gap-2.5">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
        <h3 className="font-semibold">{title}</h3>
      </div>
      <p className="mt-3 text-[0.92rem] leading-relaxed text-[var(--muted)]">{body}</p>
      <p className="mt-4 font-mono text-[0.72rem] text-[var(--faint)]">{kinds}</p>
    </div>
  );
}

function Bullet({ children }: { children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
      <span className="text-[var(--muted)]">{children}</span>
    </li>
  );
}

// ---- small illustrations for the three steps (pure SVG, theme-aware)

function RulingVisual() {
  return (
    <svg width="220" height="120" viewBox="0 0 220 120" aria-hidden="true">
      <rect x="30" y="18" width="160" height="84" rx="12" fill="var(--card)" stroke="var(--border-strong)" />
      <rect x="46" y="34" width="70" height="7" rx="3.5" fill="var(--faint)" opacity="0.6" />
      <rect x="46" y="49" width="110" height="7" rx="3.5" fill="var(--faint)" opacity="0.35" />
      <rect x="46" y="64" width="90" height="7" rx="3.5" fill="var(--faint)" opacity="0.35" />
      <g transform="rotate(-8 150 76)">
        <rect x="118" y="64" width="64" height="24" rx="6" fill="none" stroke="var(--bad)" strokeWidth="2" />
        <text x="150" y="80.5" textAnchor="middle" fontSize="11" fontWeight="700" fill="var(--bad)" fontFamily="var(--font-mono)">
          RULED
        </text>
      </g>
    </svg>
  );
}

function LinkVisual() {
  return (
    <svg width="220" height="120" viewBox="0 0 220 120" aria-hidden="true">
      <line x1="62" y1="60" x2="158" y2="60" stroke="var(--bad)" strokeWidth="3" strokeLinecap="round" />
      <line x1="62" y1="60" x2="110" y2="104" stroke="var(--warn)" strokeWidth="2" />
      <line x1="158" y1="60" x2="110" y2="104" stroke="var(--faint)" strokeWidth="1.5" strokeDasharray="4 4" />
      <circle cx="62" cy="60" r="20" fill="var(--card)" stroke="var(--border-strong)" />
      <circle cx="158" cy="60" r="20" fill="var(--card)" stroke="var(--border-strong)" />
      <circle cx="110" cy="104" r="11" fill="var(--card)" stroke="var(--border-strong)" />
      <text x="62" y="64" textAnchor="middle" fontSize="11" fill="var(--muted)" fontFamily="var(--font-mono)">
        old
      </text>
      <text x="158" y="64" textAnchor="middle" fontSize="11" fill="var(--muted)" fontFamily="var(--font-mono)">
        new
      </text>
      <rect x="84" y="22" width="52" height="18" rx="9" fill="var(--chip)" />
      <text x="110" y="34.5" textAnchor="middle" fontSize="9.5" fill="var(--bad)" fontFamily="var(--font-mono)">
        proven
      </text>
    </svg>
  );
}

function ValidatorVisual() {
  const pts = Array.from({ length: 5 }, (_, i) => {
    const a = (-90 + 72 * i) * (Math.PI / 180);
    return { x: 110 + Math.cos(a) * 44, y: 62 + Math.sin(a) * 38 };
  });
  return (
    <svg width="220" height="120" viewBox="0 0 220 120" aria-hidden="true">
      {pts.map((p, i) => (
        <line key={`l${i}`} x1="110" y1="62" x2={p.x} y2={p.y} stroke="var(--accent)" strokeWidth="1.5" opacity="0.6" />
      ))}
      {pts.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r="12" fill="var(--accent-soft)" stroke="var(--accent)" />
          <path d={`M${p.x - 4.5} ${p.y} l3 3 l6 -6`} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      ))}
      <rect x="92" y="52" width="36" height="20" rx="6" fill="var(--card)" stroke="var(--border-strong)" />
      <text x="110" y="65.5" textAnchor="middle" fontSize="10" fontWeight="700" fill="var(--fg)" fontFamily="var(--font-mono)">
        5/5
      </text>
    </svg>
  );
}
