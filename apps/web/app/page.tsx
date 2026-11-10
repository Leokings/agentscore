"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import type { CourtRecord, WalletLink } from "@agentscore/shared";

const LinkGraph = dynamic(() => import("./LinkGraph").then((m) => m.LinkGraph), { ssr: false });

const API = process.env.NEXT_PUBLIC_AGENTSCORE_API_URL ?? "http://localhost:8787";

interface ScoreResponse {
  grade: string | null;
  status: string;
  reasons: string[];
  flags: string[];
}

interface Result {
  wallet: string;
  score: ScoreResponse;
  record: CourtRecord;
  links: WalletLink[];
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body as T;
}

export default function Home() {
  const [wallet, setWallet] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function lookup(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const w = wallet.trim();
      const [score, record, links] = await Promise.all([
        getJson<ScoreResponse>(`/v1/agents/${w}/score`),
        getJson<CourtRecord>(`/v1/agents/${w}/court-record`),
        getJson<{ links: WalletLink[] }>(`/v1/agents/${w}/links`),
      ]);
      setResult({ wallet: w.toLowerCase(), score, record, links: links.links });
    } catch (err) {
      setError((err as Error).message);
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">AgentScore</h1>
      <p className="mt-2 text-[var(--muted)]">Credit scores for AI agents, from Internet Court rulings, linked wallets and GenLayer judgment.</p>

      <form onSubmit={lookup} className="mt-8 flex flex-col gap-2 sm:flex-row">
        <input
          value={wallet}
          onChange={(e) => setWallet(e.target.value)}
          placeholder="Agent wallet address (0x…)"
          className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--card)] px-4 py-3 font-mono text-sm outline-none focus:border-[var(--accent)]"
        />
        <button disabled={loading || !wallet} className="rounded-lg bg-[var(--accent)] px-6 py-3 font-medium text-white disabled:opacity-50">
          {loading ? "Checking…" : "Check agent"}
        </button>
      </form>

      {error && <p className="mt-4 text-sm text-red-500">{error}</p>}

      {result && (
        <div className="mt-10 grid gap-6">
          <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-6">
            <div className="flex items-baseline gap-4">
              <span className="text-5xl font-bold">{result.score.grade ?? "–"}</span>
              <span className="text-sm uppercase tracking-wide text-[var(--muted)]">{result.score.status.replace("_", " ")}</span>
            </div>
            <ul className="mt-3 list-disc pl-5 text-sm text-[var(--muted)]">
              {result.score.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </section>

          <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-6">
            <h2 className="font-semibold">Internet Court record</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              {result.record.totals.cases} cases · {result.record.totals.disputed} disputed · {result.record.totals.ruled} ruled ·{" "}
              {result.record.totals.pendingRuling} awaiting a ruling
            </p>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-[var(--muted)]">
                  <tr>
                    <th className="py-2 pr-4">Case</th>
                    <th className="py-2 pr-4">Role</th>
                    <th className="py-2 pr-4">Verdict</th>
                    <th className="py-2">Jury reasoning</th>
                  </tr>
                </thead>
                <tbody>
                  {result.record.cases.map((c) => (
                    <tr key={c.address} className="border-t border-[var(--border)] align-top">
                      <td className="py-2 pr-4 font-mono">#{c.id}</td>
                      <td className="py-2 pr-4">{c.role}</td>
                      <td className="py-2 pr-4">{c.statementVerdict ?? (c.verdictCode !== undefined ? `code ${c.verdictCode}` : "–")}</td>
                      <td className="py-2 text-[var(--muted)]">{c.reasoning ?? c.statement ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-6">
            <h2 className="font-semibold">Linked wallets</h2>
            {result.links.length === 0 ? (
              <p className="mt-1 text-sm text-[var(--muted)]">No links found.</p>
            ) : (
              <>
                <div className="mt-4">
                  <LinkGraph subject={result.wallet} links={result.links} />
                </div>
                <ul className="mt-4 grid gap-2 text-sm">
                  {result.links.map((l) => (
                    <li key={`${l.type}:${l.other}`} className="flex flex-wrap gap-x-3">
                      <span className="font-medium">{l.type.replaceAll("_", " ")}</span>
                      <span className="font-mono text-[var(--muted)]">{l.other}</span>
                      <span className="text-[var(--muted)]">
                        {l.strength} · {l.evidence[0]?.description}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
