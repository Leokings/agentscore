import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, type Client } from "@libsql/client";
import type { Address, CaseContractType, CaseKind, CaseParty, CourtCase, StatementVerdict, TxHash } from "@agentscore/shared";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS cases (
    id INTEGER PRIMARY KEY,
    address TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL,
    contract_type TEXT NOT NULL DEFAULT 'unknown',
    statement TEXT,
    reasoning TEXT,
    status_code INTEGER,
    status TEXT,
    escrow_amount TEXT,
    created_block INTEGER NOT NULL,
    created_tx TEXT,
    disputed INTEGER NOT NULL DEFAULT 0,
    dispute_block INTEGER,
    verdict_code INTEGER,
    verdict_block INTEGER,
    statement_verdict TEXT,
    enriched_at INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS case_parties (
    case_address TEXT NOT NULL,
    role TEXT NOT NULL,
    address TEXT NOT NULL,
    PRIMARY KEY (case_address, role)
  )`,
  `CREATE INDEX IF NOT EXISTS case_parties_by_address ON case_parties(address)`,
  `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS http_cache (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires_at INTEGER NOT NULL)`,
];

export class Store {
  private constructor(readonly db: Client) {}

  static async open(url = process.env.DATABASE_URL || "file:data/agentscore.db"): Promise<Store> {
    if (url.startsWith("file:")) {
      // Relative file paths are resolved from the repository root, whichever workspace runs this.
      const path = resolve(REPO_ROOT, url.slice("file:".length));
      mkdirSync(dirname(path), { recursive: true });
      url = `file:${path}`;
    }
    const db = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN || undefined });
    for (const sql of SCHEMA) await db.execute(sql);
    return new Store(db);
  }

  close(): void {
    this.db.close();
  }

  // --- meta ---------------------------------------------------------------

  async getMeta(key: string): Promise<string | undefined> {
    const r = await this.db.execute({ sql: "SELECT value FROM meta WHERE key = ?", args: [key] });
    return r.rows[0]?.value as string | undefined;
  }

  async setMeta(key: string, value: string): Promise<void> {
    await this.db.execute({
      sql: "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      args: [key, value],
    });
  }

  // --- cache --------------------------------------------------------------

  async cacheGet<T>(key: string): Promise<T | undefined> {
    const r = await this.db.execute({
      sql: "SELECT value FROM http_cache WHERE key = ? AND expires_at > ?",
      args: [key, Date.now()],
    });
    const v = r.rows[0]?.value as string | undefined;
    return v === undefined ? undefined : (JSON.parse(v) as T);
  }

  async cacheSet(key: string, value: unknown, ttlMs: number): Promise<void> {
    await this.db.execute({
      sql: "INSERT INTO http_cache (key, value, expires_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at",
      args: [key, JSON.stringify(value), Date.now() + ttlMs],
    });
  }

  // --- cases --------------------------------------------------------------

  async upsertCaseCreated(c: {
    id: number;
    address: Address;
    kind: CaseKind;
    createdBlock: number;
    createdTx?: TxHash;
  }): Promise<void> {
    await this.db.execute({
      sql: `INSERT INTO cases (id, address, kind, created_block, created_tx) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET address = excluded.address, kind = excluded.kind,
              created_block = excluded.created_block, created_tx = COALESCE(excluded.created_tx, cases.created_tx)`,
      args: [c.id, c.address, c.kind, c.createdBlock, c.createdTx ?? null],
    });
  }

  async markDisputed(address: Address, block: number): Promise<void> {
    await this.db.execute({
      sql: "UPDATE cases SET disputed = 1, dispute_block = COALESCE(dispute_block, ?), enriched_at = NULL WHERE address = ?",
      args: [block, address],
    });
  }

  async setVerdict(address: Address, code: number, block: number): Promise<void> {
    await this.db.execute({
      sql: "UPDATE cases SET verdict_code = ?, verdict_block = ?, enriched_at = NULL WHERE address = ?",
      args: [code, block, address],
    });
  }

  async setParties(caseAddress: Address, parties: CaseParty[]): Promise<void> {
    for (const p of parties) {
      await this.db.execute({
        sql: "INSERT INTO case_parties (case_address, role, address) VALUES (?, ?, ?) ON CONFLICT(case_address, role) DO UPDATE SET address = excluded.address",
        args: [caseAddress, p.role, p.address],
      });
    }
  }

  async saveEnrichment(
    address: Address,
    e: {
      contractType: CaseContractType;
      statement?: string;
      reasoning?: string;
      statusCode?: number;
      status?: string;
      escrowAmount?: string;
      statementVerdict?: StatementVerdict;
    },
  ): Promise<void> {
    await this.db.execute({
      sql: `UPDATE cases SET contract_type = ?, statement = ?, reasoning = ?, status_code = ?, status = ?,
              escrow_amount = ?, statement_verdict = ?, enriched_at = ? WHERE address = ?`,
      args: [
        e.contractType,
        e.statement ?? null,
        e.reasoning ?? null,
        e.statusCode ?? null,
        e.status ?? null,
        e.escrowAmount ?? null,
        e.statementVerdict ?? null,
        Date.now(),
        address,
      ],
    });
  }

  /** Cases that were never read, or changed since they were last read, or are not final yet. */
  async casesNeedingEnrichment(staleAfterMs: number): Promise<Array<{ address: Address; kind: CaseKind; createdTx?: TxHash }>> {
    const r = await this.db.execute({
      sql: `SELECT address, kind, created_tx FROM cases
            WHERE enriched_at IS NULL OR (verdict_code IS NULL AND enriched_at < ?)`,
      args: [Date.now() - staleAfterMs],
    });
    return r.rows.map((row) => ({
      address: row.address as Address,
      kind: row.kind as CaseKind,
      createdTx: (row.created_tx as TxHash | null) ?? undefined,
    }));
  }

  async allCases(): Promise<CourtCase[]> {
    const r = await this.db.execute("SELECT * FROM cases ORDER BY id");
    const parties = await this.db.execute("SELECT case_address, role, address FROM case_parties");
    const byCase = new Map<string, CaseParty[]>();
    for (const p of parties.rows) {
      const list = byCase.get(p.case_address as string) ?? [];
      list.push({ role: p.role as string, address: p.address as Address });
      byCase.set(p.case_address as string, list);
    }
    return r.rows.map((row) => rowToCase(row, byCase.get(row.address as string) ?? []));
  }

  async casesForWallet(wallet: Address): Promise<Array<CourtCase & { role: string }>> {
    const r = await this.db.execute({
      sql: "SELECT case_address, role FROM case_parties WHERE address = ?",
      args: [wallet],
    });
    const roles = new Map(r.rows.map((row) => [row.case_address as string, row.role as string]));
    const all = await this.allCases();
    return all.filter((c) => roles.has(c.address)).map((c) => ({ ...c, role: roles.get(c.address)! }));
  }
}

function rowToCase(row: Record<string, unknown>, parties: CaseParty[]): CourtCase {
  const opt = <T>(v: unknown): T | undefined => (v === null || v === undefined ? undefined : (v as T));
  return {
    id: Number(row.id),
    address: row.address as Address,
    kind: row.kind as CaseKind,
    contractType: row.contract_type as CaseContractType,
    parties,
    statement: opt<string>(row.statement),
    reasoning: opt<string>(row.reasoning),
    statusCode: opt<number>(row.status_code) === undefined ? undefined : Number(row.status_code),
    status: opt<string>(row.status),
    escrowAmount: opt<string>(row.escrow_amount),
    createdBlock: Number(row.created_block),
    createdTx: opt<TxHash>(row.created_tx),
    disputed: Number(row.disputed) === 1,
    disputeBlock: opt<number>(row.dispute_block) === undefined ? undefined : Number(row.dispute_block),
    verdictCode: opt<number>(row.verdict_code) === undefined ? undefined : Number(row.verdict_code),
    verdictBlock: opt<number>(row.verdict_block) === undefined ? undefined : Number(row.verdict_block),
    statementVerdict: opt<StatementVerdict>(row.statement_verdict),
  };
}
