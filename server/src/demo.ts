import { randomBytes, randomUUID } from "node:crypto";
import {
  noteNullifier,
  pureCircuits,
  type CreditNote,
} from "@canopy/contract";
import {
  dustNow,
  enqueue,
  handleFor,
  isRefusal,
  logger,
  publicLedger,
  rootCause,
  settle,
  walletSnapshot,
} from "./chain.js";
import { historyView, recordAction } from "./history.js";
import { affordable, easeRequirement, raiseRequirement, spent } from "./fees.js";
import {
  auditorSecretKey,
  companyLabel,
  companySecretKey,
  derive,
  registrySecretKey,
  type CompanyRole,
} from "./identities.js";

export const hex = (bytes: Uint8Array): string =>
  Buffer.from(bytes).toString("hex");

const bytes = (): Uint8Array => new Uint8Array(randomBytes(32));

// Three real Verra projects, so the public supply table reads like a registry rather
// than like one row copied three times. The batch id is derived from the key, which
// makes reopening a batch idempotent across restarts instead of leaving orphans.
const PROJECTS = [
  {
    key: "kariba",
    name: "Kariba REDD+ Forest Protection",
    vintage: 2024n,
    tonnes: 50_000n,
    credits: 500n,
  },
  {
    key: "rimba",
    name: "Rimba Raya Biodiversity Reserve",
    vintage: 2023n,
    tonnes: 32_000n,
    credits: 320n,
  },
  {
    key: "delta",
    name: "Delta Blue Carbon, Sindh",
    vintage: 2025n,
    tonnes: 18_500n,
    credits: 185n,
  },
] as const;

export type ProjectKey = (typeof PROJECTS)[number]["key"];

const projectFor = (key: string) =>
  PROJECTS.find((entry) => entry.key === key) ?? PROJECTS[0];

const batchIdOf = (key: string): Uint8Array => derive("showcase", key);

const ALLOCATION = [600n, 900n];

type CompanyState = {
  readonly role: CompanyRole;
  readonly name: string;
  readonly secretKey: Uint8Array;
  readonly publicKey: Uint8Array;
  credits: CreditNote[];
};

export type Session = {
  readonly id: string;
  readonly createdAt: number;
  readonly companies: Record<CompanyRole, CompanyState>;
  claimIds: string[];
  seeding: { done: number; total: number; failed?: string };
};

const sessions = new Map<string, Session>();

const same = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((byte, index) => byte === b[index]);

// Adding a note twice would show a company holding two of the same credit. The
// showcase reconstructs its notes before checking whether the chain already has them,
// so this runs on every resumed seeding pass.
const remember = (company: CompanyState, note: CreditNote): void => {
  const known = company.credits.some(
    (credit) => same(credit.serial, note.serial) && same(credit.salt, note.salt),
  );
  if (!known) company.credits = [...company.credits, note];
};

const makeCompany = (sessionId: string, role: CompanyRole): CompanyState => {
  const secretKey = companySecretKey(sessionId, role);
  return {
    role,
    name: companyLabel[role],
    secretKey,
    publicKey: pureCircuits.companyPublicKey(secretKey),
    credits: [],
  };
};

// A circuit refusal is the contract doing its job, and it is deterministic: retrying a
// double retirement just proves the same fraud twice. Everything else — a node hiccup,
// an indexer lagging a block — is worth one more go, but not the twelve minutes an
// earlier version of this spent before giving up.
const brokeOnFees = /Insufficient Funds|could not balance dust/i;

const submitOnce = async <T>(work: () => Promise<T>): Promise<T> => {
  for (let attempt = 1; ; attempt++) {
    try {
      const result = await enqueue(async () => {
        await affordable();
        const before = await dustNow();
        const done = await work();
        spent(before, await dustNow());
        easeRequirement();
        return done;
      });
      await settle();
      return result;
    } catch (error) {
      const reason = rootCause(error);
      if (attempt >= 4 || isRefusal(reason)) {
        throw new Error(reason, { cause: error });
      }
      // Running out of DUST is not a rejection, it is a queue. Ask for more next time
      // and wait through a regeneration window rather than hammering the node.
      const starved = brokeOnFees.test(reason);
      if (starved) raiseRequirement();
      logger.warn(
        { attempt, reason, wallet: await walletSnapshot() },
        starved
          ? "the fee wallet ran out of DUST, waiting for it to regenerate"
          : "the node rejected the transaction, waiting before trying again",
      );
      await settle();
      await new Promise((resolve) =>
        setTimeout(resolve, attempt * (starved ? 60_000 : 20_000)),
      );
    }
  }
};

const submit = async <T>(action: string, work: () => Promise<T>): Promise<T> => {
  const startedAt = Date.now();
  try {
    const result = await submitOnce(work);
    void recordAction(action, Date.now() - startedAt, result);
    return result;
  } catch (error) {
    const reason = rootCause(error);
    void recordAction(action, Date.now() - startedAt, undefined, reason);
    throw error instanceof Error && error.message === reason
      ? error
      : new Error(reason, { cause: error });
  }
};

export const createSession = (fixedId?: string): Session => {
  const id = fixedId ?? randomUUID().slice(0, 8);
  const session: Session = {
    id,
    createdAt: Date.now(),
    companies: {
      ecocorp: makeCompany(id, "ecocorp"),
      fraudcorp: makeCompany(id, "fraudcorp"),
    },
    claimIds: [],
    seeding: { done: 0, total: ALLOCATION.length + 2 },
  };
  sessions.set(id, session);
  return session;
};

export const getSession = (id: string): Session => {
  const session = sessions.get(id);
  if (!session) throw new Error(`unknown session '${id}'`);
  return session;
};

export const pruneSessions = (maxAgeMs = 86_400_000): void => {
  const cutoff = Date.now() - maxAgeMs;
  for (const [id, session] of sessions) {
    if (session.createdAt < cutoff) sessions.delete(id);
  }
};

const stateId = (session: Session, who: string) => `canopy-${session.id}-${who}`;

const registryHandle = (session: Session) =>
  handleFor(stateId(session, "registry"), registrySecretKey, []);

const auditorHandle = (session: Session) =>
  handleFor(stateId(session, "auditor"), auditorSecretKey, []);

const companyHandle = (session: Session, role: CompanyRole) => {
  const company = session.companies[role];
  return handleFor(stateId(session, role), company.secretKey, company.credits);
};

export const openBatch = (session: Session, key: string = PROJECTS[0].key) =>
  submit("open-batch", async () => {
    const project = projectFor(key);
    const batchId = batchIdOf(project.key);
    const contract = await registryHandle(session);
    const tx = await contract.callTx.openBatch(
      batchId,
      project.name,
      project.vintage,
      project.tonnes,
      project.credits,
    );
    return { txHash: tx.public.txHash, batchId: hex(batchId) };
  });

export const issueCredit = (
  session: Session,
  role: CompanyRole,
  tonnes: bigint,
  key: string = PROJECTS[0].key,
  // The showcase supplies its own derived note so that re-running it recognises what
  // is already on chain instead of minting a second copy.
  given?: CreditNote,
) =>
  submit("issue", async () => {
    const company = session.companies[role];
    const note: CreditNote = given ?? {
      serial: bytes(),
      tonnes,
      salt: bytes(),
      batchId: batchIdOf(projectFor(key).key),
    };
    const commitment = pureCircuits.creditCommitment(
      note.serial,
      note.tonnes,
      company.publicKey,
      note.salt,
    );
    const contract = await registryHandle(session);
    const tx = await contract.callTx.issueCredit(note.batchId, commitment);
    remember(company, note);
    return {
      txHash: tx.public.txHash,
      serial: hex(note.serial),
      tonnes: tonnes.toString(),
      commitment: hex(commitment),
    };
  });

export const registerCompany = (session: Session, role: CompanyRole) =>
  submit("register", async () => {
    const company = session.companies[role];
    const contract = await companyHandle(session, role);
    const tx = await contract.callTx.registerCompany(company.name);
    return { txHash: tx.public.txHash, publicKey: hex(company.publicKey) };
  });

// Prefer this company's own note. A serial survives a transfer, so after one hop two
// companies hold notes with the same serial and different salts; picking the first
// match would sign the wrong one. Falling back to anybody's note is deliberate: it is
// what lets a visitor point FraudCorp at a credit it does not hold and watch the
// circuit refuse to prove it, rather than being stopped by a check in this file.
const noteFor = (session: Session, role: CompanyRole, serialHex: string) => {
  const matching = (credit: CreditNote) => hex(credit.serial) === serialHex;
  const note =
    session.companies[role].credits.find(matching) ??
    Object.values(session.companies).flatMap((c) => c.credits).find(matching);
  if (!note) throw new Error("no credit with that serial exists in this demo");
  return note;
};

export const retireCredit = (
  session: Session,
  role: CompanyRole,
  serialHex: string,
) =>
  submit("retire", async () => {
    const company = session.companies[role];
    const note = noteFor(session, role, serialHex);
    const contract = await companyHandle(session, role);
    const tx = await contract.callTx.retireCredit(
      note.serial,
      note.tonnes,
      note.salt,
    );
    return {
      txHash: tx.public.txHash,
      nullifier: hex(noteNullifier(note, company.secretKey)),
      tonnes: note.tonnes.toString(),
    };
  });

export const transferCredit = (
  session: Session,
  from: CompanyRole,
  to: CompanyRole,
  serialHex: string,
  givenSalt?: Uint8Array,
) =>
  submit("transfer", async () => {
    const sender = session.companies[from];
    const recipient = session.companies[to];
    const note = noteFor(session, from, serialHex);
    const freshSalt = givenSalt ?? bytes();
    const contract = await companyHandle(session, from);
    const tx = await contract.callTx.transferCredit(
      note.serial,
      note.tonnes,
      note.salt,
      recipient.publicKey,
      freshSalt,
    );
    // Only a commitment went on chain. The note that opens it travels out of band —
    // here that means this server hands it to the recipient, the way a shielded memo
    // or an ordinary settlement message would carry it in production.
    remember(recipient, { ...note, salt: freshSalt });
    return {
      txHash: tx.public.txHash,
      to: recipient.name,
      tonnes: note.tonnes.toString(),
      nullifier: hex(noteNullifier(note, sender.secretKey)),
    };
  });

export const publishClaim = (
  session: Session,
  role: CompanyRole,
  threshold: bigint,
  period: string,
  givenId?: Uint8Array,
) =>
  submit("claim", async () => {
    const claimId = givenId ?? bytes();
    const contract = await companyHandle(session, role);
    const tx = await contract.callTx.publishClaim(claimId, threshold, period);
    session.claimIds.push(hex(claimId));
    return {
      txHash: tx.public.txHash,
      claimId: hex(claimId),
      threshold: threshold.toString(),
    };
  });

export const disclosureFor = async (session: Session, role: CompanyRole) => {
  const company = session.companies[role];
  const ledger = await publicLedger();
  return company.credits.map((note) => {
    const nullifier = noteNullifier(note, company.secretKey);
    return {
      serial: hex(note.serial),
      tonnes: note.tonnes.toString(),
      salt: hex(note.salt),
      nullifier: hex(nullifier),
      retired: ledger.retiredCredits.member(nullifier),
      transferred: ledger.transferredCredits.member(nullifier),
      commitment: hex(
        pureCircuits.creditCommitment(
          note.serial,
          note.tonnes,
          company.publicKey,
          note.salt,
        ),
      ),
    };
  });
};

export const attestClaim = (session: Session, claimIdHex: string) =>
  submit("attest", async () => {
    const contract = await auditorHandle(session);
    const tx = await contract.callTx.attestClaim(
      Uint8Array.from(Buffer.from(claimIdHex, "hex")),
    );
    return { txHash: tx.public.txHash, claimId: claimIdHex };
  });

export const chainView = async () => {
  const ledger = await publicLedger();
  const batches = [...ledger.batches].map(([id, batch]) => ({
    id: hex(id),
    project: batch.project,
    vintage: Number(batch.vintage),
    tonnes: batch.tonnes.toString(),
    credits: Number(batch.credits),
  }));
  const companies = [...ledger.companies].map(([pk, tally]) => ({
    publicKey: hex(pk),
    name: ledger.companyNames.member(pk)
      ? ledger.companyNames.lookup(pk)
      : "(unnamed)",
    tallyCommitment: hex(tally),
  }));
  const claims = [...ledger.claims].map(([id, claim]) => ({
    id: hex(id),
    company: hex(claim.company),
    threshold: claim.threshold.toString(),
    period: claim.period,
    attested: claim.attested,
  }));
  return {
    batches,
    companies,
    claims,
    retiredNullifiers: [...ledger.retiredCredits].map(hex),
    transferredNullifiers: [...ledger.transferredCredits].map(hex),
    issuedCredits: Number(ledger.issuedCredits),
    issuedTonnes: ledger.issuedTonnes.toString(),
    retirementEvents: Number(ledger.retirementEvents),
    transferEvents: Number(ledger.transferEvents),
    registryKey: hex(ledger.registryKey),
    auditorKey: hex(ledger.auditorKey),
  };
};

export const sessionView = async (session: Session) => {
  const ledger = await publicLedger();
  const companies = (["ecocorp", "fraudcorp"] as const).map((role) => {
    const company = session.companies[role];
    const credits = company.credits.map((note) => {
      const nullifier = noteNullifier(note, company.secretKey);
      return {
        serial: hex(note.serial),
        tonnes: note.tonnes.toString(),
        retired: ledger.retiredCredits.member(nullifier),
        transferred: ledger.transferredCredits.member(nullifier),
        nullifier: hex(nullifier),
      };
    });
    const retiredTonnes = credits
      .filter((c) => c.retired)
      .reduce((total, c) => total + BigInt(c.tonnes), 0n);
    return {
      role,
      name: company.name,
      publicKey: hex(company.publicKey),
      credits,
      retiredTonnes: retiredTonnes.toString(),
    };
  });
  return {
    id: session.id,
    companies,
    claimIds: session.claimIds,
    seeding: session.seeding,
  };
};

// Batches are shared across every visitor, so opening them is a per-process singleton.
// If the transaction loses a race with another process the batch is already there,
// which is exactly the outcome we wanted, so treat that as success.
const opening = new Map<string, Promise<unknown>>();

const openBatchOnce = (session: Session, key: string): Promise<unknown> => {
  const existing = opening.get(key);
  if (existing) return existing;
  const started = openBatch(session, key).catch(async (error: unknown) => {
    const ledger = await publicLedger();
    if (ledger.batches.member(batchIdOf(key))) return;
    opening.delete(key);
    throw error;
  });
  opening.set(key, started);
  return started;
};

export const seedSession = async (session: Session): Promise<void> => {
  const steps: (() => Promise<unknown>)[] = [
    ...ALLOCATION.map((tonnes) => () => issueCredit(session, "ecocorp", tonnes)),
    () => registerCompany(session, "ecocorp"),
    () => registerCompany(session, "fraudcorp"),
  ];
  try {
    await openBatchOnce(session, PROJECTS[0].key);
    for (const step of steps) {
      await step();
      session.seeding = { ...session.seeding, done: session.seeding.done + 1 };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    session.seeding = { ...session.seeding, failed: message };
    logger.error({ error, session: session.id }, "failed to seed session");
  }
};

// The showcase is what a first visitor lands on, and it has to survive restarts.
// Every value in it is derived from the seed, so re-running reconstructs exactly the
// same credits, claim and keys, and every step asks the chain whether it already
// happened before paying for it again. That makes seeding resumable — which matters,
// because the fee wallet can run out of DUST halfway through, and did.
const SHOWCASE = "showcase";

const showcaseNote = (
  index: number,
  tonnes: bigint,
  project: string,
  hop = 0,
): CreditNote => ({
  serial: derive("showcase-serial", String(index)),
  tonnes,
  salt: derive("showcase-salt", `${index}-${hop}`),
  batchId: batchIdOf(project),
});

const SUPPLY = [
  { index: 0, tonnes: 600n, project: "kariba", to: "ecocorp" },
  { index: 1, tonnes: 900n, project: "kariba", to: "ecocorp" },
  { index: 2, tonnes: 1_200n, project: "kariba", to: "ecocorp" },
  { index: 3, tonnes: 450n, project: "rimba", to: "ecocorp" },
  { index: 4, tonnes: 300n, project: "delta", to: "fraudcorp" },
] as const;

const TRADED = 3;
const CLAIM_ID = derive("showcase-claim", "ecocorp");
const CLAIM_PERIOD = "FY2026 Q3";
const CLAIM_THRESHOLD = 1_000n;

const commitmentOf = (note: CreditNote, owner: Uint8Array) =>
  pureCircuits.creditCommitment(note.serial, note.tonnes, owner, note.salt);

const expectRefusal = async (
  what: string,
  attempt: () => Promise<unknown>,
): Promise<void> => {
  try {
    await attempt();
    logger.error({ what }, "a fraud attempt succeeded, which is a real bug");
  } catch (error) {
    logger.info({ what, reason: rootCause(error) }, "the circuit refused a lie");
  }
};

export const seedShowcase = async (): Promise<void> => {
  const session = sessions.get(SHOWCASE) ?? createSession(SHOWCASE);
  const hold = (role: CompanyRole, note: CreditNote) =>
    remember(session.companies[role], note);

  try {
    for (const project of PROJECTS) {
      if ((await publicLedger()).batches.member(batchIdOf(project.key))) continue;
      await openBatchOnce(session, project.key);
    }

    for (const role of ["ecocorp", "fraudcorp"] as const) {
      if ((await publicLedger()).companies.member(session.companies[role].publicKey)) {
        continue;
      }
      await registerCompany(session, role);
    }

    for (const spec of SUPPLY) {
      const note = showcaseNote(spec.index, spec.tonnes, spec.project);
      hold(spec.to, note);
      const owner = session.companies[spec.to].publicKey;
      const ledger = await publicLedger();
      if (ledger.creditTree.findPathForLeaf(commitmentOf(note, owner))) continue;
      await issueCredit(session, spec.to, spec.tonnes, spec.project, note);
    }

    // One credit changes hands, which is the whole point of the transfer circuit.
    const outbound = showcaseNote(TRADED, 450n, "rimba");
    const inbound = showcaseNote(TRADED, 450n, "rimba", 1);
    hold("fraudcorp", inbound);
    const traded = noteNullifier(outbound, session.companies.ecocorp.secretKey);
    if (!(await publicLedger()).transferredCredits.member(traded)) {
      await transferCredit(
        session,
        "ecocorp",
        "fraudcorp",
        hex(outbound.serial),
        inbound.salt,
      );
    }

    const retirements: [CompanyRole, CreditNote][] = [
      ["ecocorp", showcaseNote(0, 600n, "kariba")],
      ["ecocorp", showcaseNote(1, 900n, "kariba")],
      ["fraudcorp", inbound],
    ];
    for (const [role, note] of retirements) {
      const nullifier = noteNullifier(note, session.companies[role].secretKey);
      if ((await publicLedger()).retiredCredits.member(nullifier)) continue;
      await retireCredit(session, role, hex(note.serial));
    }

    const published = await publicLedger();
    if (!published.claims.member(CLAIM_ID)) {
      await publishClaim(
        session,
        "ecocorp",
        CLAIM_THRESHOLD,
        CLAIM_PERIOD,
        CLAIM_ID,
      );
    }
    if (!(await publicLedger()).claims.lookup(CLAIM_ID).attested) {
      await attestClaim(session, hex(CLAIM_ID));
    }
    session.seeding = { ...session.seeding, done: session.seeding.total };
    logger.info({ claim: hex(CLAIM_ID) }, "showcase seeded");

    // None of these reach the chain, so they cost nothing but prove the refusals are
    // real. A page that only ever shows successes is not evidence of enforcement.
    // Once for this deployment: re-running them on every restart would inflate the
    // count on the front page, which would make an honest number into a dishonest one.
    if (historyView().refusals > 0) return;
    await expectRefusal("retiring the same credit twice", () =>
      retireCredit(session, "ecocorp", hex(showcaseNote(0, 600n, "kariba").serial)),
    );
    await expectRefusal("retiring a credit already passed on", () =>
      retireCredit(session, "ecocorp", hex(outbound.serial)),
    );
    await expectRefusal("retiring a credit belonging to someone else", () =>
      retireCredit(session, "fraudcorp", hex(showcaseNote(2, 1_200n, "kariba").serial)),
    );
    await expectRefusal("claiming more than was ever retired", () =>
      publishClaim(session, "ecocorp", 100_000n, CLAIM_PERIOD),
    );
  } catch (error) {
    logger.error({ error: rootCause(error) }, "could not finish seeding the showcase");
  }
};

export const showcaseComplete = async (): Promise<boolean> => {
  const ledger = await publicLedger();
  return ledger.claims.member(CLAIM_ID) && ledger.claims.lookup(CLAIM_ID).attested;
};

export const allocation = ALLOCATION;
export const projects = PROJECTS;
