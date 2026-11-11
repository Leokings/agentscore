import type { CSSProperties, ReactNode } from "react";
import { ReportView, type Report } from "../app/agent/[wallet]/ReportView";
import checkSnapshot from "./data/check-fake-win.json";
import reportSnapshot from "./data/report-fresh-wallet.json";
import voiceManifest from "./data/voiceover.json";
import { VOICE_LINES, type VoiceManifest } from "./voiceover";
import { AbsoluteFill, Audio, Easing, Img, interpolate, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";

/**
 * The AgentScore explainer: 45 seconds at 30 fps, 1920x1080. It plays on the website (Remotion
 * Player) and renders to the submission video (remotion/render.ts). Every claim in it is shown
 * live in the repo's release manifest.
 */
export const FPS = 30;
export const DURATION = 45 * FPS;
export const WIDTH = 1920;
export const HEIGHT = 1080;

// The site's white palette: ink type, one electric-blue accent.
const C = {
  bg: "#ffffff",
  card: "#ffffff",
  card2: "#f7f8fb",
  line: "#e7e9ef",
  fg: "#0b1220",
  muted: "#586174",
  faint: "#98a1b3",
  accent: "#2d5bff",
  red: "#f04438",
  amber: "#f79009",
  orange: "#f79009",
  green: "#12b76a",
  violet: "#6b7cff",
};
const SHADOW = "0 2px 4px rgba(16,24,40,0.04), 0 24px 60px -18px rgba(16,24,40,0.18)";
const SANS = "var(--font-sans), Geist, Inter, ui-sans-serif, system-ui, sans-serif";
const MONO = "var(--font-mono), 'Geist Mono', ui-monospace, Menlo, monospace";

/**
 * Files from the website's public folder. In the website's Player they are served from the site
 * root; in a rendered video Remotion serves them through staticFile().
 */
function asset(path: string): string {
  const w = globalThis as { remotion_staticBase?: string };
  return w.remotion_staticBase !== undefined ? staticFile(path) : `/${path}`;
}

const PARTNERS = [
  { name: "Internet Court", src: "partners/internet-court.svg", h: 64 },
  { name: "GenLayer", src: "partners/genlayer.svg", h: 74 },
  { name: "Nansen", src: "partners/nansen.png", h: 64 },
];

/** The AgentScore mark and wordmark. */
function Brand({ size = 56, opacity = 1 }: { size?: number; opacity?: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: size * 0.32, opacity }}>
      <Img src={asset("brand/agentscore-mark.svg")} style={{ width: size, height: size, borderRadius: size * 0.28 }} />
      <span style={{ fontFamily: SANS, fontSize: size * 0.62, fontWeight: 650, letterSpacing: "-0.03em", color: C.fg }}>AgentScore</span>
    </div>
  );
}

// Scene timing (frames).
const S = {
  hook: [0, 120],
  fresh: [120, 330],
  link: [330, 540],
  validators: [540, 750],
  product: [750, 1050],
  api: [1050, 1200],
  cta: [1200, 1350],
} as const;

const ease = Easing.bezier(0.2, 0.7, 0.2, 1);

function useAppear(delay = 0, duration = 18) {
  const frame = useCurrentFrame();
  return interpolate(frame - delay, [0, duration], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease });
}

function usePop(delay = 0) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - delay, fps, config: { damping: 14, stiffness: 120, mass: 0.8 } });
}

/** Fades a whole scene in and out at its edges. */
function SceneFade({ length, children }: { length: number; children: ReactNode }) {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 12, length - 12, length], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
}

function Caption({ children, delay = 0, top = 150, size = 64, color = C.fg }: { children: ReactNode; delay?: number; top?: number; size?: number; color?: string }) {
  const p = useAppear(delay, 20);
  return (
    <div
      style={{
        position: "absolute",
        top,
        width: "100%",
        textAlign: "center",
        fontFamily: SANS,
        fontSize: size,
        fontWeight: 600,
        letterSpacing: "-0.03em",
        lineHeight: 1.1,
        color,
        opacity: p,
        transform: `translateY(${(1 - p) * 24}px)`,
      }}
    >
      {children}
    </div>
  );
}

function Eyebrow({ children, delay = 0, top = 96 }: { children: ReactNode; delay?: number; top?: number }) {
  const p = useAppear(delay);
  return (
    <div style={{ position: "absolute", top, width: "100%", textAlign: "center", fontFamily: MONO, fontSize: 22, letterSpacing: "0.22em", color: C.accent, opacity: p }}>
      {children}
    </div>
  );
}

function Panel({ x, y, w, h, children, style }: { x: number; y: number; w: number; h: number; children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: w,
        height: h,
        background: C.card,
        border: `1.5px solid ${C.line}`,
        borderRadius: 28,
        boxShadow: SHADOW,
        fontFamily: SANS,
        color: C.fg,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function Wallet({ x, y, label, sub, tone = C.fg, scale = 1, opacity = 1, glow }: { x: number; y: number; label: string; sub: string; tone?: string; scale?: number; opacity?: number; glow?: string }) {
  return (
    <div style={{ position: "absolute", left: x, top: y, transform: `translate(-50%, -50%) scale(${scale})`, opacity }}>
      <div
        style={{
          width: 360,
          padding: "26px 28px",
          background: C.card,
          border: `1.5px solid ${glow ?? C.line}`,
          borderRadius: 24,
          boxShadow: glow ? `0 0 0 4px ${glow}1f, ${SHADOW}` : SHADOW,
          fontFamily: SANS,
        }}
      >
        <div style={{ fontFamily: MONO, fontSize: 20, color: C.muted }}>{sub}</div>
        <div style={{ marginTop: 8, fontSize: 34, fontWeight: 600, color: tone, letterSpacing: "-0.02em" }}>{label}</div>
      </div>
    </div>
  );
}

function Grade({ letter, color, size = 220 }: { letter: string; color: string; size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.22,
        background: C.card2,
        border: `2px solid ${color}55`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: SANS,
        fontWeight: 700,
        fontSize: size * 0.62,
        color,
        boxShadow: `0 0 80px ${color}33`,
      }}
    >
      {letter}
    </div>
  );
}

// ---------------------------------------------------------------- scenes

function Hook() {
  const frame = useCurrentFrame();
  const coin = interpolate(frame, [40, 95], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease });
  const a = usePop(10);
  const b = usePop(20);
  return (
    <SceneFade length={S.hook[1] - S.hook[0]}>
      <div style={{ position: "absolute", left: 80, top: 64 }}>
        <Brand size={52} opacity={useAppear(0, 14)} />
      </div>
      <Caption top={170} size={84}>
        Agents now pay agents.
      </Caption>
      <Caption top={280} size={52} color={C.muted} delay={70}>
        Who should they trust?
      </Caption>
      <Wallet x={640} y={640} sub="AGENT A · client" label="Pays $500" scale={a} />
      <Wallet x={1280} y={640} sub="AGENT B · worker" label="Takes the job" scale={b} />
      <div
        style={{
          position: "absolute",
          left: interpolate(coin, [0, 1], [800, 1120]),
          top: 616,
          width: 48,
          height: 48,
          borderRadius: 24,
          background: C.accent,
          opacity: coin > 0 && coin < 1 ? 1 : 0,
          boxShadow: `0 0 40px ${C.accent}`,
          fontFamily: MONO,
          fontSize: 26,
          fontWeight: 700,
          color: "#ffffff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        $
      </div>
    </SceneFade>
  );
}

function FreshWallet() {
  const frame = useCurrentFrame();
  const verdict = usePop(28);
  const old = interpolate(frame, [95, 125], [1, 0.35], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const fresh = usePop(105);
  return (
    <SceneFade length={S.fresh[1] - S.fresh[0]}>
      <Eyebrow>INTERNET COURT</Eyebrow>
      <Caption top={150} size={64}>
        A bad agent loses its case…
      </Caption>
      <Wallet x={620} y={600} sub="0xbad…01 · 2 cases" label="Agent B" opacity={old} glow={frame > 28 ? C.red : undefined} />
      <div
        style={{
          position: "absolute",
          left: 620,
          top: 760,
          transform: `translateX(-50%) scale(${verdict}) rotate(-4deg)`,
          padding: "14px 26px",
          border: `3px solid ${C.red}`,
          borderRadius: 14,
          fontFamily: MONO,
          fontSize: 28,
          fontWeight: 700,
          color: C.red,
          letterSpacing: "0.08em",
          opacity: old,
        }}
      >
        LOST · DID NOT DELIVER
      </div>
      <div style={{ position: "absolute", top: 260, width: "100%", textAlign: "center", fontFamily: SANS, fontSize: 50, color: C.muted, opacity: useAppear(100) }}>
        …then comes back with a brand-new wallet.
      </div>
      <Wallet x={1300} y={600} sub="0xnew…77 · no history" label="Clean slate?" scale={fresh} glow={C.accent} tone={C.accent} />
    </SceneFade>
  );
}

function LinkScene() {
  const frame = useCurrentFrame();
  const draw = interpolate(frame, [60, 130], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease });
  const tag = usePop(140);
  const nansen = useAppear(20);
  return (
    <SceneFade length={S.link[1] - S.link[0]}>
      <Eyebrow>NANSEN · ON-CHAIN HISTORY</Eyebrow>
      <Caption top={150} size={64}>
        AgentScore follows the owner, not the wallet.
      </Caption>
      <Wallet x={560} y={600} sub="0xbad…01" label="Old wallet" glow={C.red} />
      <Wallet x={1360} y={600} sub="0xnew…77" label="New wallet" glow={frame > 150 ? C.red : C.accent} />
      <svg width={WIDTH} height={HEIGHT} style={{ position: "absolute", inset: 0 }}>
        <line x1={720} y1={600} x2={720 + (1200 - 720) * draw} y2={600} stroke={C.red} strokeWidth={6} strokeLinecap="round" />
      </svg>
      <div
        style={{
          position: "absolute",
          left: 960,
          top: 690,
          transform: `translateX(-50%) scale(${tag})`,
          padding: "18px 28px",
          background: C.card2,
          border: `1.5px solid ${C.line}`,
          borderRadius: 18,
          fontFamily: SANS,
          fontSize: 30,
          color: C.fg,
          textAlign: "center",
          whiteSpace: "nowrap",
        }}
      >
        Its very first money came from the old wallet
        <div style={{ fontFamily: MONO, fontSize: 22, color: C.muted, marginTop: 8 }}>found by Nansen · proven against the chain</div>
      </div>
      <div style={{ position: "absolute", top: 880, width: "100%", textAlign: "center", fontFamily: SANS, fontSize: 30, color: C.muted, opacity: nansen }}>
        Also caught: deployers, multisig owners, shared cash-outs, closed loops.
      </div>
    </SceneFade>
  );
}

function Validators() {
  const frame = useCurrentFrame();
  const n = 5;
  const center = { x: 960, y: 620 };
  const agreed = Math.min(n, Math.floor(interpolate(frame, [45, 125], [0, n], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })));
  const stored = usePop(135);
  return (
    <SceneFade length={S.validators[1] - S.validators[0]}>
      <Eyebrow>GENLAYER</Eyebrow>
      <Caption top={150} size={64}>
        Validators check every ruling and every link.
      </Caption>
      {/* All connecting lines first, so they sit under the validator nodes. */}
      <svg width={WIDTH} height={HEIGHT} style={{ position: "absolute", inset: 0 }}>
        {Array.from({ length: n }, (_, i) => {
          const angle = (-90 + (360 / n) * i) * (Math.PI / 180);
          return (
            <line
              key={i}
              x1={center.x}
              y1={center.y}
              x2={center.x + Math.cos(angle) * 300}
              y2={center.y + Math.sin(angle) * 230}
              stroke={i < agreed ? C.accent : C.line}
              strokeWidth={3}
            />
          );
        })}
      </svg>
      {Array.from({ length: n }, (_, i) => {
        const angle = (-90 + (360 / n) * i) * (Math.PI / 180);
        const x = center.x + Math.cos(angle) * 300;
        const y = center.y + Math.sin(angle) * 230;
        const on = i < agreed;
        const p = usePopAt(10 + i * 8);
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x,
              top: y,
              transform: `translate(-50%,-50%) scale(${p})`,
              width: 120,
              height: 120,
              borderRadius: 60,
              background: on ? "#eef2ff" : C.card,
              border: `2px solid ${on ? C.accent : C.line}`,
              boxShadow: SHADOW,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: MONO,
              fontSize: on ? 54 : 26,
              color: on ? C.accent : C.muted,
            }}
          >
            {on ? "✓" : `V${i + 1}`}
          </div>
        );
      })}
      <div
        style={{
          position: "absolute",
          left: center.x,
          top: center.y,
          transform: "translate(-50%,-50%)",
          padding: "22px 30px",
          background: C.card2,
          border: `1.5px solid ${C.line}`,
          borderRadius: 20,
          fontFamily: SANS,
          fontSize: 30,
          textAlign: "center",
          color: C.fg,
        }}
      >
        Ruling: did it deliver?
        <div style={{ fontFamily: MONO, fontSize: 22, color: C.muted, marginTop: 6 }}>
          {agreed}/{n} agree
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          top: 930,
          width: "100%",
          textAlign: "center",
          fontFamily: SANS,
          fontSize: 34,
          color: C.accent,
          opacity: stored,
          transform: `scale(${0.9 + stored * 0.1})`,
        }}
      >
        Agreed and stored on-chain. No single model decides.
      </div>
    </SceneFade>
  );
}

function usePopAt(delay: number) {
  return usePop(delay);
}

/** A browser window around real product UI. */
function BrowserFrame({ url, children, style }: { url: string; children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ position: "absolute", overflow: "hidden", background: "#ffffff", border: `1.5px solid ${C.line}`, borderRadius: 22, boxShadow: SHADOW, ...style }}>
      <div style={{ height: 58, display: "flex", alignItems: "center", gap: 18, padding: "0 22px", borderBottom: `1.5px solid ${C.line}`, background: C.card2 }}>
        <div style={{ display: "flex", gap: 9 }}>
          {["#f04438", "#f79009", "#12b76a"].map((c) => (
            <div key={c} style={{ width: 14, height: 14, borderRadius: 7, background: c, opacity: 0.85 }} />
          ))}
        </div>
        <div style={{ flex: 1, height: 34, borderRadius: 10, background: "#ffffff", border: `1.5px solid ${C.line}`, display: "flex", alignItems: "center", padding: "0 16px", fontFamily: MONO, fontSize: 19, color: C.muted }}>
          <span style={{ color: C.green, marginRight: 10 }}>●</span>
          {url}
        </div>
      </div>
      {children}
    </div>
  );
}

/**
 * The real report page for the fresh wallet: the site's own ReportView component, fed with a
 * snapshot of the live /report response (remotion/data/report-fresh-wallet.json).
 */
function ProductReport() {
  const frame = useCurrentFrame();
  const enter = usePop(0);
  // Camera: overview, push in on the grade and advice, then glide down to the inherited loss.
  const zoom = interpolate(frame, [40, 85, 150, 190], [1, 1.32, 1.32, 1.18], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease });
  const panY = interpolate(frame, [40, 85, 150, 200], [0, -40, -40, -470], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease });
  const panX = interpolate(frame, [40, 85, 150, 200], [0, 110, 110, 40], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease });
  const note1 = usePop(70) * interpolate(frame, [150, 175], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const note2 = usePop(205);
  const short = `${reportSnapshot.wallet.slice(0, 6)}…${reportSnapshot.wallet.slice(-4)}`;
  return (
    <SceneFade length={S.product[1] - S.product[0]}>
      <Eyebrow top={56}>THE LIVE PRODUCT</Eyebrow>
      <Caption top={96} size={52}>
        The real report for that new wallet.
      </Caption>
      <BrowserFrame url={`agentscore-seven.vercel.app/agent/${short}`} style={{ left: 260, top: 200, width: 1400, height: 820, transform: `translateY(${(1 - enter) * 60}px)`, opacity: enter }}>
        <div style={{ position: "absolute", top: 58, left: 0, right: 0, bottom: 0, overflow: "hidden", background: "var(--bg)" }}>
          <div
            style={{
              position: "absolute",
              left: 200,
              top: 36,
              width: 1000,
              transformOrigin: "30% 0%",
              transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
            }}
          >
            <p className="eyebrow" style={{ marginBottom: 14 }}>
              Agent report
            </p>
            <ReportView report={reportSnapshot as unknown as Report} />
          </div>
        </div>
      </BrowserFrame>
      <Callout right={70} y={330} p={note1} color={C.orange}>
        Grade D · pay only through escrow
      </Callout>
      <Callout right={70} y={690} p={note2} color={C.red}>
        Inherits the old wallet&apos;s loss
      </Callout>
    </SceneFade>
  );
}

function Callout({ right, y, p, color, children }: { right: number; y: number; p: number; color: string; children: ReactNode }) {
  return (
    <div
      style={{
        position: "absolute",
        right,
        top: y,
        opacity: Math.min(1, p * 1.2),
        transform: `scale(${0.85 + 0.15 * p})`,
        transformOrigin: "right center",
        padding: "16px 24px",
        borderRadius: 16,
        background: "#ffffff",
        border: `2px solid ${color}`,
        boxShadow: SHADOW,
        fontFamily: SANS,
        fontSize: 28,
        fontWeight: 600,
        color,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </div>
  );
}

/** A real API call: the command types out, then the live answer (remotion/data/check-fake-win.json). */
function ApiTerminal() {
  const frame = useCurrentFrame();
  const cmd = `curl "agentscore-seven.vercel.app/api/v1/check?wallet=0x36b2…24Cc&amount=500"`;
  const typed = Math.floor(interpolate(frame, [8, 50], [0, cmd.length], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
  const c = checkSnapshot as { advice: string; decision: string; grade: string; points: number; approvalLimitUsd: number; flags: string[] };
  const lines: Array<[string, string, string]> = [
    ["advice", JSON.stringify(c.advice), C.fg],
    ["decision", JSON.stringify(c.decision), C.red],
    ["grade", JSON.stringify(c.grade), C.orange],
    ["points", String(c.points), C.fg],
    ["approvalLimitUsd", String(c.approvalLimitUsd), C.fg],
    ["flags", JSON.stringify(c.flags), C.red],
  ];
  const mcp = useAppear(96);
  return (
    <SceneFade length={S.api[1] - S.api[0]}>
      <Eyebrow top={70}>FOR AGENTS AND DEVELOPERS</Eyebrow>
      <Caption top={112} size={56}>
        One call before paying an agent.
      </Caption>
      <div
        style={{
          position: "absolute",
          left: 240,
          top: 250,
          width: 1440,
          height: 640,
          borderRadius: 22,
          background: "#0b1220",
          boxShadow: SHADOW,
          padding: "34px 44px",
          fontFamily: MONO,
          fontSize: 27,
          lineHeight: 1.6,
          color: "#e6ebf5",
        }}
      >
        <div>
          <span style={{ color: "#7c9cff" }}>$ </span>
          {cmd.slice(0, typed)}
          {typed < cmd.length && <span style={{ background: "#e6ebf5", marginLeft: 2 }}>&nbsp;</span>}
        </div>
        <div style={{ marginTop: 18 }}>{frame > 56 ? "{" : ""}</div>
        {lines.map(([k, v, color], i) => {
          const show = interpolate(frame, [58 + i * 6, 64 + i * 6], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
          return (
            <div key={k} style={{ opacity: show, paddingLeft: 30, whiteSpace: "pre-wrap" }}>
              <span style={{ color: "#93a4c3" }}>&quot;{k}&quot;</span>: <span style={{ color: color === C.fg ? "#e6ebf5" : color }}>{v}</span>
              {i < lines.length - 1 ? "," : ""}
            </div>
          );
        })}
        <div>{frame > 100 ? "}" : ""}</div>
      </div>
      <div style={{ position: "absolute", top: 930, width: "100%", textAlign: "center", fontFamily: SANS, fontSize: 32, color: C.muted, opacity: mcp }}>
        Same answer for any agent over MCP: <span style={{ fontFamily: MONO, color: C.accent }}>check_agent</span>
      </div>
    </SceneFade>
  );
}

function Cta() {
  const p = useAppear(10);
  const logos = useAppear(50);
  return (
    <SceneFade length={S.cta[1] - S.cta[0]}>
      <div style={{ position: "absolute", top: 90, width: "100%", display: "flex", justifyContent: "center", transform: `scale(${0.9 + 0.1 * p})`, opacity: p }}>
        <Brand size={84} />
      </div>
      <Caption top={250} size={88}>
        Check any agent before you pay.
      </Caption>
      <div
        style={{
          position: "absolute",
          left: 960,
          top: 450,
          transform: "translateX(-50%)",
          opacity: p,
          padding: "26px 36px",
          background: C.card,
          border: `1.5px solid ${C.line}`,
          borderRadius: 20,
          fontFamily: MONO,
          fontSize: 32,
          color: C.fg,
          whiteSpace: "nowrap",
        }}
      >
        <span style={{ color: C.accent }}>$ </span>claude mcp add agentscore …/api/mcp
      </div>
      <div style={{ position: "absolute", top: 610, width: "100%", textAlign: "center", fontFamily: SANS, fontSize: 40, color: C.muted, opacity: p }}>
        agentscore-seven.vercel.app
      </div>
      <div style={{ position: "absolute", top: 760, width: "100%", textAlign: "center", fontFamily: MONO, fontSize: 22, letterSpacing: "0.22em", color: C.faint, opacity: logos }}>
        BUILT ON
      </div>
      <div style={{ position: "absolute", top: 830, width: "100%", display: "flex", justifyContent: "center", alignItems: "center", gap: 110, opacity: logos }}>
        {PARTNERS.map((l) => (
          <Img key={l.name} src={asset(l.src)} style={{ height: l.h, width: "auto", filter: "brightness(0)" }} />
        ))}
      </div>
    </SceneFade>
  );
}

/** The ElevenLabs voiceover (scripts/voiceover.ts): each line starts at its own time. */
function Voiceover() {
  const manifest = voiceManifest as unknown as VoiceManifest;
  return (
    <>
      {VOICE_LINES.filter((l) => manifest[l.id]).map((l) => (
        <Sequence key={l.id} from={Math.round(l.at * FPS)} durationInFrames={Math.ceil(manifest[l.id]!.seconds * FPS) + 6}>
          <Audio src={asset(manifest[l.id]!.file)} />
        </Sequence>
      ))}
    </>
  );
}

export function Explainer() {
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <Voiceover />
      <AbsoluteFill style={{ background: `radial-gradient(1000px 520px at 50% 0%, ${C.accent}10, transparent 70%)` }} />
      <Sequence from={S.hook[0]} durationInFrames={S.hook[1] - S.hook[0]}>
        <Hook />
      </Sequence>
      <Sequence from={S.fresh[0]} durationInFrames={S.fresh[1] - S.fresh[0]}>
        <FreshWallet />
      </Sequence>
      <Sequence from={S.link[0]} durationInFrames={S.link[1] - S.link[0]}>
        <LinkScene />
      </Sequence>
      <Sequence from={S.validators[0]} durationInFrames={S.validators[1] - S.validators[0]}>
        <Validators />
      </Sequence>
      <Sequence from={S.product[0]} durationInFrames={S.product[1] - S.product[0]}>
        <ProductReport />
      </Sequence>
      <Sequence from={S.api[0]} durationInFrames={S.api[1] - S.api[0]}>
        <ApiTerminal />
      </Sequence>
      <Sequence from={S.cta[0]} durationInFrames={S.cta[1] - S.cta[0]}>
        <Cta />
      </Sequence>
    </AbsoluteFill>
  );
}
