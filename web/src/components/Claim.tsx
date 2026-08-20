import { useEffect, useState } from "react";
import { getClaim, type ClaimRecord } from "../api.js";
import { count } from "../format.js";
import Verify from "./Verify.js";

const INDEXER: Record<string, string> = {
  preprod: "https://indexer.preprod.midnight.network/api/v4/graphql",
  preview: "https://indexer.preview.midnight.network/api/v4/graphql",
};

const when = (at: number) =>
  new Date(at).toISOString().replace("T", " ").slice(0, 19) + " UTC";

export default function Claim({ id }: { id: string }) {
  const [record, setRecord] = useState<ClaimRecord>();
  const [failed, setFailed] = useState<string>();

  useEffect(() => {
    const read = () =>
      getClaim(id).then(setRecord, (error: Error) => setFailed(error.message));
    read();
    const timer = setInterval(read, 15_000);
    return () => clearInterval(timer);
  }, [id]);

  return (
    <div className="claim-page">
      <header className="brand" style={{ marginBottom: 30 }}>
        <img className="brand-mark" src="/mark-512.png" alt="" aria-hidden />
        <div className="brand-name">Canopy</div>
        <div className="brand-tag">Carbon claim record</div>
      </header>

      {failed && (
        <div className="card">
          <h3>Could not reach the registry</h3>
          <p className="hint" style={{ marginBottom: 0 }}>
            <code>{failed}</code>
          </p>
        </div>
      )}

      {record && !record.found && (
        <div className="card">
          <h3>No such claim</h3>
          <p className="hint" style={{ marginBottom: 0 }}>
            Nothing with the id <code>{id}</code> is published on the contract at{" "}
            <code>{record.contractAddress}</code>. A claim that was never
            published, or one published against an earlier deployment, reads
            exactly like this — the contract does not keep a list of things it
            refused.
          </p>
        </div>
      )}

      {record?.claim && (
        <>
          <div className="claim-hero">
            <div className="claim-verdict">
              {record.claim.attested ? (
                <span className="tag attested">verified · attested</span>
              ) : (
                <span className="tag held">verified · not yet attested</span>
              )}
            </div>
            <h1 style={{ marginTop: 10 }}>
              At least {count(record.claim.threshold)} tonnes retired
            </h1>
            <p className="lede" style={{ marginBottom: 0 }}>
              For {record.claim.period}, proved on Midnight{" "}
              {record.network} against a sealed tally the claimant cannot
              reopen to a different number.
            </p>
          </div>

          <div className="card">
            <h3>What this record proves</h3>
            <ul className="claim-list">
              <li>
                The tonnes behind it were retired by credits the registry really
                issued, each one nullified so it cannot be counted again by
                anyone, including whoever it was sold to.
              </li>
              <li>
                The published figure is a <strong>floor</strong>. The company's
                actual total was never transmitted and is not derivable from
                anything on this page.
              </li>
              <li>
                {record.claim.attested
                  ? "An accredited auditor was shown the underlying records off-chain, checked every commitment and nullifier against the chain, and attested with the key fixed at deployment."
                  : "No auditor has attested this yet. Under the EU Green Claims Directive that attestation is the part that makes the claim usable, and only the key fixed at deployment can supply it."}
              </li>
            </ul>
          </div>

          <div className="card">
            <h3>Check it yourself</h3>
            <div className="claim-facts">
              <div>
                <div className="claim-key">contract</div>
                <code>{record.contractAddress}</code>
              </div>
              <div>
                <div className="claim-key">claim id</div>
                <code>{record.claim.id}</code>
              </div>
              <div>
                <div className="claim-key">claimant</div>
                <code>{record.claim.company}</code>
              </div>
              <div>
                <div className="claim-key">accredited auditor</div>
                <code>{record.auditorKey}</code>
              </div>
              <div>
                <div className="claim-key">registry</div>
                <code>{record.registryKey}</code>
              </div>
              <div>
                <div className="claim-key">read from the chain</div>
                <code>{when(record.checkedAt)}</code>
              </div>
            </div>
            <div className="note">
              Every field above comes from Midnight's public indexer at read
              time, not from anything this server stores. The claimant is a
              public key, not a name: names live in the contract only for
              companies that chose to register one.
            </div>
            <pre className="code-block source verify">{`curl ${
              INDEXER[record.network] ?? INDEXER.preprod
            } \\
  -H 'content-type: application/json' \\
  -d '{"query":"query($a:HexEncoded!){contractAction(address:$a){state}}",
       "variables":{"a":"${record.contractAddress}"}}'`}</pre>
            <div className="note" style={{ marginBottom: 0 }}>
              That returns the serialised contract state, anonymously and
              without asking us. <code>ledger()</code> from the contract package
              decodes it, and this claim is one entry in its <code>claims</code>
              map.
            </div>
          </div>
        </>
      )}

      <Verify />

      <div className="foot">
        <a href="/">Open the Canopy registry →</a>
      </div>
    </div>
  );
}
