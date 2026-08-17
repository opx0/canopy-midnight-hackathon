import { WebSocket } from "ws";
import {
  initializeMidnightProviders,
  type ContractConfiguration,
} from "@midnight-ntwrk/testkit-js";
import { fund } from "./funding.js";
import { buildWallet, saveWalletState } from "./wallet.js";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import {
  deployContract,
  findDeployedContract,
} from "@midnight-ntwrk/midnight-js-contracts";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { access, readFile, writeFile } from "node:fs/promises";
import { pino } from "pino";

import {
  CanopyCompiledContract,
  pureCircuits,
  type CanopyPrivateState,
  type CreditNote,
} from "@canopy/contract";
import {
  deploymentFile,
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
  | "publishClaim"
  | "attestClaim";

type Providers = ReturnType<
  typeof initializeMidnightProviders<CanopyCircuit, CanopyPrivateState>
>;

let providers: Providers;
let contractAddress: string;
let reader: ReturnType<typeof indexerPublicDataProvider>;

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
  await walletProvider.start(false);

  await fund(
    logger,
    walletProvider.wallet,
    walletProvider.unshieldedKeystore as Parameters<typeof fund>[2],
  );

  await catchUpToTip(walletProvider.wallet);

  const keepScanSaved = () =>
    saveWalletState(logger, walletProvider).catch((error: unknown) =>
      logger.warn({ reason: rootCause(error) }, "could not save the DUST scan"),
    );
  await keepScanSaved();
  setInterval(keepScanSaved, 600_000).unref();

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

const catchUpToTip = async (wallet: {
  waitForSyncedState(): Promise<unknown>;
}): Promise<void> => {
  logger.info("waiting for the wallet to reach the chain tip");
  const startedAt = Date.now();
  let settled = false;
  const deadline = new Promise<void>((resolve) =>
    setTimeout(() => resolve(), 900_000).unref(),
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
  logger.info("deploying Canopy contract");
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
  await writeFile(
    deploymentFile,
    `${JSON.stringify({ network: networkName, contractAddress: address, deployedAt: new Date().toISOString() }, null, 2)}\n`,
  );
  logger.info({ contractAddress: address }, "contract deployed");
  return address;
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

export const rootCause = (error: unknown): string => {
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
