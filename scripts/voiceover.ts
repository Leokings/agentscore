#!/usr/bin/env tsx
/**
 * Voices the explainer with ElevenLabs: one MP3 per line in apps/web/remotion/voiceover.ts,
 * written to apps/web/public/audio/, plus a manifest with each clip's length. Refuses to finish
 * if a line runs past the end of its scene.
 *
 *   npx tsx --env-file=.env scripts/voiceover.ts            # needs ELEVENLABS_API_KEY in .env
 *   ELEVENLABS_VOICE_ID=... to pick another voice (default: a calm, clear narrator voice)
 *
 * Costs about 600 characters of ElevenLabs credit per full run; clips that already exist with
 * the same text are not generated again.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { VOICE_LINES, type VoiceManifest } from "../apps/web/remotion/voiceover";

const KEY = process.env.ELEVENLABS_API_KEY;
const VOICE = process.env.ELEVENLABS_VOICE_ID || "JBFqnCBsd6RMkjVDRZzb"; // "George": warm, clear narration
const MODEL = process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2";
const OUT = "apps/web/public/audio";
const MANIFEST = "apps/web/remotion/data/voiceover.json";

if (!KEY) {
  console.error("ELEVENLABS_API_KEY is not set. Add it to .env (never paste it into chat).");
  process.exit(1);
}

function seconds(file: string): number {
  const out = execFileSync("npx", ["remotion", "ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8", shell: true, cwd: "apps/web" });
  return Number(out.trim().split(/\s+/).pop());
}

mkdirSync(OUT, { recursive: true });
const manifest: VoiceManifest & { _texts?: Record<string, string> } = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : {};
const texts: Record<string, string> = (manifest as { _texts?: Record<string, string> })._texts ?? {};
let problems = 0;

for (const line of VOICE_LINES) {
  const file = `audio/vo-${line.id}.mp3`;
  const path = join("apps/web/public", file);
  if (!(existsSync(path) && texts[line.id] === line.text)) {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": KEY, "content-type": "application/json", accept: "audio/mpeg" },
      body: JSON.stringify({ text: line.text, model_id: MODEL, voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.2, use_speaker_boost: true } }),
    });
    if (!res.ok) {
      console.error(`${line.id}: ElevenLabs ${res.status} ${(await res.text()).slice(0, 200)}`);
      process.exit(1);
    }
    writeFileSync(path, Buffer.from(await res.arrayBuffer()));
    texts[line.id] = line.text;
  }
  const s = seconds(`public/${file}`);
  manifest[line.id] = { file, seconds: s };
  const room = line.sceneEnd - line.at;
  const ok = s <= room;
  if (!ok) problems++;
  console.log(`${ok ? "✓" : "✗"} ${line.id}: ${s.toFixed(2)}s of ${room.toFixed(2)}s available`);
}

writeFileSync(MANIFEST, JSON.stringify({ ...manifest, _texts: texts }, null, 2) + "\n");
console.log(problems ? `${problems} line(s) are too long for their scene: shorten them in apps/web/remotion/voiceover.ts and run again.` : `Voiceover ready: ${MANIFEST}`);
process.exit(problems ? 1 : 0);
