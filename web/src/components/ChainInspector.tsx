import { useEffect, useRef } from "react";
import type { ChainView, History, Meta } from "../api.js";
import { count, hash as short } from "../format.js";
import Num from "./Num.js";

const INDEXER: Record<string, string> = {
  preprod: "https://indexer.preprod.midnight.network/api/v4/graphql",
  preview: "https://indexer.preview.midnight.network/api/v4/graphql",
};

type Folded = History["recent"][number] & { repeated: number };

const ACTIONS: Record<string, string> = {
  "open-batch": "Registry opened a batch",
  issue: "Registry issued a credit",
  register: "Company registered",
  retire: "Credit retired",
  transfer: "Credit passed on",
  claim: "Claim published",
  attest: "Auditor attested",
};

export default function ChainInspector({
  chain,
  meta,
  history,
}: {
  chain?: ChainView;
  meta?: Meta;
  history?: History;
}) {
  const seen = useRef(new Set<string>());
  const fresh = useRef(new Set<string>());

  // The same failure repeated ten times is one fact, and listing it ten times reads
  // like a broken page rather than an honest one. Fold runs of identical outcomes.
  const folded = (history?.recent ?? []).reduce<Folded[]>((rows, entry) => {
    const last = rows[rows.length - 1];
    if (
      last &&
      last.action === entry.action &&
      last.rejected === entry.rejected &&
      !entry.txHash &&
      !last.txHash
    ) {
      last.repeated += 1;
      return rows;
    }
    rows.push({ ...entry, repeated: 1 });
    return rows;
  }, []);

  const spent = [
    ...(chain?.retiredNullifiers ?? []).map((nullifier) => ({
      nullifier,
      kind: "retired" as const,
    })),
    ...(chain?.transferredNullifiers ?? []).map((nullifier) => ({
      nullifier,
      kind: "passed on" as const,
    })),
  ].reverse();

  const primed = useRef(false);

  useEffect(() => {
    if (!chain) return;
    const next = new Set<string>();
    for (const nullifier of [
      ...chain.retiredNullifiers,
      ...chain.transferredNullifiers,
    ]) {
      // The flash means "this just landed", not "the page just loaded". On the first
      // read everything is new to us and none of it is new to the chain.
      if (primed.current && !seen.current.has(nullifier)) next.add(nullifier);
      seen.current.add(nullifier);
    }
    primed.current = true;
    fresh.current = next;
  }, [chain]);

  return (
    <aside className="inspector">
      <div className="inspector-head">
        <h2 style={{ marginBottom: 0 }}>Chain inspector</h2>
        <span className={`pill${chain ? " live" : ""}`}>
          <span className={`dot${chain ? " pulse" : ""}`} />
          {chain ? "live" : "no contract yet"}
        </span>
      </div>
      <div className="inspector-sub">
        The complete public state of the contract. Anyone in the world can read
        exactly this and nothing more.
      </div>

      <div className="stat-grid">
        <div className="stat">
          <div className="stat-value">{chain ? <Num value={chain.issuedCredits} /> : "—"}</div>
          <div className="stat-label">credits issued</div>
        </div>
        <div className="stat">
          <div className="stat-value">{chain ? <Num value={chain.retirementEvents} /> : "—"}</div>
          <div className="stat-label">retirements</div>
        </div>
        <div className="stat">
          <div className="stat-value">{chain ? <Num value={chain.transferEvents} /> : "—"}</div>
          <div className="stat-label">credits passed on</div>
        </div>
        <div className="stat">
          <div className="stat-value">{chain ? <Num value={chain.claims.length} /> : "—"}</div>
          <div className="stat-label">claims</div>
        </div>
        <div className="stat">
          <div className="stat-value">{chain ? <Num value={chain.companies.length} /> : "—"}</div>
          <div className="stat-label">companies</div>
        </div>
        <div className="stat">
          <div className="stat-value">
            {chain
              ? chain.retiredNullifiers.length +
                chain.transferredNullifiers.length
              : "—"}
          </div>
          <div className="stat-label">notes spent</div>
        </div>
      </div>

      <div className="section">
        <h3>Spent note nullifiers</h3>
        {spent.length ? (
          spent.slice(0, 8).map(({ nullifier, kind }) => (
            <div
              key={nullifier}
              className="list-row"
              style={{ padding: "3px 0", gap: 8 }}
            >
              <div
                className={`hash grow${
                  fresh.current.has(nullifier) ? " fresh" : ""
                }`}
                style={{ marginBottom: 0 }}
              >
                {short(nullifier)}
              </div>
              <span className={`tag ${kind === "retired" ? "retired" : "held"}`}>
                {kind}
              </span>
            </div>
          ))
        ) : (
          <div className="empty">Nothing spent yet.</div>
        )}
        <div className="inspector-sub" style={{ marginTop: 8 }}>
          A note can be spent exactly once — retired, or passed to someone else.
          Spending it writes a nullifier here, and doing it twice would have to
          write the same one twice, which the contract refuses. Which company
          the entry belongs to is not derivable from it.
        </div>
      </div>

      <div className="section">
        <h3>Company tallies</h3>
        {chain?.companies.length ? (
          chain.companies.map((company) => (
            <div key={company.publicKey} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 13.5, marginBottom: 3 }}>
                {company.name}
              </div>
              <div className="hash">{short(company.tallyCommitment)}</div>
            </div>
          ))
        ) : (
          <div className="empty">No companies registered yet.</div>
        )}
        <div className="inspector-sub" style={{ marginTop: 4 }}>
          A commitment to the tonnes each company retired. Binding, so it cannot
          be re-opened to a different figure — and unreadable without the
          company's key.
        </div>
      </div>

      <div className="section">
        <h3>Published claims</h3>
        {chain?.claims.length ? (
          chain.claims.map((claim) => (
            <div key={claim.id} className="list-row" style={{ padding: "9px 0" }}>
              <div className="grow">
                <div style={{ fontSize: 13.5 }}>
                  ≥ {count(claim.threshold)} t · {claim.period}
                </div>
                <div className="hash" style={{ marginTop: 4, marginBottom: 0 }}>
                  {short(claim.company)}
                </div>
              </div>
              <a
                className={`tag ${claim.attested ? "attested" : "held"}`}
                href={`/claim/${claim.id}`}
                title="Open the public record for this claim"
              >
                {claim.attested ? "attested" : "unaudited"}
              </a>
            </div>
          ))
        ) : (
          <div className="empty">No claims published yet.</div>
        )}
      </div>

      <div className="section">
        <h3>Registry supply</h3>
        {chain?.batches.length ? (
          chain.batches.slice(-3).map((batch) => (
            <div key={batch.id} style={{ marginBottom: 12, fontSize: 13.5 }}>
              <div>{batch.project}</div>
              <div style={{ color: "var(--text-faint)", fontSize: 12.5 }}>
                vintage {batch.vintage} ·{" "}
                {count(batch.tonnes)} t
              </div>
            </div>
          ))
        ) : (
          <div className="empty">No batches opened yet.</div>
        )}
      </div>

      <div className="section">
        <h3>Recent transactions</h3>
        {folded.length ? (
          folded.map((entry) => (
            <div
              key={`${entry.at}${entry.txHash ?? entry.rejected ?? ""}`}
              className="list-row"
              style={{ padding: "8px 0" }}
            >
              <div className="grow">
                <div style={{ fontSize: 13 }}>
                  {ACTIONS[entry.action ?? ""] ?? entry.action}
                  {entry.repeated > 1 && (
                    <span className="faint"> · {entry.repeated} times</span>
                  )}
                </div>
                <div
                  className={entry.txHash ? "hash" : "reason"}
                  style={{ marginTop: 4, marginBottom: 0 }}
                >
                  {entry.txHash
                    ? short(entry.txHash)
                    : entry.rejected?.replace(/^failed assert:\s*/, "")}
                </div>
              </div>
              <span
                className={`tag ${
                  entry.refused ? "refused" : entry.rejected ? "held" : "attested"
                }`}
              >
                {entry.refused
                  ? "refused"
                  : entry.rejected
                    ? "failed"
                    : `${((entry.ms ?? 0) / 1000).toFixed(1)}s`}
              </span>
            </div>
          ))
        ) : (
          <div className="empty">No transactions recorded yet.</div>
        )}
        <div className="inspector-sub" style={{ marginTop: 8 }}>
          Every action on this site is a real transaction. <em>Refused</em> means
          the circuit would not prove it — a lie, stopped before it reached the
          chain. <em>Failed</em> means Canopy's own plumbing broke, which is our
          fault and not the contract's; both are shown rather than hidden.
        </div>
      </div>

      {meta?.contractAddress && (
        <div className="section" style={{ marginBottom: 0 }}>
          <h3>Deployment</h3>
          <div className="inspector-sub" style={{ marginBottom: 6 }}>
            Midnight {meta.network} — the contract address anyone can check
            against the public chain.
          </div>
          <div className="hash" style={{ whiteSpace: "normal" }}>
            {meta.contractAddress}
          </div>
          <div className="inspector-sub" style={{ marginTop: 8 }}>
            Every figure above is read from this address through Midnight's
            public indexer, not from anything this server stores. You can make
            the same request without asking us:
          </div>
          <pre className="code-block source verify">{`curl ${INDEXER[meta.network] ?? INDEXER.preprod} \\
  -H 'content-type: application/json' \\
  -d '{"query":"query($a:HexEncoded!){contractAction(address:$a){state}}",
       "variables":{"a":"${meta.contractAddress}"}}'`}</pre>
          <div className="inspector-sub" style={{ marginTop: 8, marginBottom: 0 }}>
            No key, no account. What comes back is the serialised contract
            state; <code>ledger()</code> from this repo's contract package
            decodes it into the same numbers shown here. No third-party PreProd
            explorer is currently indexing recent blocks, so this is the honest
            way to check.
          </div>
        </div>
      )}
    </aside>
  );
}
