export type Meta = {
  network: string;
  contractAddress: string;
  project: {
    name: string;
    vintage: number;
    tonnes: string;
    credits: number;
  };
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
  issuedCredits: number;
  issuedTonnes: string;
  retirementEvents: number;
  registryKey: string;
  auditorKey: string;
};

export type Credit = {
  serial: string;
  tonnes: string;
  retired: boolean;
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
  batchId: string;
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

export type Status = {
  ready: boolean;
  failure?: string;
  warmingUpSeconds: number;
};

export const getStatus = () => fetch("/api/status").then(json<Status>);
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
