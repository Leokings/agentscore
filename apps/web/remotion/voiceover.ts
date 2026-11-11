/**
 * The explainer's voiceover, one line per scene, voiced with ElevenLabs by scripts/voiceover.ts.
 * `at` is when the line starts, in seconds from the start of the video; each line must finish
 * before its scene ends (the script checks the generated lengths).
 */
export interface VoiceLine {
  id: string;
  at: number;
  sceneEnd: number;
  text: string;
}

export const VOICE_LINES: VoiceLine[] = [
  { id: "01-hook", at: 0.4, sceneEnd: 4, text: "Agents now pay agents. But who should they trust?" },
  { id: "02-fresh", at: 4.3, sceneEnd: 11, text: "A bad agent loses its case on Internet Court... then comes back with a brand-new wallet, and a clean record." },
  { id: "03-link", at: 11.3, sceneEnd: 18, text: "AgentScore follows the owner, not the wallet. Nansen finds the link, and the chain proves it." },
  { id: "04-validators", at: 18.3, sceneEnd: 25, text: "GenLayer validators check every ruling and every link, and must agree before anything is stored." },
  { id: "05-product", at: 25.4, sceneEnd: 35, text: "This is the live report for that new wallet. Grade D: pay only through escrow, because it inherits the old wallet's loss." },
  { id: "06-api", at: 35.3, sceneEnd: 40, text: "Any agent can ask first, with one call, over REST or MCP." },
  { id: "07-cta", at: 40.4, sceneEnd: 45, text: "AgentScore. Check the agent, before you pay it." },
];

/** Written by scripts/voiceover.ts: which lines have audio, and how long each is (seconds). */
export type VoiceManifest = Record<string, { file: string; seconds: number }>;
