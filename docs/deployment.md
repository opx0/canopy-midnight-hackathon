# Deploying the public demo

The judging artifact is a URL a visitor can open with no wallet and no signup.
This is how that gets stood up.

## What runs where

```
  visitor ──https──▶ nginx (TLS, your domain)
                       │ proxy_pass
                       ▼
                  canopy backend :3001  ── serves web/dist and /api
                       │
                       ├──▶ proof server :6300   (Docker, local)
                       └──▶ Midnight PreProd      (indexer + node, remote)
```

## One-time: fund the fee wallet

Every transaction the demo submits is paid for by a single wallet derived from
`CANOPY_SEED`. It needs tNIGHT once, and the public faucets are behind a
captcha, so this step is manual.

```bash
# print the address the current seed derives, then stop
CANOPY_NETWORK=preprod npm run deploy-contract --workspace @canopy/server
# → look for "fee wallet address" in the output
```

Fund it at https://midnight-tmnight-preprod.nethermind.dev/ and the same command
will continue by itself: it waits for NIGHT, registers those UTXOs for DUST
generation, and then deploys the contract.

Check faucet health before blaming yourself — Preview was returning
`{"status":"NOT_SERVING","reason":"SYNC_STUCK_RECOVERY"}` behind a green captcha
while we built this:

```bash
curl -s https://midnight-tmnight-preprod.nethermind.dev/api/health
```

If you already hold tNIGHT in a wallet, skip the faucet entirely:

```bash
export CANOPY_WALLET_SEED=<64-char hex seed of the funded wallet>
```

Deployment writes `server/deployment.json`. Keep it — it is what lets the
backend rejoin the same contract instead of deploying a new one.

## Build and run

The Compact compiler is not in the container image, so proving keys are built on
the host first.

```bash
npm install
npm run compact --workspace @canopy/contract    # ~3 min, writes contract/src/managed
npm run build   --workspace @canopy/contract

export CANOPY_SEED=<your seed>
export CANOPY_NETWORK=preprod
docker compose up -d --build
```

The backend listens on `127.0.0.1:3001` and serves both the API and the built
frontend, so only one port needs proxying.

## nginx and TLS

```nginx
server {
    server_name canopy.example.com;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Proving and settling a transaction is slow by design.
        proxy_read_timeout 300s;
    }
}
```

```bash
sudo certbot --nginx -d canopy.example.com
```

The long `proxy_read_timeout` matters: actions are polled as jobs, but the
initial request still waits on the backend.

## Verify it before you hand over the link

```bash
# replays the full story against the deployed contract, including every
# attempt that must fail
npm run smoke --workspace @canopy/server
```

Then open the site in a clean browser profile with no extensions and walk the
guided tour end to end. That is exactly what a judge will do.

## Operational notes

- **The first start scans the chain for DUST, and that is slow.** DUST pays
  every fee, and the wallet only sees its own DUST generation after its dust
  scanner reaches the block that registered it. The scanner runs at roughly
  200 blocks/second from genesis, so on PreProd (~2.1M blocks) expect about
  three hours before the first transaction can be paid for. Progress is logged
  as `dust wallet scanning` with the applied block index, so you can tell
  progress from a hang — without that log the two look identical.
- **Keep the process up.** The wallet holds its scan in memory, so restarting
  repeats it. A funded wallet stays funded and `deployment.json` pins the
  contract, but plan restarts for when the demo is idle.
- **Transactions are serialised** through one queue, because one wallet funds
  them all. Several visitors at once will queue rather than fail.
- **Sessions are in memory.** A restart drops visitors' local credit notes;
  their on-chain state is untouched, and a reload issues a fresh sandbox.
- **Watch the fee wallet.** Each visitor costs roughly four transactions to
  seed plus whatever they do. If DUST runs low, top the wallet up from the
  faucet again.
