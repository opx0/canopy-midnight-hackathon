import { useEffect, useState } from "react";
import { getBenchmarks, type Benchmarks as Data } from "../api.js";
import { count } from "../format.js";

const seconds = (ms?: number) => (ms ? `${(ms / 1000).toFixed(1)}s` : "—");

const megabytes = (bytes: number) => `${(bytes / 1_048_576).toFixed(1)} MB`;

// DUST has 18 decimals like most such units; the raw integers are unreadable.
const dust = (value: string | number) => {
  const amount = Number(value) / 1e18;
  if (amount === 0) return "0";
  if (amount < 0.000001) return `${(amount * 1e9).toFixed(2)} nDUST`;
  return `${amount.toFixed(6)} DUST`;
};

export default function Benchmarks() {
  const [data, setData] = useState<Data>();
  const [failed, setFailed] = useState<string>();

  useEffect(() => {
    getBenchmarks().then(setData, (error: Error) => setFailed(error.message));
  }, []);

  if (failed) return <div className="empty">Benchmarks unavailable: {failed}</div>;
  if (!data) return <div className="empty">Reading the compiled circuits…</div>;

  const measured = data.circuits.filter((circuit) => circuit.measured);

  return (
    <>
      <p className="lede">
        Every figure on this page is read from the compiled artefacts on the
        server or measured from transactions this deployment actually landed on
        Midnight preprod. Nothing here is projected.
      </p>

      <div className="card">
        <h3>Cost of each circuit</h3>
        <p className="hint">
          Operations are instructions in the compiled ZK intermediate
          representation. The proving key is the better guide to what a proof
          actually costs — it is what a client has to hold in memory to build
          one, and it grows with the constraint system rather than with the
          source. Timings are end to end: prove, submit, and wait for a block.
        </p>
        <div className="list bench">
          <div className="list-row head">
            <div className="grow">circuit</div>
            <div className="num">ops</div>
            <div className="num">key</div>
            <div className="num">median</div>
            <div className="num">p90</div>
            <div className="num">n</div>
          </div>
          {data.circuits.map((circuit) => (
            <div className="list-row" key={circuit.circuit}>
              <div className="grow">
                <code>{circuit.circuit}</code>
                <div className="faint" style={{ fontSize: 13 }}>
                  {circuit.summary}
                </div>
              </div>
              <div className="num">{count(circuit.operations)}</div>
              <div className="num">{megabytes(circuit.proverKeyBytes)}</div>
              <div className="num">{seconds(circuit.measured?.medianMs)}</div>
              <div className="num">{seconds(circuit.measured?.p90Ms)}</div>
              <div className="num">{circuit.measured?.count ?? 0}</div>
            </div>
          ))}
        </div>
        {measured.length === 0 && (
          <div className="note" style={{ marginBottom: 0 }}>
            No timings yet on this deployment. Run anything from the Explore tab
            and this table fills in from real transactions.
          </div>
        )}
      </div>

      <div className="card">
        <h3>Why the two columns disagree</h3>
        <p style={{ fontSize: 14.5 }}>
          <code>retireCredit</code> has roughly twice the instructions of{" "}
          <code>issueCredit</code> and about seven times the proving key. The
          instruction count is source-shaped; the key is constraint-shaped, and
          a depth-10 Merkle membership proof is ten hash gadgets that one
          instruction hides. Read the key column when you want to know what a
          circuit costs.
        </p>
      </div>

      <div className="card">
        <h3>What the verifier does</h3>
        <p style={{ fontSize: 14.5 }}>
          Each circuit's verifier key is about two kilobytes, and verification
          cost does not vary with how much history the contract holds. A
          validator checking a retirement made after a million retirements does
          exactly the same work as one checking the first.
        </p>
      </div>

      <div className="card">
        <h3>What grows, and what does not</h3>
        <div className="list">
          <div className="list-row head">
            <div className="grow">structure</div>
            <div style={{ width: 190 }}>growth</div>
          </div>
          <div className="list-row">
            <div className="grow">
              <code>creditTree</code>
              <div className="faint" style={{ fontSize: 13 }}>
                depth {data.treeDepth}, so {count(data.treeCapacity)} notes per
                deployment — issues and transfers share it
              </div>
            </div>
            <div style={{ width: 190 }}>bounded, by design</div>
          </div>
          <div className="list-row">
            <div className="grow">
              <code>retiredCredits</code>, <code>transferredCredits</code>
              <div className="faint" style={{ fontSize: 13 }}>
                one 32-byte nullifier per spend, checked by lookup
              </div>
            </div>
            <div style={{ width: 190 }}>linear, never scanned</div>
          </div>
          <div className="list-row">
            <div className="grow">
              <code>companies</code>, <code>claims</code>
              <div className="faint" style={{ fontSize: 13 }}>
                one entry each, replaced in place when a tally moves
              </div>
            </div>
            <div style={{ width: 190 }}>linear, never scanned</div>
          </div>
          <div className="list-row">
            <div className="grow">
              proof size and verification time
              <div className="faint" style={{ fontSize: 13 }}>
                fixed by the circuit, not by the ledger
              </div>
            </div>
            <div style={{ width: 190 }}>constant</div>
          </div>
        </div>
        <div className="note">
          No circuit iterates over a ledger collection. Every access is a
          keyed lookup or an append, which is what keeps proving cost flat as
          the registry fills up.
        </div>
        <div className="note" style={{ marginBottom: 0 }}>
          Raising the tree to depth 20 would hold about a million notes and add
          ten hashes to two circuits. It costs nothing on chain, and the reason
          this deployment does not do it is that a deeper tree makes a bigger
          proving key to ship, for a demo that will never issue a thousand
          credits.
        </div>
      </div>

      <div className="card">
        <h3>Where the real limit is</h3>
        <p style={{ fontSize: 14.5 }}>
          Not the contract, and not proving. Midnight pays fees in DUST, which
          is regenerated by registered NIGHT at a fixed rate, and this
          deployment funds every visitor from one wallet backed by one
          registered NIGHT UTxO. That budget, not the circuits, is what caps how
          fast this site can write.
        </p>
        <div className="list">
          <div className="list-row">
            <div className="grow">DUST available now</div>
            <div className="num">{dust(data.fees.dust)}</div>
          </div>
          <div className="list-row">
            <div className="grow">regenerating at</div>
            <div className="num">{dust(data.fees.perSecond)} /s</div>
          </div>
          <div className="list-row">
            <div className="grow">held back until a transaction can afford</div>
            <div className="num">{dust(data.fees.required)}</div>
          </div>
          <div className="list-row">
            <div className="grow">
              balance consumed by the last transaction
              <div className="faint" style={{ fontSize: 13 }}>
                the transaction itself declared a fee of 3×10¹⁴, and the indexer
                reports one SPECK paid — the gap is the wallet's own accounting,
                not the chain's
              </div>
            </div>
            <div className="num">{dust(data.fees.lastCost)}</div>
          </div>
          <div className="list-row">
            <div className="grow">
              sustained rate this supports
              <div className="faint" style={{ fontSize: 13 }}>
                one transaction per this many seconds, indefinitely
              </div>
            </div>
            <div className="num">
              {data.fees.perSecond
                ? `${Math.round(Number(data.fees.required) / data.fees.perSecond)}s`
                : "—"}
            </div>
          </div>
        </div>
        <div className="note">
          We found this the hard way: an earlier build submitted as fast as it
          could prove, drained the wallet to zero after thirteen transactions,
          and then failed with <code>Insufficient Funds: could not balance
          dust</code>. Deserialising those transactions showed the ledger had
          taken 3×10¹⁴ each and created a change output every time, so the
          missing balance was the wallet's own bookkeeping rather than a cost.
          Submissions now wait for a fee they can afford instead of discovering
          they cannot pay it, and anyone who hits that wait is told what they
          are waiting for.
        </div>
        <div className="note warn" style={{ marginBottom: 0 }}>
          None of this is a property of the design. In production each company
          holds its own wallet, its own registered NIGHT and its own proof
          server, and their transactions are independent — the contract has no
          global lock of any kind. It is the cost of a demo nobody has to
          install a wallet for. So the timings above are an upper bound on
          latency and a lower bound on throughput.
        </div>
      </div>
    </>
  );
}
