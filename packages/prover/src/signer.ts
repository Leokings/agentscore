import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createAccount, generatePrivateKey } from "genlayer-js";

const ENV_PATH = resolve(import.meta.dirname, "../../../.env");

/**
 * The StudioNet key the prover and keeper sign with. StudioNet is gasless, so the key holds no
 * funds; it is created on first use and kept in the git-ignored .env.
 */
export function loadSignerKey(log: (msg: string) => void = console.log): `0x${string}` {
  const existing = process.env.AGENTSCORE_SIGNER_KEY;
  if (existing && /^0x[0-9a-fA-F]{64}$/.test(existing)) return existing as `0x${string}`;
  // On CI (GitHub Actions sets CI=true) a missing or malformed secret must stop the run, not
  // silently sign with a throwaway key.
  if (process.env.CI) throw new Error("AGENTSCORE_SIGNER_KEY is missing or not a 0x-prefixed 32-byte key");
  const key = generatePrivateKey();
  const prefix = existsSync(ENV_PATH) && !readFileSync(ENV_PATH, "utf8").endsWith("\n") ? "\n" : "";
  appendFileSync(ENV_PATH, `${prefix}# StudioNet signer for the prover and keeper (test network only)\nAGENTSCORE_SIGNER_KEY=${key}\n`);
  process.env.AGENTSCORE_SIGNER_KEY = key;
  log(`Created a StudioNet signer key in .env (address ${createAccount(key).address}).`);
  return key;
}
