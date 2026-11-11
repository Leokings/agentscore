"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import type { WalletLink } from "@agentscore/shared";
import { HeroLookup } from "../../components/interactive";

const LinkGraph = dynamic(() => import("../../LinkGraph").then((m) => m.LinkGraph), { ssr: false });

const API = process.env.NEXT_PUBLIC_AGENTSCORE_API_URL ?? "/api";

/** GET /v1/agents/:wallet/report (apps/api/src/report.ts). */
interface Report {
  wallet: string;
  advice: string;
  grade: string | null;
  status: string;
  points: number | null;
  approvalLimitUsd: number | null;
  flags: Array<{ code: string; meaning: string }>;
  summary: string | null;
  contract: string | null;
  cases: Array<{
    id: number;
    address: string;
    explorer: string;
    role: string;
    claim: string | null;
    reasoning: string | null;
    decidedBy: string;
    result: string;
    severity: string | null;
    effect: string;
  }>;
  linkedWallets: Array<{
    wallet: string;
    tier?: "proven" | "signal" | "hint";
    proven: boolean;
    effect?: string;
    evidence: string;
    inheritedLosses: Array<{ caseId: number; explorer: string; claim: string | null; severity: string; effect: string }>;
  }>;
  signals: WalletLink[];
  proven: Record<string, string>;
  verifiedSignals?: Record<string, string>;
}

const FLAG_LABEL: Record<string, string> = {
  FAKE_WINS: "Fake wins",
  INHERITED_LOSSES: "Inherited losses",
  UNCONTESTED_WINS: "No-show wins",
  UNCLEAR_RULINGS: "Unclear rulings",
  NO_HISTORY: "No trusted history",
  POSSIBLE_SAME_OWNER: "Possible same owner",
};

const GRADE_COLOR: Record<string, string> = { A: "var(--grade-a)", B: "var(--grade-b)", C: "var(--grade-c)", D: "var(--grade-d)", F: "var(--grade-f)" };

const TIER: Record<string, { label: string; color: string }> = {
  proven: { label: "Proven by GenLayer", color: "var(--bad)" },
  signal: { label: "Signal verified by GenLayer", color: "var(--warn)" },
  hint: { label: "Hint only", color: "var(--faint)" },
};

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

function effectColor(effect: string): string {
  if (effect.startsWith("+")) return "var(--good)";
  if (effect.startsWith("−")) return "var(--bad)";
  return "var(--muted)";
}

function decided(decidedBy: string): { label: string; tone: string } {
  if (decidedBy.includes("AI jury")) return { label: "AI jury", tone: "var(--good)" };
  if (decidedBy.startsWith("default")) return { label: "Default · no jury", tone: "var(--warn)" };
  if (decidedBy.startsWith("settlement")) return { label: "Settled · no jury", tone: "var(--warn)" };
  return { label: "Not ruled yet", tone: "var(--muted)" };
}

export function AgentReport({ wallet }: { wallet: string }) {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setReport(null);
    setError(null);
    fetch(`${API}/v1/agents/${wallet}/report`)
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
        if (live) setReport(body as Report);
      })
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [wallet]);

  if (error) {
    return (
      <div className="card mx-auto max-w-xl p-8 text-center">
        <p className="text-lg font-medium">Could not load this agent</p>
        <p className="mt-2 text-sm text-[var(--muted)]">{error}</p>
        <div className="mt-6 text-left">
          <HeroLookup />
        </div>
      </div>
    );
  }
  if (!report) return <ReportSkeleton wallet={wallet} />;

  const r = report;
  const limit = r.approvalLimitUsd ?? 0;
  const gradeColor = GRADE_COLOR[r.grade ?? ""] ?? "var(--muted)";
  const counted = r.cases.filter((c) => c.result === "won" || c.result === "lost").length;

  return (
    <div className="grid gap-6">
      {/* Score */}
      <section className="card relative overflow-hidden p-5 sm:p-8">
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full blur-3xl" style={{ background: gradeColor, opacity: 0.12 }} />
        <div className="relative flex flex-wrap items-center gap-6 sm:gap-8">
          <div
            className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl text-5xl font-bold sm:h-32 sm:w-32 sm:rounded-3xl sm:text-7xl"
            style={{ color: gradeColor, background: "var(--chip)", boxShadow: `0 0 0 1px ${gradeColor}33` }}
          >
            {r.grade ?? "–"}
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-mono text-xs text-[var(--muted)] sm:text-sm">{r.wallet}</p>
            {r.status === "scored" ? (
              <>
                <h1 className="mt-2 text-xl font-semibold tracking-tight sm:text-3xl">
                  {limit > 0 ? `Can be paid directly for jobs up to $${limit.toLocaleString()}` : "Pay this agent only through escrow"}
                </h1>
                <p className="mt-2 text-sm text-[var(--muted)]">
                  {r.points} points · {counted} counted case{counted === 1 ? "" : "s"} · graded on-chain by GenLayer
                </p>
              </>
            ) : (
              <h1 className="mt-2 text-2xl font-semibold">{r.status === "pending" ? "Score unavailable right now" : "Not scored"}</h1>
            )}
          </div>
        </div>
        <div className="relative mt-6 rounded-xl border border-[var(--border)] bg-[var(--card-2)] px-4 py-3 text-sm">
          <span className="font-mono text-[0.7rem] uppercase tracking-[0.14em] text-[var(--accent)]">Advice for the payer</span>
          <p className="mt-1 text-[0.98rem]">{r.advice}</p>
        </div>
        {r.flags.length > 0 && (
          <ul className="relative mt-5 grid gap-2.5">
            {r.flags.map((f) => (
              <li key={f.code} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
                <span className="rounded-full px-2.5 py-0.5 text-xs font-medium" style={{ background: "var(--chip)", color: f.code === "NO_HISTORY" ? "var(--muted)" : f.code === "POSSIBLE_SAME_OWNER" || f.code === "UNCONTESTED_WINS" ? "var(--warn)" : "var(--bad)" }}>
                  {FLAG_LABEL[f.code] ?? f.code}
                </span>
                <span className="min-w-0 flex-1 text-[var(--muted)]">{f.meaning}</span>
              </li>
            ))}
          </ul>
        )}
        {r.summary && <p className="relative mt-5 text-sm text-[var(--muted)]">{r.summary}</p>}
      </section>

      {/* History */}
      <section className="card p-5 sm:p-8">
        <h2 className="text-lg font-semibold">Internet Court history</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          {r.cases.length === 0 ? "No cases on Internet Court yet." : "Every case this wallet is a party to, what the validators found, and what it did to the score."}
        </p>
        {r.cases.length > 0 && (
          <div className="mt-5 grid gap-3">
            {r.cases.map((c) => {
              const d = decided(c.decidedBy);
              return (
                <article key={c.address} className="rounded-xl border border-[var(--border)] bg-[var(--card-2)] p-4">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <a href={c.explorer} target="_blank" rel="noreferrer" className="-my-2 inline-flex min-h-10 items-center font-mono text-sm font-medium hover:text-[var(--accent)]">
                      Case #{c.id}
                    </a>
                    <span className="text-xs text-[var(--faint)]">{c.role}</span>
                    <span className="rounded-full px-2 py-0.5 text-xs font-medium capitalize" style={{ background: "var(--chip)", color: c.result === "won" ? "var(--good)" : c.result === "lost" ? "var(--bad)" : "var(--muted)" }}>
                      {c.result}
                    </span>
                    <span className="rounded-full px-2 py-0.5 text-xs" style={{ background: "var(--chip)", color: d.tone }} title={c.decidedBy}>
                      {d.label}
                    </span>
                    <span className="basis-full text-xs font-medium sm:ml-auto sm:basis-auto sm:text-right" style={{ color: effectColor(c.effect) }}>
                      {c.effect}
                    </span>
                  </div>
                  {c.claim && <p className="mt-3 text-[0.92rem]">{c.claim}</p>}
                  {c.reasoning && <p className="mt-1.5 text-sm text-[var(--muted)]">{c.reasoning}</p>}
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* Links */}
      <section className="card p-5 sm:p-8">
        <h2 className="text-lg font-semibold">Wallets with the same owner</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          <Dot color="var(--bad)" /> proven by GenLayer: losses count here · <Dot color="var(--warn)" /> verified signal: escrow above $100 · <Dot color="var(--faint)" /> hint: not counted
        </p>
        {r.linkedWallets.length === 0 ? (
          <p className="mt-4 text-sm text-[var(--muted)]">No linked wallets found.</p>
        ) : (
          <>
            <div className="mt-5">
              <LinkGraph subject={r.wallet} links={r.signals} proven={r.proven} verifiedSignals={r.verifiedSignals ?? {}} />
            </div>
            <ul className="mt-5 grid gap-3">
              {r.linkedWallets.map((l) => {
                const t = TIER[l.tier ?? (l.proven ? "proven" : "hint")]!;
                return (
                  <li key={l.wallet} className="rounded-xl border border-[var(--border)] bg-[var(--card-2)] p-4 text-sm">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="font-medium" style={{ color: t.color }}>
                        {t.label}
                      </span>
                      <a href={`/agent/${l.wallet}`} className="-my-2 inline-flex min-h-10 items-center font-mono text-[var(--muted)] underline decoration-[var(--border-strong)] underline-offset-4 hover:text-[var(--fg)]">
                        {short(l.wallet)}
                      </a>
                    </div>
                    <p className="mt-1.5 text-[var(--muted)]">{l.evidence}</p>
                    {l.effect && <p className="mt-1 text-xs text-[var(--faint)]">{l.effect}</p>}
                    {l.inheritedLosses.map((x) => (
                      <p key={x.caseId} className="mt-2 text-xs" style={{ color: "var(--bad)" }}>
                        Lost{" "}
                        <a href={x.explorer} target="_blank" rel="noreferrer" className="font-mono underline">
                          case #{x.caseId}
                        </a>{" "}
                        → {x.effect}
                      </p>
                    ))}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>

      {r.contract && (
        <p className="text-center font-mono text-xs text-[var(--faint)]">
          Graded by GenLayer contract {r.contract} on StudioNet · Internet Court on Base Sepolia
        </p>
      )}
    </div>
  );
}

function Dot({ color }: { color: string }) {
  return <span className="mx-0.5 inline-block h-2 w-2 rounded-full align-middle" style={{ background: color }} />;
}

function ReportSkeleton({ wallet }: { wallet: string }) {
  return (
    <div className="grid gap-6" aria-busy="true">
      <section className="card p-5 sm:p-8">
        <div className="flex items-center gap-6">
          <div className="h-28 w-28 animate-pulse rounded-3xl bg-[var(--chip)] sm:h-32 sm:w-32" />
          <div className="min-w-0 flex-1">
            <p className="font-mono text-sm text-[var(--muted)]">{wallet}</p>
            <div className="mt-3 h-7 w-3/4 animate-pulse rounded-lg bg-[var(--chip)]" />
            <p className="mt-3 text-sm text-[var(--muted)]">Reading Internet Court, the index and the GenLayer contract…</p>
          </div>
        </div>
      </section>
      <section className="card h-48 animate-pulse p-6" />
    </div>
  );
}
