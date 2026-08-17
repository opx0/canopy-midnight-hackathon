import { useEffect, useRef } from "react";
import type { ChainView, History, Meta } from "../api.js";
import { hash as short } from "../format.js";

const ACTIONS: Record<string, string> = {
  "open-batch": "Registry opened a batch",
  issue: "Registry issued a credit",
  register: "Company registered",
  retire: "Credit retired",
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

  useEffect(() => {
    if (!chain) return;
    const next = new Set<string>();
    for (const nullifier of chain.retiredNullifiers) {
      if (!seen.current.has(nullifier)) next.add(nullifier);
      seen.current.add(nullifier);
    }
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
          <div className="stat-value">{chain?.issuedCredits ?? "—"}</div>
          <div className="stat-label">credits issued</div>
        </div>
        <div className="stat">
          <div className="stat-value">{chain?.retirementEvents ?? "—"}</div>
          <div className="stat-label">retirements</div>
        </div>
        <div className="stat">
          <div className="stat-value">{chain?.companies.length ?? "—"}</div>
          <div className="stat-label">companies</div>
        </div>
        <div className="stat">
          <div className="stat-value">{chain?.claims.length ?? "—"}</div>
          <div className="stat-label">claims</div>
        </div>
      </div>

      <div className="section">
        <h3>Retired credit nullifiers</h3>
        {chain?.retiredNullifiers.length ? (
          chain.retiredNullifiers
            .slice(-6)
            .reverse()
            .map((nullifier) => (
              <div
                key={nullifier}
                className={`hash${fresh.current.has(nullifier) ? " fresh" : ""}`}
              >
                {short(nullifier)}
              </div>
            ))
        ) : (
          <div className="empty">Nothing retired yet.</div>
        )}
        <div className="inspector-sub" style={{ marginTop: 8 }}>
          One entry per retired credit. A second retirement of the same credit
          would have to repeat an entry, which the contract rejects.
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
                  ≥ {Number(claim.threshold).toLocaleString()} t · {claim.period}
                </div>
                <div className="hash" style={{ marginTop: 4, marginBottom: 0 }}>
                  {short(claim.company)}
                </div>
              </div>
              {claim.attested ? (
                <span className="tag attested">attested</span>
              ) : (
                <span className="tag held">unaudited</span>
              )}
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
                {Number(batch.tonnes).toLocaleString()} t
              </div>
            </div>
          ))
        ) : (
          <div className="empty">No batches opened yet.</div>
        )}
      </div>

      <div className="section">
        <h3>Recent transactions</h3>
        {history?.recent.length ? (
          history.recent.map((entry) => (
            <div
              key={`${entry.at}${entry.txHash ?? entry.rejected ?? ""}`}
              className="list-row"
              style={{ padding: "8px 0" }}
            >
              <div className="grow">
                <div style={{ fontSize: 13 }}>
                  {ACTIONS[entry.action ?? ""] ?? entry.action}
                </div>
                <div className="hash" style={{ marginTop: 4, marginBottom: 0 }}>
                  {entry.txHash ? short(entry.txHash) : "never submitted"}
                </div>
              </div>
              <span className={`tag ${entry.rejected ? "held" : "attested"}`}>
                {entry.rejected ? "refused" : `${((entry.ms ?? 0) / 1000).toFixed(1)}s`}
              </span>
            </div>
          ))
        ) : (
          <div className="empty">No transactions recorded yet.</div>
        )}
        <div className="inspector-sub" style={{ marginTop: 8 }}>
          Every action on this site is a real transaction. Refused ones never
          reach the chain — the circuit rejects them while proving.
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
          <div className="inspector-sub" style={{ marginTop: 8, marginBottom: 0 }}>
            Every figure above is read from this address through Midnight's
            public indexer, not from anything this server stores.
          </div>
        </div>
      )}
    </aside>
  );
}
