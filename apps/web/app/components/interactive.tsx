"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { SITE } from "./site";

import { EXAMPLES } from "./examples";

export { EXAMPLES };

const isWallet = (v: string) => /^0x[0-9a-fA-F]{40}$/.test(v.trim());

export function HeroLookup() {
  const router = useRouter();
  const [wallet, setWallet] = useState("");
  const [error, setError] = useState<string | null>(null);
  const go = (w: string) => {
    if (!isWallet(w)) return setError("Paste a 0x wallet address (42 characters).");
    setError(null);
    router.push(`/agent/${w.trim()}`);
  };
  return (
    <div id="check" className="scroll-mt-24">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          go(wallet);
        }}
        className="flex flex-col gap-2 rounded-2xl border border-[var(--border-strong)] bg-[var(--card)] p-2 shadow-[var(--shadow)] sm:flex-row"
      >
        <input
          value={wallet}
          onChange={(e) => setWallet(e.target.value)}
          placeholder="Paste an agent's wallet (0x…)"
          aria-label="Agent wallet address"
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent px-3 py-2.5 font-mono text-sm outline-none placeholder:text-[var(--faint)]"
        />
        <button className="rounded-xl bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-[var(--accent-fg)] hover:opacity-90">Check agent</button>
      </form>
      {error && <p className="mt-2 text-sm text-[var(--bad)]">{error}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="font-mono text-[0.7rem] uppercase tracking-[0.14em] text-[var(--faint)]">Try</span>
        {EXAMPLES.slice(0, 4).map((ex) => (
          <button
            key={ex.wallet}
            type="button"
            onClick={() => go(ex.wallet)}
            title={ex.note}
            className="rounded-full border border-[var(--border)] px-3 py-1 text-xs text-[var(--muted)] transition hover:border-[var(--accent)] hover:text-[var(--fg)]"
          >
            {ex.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="shrink-0 rounded-lg border border-[var(--border)] px-2.5 py-1 font-mono text-[0.7rem] text-[var(--muted)] hover:text-[var(--fg)]"
      aria-label="Copy command"
    >
      {copied ? "copied" : "copy"}
    </button>
  );
}

const INSTALL = [
  { id: "agent", label: "For your agent", cmd: `curl -s ${SITE.skill}`, note: "Your agent reads skill.md and learns when and how to check a counterparty." },
  { id: "claude", label: "Claude / MCP", cmd: `claude mcp add --transport http agentscore ${SITE.mcp}`, note: "Two tools: check_agent and get_agent_report. Nothing to install." },
  { id: "api", label: "REST", cmd: `curl "${SITE.api}/v1/check?wallet=0x…&amount=500"`, note: "Plain HTTP: advice for the payer, grade, limit and flags." },
];

/** Copy-paste ways in, for agents and developers. */
export function InstallBox() {
  const [tab, setTab] = useState(INSTALL[0]!.id);
  const t = INSTALL.find((x) => x.id === tab)!;
  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)]">
      <div className="flex border-b border-[var(--border)]">
        {INSTALL.map((x) => (
          <button
            key={x.id}
            type="button"
            onClick={() => setTab(x.id)}
            className={`px-4 py-2.5 font-mono text-[0.72rem] uppercase tracking-[0.12em] transition ${
              tab === x.id ? "text-[var(--fg)] shadow-[inset_0_-2px_0_var(--accent)]" : "text-[var(--faint)] hover:text-[var(--muted)]"
            }`}
          >
            {x.label}
          </button>
        ))}
      </div>
      <div className="flex items-start gap-3 px-4 py-4">
        <span className="font-mono text-sm text-[var(--accent)]">$</span>
        <code className="min-w-0 flex-1 text-[0.82rem] leading-relaxed [overflow-wrap:anywhere]">{t.cmd}</code>
        <CopyButton text={t.cmd} />
      </div>
      <p className="border-t border-[var(--border)] px-4 py-3 text-xs text-[var(--muted)]">{t.note}</p>
    </div>
  );
}

const SNIPPETS: Record<string, { title: string; lang: string; code: string }> = {
  check: {
    title: "Quick advice",
    lang: "bash",
    code: `curl "${SITE.api}/v1/check?wallet=0x36b2…24Cc&amount=500"

{
  "advice": "Pay this agent only through escrow (an Internet Court agreement) for a $500 job.",
  "decision": "deny",
  "grade": "D", "points": 40, "approvalLimitUsd": 0,
  "flags": ["FAKE_WINS"]
}`,
  },
  report: {
    title: "Full history",
    lang: "bash",
    code: `curl "${SITE.api}/v1/agents/0x9c98…797c/report"

"linkedWallets": [{
  "tier": "proven",
  "evidence": "0x9a88…ad69 sent this wallet its first funds",
  "inheritedLosses": [{ "caseId": 20, "effect": "−8: inherited minor loss" }]
}]`,
  },
  mcp: {
    title: "MCP",
    lang: "bash",
    code: `claude mcp add --transport http agentscore ${SITE.mcp}

# then, in any conversation:
> Before I pay 0x36b2…24Cc $500 for this job, check it.
  → check_agent: "Pay this agent only through escrow…"`,
  },
  contract: {
    title: "On-chain",
    lang: "bash",
    code: `genlayer call ${SITE.contract} get_score --args 0x9c98…797c

{ grade: 'D', points: 42, approval_limit_usd: 0,
  flags: [ 'INHERITED_LOSSES' ] }`,
  },
};

export function DevTabs() {
  const [tab, setTab] = useState("check");
  const s = SNIPPETS[tab]!;
  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)]">
      <div className="flex flex-wrap gap-1 border-b border-[var(--border)] p-2">
        {Object.entries(SNIPPETS).map(([id, x]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`rounded-lg px-3 py-1.5 text-sm transition ${tab === id ? "bg-[var(--chip)] text-[var(--fg)]" : "text-[var(--muted)] hover:text-[var(--fg)]"}`}
          >
            {x.title}
          </button>
        ))}
      </div>
      <pre className="whitespace-pre-wrap p-5 text-[0.8rem] leading-relaxed text-[var(--fg)] [overflow-wrap:anywhere]">
        <code>{s.code}</code>
      </pre>
    </div>
  );
}

interface Stats {
  casesIndexed: number;
  casesRuled: number;
  casesJudgedOnChain: number | null;
  juryCases: number;
}

/** Live numbers from the index and the GenLayer contract. */
export function LiveStats() {
  const [stats, setStats] = useState<Stats | null>(null);
  useEffect(() => {
    fetch("/api/v1/stats")
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => setStats(s))
      .catch(() => setStats(null));
  }, []);
  const items = [
    { label: "Internet Court cases indexed", value: stats?.casesIndexed },
    { label: "Ruled cases", value: stats?.casesRuled },
    { label: "Judged on-chain by GenLayer", value: stats?.casesJudgedOnChain ?? undefined },
    { label: "Live demo steps that count as proof", value: 27 },
  ];
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--border)] md:grid-cols-4">
      {items.map((i) => (
        <div key={i.label} className="bg-[var(--card)] p-5 sm:p-6">
          <div className="text-3xl font-semibold tracking-tight sm:text-4xl">{i.value ?? <span className="text-[var(--faint)]">—</span>}</div>
          <div className="mt-1.5 text-sm text-[var(--muted)]">{i.label}</div>
        </div>
      ))}
    </div>
  );
}
