import { readFile, writeFile } from "node:fs/promises";
import {
  DEFAULT_DUST_OPTIONS,
  FluentWalletBuilder,
  MidnightWalletProvider,
  WalletFactory,
  WalletSeeds,
} from "@midnight-ntwrk/testkit-js";
import { DustWallet } from "@midnight-ntwrk/wallet-sdk-dust-wallet";
import { createKeystore } from "@midnight-ntwrk/wallet-sdk-unshielded-wallet";
import { DustSecretKey, ZswapSecretKeys } from "@midnight-ntwrk/ledger-v8";
import type { Logger } from "pino";
import { environment, walletStateFile } from "./config.js";
import { nowDoing } from "./progress.js";
import { walletSeed } from "./identities.js";

type WalletConfiguration = Parameters<typeof WalletFactory.createDustWallet>[0] &
  Parameters<typeof WalletFactory.createWalletFacade>[0];

const configuration = (): WalletConfiguration =>
  (
    FluentWalletBuilder.forEnvironment(environment) as unknown as {
      config: WalletConfiguration;
    }
  ).config;

// Midnight rejects a transaction whose DUST fee rounds to zero: the wallet emits an
// empty DustActions and the node answers `1010 Invalid Transaction: Custom error: 117`
// (TransactionMalformed(NotNormalized)). The testkit ships additionalFeeOverhead: 0n,
// which a contract deploy survives and a contract call does not. Any positive overhead
// the wallet can cover makes the fee real; this is the value Midnight's templates use.
// Only has to be positive. Midnight's templates use 300_000_000_000_000n, which is
// fine on a devnet and expensive here: one registered NIGHT UTxO regenerates DUST at
// roughly 8e12 per second, so that value is thirty-odd seconds of income per
// transaction. This is small enough to leave headroom and still not zero.
export const additionalFeeOverhead = 10_000_000_000n;

export const dustOptions = {
  ledgerParams: DEFAULT_DUST_OPTIONS.ledgerParams,
  additionalFeeOverhead,
  feeBlocksMargin: DEFAULT_DUST_OPTIONS.feeBlocksMargin,
};

export const dustConfiguration = (config = configuration()) => ({
  ...config,
  costParameters: dustOptions,
});

// Whether the last buildWallet() came up from a cached scan. A restored wallet is
// already within minutes of the tip; a cold one has the whole chain to replay, and
// submitting before it catches up is what produced Midnight node error 170 the first
// time this deployed. The wait before writing is sized from this.
export let restoredFromCache = false;

export const buildWallet = async (
  logger: Logger,
): Promise<MidnightWalletProvider> => {
  const config = configuration();
  const seeds = WalletSeeds.fromMasterSeed(walletSeed);
  const keystore = createKeystore(seeds.unshielded, environment.walletNetworkId);

  const saved = await readFile(walletStateFile, "utf8").catch(() => undefined);
  restoredFromCache = saved !== undefined;
  if (saved) {
    logger.info(
      { file: walletStateFile, bytes: saved.length },
      "restoring the DUST wallet from a saved scan instead of replaying the chain",
    );
  }

  nowDoing(
    saved
      ? "restoring the fee wallet from its cached scan"
      : "replaying the ledger from genesis to find this wallet's DUST — this happens once",
  );
  const dust = saved
    ? DustWallet(dustConfiguration(config)).restore(saved)
    : WalletFactory.createDustWallet(config, seeds.dust, dustOptions);

  const wallet = await WalletFactory.createWalletFacade(
    config,
    WalletFactory.createShieldedWallet(config, seeds.shielded),
    WalletFactory.createUnshieldedWallet(config, keystore),
    dust,
  );

  return MidnightWalletProvider.withWallet(
    logger,
    environment,
    wallet,
    ZswapSecretKeys.fromSeed(seeds.shielded),
    DustSecretKey.fromSeed(seeds.dust),
    keystore,
  );
};

export const saveWalletState = async (
  logger: Logger,
  walletProvider: MidnightWalletProvider,
): Promise<void> => {
  const serialized = await walletProvider.wallet.dust.serializeState();
  await writeFile(walletStateFile, serialized);
  logger.info(
    { file: walletStateFile, bytes: serialized.length },
    "saved the DUST scan so the next start does not replay the chain",
  );
};
