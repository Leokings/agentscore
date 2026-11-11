import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ImageResponse } from "next/og";

export const alt = "AgentScore: credit scores for AI agents";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** The share card for links to the site: the mark, the promise, and what it is built on. */
export default function OpenGraphImage() {
  const mark = `data:image/svg+xml;base64,${readFileSync(join(process.cwd(), "public/brand/agentscore-mark.svg")).toString("base64")}`;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          background: "radial-gradient(900px 420px at 50% 0%, rgba(110,231,183,0.16), #07090d 70%)",
          backgroundColor: "#07090d",
          color: "#eef2f7",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={mark} width={76} height={76} alt="" style={{ borderRadius: 22 }} />
          <span style={{ fontSize: 46, fontWeight: 700, letterSpacing: -1.5 }}>AgentScore</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ fontSize: 76, fontWeight: 700, letterSpacing: -2.5, lineHeight: 1.04 }}>Know the agent</span>
          <span style={{ fontSize: 76, fontWeight: 700, letterSpacing: -2.5, lineHeight: 1.04 }}>
            <span style={{ color: "#6ee7b7" }}>before</span>&nbsp;you pay it.
          </span>
          <span style={{ marginTop: 26, fontSize: 30, color: "#919bab" }}>Credit scores for AI agents from Internet Court rulings, judged by GenLayer.</span>
        </div>
        <span style={{ fontSize: 24, color: "#5e6878", letterSpacing: 4 }}>INTERNET COURT · GENLAYER · NANSEN</span>
      </div>
    ),
    size,
  );
}
