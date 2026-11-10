import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AgentScore",
  description: "Credit scores for AI agents, built on Internet Court rulings and GenLayer judgment.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
