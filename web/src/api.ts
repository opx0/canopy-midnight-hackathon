export type Meta = {
  network: string;
  contractAddress: string;
  projects: {
    key: string;
    name: string;
    vintage: number;
    tonnes: string;
    credits: number;
  }[];
  allocation: string[];
};

export type ChainView = {
  batches: {
    id: string;
    project: string;
    vintage: number;
    tonnes: string;
    credits: number;
  }[];
  companies: { publicKey: string; name: string; tallyCommitment: string }[];
  claims: {
    id: string;
    company: string;
    threshold: string;
    period: string;
    attested: boolean;
  }[];
  retiredNullifiers: string[];
  transferredNullifiers: string[];
  issuedCredits: number;
  issuedTonnes: string;
  retirementEvents: number;
  transferEvents: number;
  registryKey: string;
  auditorKey: string;
};

export type Credit = {
  serial: string;
  tonnes: string;
  retired: boolean;
  transferred: boolean;
  nullifier: string;
};

export type CompanyView = {
  role: "ecocorp" | "fraudcorp";
  name: string;
  publicKey: string;
  credits: Credit[];
  retiredTonnes: string;
};

export type SessionView = {
  id: string;
  companies: CompanyView[];
  claimIds: string[];
  seeding: { done: number; total: number; failed?: string };
};

export type Disclosure = {
  serial: string;
  tonnes: string;
  salt: string;
  nullifier: string;
  retired: boolean;
  transferred: boolean;
  commitment: string;
};

export type Job = {
  id: string;
  action: string;
  status: "running" | "done" | "failed";
  startedAt: number;
  finishedAt?: number;
  result?: Record<string, string>;
  error?: string;
};

const json = async <T>(response: Response): Promise<T> => {
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(body.error ?? `request failed (${response.status})`);
  }
  return (await response.json()) as T;
};

export type Fees = {
  dust: string;
  required: string;
  perSecond: number;
  waitingSince: number;
  waitedSeconds: number;
  secondsToAfford: number;
  transactions: number;
  lastCost: string;
};

// The one piece of global state worth a module variable: the fee wallet's balance is
// the same for every visitor, and every busy spinner on the page wants to explain
// itself with it.
export const live: { fees?: Fees } = {};

export type Status = {
  ready: boolean;
  reads: boolean;
  failure?: string;
  warmingUpSeconds: number;
  stage?: string;
  stageSeconds?: number;
  fees?: Fees;
  scan?: {
    applied: number;
    perSecond: number;
    estimatedTotal: number;
    secondsLeft: number;
  };
};

export type History = {
  since?: number;
  transactions: number;
  refusals: number;
  errors: number;
  medianMs: number;
  snapshots: {
    at: number;
    issuedTonnes?: string;
    issuedCredits?: number;
    retirementEvents?: number;
  }[];
  recent: {
    at: number;
    action?: string;
    txHash?: string;
    ms?: number;
    rejected?: string;
    refused?: boolean;
  }[];
};

export type Benchmarks = {
  treeDepth: number;
  treeCapacity: number;
  fees: Fees;
  circuits: {
    circuit: string;
    action: string;
    summary: string;
    operations: number;
    inputs: number;
    proverKeyBytes: number;
    verifierKeyBytes: number;
    measured?: {
      count: number;
      medianMs: number;
      p90Ms: number;
      fastestMs: number;
    };
  }[];
};

export type ClaimRecord = {
  network: string;
  contractAddress: string;
  found: boolean;
  claim?: {
    id: string;
    company: string;
    threshold: string;
    period: string;
    attested: boolean;
  };
  auditorKey: string;
  registryKey: string;
  retirementEvents: number;
  checkedAt: number;
};

export const getClaim = (id: string) =>
  fetch(`/api/claim/${id}`).then(json<ClaimRecord>);

export const getBenchmarks = () =>
  fetch("/api/benchmarks").then(json<Benchmarks>);

export const getStatus = () =>
  fetch("/api/status")
    .then(json<Status>)
    .then((status) => {
      live.fees = status.fees;
      return status;
    });
export const getHistory = () => fetch("/api/history").then(json<History>);
export const getMeta = () => fetch("/api/meta").then(json<Meta>);
export const getChain = () => fetch("/api/chain").then(json<ChainView>);
export const getSession = (id: string) =>
  fetch(`/api/session/${id}`).then(json<SessionView>);
export const getDisclosure = (id: string, role: string) =>
  fetch(`/api/session/${id}/disclosure/${role}`).then(json<Disclosure[]>);

export const createSession = () =>
  fetch("/api/session", { method: "POST" }).then(json<{ id: string }>);

const startAction = (sessionId: string, body: Record<string, unknown>) =>
  fetch(`/api/session/${sessionId}/action`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(json<Job>);

const pollJob = (id: string) => fetch(`/api/job/${id}`).then(json<Job>);

export const runAction = async (
  sessionId: string,
  body: Record<string, unknown>,
  onTick?: (elapsedMs: number) => void,
): Promise<Job> => {
  const started = await startAction(sessionId, body);
  const startedAt = Date.now();
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 700));
    const job = await pollJob(started.id);
    onTick?.(Date.now() - startedAt);
    if (job.status === "done") return job;
    if (job.status === "failed") throw new Error(job.error ?? "action failed");
  }
};
