"use client";

import { useEffect, useRef } from "react";
import cytoscape from "cytoscape";
import type { WalletLink } from "@agentscore/shared";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

function cssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

/**
 * The subject in the middle and one node per linked wallet. A wallet with several link types gets
 * one edge. Edges proven by the GenLayer contract are solid; the rest are dashed signals.
 */
export function LinkGraph({
  subject,
  links,
  proven,
  verifiedSignals = {},
}: {
  subject: string;
  links: WalletLink[];
  proven: Record<string, string>;
  verifiedSignals?: Record<string, string>;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const others = [...new Set([...links.map((l) => l.other), ...Object.keys(proven), ...Object.keys(verifiedSignals)])];
    const tierOf = (o: string) => (o in proven ? "proven" : o in verifiedSignals ? "verified" : "signal");
    const typesFor = (o: string) => [...new Set(links.filter((l) => l.other === o).map((l) => l.type.replaceAll("_", " ")))];
    const accent = cssVar("--accent", "#7c8cff");
    const muted = cssVar("--muted", "#9a9aa6");
    const fg = cssVar("--fg", "#ececf1");
    const bad = cssVar("--bad", "#e5484d");
    const warn = cssVar("--warn", "#fbbf24");

    const cy = cytoscape({
      container: ref.current,
      elements: [
        { data: { id: subject, label: short(subject) }, classes: "subject" },
        ...others.map((o) => ({ data: { id: o, label: short(o) }, classes: tierOf(o) })),
        ...others.map((o) => ({
          data: {
            id: `e:${o}`,
            source: subject,
            target: o,
            label: tierOf(o) === "proven" ? "proven by GenLayer" : tierOf(o) === "verified" ? "signal verified by GenLayer" : typesFor(o).join(" · "),
          },
          classes: tierOf(o),
        })),
      ],
      style: [
        {
          selector: "node",
          style: {
            label: "data(label)",
            "font-size": 11,
            "font-family": "ui-monospace, monospace",
            color: muted,
            "text-valign": "bottom",
            "text-margin-y": 6,
            "background-color": muted,
            width: 16,
            height: 16,
          },
        },
        { selector: "node.proven", style: { "background-color": bad } },
        { selector: "node.verified", style: { "background-color": warn } },
        { selector: ".subject", style: { "background-color": accent, color: fg, width: 30, height: 30, "font-weight": "bold" } },
        {
          selector: "edge",
          style: {
            label: "data(label)",
            "font-size": 10,
            color: muted,
            "text-background-color": cssVar("--card", "#18181f"),
            "text-background-opacity": 1,
            "text-background-padding": "2px",
            "line-color": muted,
            width: 1.5,
            "curve-style": "straight",
          },
        },
        { selector: "edge.signal", style: { "line-style": "dashed" } },
        { selector: "edge.proven", style: { "line-color": bad, width: 3, color: bad } },
        { selector: "edge.verified", style: { "line-color": warn, width: 2.5, color: warn } },
      ],
      layout: {
        name: "concentric",
        concentric: (n: cytoscape.NodeSingular) => (n.id() === subject ? 2 : 1),
        levelWidth: () => 1,
        minNodeSpacing: 80,
        padding: 40,
      } as cytoscape.LayoutOptions,
      userZoomingEnabled: false,
      userPanningEnabled: false,
      boxSelectionEnabled: false,
    });
    return () => cy.destroy();
  }, [subject, links, proven, verifiedSignals]);

  return <div ref={ref} className="h-80 w-full rounded-lg border border-[var(--border)]" />;
}
