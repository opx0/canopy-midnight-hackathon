import { appendFile, readFile, rename } from "node:fs/promises";
import { historyFile } from "./config.js";
import { isRefusal, logger, publicLedger } from "./chain.js";

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

// A new contract is a new ledger: its counters start at zero and the old numbers
// describe something that no longer exists. Keep the old log next to the new one —
// the deployment it belongs to is in deployments.jsonl — but stop serving it.
export const rotate = async (reason: string): Promise<void> => {
  entries.length = 0;
  const archive = `${historyFile}.${Date.now()}`;
  await rename(historyFile, archive).then(
    () => logger.info({ archive, reason }, "archived the previous deployment's history"),
    () => undefined,
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

const quantile = (values: number[], at: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * at))];
};

// Latency per circuit, measured end to end: proving, submission, and waiting for the
// node to accept it. Refused attempts are excluded — they never reach a block, so
// timing them would flatter the numbers.
export const latencyByAction = (): Record<
  string,
  { count: number; medianMs: number; p90Ms: number; fastestMs: number }
> => {
  const byAction: Record<string, number[]> = {};
  for (const entry of entries) {
    if (entry.kind !== "action" || !entry.txHash) continue;
    (byAction[entry.action ?? "?"] ??= []).push(entry.ms ?? 0);
  }
  return Object.fromEntries(
    Object.entries(byAction).map(([action, times]) => [
      action,
      {
        count: times.length,
        medianMs: quantile(times, 0.5),
        p90Ms: quantile(times, 0.9),
        fastestMs: quantile(times, 0),
      },
    ]),
  );
};

const median = (values: number[]): number =>
  values.length === 0
    ? 0
    : [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

export const historyView = () => {
  const actions = entries.filter((entry) => entry.kind === "action");
  const confirmed = actions.filter((entry) => entry.txHash);
  const rejected = actions.filter((entry) => entry.rejected);
  return {
    since: entries[0]?.at,
    transactions: confirmed.length,
    // A refusal is the contract rejecting a lie. An error is Canopy's own plumbing
    // failing. Counting the second as the first would flatter this app dishonestly.
    refusals: rejected.filter((entry) => isRefusal(entry.rejected ?? "")).length,
    errors: rejected.filter((entry) => !isRefusal(entry.rejected ?? "")).length,
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
        refused: rejected !== undefined && isRefusal(rejected),
      })),
  };
};
