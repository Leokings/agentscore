"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import type { WalletLink } from "@agentscore/shared";

const LinkGraph = dynamic(() => import("./LinkGraph").then((m) => m.LinkGraph), { ssr: false });

const API = process.env.NEXT_PUBLIC_AGENTSCORE_API_URL ?? "/api";

/** Real wallets on Internet Court, picked to show each part of the score. */
const EXAMPLES = [
  { label: "Fake win", wallet: "0x36b26d2DF45a2838E6Fe0F8B3c97Cd0033A124Cc", note: "Beat a wallet it funded itself" },
  { label: "Fresh wallet", wallet: "0x9c985F2536587966F087E2677c81E386D4AB797c", note: "Funded by an agent right after it lost" },
  { label: "No-show win", wallet: "0x5A5160Eec0435cc20309735715b44898A46b8032", note: "Won only because the other side never answered" },
  { label: "Jury rulings", wallet: "0xce413FFE2628b60cdaF4413d63d7838B8d4309AC", note: "Lost two cases decided by the AI jury" },
];

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
    proven: boolean;
    evidence: string;
    inheritedLosses: Array<{ caseId: number; explorer: string; claim: string | null; severity: string; effect: string }>;
  }>;
  signals: WalletLink[];
  proven: Record<string, string>;
}

const FLAG_LABEL: Record<string, string> = {
  FAKE_WINS: "Fake wins",
  INHERITED_LOSSES: "Inherited losses",
  UNCONTESTED_WINS: "No-show wins",
  UNCLEAR_RULINGS: "Unclear rulings",
  NO_HISTORY: "No trusted history",
};

const GRADE_COLOR: Record<string, string> = { A: "var(--good)", B: "var(--good)", C: "var(--warn)", D: "var(--bad)", F: "var(--bad)" };

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** Green for points gained, red for points lost, muted for nothing. */
function effectColor(effect: string): string {
  if (effect.startsWith("+")) return "var(--good)";
  if (effect.startsWith("−")) return "var(--bad)";
  return "var(--muted)";
}

function decidedTone(decidedBy: string): string {
  if (decidedBy.includes("AI jury")) return "var(--good)";
  if (decidedBy.includes("no jury")) return "var(--warn)";
  return "var(--muted)";
}

function decidedLabel(decidedBy: string): string {
  if (decidedBy.includes("AI jury")) return "AI jury";
  if (decidedBy.startsWith("default")) return "Default · no jury";
  if (decidedBy.startsWith("settlement")) return "Settled · no jury";
  return "Not ruled yet";
}

export default function Home() {
  const [wallet, setWallet] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function lookup(raw: string) {
    const w = raw.trim();
    if (!w) return;
    setWallet(w);
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API}/v1/agents/${w}/report`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
      setReport(body as Report);
    } catch (err) {
      setError((err as Error).message);
      setReport(null);
    } finally {
      setLoading(false);
    }
  }

  const r = report;
  const limit = r?.approvalLimitUsd ?? 0;

  return (
    <main className="mx-auto max-w-4xl px-4 py-12">
      <header>
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-[var(--accent)]">AgentScore</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Should you trust this agent with the job?</h1>
        <p className="mt-3 max-w-2xl text-[var(--muted)]">
          A credit score for AI agents, built from their Internet Court rulings. Nansen finds wallets with the same owner,
          and GenLayer validators prove those links and judge each ruling, so a bad record can't be dodged with a new
          wallet or padded with fake wins. Check an agent before you pay it.
        </p>
      </header>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void lookup(wallet);
        }}
        className="mt-8 flex flex-col gap-2 sm:flex-row"
      >
        <input
          value={wallet}
          onChange={(e) => setWallet(e.target.value)}
          placeholder="Agent wallet address (0x…)"
          aria-label="Agent wallet address"
          className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--card)] px-4 py-3 font-mono text-sm outline-none focus:border-[var(--accent)]"
        />
        <button disabled={loading || !wallet} className="rounded-lg bg-[var(--accent)] px-6 py-3 font-medium text-white disabled:opacity-50">
          {loading ? "Checking…" : "Check agent"}
        </button>
      </form>

      <div className="mt-3 flex flex-wrap gap-2">
        {EXAMPLES.map((ex) => (
          <button
            key={ex.wallet}
            onClick={() => void lookup(ex.wallet)}
            title={ex.note}
            className="rounded-full border border-[var(--border)] px-3 py-1 text-xs text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--fg)]"
          >
            {ex.label}
          </button>
        ))}
      </div>

      {error && <p className="mt-4 text-sm text-[var(--bad)]">{error}</p>}

      {r && (
        <div className="mt-10 grid min-w-0 gap-6 [overflow-wrap:anywhere]">
          <section className="min-w-0 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 sm:p-6">
            <div className="flex flex-wrap items-center gap-6">
              <div
                className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl text-6xl font-bold sm:h-24 sm:w-24"
                style={{ color: GRADE_COLOR[r.grade ?? ""] ?? "var(--muted)", background: "var(--chip)" }}
              >
                {r.grade ?? "–"}
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-mono text-sm text-[var(--muted)]">{short(r.wallet)}</p>
                {r.status === "scored" ? (
                  <>
                    <p className="mt-1 text-xl font-semibold">
                      {limit > 0 ? `Can be paid directly for jobs up to $${limit.toLocaleString()}` : "Pay this agent only through escrow"}
                    </p>
                    <p className="mt-1 text-sm text-[var(--muted)]">{r.points} points · graded on-chain by GenLayer</p>
                  </>
                ) : (
                  <p className="mt-1 text-xl font-semibold">{r.status === "pending" ? "Score unavailable right now" : "Not scored"}</p>
                )}
              </div>
            </div>
            <p className="mt-4 rounded-lg px-3 py-2 text-sm" style={{ background: "var(--chip)" }}>
              <span className="font-medium">Advice for whoever pays this agent: </span>
              {r.advice}
            </p>

            {r.flags.length > 0 && (
              <ul className="mt-4 grid gap-2">
                {r.flags.map((f) => (
                  <li key={f.code} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                    <span className="rounded-full px-2.5 py-0.5 text-xs font-medium" style={{ background: "var(--chip)", color: f.code === "NO_HISTORY" ? "var(--muted)" : "var(--bad)" }}>
                      {FLAG_LABEL[f.code] ?? f.code}
                    </span>
                    <span className="text-[var(--muted)]">{f.meaning}</span>
                  </li>
                ))}
              </ul>
            )}
            {r.summary && <p className="mt-4 text-sm text-[var(--muted)]">{r.summary}</p>}
            {r.contract && <p className="mt-2 font-mono text-xs text-[var(--muted)]">GenLayer contract {r.contract}</p>}
          </section>

          <section className="min-w-0 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 sm:p-6">
            <h2 className="font-semibold">Internet Court history</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              {r.cases.length === 0
                ? "No cases yet."
                : "Every case this wallet is a party to, what the validators found, and what it did to the score."}
            </p>
            {r.cases.length > 0 && (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-[var(--muted)]">
                    <tr>
                      <th className="whitespace-nowrap py-2 pr-4 font-medium">Case</th>
                      <th className="whitespace-nowrap py-2 pr-4 font-medium">Result</th>
                      <th className="whitespace-nowrap py-2 pr-4 font-medium">Decided by</th>
                      <th className="whitespace-nowrap py-2 pr-4 font-medium">Effect on score</th>
                      <th className="py-2 font-medium">Claim and reasoning</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.cases.map((c) => (
                      <tr key={c.address} className="border-t border-[var(--border)] align-top">
                        <td className="whitespace-nowrap py-3 pr-4 [overflow-wrap:normal]">
                          <a href={c.explorer} target="_blank" rel="noreferrer" className="font-mono hover:text-[var(--accent)]">
                            #{c.id}
                          </a>
                          <div className="text-xs text-[var(--muted)]">{c.role}</div>
                        </td>
                        <td className="whitespace-nowrap py-3 pr-4 font-medium capitalize [overflow-wrap:normal]" style={{ color: c.result === "won" ? "var(--good)" : c.result === "lost" ? "var(--bad)" : "var(--muted)" }}>
                          {c.result}
                        </td>
                        <td className="py-3 pr-4">
                          <span className="whitespace-nowrap rounded-full px-2 py-0.5 text-xs" style={{ background: "var(--chip)", color: decidedTone(c.decidedBy) }} title={c.decidedBy}>
                            {decidedLabel(c.decidedBy)}
                          </span>
                        </td>
                        <td className="min-w-[11rem] py-3 pr-4 text-xs [overflow-wrap:normal]" style={{ color: effectColor(c.effect) }}>
                          {c.effect}
                        </td>
                        <td className="min-w-[14rem] py-3 text-[var(--muted)]">
                          {c.claim && <p className="text-[var(--fg)]">{c.claim}</p>}
                          {c.reasoning && <p className="mt-1">{c.reasoning}</p>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="min-w-0 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 sm:p-6">
            <h2 className="font-semibold">Wallets with the same owner</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Solid lines are proven on-chain by GenLayer and count in the grade. Dashed lines are signals from Nansen and
              wallet history that do not.
            </p>
            {r.linkedWallets.length === 0 ? (
              <p className="mt-4 text-sm text-[var(--muted)]">No linked wallets found.</p>
            ) : (
              <>
                <div className="mt-4">
                  <LinkGraph subject={r.wallet} links={r.signals} proven={r.proven} />
                </div>
                <ul className="mt-4 grid gap-3 text-sm">
                  {r.linkedWallets.map((l) => (
                    <li key={l.wallet}>
                      <div className="flex flex-wrap gap-x-3">
                        <span className="font-medium" style={{ color: l.proven ? "var(--bad)" : "var(--fg)" }}>
                          {l.proven ? "Proven by GenLayer" : "Signal only"}
                        </span>
                        <span className="font-mono text-[var(--muted)]">{short(l.wallet)}</span>
                        <span className="text-[var(--muted)]">{l.evidence}</span>
                      </div>
                      {l.inheritedLosses.map((x) => (
                        <p key={x.caseId} className="mt-1 pl-4 text-xs" style={{ color: "var(--bad)" }}>
                          Lost{" "}
                          <a href={x.explorer} target="_blank" rel="noreferrer" className="font-mono underline">
                            case #{x.caseId}
                          </a>{" "}
                          → {x.effect}
                        </p>
                      ))}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        </div>
      )}

      <footer className="mt-16 border-t border-[var(--border)] pt-6 text-xs text-[var(--muted)]">
        Rulings from Internet Court on Base Sepolia · wallet links found with Nansen · judged and graded by a GenLayer
        intelligent contract. Test networks only. ·{" "}
        <a href="https://github.com/Leokings/agentscore" target="_blank" rel="noreferrer" className="underline hover:text-[var(--fg)]">
          Source on GitHub
        </a>
      </footer>
    </main>
  );
}
