import * as Rx from "rxjs";
import { WebSocket } from "ws";
import { MidnightWalletProvider } from "@midnight-ntwrk/testkit-js";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { unshieldedToken } from "@midnight-ntwrk/midnight-js-protocol/ledger";
import type { FacadeState } from "@midnight-ntwrk/wallet-sdk-facade";
import { pino } from "pino";
import { environment, networkName } from "../config.js";
import { walletSeed } from "../identities.js";

(globalThis as { WebSocket?: unknown }).WebSocket ??= WebSocket;

const logger = pino({
  level: "info",
  transport: { target: "pino-pretty", options: { colorize: true } },
});

setNetworkId(environment.walletNetworkId);
const provider = await MidnightWalletProvider.build(
  logger,
  environment,
  walletSeed,
);
await provider.start(false);

const nightOf = (state: FacadeState) =>
  state.unshielded.balances[unshieldedToken().raw] ?? 0n;

const state = await Rx.firstValueFrom(
  provider.wallet.state().pipe(
    Rx.throttleTime(5_000, undefined, { leading: true, trailing: true }),
    Rx.tap((s: FacadeState) =>
      logger.info(
        { night: nightOf(s).toString(), utxos: s.unshielded.availableCoins.length },
        "waiting for the wallet to see its NIGHT",
      ),
    ),
    Rx.filter((s: FacadeState) => nightOf(s) > 0n),
    Rx.timeout({ each: 600_000 }),
  ),
);

const utxos = state.unshielded.availableCoins.filter(
  (coin) => coin.utxo.type === unshieldedToken().raw,
);

logger.info(
  {
    network: networkName,
    night: nightOf(state).toString(),
    dustNow: state.dust.balance(new Date()).toString(),
    dustInAnHour: state.dust.balance(new Date(Date.now() + 3_600_000)).toString(),
    nightUtxos: utxos.length,
    registeredForDustGeneration: utxos.map(
      (c) => c.meta.registeredForDustGeneration,
    ),
    ourDustAddress: JSON.stringify(state.dust.address ?? null).slice(0, 160),
  },
  "wallet snapshot",
);

try {
  const estimate = await provider.wallet.estimateRegistration(utxos);
  logger.info(
    {
      fee: estimate.fee.toString(),
      generation: JSON.stringify(
        estimate.dustGenerationEstimations,
        (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v),
      ).slice(0, 1200),
    },
    "registration estimate",
  );
} catch (error) {
  logger.error({ error: String(error) }, "estimateRegistration failed");
}

try {
  await provider.wallet.waitForGeneratedDust(utxos, 1n, { timeoutMs: 60_000 });
  logger.info("DUST is being generated to this wallet");
} catch (error) {
  logger.error(
    { error: String(error) },
    "no DUST projected for this wallet — the NIGHT generates to a different dust address",
  );
}

await provider.stop();
process.exit(0);
