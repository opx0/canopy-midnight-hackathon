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
import { walletSeed } from "./identities.js";

type WalletConfiguration = Parameters<typeof WalletFactory.createDustWallet>[0] &
  Parameters<typeof WalletFactory.createWalletFacade>[0];

const configuration = (): WalletConfiguration =>
  (
    FluentWalletBuilder.forEnvironment(environment) as unknown as {
      config: WalletConfiguration;
    }
  ).config;

export const dustConfiguration = (config = configuration()) => ({
  ...config,
  costParameters: {
    ledgerParams: DEFAULT_DUST_OPTIONS.ledgerParams,
    additionalFeeOverhead: DEFAULT_DUST_OPTIONS.additionalFeeOverhead,
    feeBlocksMargin: DEFAULT_DUST_OPTIONS.feeBlocksMargin,
  },
});

export const buildWallet = async (
  logger: Logger,
): Promise<MidnightWalletProvider> => {
  const config = configuration();
  const seeds = WalletSeeds.fromMasterSeed(walletSeed);
  const keystore = createKeystore(seeds.unshielded, environment.walletNetworkId);

  const saved = await readFile(walletStateFile, "utf8").catch(() => undefined);
  if (saved) {
    logger.info(
      { file: walletStateFile, bytes: saved.length },
      "restoring the DUST wallet from a saved scan instead of replaying the chain",
    );
  }

  const dust = saved
    ? DustWallet(dustConfiguration(config)).restore(saved)
    : WalletFactory.createDustWallet(config, seeds.dust);

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
