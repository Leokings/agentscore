import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill, Easing, Img, interpolate, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";

/**
 * The AgentScore explainer: 45 seconds at 30 fps, 1920x1080. It plays on the website (Remotion
 * Player) and renders to the submission video (remotion/render.ts). Every claim in it is shown
 * live in the repo's release manifest.
 */
export const FPS = 30;
export const DURATION = 45 * FPS;
export const WIDTH = 1920;
export const HEIGHT = 1080;

const C = {
  bg: "#07090d",
  card: "#0e131a",
  card2: "#131a23",
  line: "rgba(255,255,255,0.08)",
  fg: "#eef2f7",
  muted: "#919bab",
  faint: "#5e6878",
  accent: "#6ee7b7",
  red: "#f87171",
  amber: "#fbbf24",
  orange: "#fb923c",
  green: "#4ade80",
  violet: "#a5b4fc",
};
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
  hook: [0, 150],
  fresh: [150, 420],
  link: [420, 690],
  validators: [690, 960],
  score: [960, 1200],
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
        boxShadow: "0 30px 80px rgba(0,0,0,0.45)",
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
          width: 300,
          padding: "26px 28px",
          background: C.card,
          border: `1.5px solid ${glow ?? C.line}`,
          borderRadius: 24,
          boxShadow: glow ? `0 0 60px ${glow}55` : "0 24px 60px rgba(0,0,0,0.4)",
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
          color: "#04130d",
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
  const verdict = usePop(40);
  const old = interpolate(frame, [130, 170], [1, 0.35], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const fresh = usePop(150);
  return (
    <SceneFade length={S.fresh[1] - S.fresh[0]}>
      <Eyebrow>INTERNET COURT</Eyebrow>
      <Caption top={150} size={64}>
        A bad agent loses its case…
      </Caption>
      <Wallet x={620} y={600} sub="0xbad…01 · 2 cases" label="Agent B" opacity={old} glow={frame > 40 ? C.red : undefined} />
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
      <div style={{ position: "absolute", top: 260, width: "100%", textAlign: "center", fontFamily: SANS, fontSize: 50, color: C.muted, opacity: useAppear(150) }}>
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
  const agreed = Math.min(n, Math.floor(interpolate(frame, [70, 170], [0, n], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })));
  const stored = usePop(185);
  return (
    <SceneFade length={S.validators[1] - S.validators[0]}>
      <Eyebrow>GENLAYER</Eyebrow>
      <Caption top={150} size={64}>
        Validators check every ruling and every link.
      </Caption>
      {Array.from({ length: n }, (_, i) => {
        const angle = (-90 + (360 / n) * i) * (Math.PI / 180);
        const x = center.x + Math.cos(angle) * 300;
        const y = center.y + Math.sin(angle) * 230;
        const on = i < agreed;
        const p = usePopAt(10 + i * 8);
        return (
          <div key={i}>
            <svg width={WIDTH} height={HEIGHT} style={{ position: "absolute", inset: 0 }}>
              <line x1={center.x} y1={center.y} x2={x} y2={y} stroke={on ? C.accent : C.line} strokeWidth={3} />
            </svg>
            <div
              style={{
                position: "absolute",
                left: x,
                top: y,
                transform: `translate(-50%,-50%) scale(${p})`,
                width: 120,
                height: 120,
                borderRadius: 60,
                background: on ? `${C.accent}22` : C.card,
                border: `2px solid ${on ? C.accent : C.line}`,
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

function ScoreScene() {
  const frame = useCurrentFrame();
  const flip = frame > 70;
  const p = usePop(10);
  const flags = [
    { t: "Inherited losses", c: C.red, d: 90 },
    { t: "Fake wins don't count", c: C.red, d: 115 },
    { t: "No-show wins earn nothing", c: C.amber, d: 140 },
  ];
  const advice = usePop(175);
  return (
    <SceneFade length={S.score[1] - S.score[0]}>
      <Caption top={130} size={64}>
        One score that follows the owner.
      </Caption>
      <div style={{ position: "absolute", left: 420, top: 330, transform: `scale(${p})` }}>
        <Grade letter={flip ? "D" : "C"} color={flip ? C.orange : C.accent} size={300} />
      </div>
      <div style={{ position: "absolute", left: 820, top: 340, fontFamily: SANS, color: C.fg }}>
        <div style={{ fontFamily: MONO, fontSize: 24, color: C.muted }}>0xnew…77</div>
        <div style={{ fontSize: 52, fontWeight: 600, marginTop: 10, letterSpacing: "-0.02em" }}>{flip ? "30 points · not a clean slate" : "Looks new and clean…"}</div>
        <div style={{ marginTop: 34, display: "flex", flexDirection: "column", gap: 18 }}>
          {flags.map((f) => {
            const fp = usePopAt(f.d);
            return (
              <div key={f.t} style={{ display: "flex", alignItems: "center", gap: 16, opacity: fp, transform: `translateX(${(1 - fp) * 30}px)` }}>
                <div style={{ width: 16, height: 16, borderRadius: 8, background: f.c }} />
                <div style={{ fontSize: 36, color: C.fg }}>{f.t}</div>
              </div>
            );
          })}
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          left: 960,
          top: 880,
          transform: `translateX(-50%) scale(${advice})`,
          padding: "20px 34px",
          borderRadius: 18,
          background: `${C.amber}1a`,
          border: `2px solid ${C.amber}`,
          fontFamily: SANS,
          fontSize: 36,
          color: C.amber,
          whiteSpace: "nowrap",
        }}
      >
        Advice to the payer: use escrow.
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
          <Img key={l.name} src={asset(l.src)} style={{ height: l.h, width: "auto", filter: "brightness(0) invert(1)" }} />
        ))}
      </div>
    </SceneFade>
  );
}

export function Explainer() {
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <AbsoluteFill style={{ background: `radial-gradient(900px 500px at 50% 0%, ${C.accent}14, transparent 70%)` }} />
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
      <Sequence from={S.score[0]} durationInFrames={S.score[1] - S.score[0]}>
        <ScoreScene />
      </Sequence>
      <Sequence from={S.cta[0]} durationInFrames={S.cta[1] - S.cta[0]}>
        <Cta />
      </Sequence>
    </AbsoluteFill>
  );
}
