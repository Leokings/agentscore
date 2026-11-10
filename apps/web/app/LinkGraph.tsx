"use client";

import { useEffect, useRef } from "react";
import cytoscape from "cytoscape";
import type { WalletLink } from "@agentscore/shared";

const STRENGTH_COLOR: Record<WalletLink["strength"], string> = {
  strong: "#e5484d",
  medium: "#f5a524",
  weak: "#8b8d98",
};

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** The subject in the middle, one node per linked wallet, edges coloured by link strength. */
export function LinkGraph({ subject, links }: { subject: string; links: WalletLink[] }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const others = [...new Set(links.map((l) => l.other))];
    const cy = cytoscape({
      container: ref.current,
      elements: [
        { data: { id: subject, label: short(subject) }, classes: "subject" },
        ...others.map((o) => ({ data: { id: o, label: short(o) } })),
        ...links.map((l, i) => ({
          data: { id: `e${i}`, source: subject, target: l.other, label: l.type.replaceAll("_", " "), color: STRENGTH_COLOR[l.strength] },
        })),
      ],
      style: [
        { selector: "node", style: { label: "data(label)", "font-size": 10, color: "#888", "background-color": "#9aa0ff", width: 18, height: 18 } },
        { selector: ".subject", style: { "background-color": "#3d5afe", width: 30, height: 30, "font-weight": "bold" } },
        {
          selector: "edge",
          style: {
            label: "data(label)",
            "font-size": 8,
            color: "#888",
            "line-color": "data(color)",
            width: 2,
            "curve-style": "bezier",
            "text-rotation": "autorotate",
          },
        },
      ],
      layout: { name: others.length > 1 ? "concentric" : "grid", padding: 24 } as cytoscape.LayoutOptions,
      userZoomingEnabled: false,
    });
    return () => cy.destroy();
  }, [subject, links]);

  return <div ref={ref} className="h-80 w-full rounded-lg border border-[var(--border)]" />;
}
