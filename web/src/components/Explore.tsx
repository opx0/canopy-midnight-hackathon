import { useState } from "react";
import type { ChainView, Disclosure, Meta, SessionView } from "../api.js";
import { getDisclosure } from "../api.js";
import { ActionFeedback, useAction } from "./Action.js";
import { hash as short, tonnes } from "../format.js";

type Props = {
  session?: SessionView;
  chain?: ChainView;
  meta?: Meta;
  refresh: () => void;
};

type Role = "registry" | "ecocorp" | "fraudcorp" | "auditor";

const ROLES: { key: Role; label: string; blurb: string }[] = [
  {
    key: "registry",
    label: "Registry",
    blurb:
      "Issues credits into the public tree. Only the key fixed at deployment can do this.",
  },
  {
    key: "ecocorp",
    label: "EcoCorp",
    blurb:
      "Holds credits, retires them privately, and publishes claims it can prove.",
  },
  {
    key: "fraudcorp",
    label: "FraudCorp",
    blurb:
      "Registered like anyone else, and free to attempt anything. None of it works.",
  },
  {
    key: "auditor",
    label: "Auditor",
    blurb:
      "Receives disclosed records off-chain and attests claims on-chain.",
  },
];

export default function Explore(props: Props) {
  const [role, setRole] = useState<Role>("registry");
  return (
    <>
      <p className="lede">
        Every control here writes to the same deployed contract. Nothing is
        simulated, and nothing is off limits — including everything that is
        supposed to fail.
      </p>
      <nav className="tabs">
        {ROLES.map((entry) => (
          <button
            key={entry.key}
            className={`tab${role === entry.key ? " active" : ""}`}
            onClick={() => setRole(entry.key)}
          >
            {entry.label}
          </button>
        ))}
      </nav>
      <p className="faint">
        {ROLES.find((entry) => entry.key === role)?.blurb}
      </p>

      {role === "registry" && <RegistryPanel {...props} />}
      {role === "ecocorp" && <CompanyPanel {...props} role="ecocorp" />}
      {role === "fraudcorp" && <CompanyPanel {...props} role="fraudcorp" />}
      {role === "auditor" && <AuditorPanel {...props} />}
    </>
  );
}

function RegistryPanel({ session, chain, meta, refresh }: Props) {
  const action = useAction(session?.id, refresh);
  const [size, setSize] = useState(500);
  const [target, setTarget] = useState<"ecocorp" | "fraudcorp">("ecocorp");

  return (
    <>
      <div className="card">
        <h3>Issue a credit</h3>
        <p className="hint">
          From {meta?.project.name}, vintage {meta?.project.vintage}. The chain
          receives a commitment; the recipient receives the note that opens it.
        </p>
        <div className="row" style={{ marginBottom: 14 }}>
          <input
            type="number"
            min={1}
            max={10000}
            value={size}
            onChange={(event) => setSize(Number(event.target.value))}
            className="field"
            style={{ width: 110 }}
          />
          <span style={{ color: "var(--text-faint)", fontSize: 14 }}>
            tonnes to
          </span>
          <select
            value={target}
            onChange={(event) =>
              setTarget(event.target.value as "ecocorp" | "fraudcorp")
            }
            className="field"
          >
            <option value="ecocorp">EcoCorp</option>
            <option value="fraudcorp">FraudCorp</option>
          </select>
        </div>
        <button
          className="btn"
          disabled={action.busy}
          onClick={() =>
            void action.run({ action: "issue", role: target, tonnes: size })
          }
        >
          Issue credit
        </button>
        <ActionFeedback state={action} />
      </div>

      <div className="card">
        <h3>Public supply</h3>
        <div className="list">
          <div className="list-row head">
            <div className="grow">project</div>
            <div>vintage</div>
            <div>tonnes</div>
          </div>
          {chain?.batches.map((batch) => (
            <div className="list-row" key={batch.id}>
              <div className="grow trunc">{batch.project}</div>
              <div>{batch.vintage}</div>
              <div className="num">
                {tonnes(batch.tonnes)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function CompanyPanel({
  session,
  chain,
  refresh,
  role,
}: Props & { role: "ecocorp" | "fraudcorp" }) {
  const retire = useAction(session?.id, refresh);
  const claim = useAction(session?.id, refresh);
  const [threshold, setThreshold] = useState(500);
  const company = session?.companies.find((entry) => entry.role === role);
  const other = session?.companies.find((entry) => entry.role !== role);
  const claims = chain?.claims.filter(
    (entry) => entry.company === company?.publicKey,
  );

  return (
    <>
      <div className="card">
        <h3>{company?.name}'s private credit ledger</h3>
        <p className="hint">
          Visible to this company alone. The chain holds only commitments to
          these rows.
        </p>
        {company?.credits.length ? (
          <div className="list">
            {company.credits.map((credit) => (
              <div className="list-row" key={credit.serial}>
                <code className="grow trunc">{short(credit.serial)}</code>
                <div className="num">
                  {tonnes(credit.tonnes)} t
                </div>
                {credit.retired ? (
                  <span className="tag retired">retired</span>
                ) : (
                  <button
                    className="btn small ghost"
                    disabled={retire.busy}
                    onClick={() =>
                      void retire.run({
                        action: "retire",
                        role,
                        serial: credit.serial,
                      })
                    }
                  >
                    Retire
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="empty">
            No credits. Issue some from the registry tab.
          </div>
        )}
        <ActionFeedback state={retire} />
        <div className="note" style={{ marginBottom: 0 }}>
          Retired so far: <strong>{tonnes(company?.retiredTonnes ?? 0)} t</strong>
          . This total exists only here and inside the proof — the chain stores a
          commitment to it.
        </div>
      </div>

      {other && other.credits.some((credit) => !credit.retired) && (
        <div className="card">
          <h3>Try to spend a credit you do not own</h3>
          <p className="hint">
            {other.name} holds credits whose serials are visible to you in this
            demo. Attempt one.
          </p>
          <button
            className="btn danger"
            disabled={retire.busy}
            onClick={() =>
              void retire.run({
                action: "retire",
                role,
                serial: other.credits.find((credit) => !credit.retired)?.serial,
              })
            }
          >
            Retire {other.name}'s credit
          </button>
        </div>
      )}

      <div className="card">
        <h3>Publish a claim</h3>
        <div className="row" style={{ marginBottom: 14 }}>
          <input
            type="number"
            min={1}
            value={threshold}
            onChange={(event) => setThreshold(Number(event.target.value))}
            className="field"
            style={{ width: 130 }}
          />
          <span style={{ color: "var(--text-faint)", fontSize: 14 }}>
            tonnes claimed as retired, against{" "}
            {tonnes(company?.retiredTonnes ?? 0)} t actually retired
          </span>
        </div>
        <button
          className="btn"
          disabled={claim.busy}
          onClick={() =>
            void claim.run({
              action: "claim",
              role,
              threshold,
              period: "FY2026 Q3",
            })
          }
        >
          Publish claim
        </button>
        <ActionFeedback state={claim} />

        {claims?.length ? (
          <div className="list" style={{ marginTop: 16 }}>
            <div className="list-row head">
              <div className="grow">claim</div>
              <div>status</div>
            </div>
            {claims.map((entry) => (
              <div className="list-row" key={entry.id}>
                <div className="grow">
                  ≥ {tonnes(entry.threshold)} t · {entry.period}
                </div>
                <div>
                  {entry.attested ? (
                    <span className="tag attested">attested</span>
                  ) : (
                    <span className="tag held">unaudited</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </>
  );
}

function AuditorPanel({ session, chain, refresh }: Props) {
  const action = useAction(session?.id, refresh);
  const [disclosure, setDisclosure] = useState<Disclosure[]>();
  const [subject, setSubject] = useState<"ecocorp" | "fraudcorp">("ecocorp");
  const mine = chain?.claims.filter((claim) =>
    session?.claimIds.includes(claim.id),
  );

  return (
    <>
      <div className="card">
        <h3>Selective disclosure</h3>
        <p className="hint">
          A company hands the auditor the openings behind its retirements. The
          auditor recomputes every commitment and nullifier and checks them
          against the chain. Nobody else receives any of this.
        </p>
        <div className="row" style={{ marginBottom: 14 }}>
          <select
            value={subject}
            onChange={(event) => {
              setSubject(event.target.value as "ecocorp" | "fraudcorp");
              setDisclosure(undefined);
            }}
            className="field"
          >
            <option value="ecocorp">EcoCorp</option>
            <option value="fraudcorp">FraudCorp</option>
          </select>
          <button
            className="btn ghost"
            disabled={!session}
            onClick={() =>
              void getDisclosure(session!.id, subject).then(setDisclosure)
            }
          >
            Request records
          </button>
        </div>

        {disclosure &&
          (disclosure.length ? (
            <div className="list">
              <div className="list-row head">
                <div className="grow">serial</div>
                <div>size</div>
                <div style={{ width: 84 }}>chain</div>
              </div>
              {disclosure.map((record) => (
                <div className="list-row" key={record.serial}>
                  <code className="grow trunc">{short(record.serial)}</code>
                  <div className="num">
                    {tonnes(record.tonnes)} t
                  </div>
                  <div style={{ width: 84 }}>
                    {record.retired ? (
                      <span className="tag retired">retired</span>
                    ) : (
                      <span className="tag held">held</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty">This company holds no credits.</div>
          ))}
      </div>

      <div className="card">
        <h3>Attest a claim</h3>
        {mine?.length ? (
          <div className="list">
            {mine.map((claim) => (
              <div className="list-row" key={claim.id}>
                <div className="grow">
                  ≥ {tonnes(claim.threshold)} t · {claim.period}
                </div>
                {claim.attested ? (
                  <span className="tag attested">attested</span>
                ) : (
                  <button
                    className="btn small ghost"
                    disabled={action.busy}
                    onClick={() =>
                      void action.run({ action: "attest", claimId: claim.id })
                    }
                  >
                    Attest
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="empty">No claims published in this session yet.</div>
        )}
        <ActionFeedback state={action} />
      </div>
    </>
  );
}
