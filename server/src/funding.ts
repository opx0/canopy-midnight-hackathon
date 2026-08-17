import * as Rx from "rxjs";
import { unshieldedToken } from "@midnight-ntwrk/midnight-js-protocol/ledger";
import type {
  WalletFacade,
  FacadeState,
} from "@midnight-ntwrk/wallet-sdk-facade";
import type { Logger } from "pino";
import { environment } from "./config.js";

type Keystore = {
  getPublicKey(): string;
  getBech32Address(): { asString(): string };
  signData(payload: Uint8Array): string;
};

const ESTIMATED_DEPTH = 1_450_000;

export const scan = {
  applied: 0,
  perSecond: 0,
  estimatedTotal: ESTIMATED_DEPTH,
  secondsLeft: 0,
};

const night = (state: FacadeState): bigint =>
  state.unshielded.balances[unshieldedToken().raw] ?? 0n;

const dust = (state: FacadeState): bigint => state.dust.balance(new Date());

const until = (
  logger: Logger,
  wallet: WalletFacade,
  label: string,
  ready: (state: FacadeState) => boolean,
  timeoutMs: number,
): Promise<FacadeState> => {
  const startedAt = Date.now();
  return Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.throttleTime(5_000, undefined, { leading: true, trailing: true }),
      Rx.tap((state: FacadeState) =>
        logger.info(
          {
            waitingFor: label,
            seconds: Math.round((Date.now() - startedAt) / 1000),
            night: night(state).toString(),
            dust: dust(state).toString(),
          },
          "waiting on wallet",
        ),
      ),
      Rx.filter(ready),
      Rx.timeout({
        each: timeoutMs,
        with: () =>
          Rx.throwError(
            () => new Error(`timed out waiting for ${label} after ${timeoutMs}ms`),
          ),
      }),
    ),
  );
};

export const fund = async (
  logger: Logger,
  wallet: WalletFacade,
  keystore: Keystore,
): Promise<{ night: bigint; dust: bigint }> => {
  const address = keystore.getBech32Address().asString();
  logger.info({ address }, "fee wallet address");

  let state = await Rx.firstValueFrom(wallet.state());

  if (night(state) === 0n) {
    logger.warn(
      { address, faucet: environment.faucet },
      "fee wallet holds no NIGHT — fund the address above at the faucet; this will continue by itself once it arrives",
    );
    state = await until(
      logger,
      wallet,
      "NIGHT to arrive",
      (current) => night(current) > 0n,
      3_600_000,
    );
  }
  logger.info({ night: night(state).toString() }, "NIGHT available");

  if (dust(state) === 0n) {
    const startedScanAt = Date.now();
    state = await Rx.firstValueFrom(
      wallet.state().pipe(
        Rx.throttleTime(10_000, undefined, { leading: true, trailing: true }),
        Rx.tap((current: FacadeState) => {
          const p = current.dust.state.progress;
          const elapsed = Math.max(1, (Date.now() - startedScanAt) / 1000);
          scan.applied = Number(p.appliedIndex);
          scan.perSecond = Math.round(scan.applied / elapsed);
          scan.estimatedTotal = Math.max(
            ESTIMATED_DEPTH,
            Number(p.highestIndex),
            scan.applied,
          );
          scan.secondsLeft = scan.perSecond
            ? Math.round((scan.estimatedTotal - scan.applied) / scan.perSecond)
            : 0;
          logger.info(
            {
              seconds: Math.round((Date.now() - startedScanAt) / 1000),
              applied: p.appliedIndex.toString(),
              highest: p.highestIndex.toString(),
              connected: p.isConnected,
              dust: dust(current).toString(),
            },
            "dust wallet scanning",
          );
        }),
        Rx.filter(
          (current: FacadeState) =>
            dust(current) > 0n ||
            current.dust.state.progress.isCompleteWithin(64n),
        ),
        Rx.timeout({ each: 21_600_000 }),
      ),
    );

    const nightUtxos = (current: FacadeState) =>
      current.unshielded.availableCoins.filter(
        (coin) => coin.utxo.type === unshieldedToken().raw,
      );
    if (nightUtxos(state).length === 0) {
      state = await until(
        logger,
        wallet,
        "NIGHT UTXOs to appear",
        (current) => nightUtxos(current).length > 0,
        600_000,
      );
    }

    const unregistered = nightUtxos(state).filter(
      (coin) => coin.meta.registeredForDustGeneration === false,
    );
    logger.info(
      { total: nightUtxos(state).length, unregistered: unregistered.length },
      "NIGHT UTXOs available for DUST generation",
    );
    if (unregistered.length > 0) {
      logger.info(
        { utxos: unregistered.length },
        "registering NIGHT for DUST generation",
      );
      const recipe = await wallet.registerNightUtxosForDustGeneration(
        unregistered,
        keystore.getPublicKey(),
        (payload: Uint8Array) => keystore.signData(payload),
      );
      const txId = await wallet.submitTransaction(
        await wallet.finalizeRecipe(recipe),
      );
      logger.info({ txId }, "DUST registration submitted");
    }
    state = await until(
      logger,
      wallet,
      "DUST to become spendable",
      (current) => dust(current) > 0n,
      3_600_000,
    );
  }

  logger.info(
    { night: night(state).toString(), dust: dust(state).toString() },
    "fee wallet ready",
  );
  return { night: night(state), dust: dust(state) };
};
