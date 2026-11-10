"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import type { CourtRecord, WalletLink } from "@agentscore/shared";

const LinkGraph = dynamic(() => import("./LinkGraph").then((m) => m.LinkGraph), { ssr: false });

const API = process.env.NEXT_PUBLIC_AGENTSCORE_API_URL ?? "/api";
const CASE_EXPLORER = "https://base-sepolia.blockscout.com/address/";

/** Real wallets on Internet Court, picked to show each part of the score. */
const EXAMPLES = [
  { label: "Fake win", wallet: "0x36b26d2DF45a2838E6Fe0F8B3c97Cd0033A124Cc", note: "Beat a wallet it funded itself" },
  { label: "Fresh wallet", wallet: "0x9c985F2536587966F087E2677c81E386D4AB797c", note: "Funded by an agent right after it lost" },
  { label: "No-show win", wallet: "0x5A5160Eec0435cc20309735715b44898A46b8032", note: "Won only because the other side never answered" },
  { label: "Jury rulings", wallet: "0xce413FFE2628b60cdaF4413d63d7838B8d4309AC", note: "Lost two cases decided by the AI jury" },
];

interface ScoreResponse {
  grade: string | null;
  status: string;
  reasons: string[];
  flags: string[];
  points?: number;
  approvalLimitUsd?: number;
  contract?: string;
  counts?: Record<string, number>;
}

interface Result {
  wallet: string;
  score: ScoreResponse;
  record: CourtRecord;
  links: WalletLink[];
  proven: Record<string, string>;
}

const FLAG_LABEL: Record<string, string> = {
  FAKE_WINS: "Fake wins",
  INHERITED_LOSSES: "Inherited losses",
  UNCONTESTED_WINS: "No-show wins",
  UNCLEAR_RULINGS: "Unclear rulings",
  NO_HISTORY: "No trusted history",
};

const GRADE_COLOR: Record<string, string> = {
  A: "var(--good)",
  B: "var(--good)",
  C: "var(--warn)",
  D: "var(--bad)",
  F: "var(--bad)",
};

const RESOLUTION: Record<string, { label: string; tone: string }> = {
  jury: { label: "AI jury", tone: "var(--good)" },
  default: { label: "Default · no jury", tone: "var(--warn)" },
  settlement: { label: "Settled · no jury", tone: "var(--warn)" },
};

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body as T;
}

/** What a standard agreement's verdict meant for this wallet (the statement is Party A's claim). */
function outcomeFor(c: CourtRecord["cases"][number]): "Won" | "Lost" | null {
  if (c.contractType !== "Agreement" || !c.statementVerdict || c.statementVerdict === "UNDETERMINED") return null;
  const aWon = c.statementVerdict === "TRUE";
  return (c.role === "partyA") === aWon ? "Won" : "Lost";
}

/** Why a win does not count, mirroring the contract's get_score. */
function winCaveat(c: CourtRecord["cases"][number], me: string, proven: Record<string, string>): string | null {
  if (c.parties.some((p) => p.address !== me && p.address in proven)) return "doesn't count: own wallet";
  if (c.resolution && c.resolution !== "jury") return "no points: no jury";
  return null;
}

export default function Home() {
  const [wallet, setWallet] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function lookup(raw: string) {
    const w = raw.trim();
    if (!w) return;
    setWallet(w);
    setLoading(true);
    setError(null);
    try {
      const [score, record, links] = await Promise.all([
        getJson<ScoreResponse>(`/v1/agents/${w}/score`),
        getJson<CourtRecord>(`/v1/agents/${w}/court-record`),
        getJson<{ links: WalletLink[]; proven?: Record<string, string> }>(`/v1/agents/${w}/links`),
      ]);
      setResult({ wallet: w.toLowerCase(), score, record, links: links.links, proven: links.proven ?? {} });
    } catch (err) {
      setError((err as Error).message);
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  const s = result?.score;
  const limit = s?.approvalLimitUsd ?? 0;

  return (
    <main className="mx-auto max-w-4xl px-4 py-12">
      <header>
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-[var(--accent)]">AgentScore</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Should you trust this agent with the job?</h1>
        <p className="mt-3 max-w-2xl text-[var(--muted)]">
          A credit score for AI agents, built from their Internet Court rulings. Nansen finds wallets with the same owner,
          and GenLayer validators prove those links and judge each ruling, so a bad record can't be dodged with a new
          wallet or padded with fake wins.
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

      {result && s && (
        <div className="mt-10 grid min-w-0 gap-6 [overflow-wrap:anywhere]">
          <section className="min-w-0 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 sm:p-6">
            <div className="flex flex-wrap items-center gap-6">
              <div
                className="flex h-20 w-20 shrink-0 sm:h-24 sm:w-24 items-center justify-center rounded-2xl text-6xl font-bold"
                style={{ color: GRADE_COLOR[s.grade ?? ""] ?? "var(--muted)", background: "var(--chip)" }}
              >
                {s.grade ?? "–"}
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-mono text-sm text-[var(--muted)]">{short(result.wallet)}</p>
                {s.status === "scored" ? (
                  <>
                    <p className="mt-1 text-xl font-semibold">
                      {limit > 0 ? `Can take jobs up to $${limit.toLocaleString()} without escrow` : "Escrow required for any job"}
                    </p>
                    <p className="mt-1 text-sm text-[var(--muted)]">{s.points} points · graded on-chain by GenLayer</p>
                  </>
                ) : (
                  <p className="mt-1 text-xl font-semibold">{s.status === "pending" ? "Score unavailable right now" : "Not scored"}</p>
                )}
              </div>
            </div>

            {s.flags.length > 0 && (
              <div className="mt-5 flex flex-wrap gap-2">
                {s.flags.map((f) => (
                  <span key={f} className="rounded-full px-3 py-1 text-xs font-medium" style={{ background: "var(--chip)", color: f === "NO_HISTORY" ? "var(--muted)" : "var(--bad)" }}>
                    {FLAG_LABEL[f] ?? f}
                  </span>
                ))}
              </div>
            )}
            <ul className="mt-4 grid gap-1 text-sm text-[var(--muted)]">
              {s.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            {s.contract && <p className="mt-4 font-mono text-xs text-[var(--muted)]">GenLayer contract {s.contract}</p>}
          </section>

          <section className="min-w-0 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 sm:p-6">
            <h2 className="font-semibold">Internet Court record</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              {result.record.totals.cases} case{result.record.totals.cases === 1 ? "" : "s"} · {result.record.totals.ruled} ruled ·{" "}
              {result.record.totals.jury ?? 0} by the AI jury · {result.record.totals.pendingRuling} awaiting a ruling
            </p>
            {result.record.cases.length > 0 && (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-[var(--muted)]">
                    <tr>
                      <th className="py-2 pr-4 font-medium">Case</th>
                      <th className="py-2 pr-4 font-medium">Result</th>
                      <th className="py-2 pr-4 font-medium">Decided by</th>
                      <th className="py-2 font-medium">Claim and reasoning</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.record.cases.map((c) => {
                      const outcome = outcomeFor(c);
                      const caveat = outcome === "Won" ? winCaveat(c, result.wallet, result.proven) : null;
                      const how = c.resolution ? RESOLUTION[c.resolution] : undefined;
                      return (
                        <tr key={c.address} className="border-t border-[var(--border)] align-top">
                          <td className="py-3 pr-4">
                            <a href={CASE_EXPLORER + c.address} target="_blank" rel="noreferrer" className="font-mono hover:text-[var(--accent)]">
                              #{c.id}
                            </a>
                            <div className="text-xs text-[var(--muted)]">{c.role}</div>
                          </td>
                          <td className="py-3 pr-4 font-medium" style={{ color: outcome === "Won" ? "var(--good)" : outcome === "Lost" ? "var(--bad)" : "var(--muted)" }}>
                            {outcome ?? (c.resolution ? "Ruled" : "Open")}
                            {caveat && <div className="text-xs font-normal text-[var(--warn)]">{caveat}</div>}
                          </td>
                          <td className="py-3 pr-4">
                            {how ? (
                              <span className="whitespace-nowrap rounded-full px-2 py-0.5 text-xs" style={{ background: "var(--chip)", color: how.tone }}>
                                {how.label}
                              </span>
                            ) : (
                              <span className="text-[var(--muted)]">–</span>
                            )}
                          </td>
                          <td className="min-w-[14rem] py-3 text-[var(--muted)]">
                            {c.statement && <p className="text-[var(--fg)]">{c.statement}</p>}
                            {c.reasoning && <p className="mt-1">{c.reasoning}</p>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="min-w-0 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 sm:p-6">
            <h2 className="font-semibold">Wallets with the same owner</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Solid lines are proven on-chain by GenLayer and count in the grade. Dashed lines are signals from Nansen and
              wallet history.
            </p>
            {result.links.length === 0 && Object.keys(result.proven).length === 0 ? (
              <p className="mt-4 text-sm text-[var(--muted)]">No linked wallets found.</p>
            ) : (
              <>
                <div className="mt-4">
                  <LinkGraph subject={result.wallet} links={result.links} proven={result.proven} />
                </div>
                <ul className="mt-4 grid gap-2 text-sm">
                  {Object.keys(result.proven).map((other) => {
                    // The contract stores one description for both wallets; the link builder's
                    // evidence says which way the funds went from this wallet's side.
                    const seen = result.links.find((l) => l.other === other && (l.type === "funded" || l.type === "funded_by"));
                    return (
                      <li key={`proven:${other}`} className="flex flex-wrap gap-x-3">
                        <span className="font-medium text-[var(--bad)]">Proven by GenLayer</span>
                        <span className="font-mono text-[var(--muted)]">{short(other)}</span>
                        <span className="text-[var(--muted)]">{seen?.evidence[0]?.description ?? "first-funding proof verified on-chain"}</span>
                      </li>
                    );
                  })}
                  {result.links
                    .filter((l) => !(l.other in result.proven))
                    .map((l) => (
                      <li key={`${l.type}:${l.other}`} className="flex flex-wrap gap-x-3">
                        <span className="font-medium">{l.type.replaceAll("_", " ")}</span>
                        <span className="font-mono text-[var(--muted)]">{short(l.other)}</span>
                        <span className="text-[var(--muted)]">{l.evidence[0]?.description}</span>
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
