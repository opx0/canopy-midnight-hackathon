import { useState } from "react";
import type { ChainView, Disclosure, Meta, SessionView } from "../api.js";
import { getDisclosure } from "../api.js";
import { ActionFeedback, useAction } from "./Action.js";
import { hash as short, seeded, tonnes } from "../format.js";

export const STEPS = [
  "The problem",
  "Supply",
  "Retirement",
  "The claim",
  "Cheating",
  "The auditor",
  "What just happened",
];

type Props = {
  step: number;
  setStep: (step: number) => void;
  session?: SessionView;
  chain?: ChainView;
  meta?: Meta;
  refresh: () => void;
};

export default function Tour(props: Props) {
  const { step } = props;
  const Step = [Problem, Supply, Retirement, Claim, Cheating, Auditor, Recap][
    step
  ];
  return <Step {...props} />;
}

const Next = ({
  setStep,
  step,
  label = "Continue",
  disabled,
}: {
  setStep: (step: number) => void;
  step: number;
  label?: string;
  disabled?: boolean;
}) => (
  <button
    className="btn"
    onClick={() => setStep(step + 1)}
    disabled={disabled}
  >
    {label} <span aria-hidden>→</span>
  </button>
);

function Problem({ setStep, step, meta }: Props) {
  return (
    <>
      <h1>
        Carbon claims are checked by
        <br />
        trusting the company making them.
      </h1>
      <p className="lede">
        In 2022 crypto tried to fix carbon markets. Toucan bridged roughly 22
        million Verra credits onto a public chain, and Verra responded by
        banning tokenisation outright. The failure was architectural: a ledger
        where everything is public exposes every company's position, and gives a
        registry no way to stop a retired credit from trading on.
      </p>
      <p>
        The pressure has not gone away. From <strong>September 2026</strong> the
        EU Green Claims Directive makes unsubstantiated offset-based "climate
        neutral" claims illegal, bans self-certification, and requires an
        accredited external verifier. Companies must prove more, while their
        emissions profile stays commercially sensitive.
      </p>
      <div className="note">
        <strong>The contradiction:</strong> the public needs proof that a credit
        was retired exactly once. The company needs its volumes kept private.
        Ordinary ledgers can deliver one or the other. Canopy delivers both, on
        Midnight.
      </div>
      <p>
        Everything you are about to do writes to a real contract on the Midnight{" "}
        <strong>{meta?.network ?? "testnet"}</strong> network. No wallet, no
        extension, no signup.
      </p>
      <Next setStep={setStep} step={step} label="Start" />
    </>
  );
}

function Supply({ setStep, step, session, chain, meta, refresh }: Props) {
  const action = useAction(session?.id, refresh);
  const eco = session?.companies.find((c) => c.role === "ecocorp");

  return (
    <>
      <h2>A registry publishes what it issued.</h2>
      <p>
        {meta?.project.name} has issued{" "}
        {tonnes(meta?.project.tonnes ?? 0)} tonnes for vintage{" "}
        {meta?.project.vintage}. That supply is public — it is the whole point
        of a registry. What stays private is who ends up holding each credit.
      </p>
      <p>
        Each credit enters the chain as a <strong>commitment</strong>: a hash of
        its serial, its size, its owner and a blinding salt. Issue one more and
        watch the counter on the right.
      </p>

      <div className="row">
        <button
          className="btn"
          disabled={action.busy || !seeded(session)}
          onClick={() => void action.run({ action: "issue", role: "ecocorp", tonnes: 400 })}
        >
          Issue a 400 t credit to EcoCorp
        </button>
        <span style={{ color: "var(--text-faint)", fontSize: 13 }}>
          {chain?.issuedCredits ?? 0} credits issued so far
        </span>
      </div>

      <ActionFeedback state={action}>
        <div style={{ fontSize: 13.5, color: "var(--text-dim)" }}>
          The chain stored{" "}
          <code>{short(String(action.result?.result?.commitment ?? ""))}</code>.
          Nothing in that hash says "EcoCorp" or "400".
        </div>
      </ActionFeedback>

      <div className="split">
        <div className="split-pane">
          <div className="split-title">What the chain sees</div>
          {chain?.retiredNullifiers !== undefined && (
            <div style={{ fontSize: 13.5, color: "var(--text-dim)" }}>
              {chain.issuedCredits} opaque commitments, and a batch header
              saying {tonnes(chain.batches[0]?.tonnes ?? 0)} t exists.
            </div>
          )}
        </div>
        <div className="split-pane private">
          <div className="split-title">What EcoCorp sees</div>
          <div style={{ fontSize: 13.5, color: "var(--text-dim)" }}>
            {eco?.credits.length ?? 0} credits it can spend, worth{" "}
            {tonnes(
              eco?.credits.reduce((sum, c) => sum + Number(c.tonnes), 0) ?? 0,
            )}{" "}
            t in total.
          </div>
        </div>
      </div>

      <Next setStep={setStep} step={step} />
    </>
  );
}

function Retirement({ setStep, step, session, refresh }: Props) {
  const action = useAction(session?.id, refresh);
  const eco = session?.companies.find((c) => c.role === "ecocorp");
  const available = eco?.credits.filter((c) => !c.retired) ?? [];
  const retiredCount = (eco?.credits.length ?? 0) - available.length;

  return (
    <>
      <h2>Retiring a credit tells the world almost nothing.</h2>
      <p>
        Retiring is the moment a credit is consumed to offset emissions. It must
        be impossible to do twice — and it should not broadcast how much a
        company is offsetting.
      </p>
      <p>
        Pick one. The contract proves the credit was really issued, proves
        EcoCorp owns it, and publishes a <strong>nullifier</strong> derived from
        the credit and EcoCorp's secret key.
      </p>

      <div className="list">
        <div className="list-row head">
          <div className="grow">EcoCorp's private credit ledger</div>
          <div>size</div>
        </div>
        {eco?.credits.map((credit) => (
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
                disabled={action.busy || !seeded(session)}
                onClick={() =>
                  void action.run({
                    action: "retire",
                    role: "ecocorp",
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

      <ActionFeedback state={action}>
        <div style={{ fontSize: 13.5, color: "var(--text-dim)" }}>
          Nullifier <code>{short(String(action.result?.result?.nullifier ?? ""))}</code>{" "}
          is now on chain. It is derived from EcoCorp's secret key, so nobody can
          match it back to a published serial — and nobody else could have
          produced it.
        </div>
      </ActionFeedback>

      <div className="note">
        <strong>What the chain just learned:</strong> that some credit, somewhere
        in the tree, was retired. Not which one. Not by whom. Not how many
        tonnes.
      </div>

      <Next
        setStep={setStep}
        step={step}
        disabled={retiredCount === 0}
        label={retiredCount === 0 ? "Retire one to continue" : "Continue"}
      />
    </>
  );
}

function Claim({ setStep, step, session, refresh }: Props) {
  const action = useAction(session?.id, refresh);
  const [threshold, setThreshold] = useState(1000);
  const eco = session?.companies.find((c) => c.role === "ecocorp");
  const actual = Number(eco?.retiredTonnes ?? 0);
  const published = (session?.claimIds.length ?? 0) > 0;

  return (
    <>
      <h2>A claim proves a floor, not a figure.</h2>
      <p>
        EcoCorp has actually retired <strong>{tonnes(actual)} tonnes</strong> —
        a number only it can read. To satisfy a regulator it publishes a claim
        of the form "in this period we retired at least N tonnes", backed by a
        zero-knowledge proof against its sealed tally.
      </p>
      <p>
        Choose the number yourself. The contract will only accept a claim it can
        actually cover, so try one that is too large and watch it fail.
      </p>

      <div className="card flat" style={{ padding: "18px 0" }}>
        <div className="row">
          <input
            type="range"
            min={100}
            max={4000}
            step={100}
            value={threshold}
            onChange={(event) => setThreshold(Number(event.target.value))}
            style={{ flex: 1, accentColor: "var(--leaf)", minWidth: 200 }}
          />
          <div
            style={{
              fontVariantNumeric: "tabular-nums",
              fontWeight: 640,
              fontSize: 18,
              minWidth: 110,
              textAlign: "right",
              color: threshold > actual ? "var(--rose)" : "var(--leaf)",
            }}
          >
            ≥ {tonnes(threshold)} t
          </div>
        </div>
        <div
          style={{
            fontSize: 13,
            color: threshold > actual ? "var(--rose)" : "var(--text-faint)",
            marginTop: 8,
          }}
        >
          {threshold > actual
            ? `More than the ${tonnes(actual)} t EcoCorp retired — this cannot be proved.`
            : `Within the ${tonnes(actual)} t EcoCorp retired — provable.`}
        </div>
      </div>

      <button
        className="btn"
        disabled={action.busy || !seeded(session)}
        onClick={() =>
          void action.run({
            action: "claim",
            role: "ecocorp",
            threshold,
            period: "FY2026 Q3",
          })
        }
      >
        Publish claim for FY2026 Q3
      </button>

      <ActionFeedback state={action}>
        <div style={{ fontSize: 13.5, color: "var(--text-dim)" }}>
          Published. The chain records "at least {tonnes(threshold)} t". The real
          figure, {tonnes(actual)} t, was never transmitted.
        </div>
      </ActionFeedback>

      <Next
        setStep={setStep}
        step={step}
        disabled={!published}
        label={published ? "Continue" : "Publish a claim to continue"}
      />
    </>
  );
}

function Cheating({ setStep, step, session, refresh }: Props) {
  const doubleSpend = useAction(session?.id, refresh);
  const overclaim = useAction(session?.id, refresh);
  const theft = useAction(session?.id, refresh);

  const eco = session?.companies.find((c) => c.role === "ecocorp");
  const retired = eco?.credits.find((c) => c.retired);
  const held = eco?.credits.find((c) => !c.retired);

  return (
    <>
      <h2>Now try to cheat.</h2>
      <p>
        These are the three frauds that matter in carbon markets. None of them
        is caught by a rule engine or an audit after the fact — each one is
        simply unprovable, so no transaction can exist.
      </p>
      <p className="faint">
        Each attempt is rejected while the proof is being built, which is why
        these come back instantly and cost nothing.
      </p>

      <div className="card">
        <h3>1 · Count the same credit twice</h3>
        <p style={{ fontSize: 14, marginBottom: 12 }}>
          Retire a credit EcoCorp has already retired — the double counting the
          EU rules single out.
        </p>
        <button
          className="btn danger"
          disabled={doubleSpend.busy || !retired}
          onClick={() =>
            void doubleSpend.run({
              action: "retire",
              role: "ecocorp",
              serial: retired?.serial,
            })
          }
        >
          Retire {retired ? short(retired.serial) : "…"} again
        </button>
        <ActionFeedback state={doubleSpend} />
      </div>

      <div className="card">
        <h3>2 · Claim more than you retired</h3>
        <p style={{ fontSize: 14, marginBottom: 12 }}>
          Publish a claim for 50,000 tonnes on a tally that holds{" "}
          {tonnes(eco?.retiredTonnes ?? 0)}.
        </p>
        <button
          className="btn danger"
          disabled={overclaim.busy || !seeded(session)}
          onClick={() =>
            void overclaim.run({
              action: "claim",
              role: "ecocorp",
              threshold: 50000,
              period: "FY2026 Q3",
            })
          }
        >
          Claim 50,000 t
        </button>
        <ActionFeedback state={overclaim} />
      </div>

      <div className="card">
        <h3>3 · Retire a credit you do not own</h3>
        <p style={{ fontSize: 14, marginBottom: 12 }}>
          FraudCorp knows the serial and the size — they are visible in this
          demo — and still cannot spend it, because it cannot open the
          commitment with its own key.
        </p>
        <button
          className="btn danger"
          disabled={theft.busy || !held}
          onClick={() =>
            void theft.run({
              action: "retire",
              role: "fraudcorp",
              serial: held?.serial,
            })
          }
        >
          Retire EcoCorp's {held ? short(held.serial) : "…"} as FraudCorp
        </button>
        <ActionFeedback state={theft} />
      </div>

      <Next setStep={setStep} step={step} />
    </>
  );
}

function Auditor({ setStep, step, session, chain, refresh }: Props) {
  const action = useAction(session?.id, refresh);
  const [disclosure, setDisclosure] = useState<Disclosure[]>();
  const claim = chain?.claims.find((c) => session?.claimIds.includes(c.id));

  return (
    <>
      <h2>The auditor sees everything. The public still sees nothing.</h2>
      <p>
        The Green Claims Directive requires an accredited verifier with no
        financial interest in the outcome. So EcoCorp hands that verifier the
        openings behind its retirements — serials, sizes, salts. The auditor
        recomputes each commitment and each nullifier and checks them against
        the chain.
      </p>

      <div className="row" style={{ marginBottom: 16 }}>
        <button
          className="btn ghost"
          onClick={() =>
            void getDisclosure(session!.id, "ecocorp").then(setDisclosure)
          }
          disabled={!session}
        >
          Disclose EcoCorp's records to the auditor
        </button>
      </div>

      {disclosure && (
        <div className="list" style={{ marginBottom: 18 }}>
          <div className="list-row head">
            <div className="grow">serial</div>
            <div>size</div>
            <div style={{ width: 76 }}>on chain</div>
          </div>
          {disclosure.map((record) => (
            <div className="list-row" key={record.serial}>
              <code className="grow trunc">{short(record.serial)}</code>
              <div className="num">
                {tonnes(record.tonnes)} t
              </div>
              <div style={{ width: 76 }}>
                {record.retired ? (
                  <span className="tag retired">verified</span>
                ) : (
                  <span className="tag held">held</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <p>
        Satisfied, the auditor attests on chain. That attestation is the only
        part of this exchange anyone else can see.
      </p>

      <button
        className="btn"
        disabled={action.busy || !seeded(session) || !claim}
        onClick={() => void action.run({ action: "attest", claimId: claim?.id })}
      >
        {claim ? "Attest the claim as the auditor" : "No claim to attest"}
      </button>

      <ActionFeedback state={action}>
        <div style={{ fontSize: 13.5, color: "var(--text-dim)" }}>
          The claim now carries an accredited attestation. Try attesting as
          anyone else and the contract will refuse — the auditor's key was fixed
          when the contract was deployed.
        </div>
      </ActionFeedback>

      <Next setStep={setStep} step={step} />
    </>
  );
}

function Recap({ setStep, chain, meta, session }: Props) {
  const eco = session?.companies.find((c) => c.role === "ecocorp");
  return (
    <>
      <h2>What just happened</h2>
      <p>
        You published a verifiable carbon claim and audited it, and the chain
        never learned a single commercially sensitive number.
      </p>

      <div className="split">
        <div className="split-pane">
          <div className="split-title">Public, forever</div>
          <ul style={{ paddingLeft: 18, color: "var(--text-dim)", fontSize: 14 }}>
            <li>{chain?.issuedCredits ?? 0} credit commitments</li>
            <li>{chain?.retirementEvents ?? 0} retirement nullifiers</li>
            <li>{chain?.claims.length ?? 0} claims, with attestations</li>
            <li>Which registry and auditor are authoritative</li>
          </ul>
        </div>
        <div className="split-pane private">
          <div className="split-title">Never disclosed</div>
          <ul style={{ paddingLeft: 18, color: "var(--text-dim)", fontSize: 14 }}>
            <li>That EcoCorp retired {tonnes(eco?.retiredTonnes ?? 0)} t</li>
            <li>Which credits it used</li>
            <li>What it still holds</li>
            <li>Anything about its emissions profile</li>
          </ul>
        </div>
      </div>

      <h3 style={{ marginTop: 28 }}>Why this needs Midnight</h3>
      <p>
        Three things had to be true in the same contract, and Midnight is what
        makes them coexist. Public ledger state carries the nullifier set, so
        double counting is impossible rather than merely detectable. Witness
        data stays on the client, so tonnages never leave the company. And{" "}
        <code>disclose()</code> is mandatory in Compact — the compiler refuses to
        build a circuit that leaks a private value into public state by
        accident, so privacy is checked at compile time rather than in review.
      </p>

      <div className="note">
        <strong>Honest limits.</strong> Canopy fixes carbon <em>accounting</em>,
        not carbon <em>quality</em> — a worthless credit accounted for perfectly
        is still worthless. The registry and auditor are trusted roles, as they
        are in the real market. Credits are issued to a holder and retired by
        them; secondary trading is not modelled yet.
      </div>

      <div className="row">
        <button className="btn ghost" onClick={() => setStep(0)}>
          Run the tour again
        </button>
      </div>

      {meta && (
        <div className="foot">
          Contract <code>{meta.contractAddress}</code> on Midnight{" "}
          {meta.network}. Every action in this tour was a real transaction
          against it.
        </div>
      )}
    </>
  );
}
