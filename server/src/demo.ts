import { randomBytes, randomUUID } from "node:crypto";
import { pureCircuits, type CreditNote } from "@canopy/contract";
import { enqueue, handleFor, logger, publicLedger } from "./chain.js";
import {
  auditorSecretKey,
  companyLabel,
  companySecretKey,
  registrySecretKey,
  type CompanyRole,
} from "./identities.js";

export const hex = (bytes: Uint8Array): string =>
  Buffer.from(bytes).toString("hex");

const bytes = (): Uint8Array => new Uint8Array(randomBytes(32));

const PROJECT = {
  name: "Kariba REDD+ Forest Protection",
  vintage: 2024n,
  tonnes: 50_000n,
  credits: 500n,
};

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
  readonly batchId: Uint8Array;
  readonly companies: Record<CompanyRole, CompanyState>;
  claimIds: string[];
  seeding: { done: number; total: number; failed?: string };
};

const sessions = new Map<string, Session>();

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

const sharedBatchId = bytes();

export const createSession = (): Session => {
  const id = randomUUID().slice(0, 8);
  const session: Session = {
    id,
    createdAt: Date.now(),
    batchId: sharedBatchId,
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

export const openBatch = (session: Session) =>
  enqueue(async () => {
    const contract = await registryHandle(session);
    const tx = await contract.callTx.openBatch(
      session.batchId,
      PROJECT.name,
      PROJECT.vintage,
      PROJECT.tonnes,
      PROJECT.credits,
    );
    return { txHash: tx.public.txHash, batchId: hex(session.batchId) };
  });

export const issueCredit = (
  session: Session,
  role: CompanyRole,
  tonnes: bigint,
) =>
  enqueue(async () => {
    const company = session.companies[role];
    const note: CreditNote = {
      serial: bytes(),
      tonnes,
      salt: bytes(),
      batchId: session.batchId,
    };
    const commitment = pureCircuits.creditCommitment(
      note.serial,
      note.tonnes,
      company.publicKey,
      note.salt,
    );
    const contract = await registryHandle(session);
    const tx = await contract.callTx.issueCredit(session.batchId, commitment);
    company.credits = [...company.credits, note];
    return {
      txHash: tx.public.txHash,
      serial: hex(note.serial),
      tonnes: tonnes.toString(),
      commitment: hex(commitment),
    };
  });

export const registerCompany = (session: Session, role: CompanyRole) =>
  enqueue(async () => {
    const company = session.companies[role];
    const contract = await companyHandle(session, role);
    const tx = await contract.callTx.registerCompany(company.name);
    return { txHash: tx.public.txHash, publicKey: hex(company.publicKey) };
  });

export const retireCredit = (
  session: Session,
  role: CompanyRole,
  serialHex: string,
) =>
  enqueue(async () => {
    const company = session.companies[role];
    const note = Object.values(session.companies)
      .flatMap((entry) => entry.credits)
      .find((credit) => hex(credit.serial) === serialHex);
    if (!note) throw new Error("no credit with that serial exists in this demo");
    const contract = await companyHandle(session, role);
    const tx = await contract.callTx.retireCredit(
      note.serial,
      note.tonnes,
      note.salt,
    );
    return {
      txHash: tx.public.txHash,
      nullifier: hex(
        pureCircuits.retirementNullifier(note.serial, company.secretKey),
      ),
      tonnes: note.tonnes.toString(),
    };
  });

export const publishClaim = (
  session: Session,
  role: CompanyRole,
  threshold: bigint,
  period: string,
) =>
  enqueue(async () => {
    const claimId = bytes();
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
    const nullifier = pureCircuits.retirementNullifier(
      note.serial,
      company.secretKey,
    );
    return {
      serial: hex(note.serial),
      tonnes: note.tonnes.toString(),
      salt: hex(note.salt),
      nullifier: hex(nullifier),
      retired: ledger.retiredCredits.member(nullifier),
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
  enqueue(async () => {
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
    issuedCredits: Number(ledger.issuedCredits),
    issuedTonnes: ledger.issuedTonnes.toString(),
    retirementEvents: Number(ledger.retirementEvents),
    registryKey: hex(ledger.registryKey),
    auditorKey: hex(ledger.auditorKey),
  };
};

export const sessionView = async (session: Session) => {
  const ledger = await publicLedger();
  const companies = (["ecocorp", "fraudcorp"] as const).map((role) => {
    const company = session.companies[role];
    const credits = company.credits.map((note) => {
      const nullifier = pureCircuits.retirementNullifier(
        note.serial,
        company.secretKey,
      );
      return {
        serial: hex(note.serial),
        tonnes: note.tonnes.toString(),
        retired: ledger.retiredCredits.member(nullifier),
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
    batchId: hex(session.batchId),
    companies,
    claimIds: session.claimIds,
    seeding: session.seeding,
  };
};

let sharedBatchOpen: Promise<unknown> | undefined;

export const seedSession = async (session: Session): Promise<void> => {
  const steps: (() => Promise<unknown>)[] = [
    ...ALLOCATION.map((tonnes) => () => issueCredit(session, "ecocorp", tonnes)),
    () => registerCompany(session, "ecocorp"),
    () => registerCompany(session, "fraudcorp"),
  ];
  try {
    sharedBatchOpen ??= openBatch(session).catch(async (error: unknown) => {
      const ledger = await publicLedger();
      if (ledger.batches.member(sharedBatchId)) return;
      sharedBatchOpen = undefined;
      throw error;
    });
    await sharedBatchOpen;

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

export const allocation = ALLOCATION;
export const project = PROJECT;
