// Database-level protection for the ledger. Application code cannot be trusted alone with financial records:
// these triggers make the guarantees hold even for buggy code or a careless SQL session.
import { db } from "@/lib/db";

export const GUARD_SQL: string[] = [
  `CREATE OR REPLACE FUNCTION gl_block_mutation() RETURNS trigger AS $$
   BEGIN RAISE EXCEPTION 'ledger rows are append-only (% on %); post a reversing journal instead', TG_OP, TG_TABLE_NAME; END;
   $$ LANGUAGE plpgsql`,
  `DROP TRIGGER IF EXISTS gl_journal_immutable ON "GlJournal"`,
  `CREATE TRIGGER gl_journal_immutable BEFORE UPDATE OR DELETE ON "GlJournal" FOR EACH ROW EXECUTE FUNCTION gl_block_mutation()`,
  `DROP TRIGGER IF EXISTS gl_entry_immutable ON "GlEntry"`,
  `CREATE TRIGGER gl_entry_immutable BEFORE UPDATE OR DELETE ON "GlEntry" FOR EACH ROW EXECUTE FUNCTION gl_block_mutation()`,
  // Statement-level check: all entries of a journal must be inserted in ONE statement, and that statement must balance.
  // (A deferred commit-time check would be skipped silently by some drivers, so the error must be immediate.)
  `CREATE OR REPLACE FUNCTION gl_check_balance() RETURNS trigger AS $$
   BEGIN
     IF EXISTS (SELECT 1 FROM new_rows GROUP BY "journalId" HAVING SUM("baseUsdCents") <> 0) THEN
       RAISE EXCEPTION 'ledger journal does not balance in USD';
     END IF;
     IF EXISTS (SELECT 1 FROM new_rows GROUP BY "journalId", "currency" HAVING SUM("amountMinor") <> 0) THEN
       RAISE EXCEPTION 'ledger journal does not balance in every currency';
     END IF;
     RETURN NULL;
   END; $$ LANGUAGE plpgsql`,
  `DROP TRIGGER IF EXISTS gl_entry_balanced ON "GlEntry"`,
  `CREATE TRIGGER gl_entry_balanced AFTER INSERT ON "GlEntry" REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION gl_check_balance()`,
  `CREATE OR REPLACE FUNCTION gl_check_period_open() RETURNS trigger AS $$
   BEGIN
     IF EXISTS (SELECT 1 FROM "GlPeriod" WHERE "id" = NEW."periodId" AND "status" = 'CLOSED') THEN
       RAISE EXCEPTION 'accounting period % is closed', NEW."periodId";
     END IF;
     RETURN NEW;
   END; $$ LANGUAGE plpgsql`,
  `DROP TRIGGER IF EXISTS gl_journal_period_open ON "GlJournal"`,
  `CREATE TRIGGER gl_journal_period_open BEFORE INSERT ON "GlJournal" FOR EACH ROW EXECUTE FUNCTION gl_check_period_open()`,
];

export async function guardsInstalled(): Promise<boolean> {
  const rows = await db.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*)::bigint AS n FROM pg_trigger WHERE tgname IN ('gl_journal_immutable','gl_entry_immutable','gl_entry_balanced','gl_journal_period_open') AND NOT tgisinternal`;
  if (Number(rows[0]?.n ?? 0) !== 4) return false;
  // Upgrade check: the statement-level balance function (uses the new_rows transition table) must be the installed version.
  const fn = await db.$queryRaw<{ prosrc: string }[]>`SELECT prosrc FROM pg_proc WHERE proname = 'gl_check_balance' LIMIT 1`;
  return !!fn[0]?.prosrc.includes("new_rows");
}

export async function installGuards(): Promise<void> {
  for (const stmt of GUARD_SQL) await db.$executeRawUnsafe(stmt);
}

let checked = false;
/** Called before the first posting in a process. Installs the triggers when allowed, otherwise refuses to post without them. */
export async function ensureLedgerGuards(): Promise<void> {
  if (checked) return;
  if (!(await guardsInstalled())) {
    if (process.env.NODE_ENV === "production" && process.env.LEDGER_GUARDS_AUTOINSTALL !== "true") {
      throw new Error("Ledger database guards are not installed. Run: node scripts/db-guards.mjs (or set LEDGER_GUARDS_AUTOINSTALL=true)");
    }
    await installGuards();
  }
  checked = true;
}
