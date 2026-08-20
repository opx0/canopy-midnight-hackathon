import { Transaction } from "@midnight-ntwrk/ledger-v8";
import { environment } from "../config.js";

// Read what a transaction actually declared, rather than what the wallet believes it
// did. This is how we found that the ledger only ever charged 3e14 of DUST while the
// wallet's balance was falling by 2e17 — the discrepancy is local bookkeeping, not the
// chain. See docs/what-we-learned.md.

const hash = process.argv[2];
if (!hash) {
  console.error(
    "usage: npm run inspect-tx --workspace @canopy/server -- <transaction hash>",
  );
  process.exit(1);
}

const answer = (await fetch(environment.indexer, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    query: `query($o: TransactionOffset!) {
      transactions(offset: $o) {
        hash
        raw
        block { height timestamp }
        ... on RegularTransaction { fees { estimatedFees paidFees } }
      }
    }`,
    variables: { o: { hash } },
  }),
  signal: AbortSignal.timeout(30_000),
}).then((response) => response.json())) as {
  data?: { transactions?: { hash: string; raw: string; block?: unknown }[] };
};

const [transaction] = answer.data?.transactions ?? [];
if (!transaction) {
  console.error(`no transaction ${hash} on ${environment.networkId}`);
  process.exit(2);
}

console.log(JSON.stringify({ ...transaction, raw: undefined }, null, 2));

const parsed = Transaction.deserialize(
  "signature",
  "proof",
  "binding",
  Uint8Array.from(Buffer.from(transaction.raw, "hex")),
);

// The full dump is enormous. The DUST lines are the interesting ones.
const interesting =
  /dust|v_fee|ctime|registration|allow_fee|night|fees/i;
console.log(
  parsed
    .toString(false)
    .split("\n")
    .filter((line) => interesting.test(line))
    .join("\n"),
);
