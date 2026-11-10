import type { Address } from "./types.js";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export function isAddress(value: unknown): value is Address {
  return typeof value === "string" && ADDRESS_RE.test(value);
}

/** Lower-cases an address so it can be used as a map key. Throws on invalid input. */
export function normalizeAddress(value: string): Address {
  if (!isAddress(value)) throw new Error(`Invalid address: ${value}`);
  return value.toLowerCase() as Address;
}

export function sameAddress(a: string | undefined, b: string | undefined): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}
