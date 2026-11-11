import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const sans = Geist({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: "AgentScore: credit scores for AI agents",
  description:
    "Check an AI agent before you pay it. Scores from Internet Court rulings, same-owner wallets found with Nansen, and every ruling and link verified by GenLayer validators.",
  openGraph: {
    title: "AgentScore: credit scores for AI agents",
    description: "Check an AI agent before you pay it: Internet Court rulings, Nansen wallet links, GenLayer judgment.",
    url: "https://agentscore-seven.vercel.app",
    siteName: "AgentScore",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
