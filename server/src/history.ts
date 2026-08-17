import { appendFile, readFile } from "node:fs/promises";
import { historyFile } from "./config.js";
import { logger, publicLedger } from "./chain.js";

export type Entry = {
  at: number;
  kind: "action" | "snapshot";
  action?: string;
  txHash?: string;
  ms?: number;
  rejected?: string;
  issuedCredits?: number;
  issuedTonnes?: string;
  retirementEvents?: number;
  companies?: number;
  claims?: number;
};

const entries: Entry[] = [];

const append = async (entry: Entry): Promise<void> => {
  entries.push(entry);
  await appendFile(historyFile, `${JSON.stringify(entry)}\n`).catch(
    (error: unknown) => logger.warn({ error }, "could not append to history"),
  );
};

export const load = async (): Promise<void> => {
  const text = await readFile(historyFile, "utf8").catch(() => "");
  for (const line of text.split("\n")) {
    if (line) entries.push(JSON.parse(line) as Entry);
  }
  logger.info({ entries: entries.length }, "loaded the recorded history");
};

export const recordAction = (
  action: string,
  ms: number,
  result: unknown,
  rejected?: string,
): Promise<void> =>
  append({
    at: Date.now(),
    kind: "action",
    action,
    ms,
    txHash: (result as { txHash?: string } | undefined)?.txHash,
    rejected,
  });

export const snapshot = async (): Promise<void> => {
  const ledger = await publicLedger();
  await append({
    at: Date.now(),
    kind: "snapshot",
    issuedCredits: Number(ledger.issuedCredits),
    issuedTonnes: ledger.issuedTonnes.toString(),
    retirementEvents: Number(ledger.retirementEvents),
    companies: [...ledger.companies].length,
    claims: [...ledger.claims].length,
  });
};

let snapshotting: ReturnType<typeof setInterval> | undefined;

export const keepSnapshotting = (everyMs = 900_000): void => {
  if (snapshotting) return;
  const take = () =>
    snapshot().catch((error: unknown) =>
      logger.warn({ error }, "could not snapshot the chain"),
    );
  void take();
  snapshotting = setInterval(take, everyMs).unref();
};

const median = (values: number[]): number =>
  values.length === 0
    ? 0
    : [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

export const historyView = () => {
  const actions = entries.filter((entry) => entry.kind === "action");
  const confirmed = actions.filter((entry) => entry.txHash);
  return {
    since: entries[0]?.at,
    transactions: confirmed.length,
    rejections: actions.filter((entry) => entry.rejected).length,
    medianMs: median(confirmed.map((entry) => entry.ms ?? 0)),
    snapshots: entries
      .filter((entry) => entry.kind === "snapshot")
      .slice(-96)
      .map(({ at, issuedTonnes, issuedCredits, retirementEvents }) => ({
        at,
        issuedTonnes,
        issuedCredits,
        retirementEvents,
      })),
    recent: actions
      .slice(-12)
      .reverse()
      .map(({ at, action, txHash, ms, rejected }) => ({
        at,
        action,
        txHash,
        ms,
        rejected,
      })),
  };
};
