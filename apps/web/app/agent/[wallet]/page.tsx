import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Footer, Nav } from "../../components/site";
import { AgentReport } from "./AgentReport";

const isWallet = (v: string) => /^0x[0-9a-fA-F]{40}$/.test(v);

export async function generateMetadata({ params }: { params: Promise<{ wallet: string }> }): Promise<Metadata> {
  const { wallet } = await params;
  const short = `${wallet.slice(0, 6)}…${wallet.slice(-4)}`;
  return { title: `Agent ${short} · AgentScore`, description: `AgentScore report for ${wallet}: grade, Internet Court history and linked wallets.` };
}

export default async function AgentPage({ params }: { params: Promise<{ wallet: string }> }) {
  const { wallet } = await params;
  if (!isWallet(wallet)) notFound();
  return (
    <>
      <Nav />
      <main className="relative">
        <div className="bg-grid pointer-events-none absolute inset-x-0 top-0 h-[420px]" />
        <div className="relative mx-auto max-w-4xl px-4 pb-24 pt-10 sm:px-6">
          <Link href="/" className="text-sm text-[var(--muted)] hover:text-[var(--fg)]">
            ← All agents
          </Link>
          <p className="eyebrow mt-6">Agent report</p>
          <div className="mt-4">
            <AgentReport wallet={wallet} />
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
