"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { HeroLookup } from "../../components/interactive";
import { ReportView, type Report } from "./ReportView";

const LinkGraph = dynamic(() => import("../../LinkGraph").then((m) => m.LinkGraph), { ssr: false });

const API = process.env.NEXT_PUBLIC_AGENTSCORE_API_URL ?? "/api";

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

  return (
    <ReportView
      report={report}
      graph={<LinkGraph subject={report.wallet} links={report.signals} proven={report.proven} verifiedSignals={report.verifiedSignals ?? {}} />}
    />
  );
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
