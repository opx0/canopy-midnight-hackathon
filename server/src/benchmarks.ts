import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { zkConfigPath } from "./config.js";
import { latencyByAction } from "./history.js";
import { fees, secondsToAfford } from "./fees.js";

// The action name a circuit is recorded under in the history log.
const actionFor: Record<string, string> = {
  openBatch: "open-batch",
  issueCredit: "issue",
  registerCompany: "register",
  retireCredit: "retire",
  transferCredit: "transfer",
  publishClaim: "claim",
  attestClaim: "attest",
};

const summary: Record<string, string> = {
  openBatch: "Registry writes a batch header. No proof of membership needed.",
  issueCredit: "One insert into the credit tree.",
  registerCompany: "Derives a public key from a secret and seals a zero tally.",
  retireCredit:
    "The heavy one: a depth-10 membership proof, a nullifier, and a tally reopened and resealed.",
  transferCredit:
    "A membership proof, a nullifier, and one fresh commitment. No tally to touch.",
  publishClaim: "Reopens the sealed tally and proves it clears the threshold.",
  attestClaim: "Auditor key check and a flag flip.",
};

type Circuit = {
  circuit: string;
  action: string;
  summary: string;
  operations: number;
  inputs: number;
  proverKeyBytes: number;
  verifierKeyBytes: number;
};

let circuits: Circuit[] | undefined;

// Read once: the artefacts cannot change without a redeploy.
const readCircuits = async (): Promise<Circuit[]> => {
  const zkir = path.join(zkConfigPath, "zkir");
  const keys = path.join(zkConfigPath, "keys");
  const names = (await readdir(zkir))
    .filter((file) => file.endsWith(".zkir"))
    .map((file) => file.replace(/\.zkir$/, ""));

  const sizeOf = async (file: string) =>
    await stat(file).then(
      (info) => info.size,
      () => 0,
    );

  return Promise.all(
    names.map(async (circuit) => {
      const ir = JSON.parse(
        await readFile(path.join(zkir, `${circuit}.zkir`), "utf8"),
      ) as { instructions?: unknown[]; num_inputs?: number };
      return {
        circuit,
        action: actionFor[circuit] ?? circuit,
        summary: summary[circuit] ?? "",
        operations: ir.instructions?.length ?? 0,
        inputs: ir.num_inputs ?? 0,
        proverKeyBytes: await sizeOf(path.join(keys, `${circuit}.prover`)),
        verifierKeyBytes: await sizeOf(path.join(keys, `${circuit}.verifier`)),
      };
    }),
  ).then((all) => all.sort((a, b) => b.operations - a.operations));
};

export const benchmarks = async () => {
  circuits ??= await readCircuits();
  const measured = latencyByAction();
  return {
    // Depth 10 is a compile-time constant in the contract; each extra level costs
    // one hash inside the proof and nothing at all on chain.
    treeDepth: 10,
    treeCapacity: 2 ** 10,
    fees: { ...fees, secondsToAfford: secondsToAfford() },
    circuits: circuits.map((circuit) => ({
      ...circuit,
      measured: measured[circuit.action],
    })),
  };
};
