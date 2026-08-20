import * as Rx from "rxjs";
import { WebSocket } from "ws";
import { PendingTransactions } from "@midnight-ntwrk/wallet-sdk-capabilities";
import {
  initializeMidnightProviders,
  type ContractConfiguration,
} from "@midnight-ntwrk/testkit-js";
import { fund } from "./funding.js";
import { nowDoing } from "./progress.js";
import { buildWallet, restoredFromCache, saveWalletState } from "./wallet.js";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import {
  deployContract,
  findDeployedContract,
} from "@midnight-ntwrk/midnight-js-contracts";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { access, appendFile, readFile, writeFile } from "node:fs/promises";
import { inspect } from "node:util";
import { pino } from "pino";

import {
  CanopyCompiledContract,
  pureCircuits,
  type CanopyPrivateState,
  type CreditNote,
} from "@canopy/contract";
import {
  deploymentFile,
  deploymentLog,
  environment,
  networkName,
  zkConfigPath,
} from "./config.js";
import {
  auditorSecretKey,
  registrySecretKey,
  walletSeed,
} from "./identities.js";

(globalThis as { WebSocket?: unknown }).WebSocket ??= WebSocket;

export const logger = pino({
  level: process.env.CANOPY_LOG_LEVEL ?? "info",
  transport: { target: "pino-pretty", options: { colorize: true } },
});

type CanopyCircuit =
  | "openBatch"
  | "issueCredit"
  | "registerCompany"
  | "retireCredit"
  | "transferCredit"
  | "publishClaim"
  | "attestClaim";

type Providers = ReturnType<
  typeof initializeMidnightProviders<CanopyCircuit, CanopyPrivateState>
>;

let providers: Providers;
let contractAddress: string;
let reader: ReturnType<typeof indexerPublicDataProvider>;
type FacadeLike = {
  state(): Rx.Observable<{
    pending: unknown;
    dust?: { balance(at: Date): bigint };
  }>;
};

let walletFacade: FacadeLike | undefined;

let queue: Promise<unknown> = Promise.resolve();

export const enqueue = <T>(work: () => Promise<T>): Promise<T> => {
  const result = queue.then(work, work);
  queue = result.catch(() => undefined);
  return result;
};

const readDeployedAddress = async (): Promise<string | undefined> => {
  try {
    const saved = JSON.parse(await readFile(deploymentFile, "utf8")) as {
      network?: string;
      contractAddress?: string;
    };
    return saved.network === networkName ? saved.contractAddress : undefined;
  } catch {
    return undefined;
  }
};

export const connect = async (): Promise<boolean> => {
  setNetworkId(environment.walletNetworkId);
  nowDoing("reading the deployed contract from Midnight's indexer");
  reader = indexerPublicDataProvider(environment.indexer, environment.indexerWS);
  const existing = await readDeployedAddress();
  if (existing) contractAddress = existing;
  logger.info(
    { network: networkName, contractAddress: existing },
    existing
      ? "reading the deployed contract; no wallet needed for this"
      : "no deployment recorded yet, so there is nothing to read",
  );
  return existing !== undefined;
};

export const bootstrap = async ({
  deployIfMissing = false,
}: { deployIfMissing?: boolean } = {}): Promise<{ contractAddress: string }> => {
  logger.info({ network: networkName }, "starting Canopy backend");

  const walletProvider = await buildWallet(logger);
  walletFacade = walletProvider.wallet;
  await walletProvider.start(false);

  const keepScanSaved = () =>
    saveWalletState(logger, walletProvider).catch((error: unknown) =>
      logger.warn({ reason: rootCause(error) }, "could not save the DUST scan"),
    );
  // Checkpoint from here, not after funding. A cold scan replays the ledger from
  // genesis and takes hours; saving only once it finished meant a restart in the
  // middle threw the whole thing away. Restoring mid-scan resumes where it stopped.
  setInterval(keepScanSaved, 600_000).unref();

  nowDoing("checking the fee wallet holds NIGHT and DUST");
  await fund(
    logger,
    walletProvider.wallet,
    walletProvider.unshieldedKeystore as Parameters<typeof fund>[2],
  );

  await catchUpToTip(walletProvider.wallet, restoredFromCache ? 600_000 : 900_000);

  await keepScanSaved();

  await access(`${zkConfigPath}/keys`).catch(() => {
    throw new Error(
      `No proving keys in ${zkConfigPath}/keys. Run 'npm run compact --workspace @canopy/contract'. Compiling with --skip-zk deletes them, and the contract tests still pass without them.`,
    );
  });

  const contractConfiguration: ContractConfiguration = {
    privateStateStoreName: `canopy-private-state-${networkName}`,
    zkConfigPath,
  };
  providers = initializeMidnightProviders<CanopyCircuit, CanopyPrivateState>(
    walletProvider,
    environment,
    contractConfiguration,
  );

  if (contractAddress) {
    logger.info({ contractAddress }, "using existing deployment");
  } else if (deployIfMissing) {
    contractAddress = await deploy();
  } else {
    throw new Error(
      `No Canopy deployment recorded for '${networkName}'. Run: npm run deploy-contract`,
    );
  }

  return { contractAddress };
};

const catchUpToTip = async (
  wallet: { waitForSyncedState(): Promise<unknown> },
  deadlineMs: number,
): Promise<void> => {
  nowDoing("bringing the fee wallet up to the chain tip");
  logger.info({ deadlineMs }, "waiting for the wallet to reach the chain tip");
  const startedAt = Date.now();
  let settled = false;
  const deadline = new Promise<void>((resolve) =>
    setTimeout(() => resolve(), deadlineMs).unref(),
  );
  await Promise.race([
    wallet.waitForSyncedState().then(() => {
      settled = true;
    }),
    deadline,
  ]);
  logger.info(
    { seconds: Math.round((Date.now() - startedAt) / 1000), atTip: settled },
    "wallet sync wait finished",
  );
};

const withRetries = async <T>(
  label: string,
  attempts: number,
  work: () => Promise<T>,
): Promise<T> => {
  for (let attempt = 1; ; attempt++) {
    try {
      return await work();
    } catch (error) {
      if (attempt >= attempts) throw error;
      logger.warn(
        { attempt, of: attempts, reason: rootCause(error) },
        `${label} failed, retrying`,
      );
      await new Promise((resolve) => setTimeout(resolve, 30_000));
    }
  }
};

const deploy = (): Promise<string> => withRetries("deployment", 5, deployOnce);

const deployOnce = async (): Promise<string> => {
  nowDoing("deploying the contract to Midnight");
  logger.info("deploying Canopy contract");
  const { rotate } = await import("./history.js");
  const deployed = await deployContract(providers, {
    compiledContract: CanopyCompiledContract,
    privateStateId: "canopy-deployer",
    initialPrivateState: { secretKey: registrySecretKey, credits: [] },
    args: [
      pureCircuits.registryPublicKey(registrySecretKey),
      pureCircuits.auditorPublicKey(auditorSecretKey),
    ],
  });
  const address = deployed.deployTxData.public.contractAddress;
  const record = {
    network: networkName,
    contractAddress: address,
    deployedAt: new Date().toISOString(),
  };
  await appendFile(deploymentLog, `${JSON.stringify(record)}\n`);
  await writeFile(deploymentFile, `${JSON.stringify(record, null, 2)}\n`);
  await rotate(`deployed ${address}`);
  logger.info({ contractAddress: address }, "contract deployed");
  return address;
};

export const walletSnapshot = async (): Promise<Record<string, unknown>> => {
  if (!walletFacade) return {};
  const state = (await Rx.firstValueFrom(walletFacade.state())) as {
    dust?: { balance(at: Date): bigint; state?: { progress?: { appliedIndex?: bigint } } };
    unshielded?: { availableCoins?: readonly unknown[] };
    pending?: unknown;
  };
  let pending = -1;
  try {
    pending = PendingTransactions.allPending(
      state.pending as Parameters<typeof PendingTransactions.allPending>[0],
    ).length;
  } catch {
    pending = -1;
  }
  return {
    dust: state.dust?.balance(new Date()).toString(),
    unshieldedCoins: state.unshielded?.availableCoins?.length,
    applied: state.dust?.state?.progress?.appliedIndex?.toString(),
    pending,
  };
};

// The fee wallet's spendable DUST right now. Midnight regenerates it from registered
// NIGHT at a fixed rate, so this is the resource that actually limits how fast this
// deployment can write, and it is worth reading rather than assuming.
export const dustNow = async (): Promise<bigint> => {
  if (!walletFacade) return 0n;
  const state = await Rx.firstValueFrom(walletFacade.state());
  return state.dust?.balance(new Date()) ?? 0n;
};

export const settle = async (timeoutMs = 180_000): Promise<void> => {
  if (!walletFacade) return;
  const clear = (state: { pending: unknown }) => {
    try {
      return (
        PendingTransactions.allPending(
          state.pending as Parameters<typeof PendingTransactions.allPending>[0],
        ).length === 0
      );
    } catch {
      return true;
    }
  };
  await Rx.firstValueFrom(
    walletFacade.state().pipe(
      Rx.filter(clear),
      Rx.timeout({ each: timeoutMs, with: () => Rx.of(undefined) }),
    ),
  );
};

export const handleFor = async (
  privateStateId: string,
  secretKey: Uint8Array,
  credits: readonly CreditNote[],
) => {
  const state: CanopyPrivateState = { secretKey, credits };
  providers.privateStateProvider.setContractAddress(contractAddress);
  await providers.privateStateProvider.set(privateStateId, state);
  return findDeployedContract(providers, {
    contractAddress,
    compiledContract: CanopyCompiledContract,
    privateStateId,
    initialPrivateState: state,
  });
};

export const publicLedger = async () => {
  if (!contractAddress) throw new Error("no contract is deployed yet");
  const state = await reader.queryContractState(contractAddress);
  if (state === null) {
    throw new Error("contract state unavailable");
  }
  const { ledger } = await import("@canopy/contract");
  return ledger(state.data);
};

// Midnight answers a rejected submission with a bare Substrate code. These are the
// ones this app can actually provoke; the numbers are Midnight's own status codes.
const nodeErrors: Record<string, string> = {
  "117":
    "the DUST fee rounded to zero, so the node read the transaction as malformed",
  "138": "the DUST fee came to more than the wallet holds",
  "170": "the node is running a different ledger version than this client",
  "171":
    "the fee was priced against a stale block time, outside Midnight's DUST validity window",
  "173": "the wallet could not cover the DUST fee",
};

const nodeError = /Invalid Transaction: Custom error: (\d+)/;

const failedAssert = /failed assert: ([^\n"]+)/;

export const isRefusal = (reason: string): boolean =>
  failedAssert.test(reason);

export const rootCause = (error: unknown): string => {
  // The interesting part is buried: midnight-js wraps the node's answer in an Effect
  // tagged error, whose own message is always the useless "Transaction submission
  // error". Read the whole graph and pull out whichever layer actually said something.
  const text = inspect(error, { depth: 8 });
  const refused = failedAssert.exec(text);
  if (refused) return `failed assert: ${refused[1].trim()}`;
  const rejected = nodeError.exec(text);
  if (rejected) {
    const known = nodeErrors[rejected[1]];
    return known
      ? `${known} (Midnight node error ${rejected[1]})`
      : `the node refused the transaction (Midnight node error ${rejected[1]})`;
  }

  let deepest = error instanceof Error ? error.message : String(error);
  let current: unknown = error;
  while (current instanceof Error && current.cause !== undefined) {
    current = current.cause;
    if (current instanceof Error && current.message) deepest = current.message;
    else if (typeof current === "object" && current !== null) {
      const { message, stack } = current as { message?: string; stack?: string };
      if (typeof message === "string" && message) deepest = message;
      else if (typeof stack === "string")
        deepest = stack.split("\n")[0].replace(/^Error:\s*/, "");
    }
  }
  return deepest;
};

export const getContractAddress = () => contractAddress;
