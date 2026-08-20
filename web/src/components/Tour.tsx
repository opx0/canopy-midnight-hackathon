import { useState } from "react";
import type { ChainView, Disclosure, Meta, SessionView } from "../api.js";
import { getDisclosure } from "../api.js";
import { ActionFeedback, useAction } from "./Action.js";
import { hash as short, seeded, tonnes } from "../format.js";
import { type Stage } from "./Lifecycle.js";
import Split from "./Split.js";
import Commit from "./Commit.js";

export const STEPS = [
  "The problem",
  "Supply",
  "Trading",
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

// Which move on the chain each step of the tour is about. App reads this to light up
// the matching box in the lifecycle diagram at the top of the page.
export const STAGE: (Stage | undefined)[] = [
  undefined,
  "issue",
  "trade",
  "retire",
  "claim",
  undefined,
  "attest",
  undefined,
];

export default function Tour(props: Props) {
  const { step } = props;
  const Step = [
    Problem,
    Supply,
    Trading,
    Retirement,
    Claim,
    Cheating,
    Auditor,
    Recap,
  ][step];
  return (
    <div className="step-body" key={step}>
      <Step {...props} />
    </div>
  );
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
        <br className="wide-break" />{" "}
        trusting the company making them.
      </h1>

      <Split
        who="the company"
        chain={
          <>
            <div className="split-figure">Everything</div>
            On an ordinary public ledger. Every credit you buy, every tonne you
            retire, the whole position — visible to your competitors, forever.
            That is why Verra banned tokenisation in 2022.
          </>
        }
        only={
          <>
            <div className="split-figure">Everything</div>
            Under today's rules. Nobody can check the claim, so it is taken on
            trust — which the EU stops accepting in{" "}
            <strong>September 2026</strong>.
          </>
        }
      />

      <div className="note">
        <strong>Both are wrong.</strong> The public needs proof a credit was
        retired exactly once. The company needs its volumes private. Ordinary
        ledgers give you one or the other. Canopy gives both, and the diagram
        above is how.
      </div>

      <p className="faint">
        Everything you are about to do writes to a real contract on Midnight{" "}
        <strong>{meta?.network ?? "testnet"}</strong>. No wallet, no extension,
        no signup.
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
      <p className="lede">
        Supply is public — that is what a registry is for. Who ends up holding
        each credit is not.
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
          Nothing in that hash says "EcoCorp" or "400".
        </div>
      </ActionFeedback>

      <Commit tonnes="400 t" />

      <Split
        who="EcoCorp"
        chain={
          <>
            <div className="split-figure">
              {chain?.issuedCredits ?? 0} hashes
            </div>
            And a batch header saying{" "}
            {tonnes(meta?.projects[0]?.tonnes ?? 0)} tonnes of{" "}
            {meta?.projects[0]?.name} exist. Not one of them says who holds
            what.
            <code>
              {short(String(action.result?.result?.commitment ?? "hash(serial ‖ tonnes ‖ owner ‖ salt)"))}
            </code>
          </>
        }
        only={
          <>
            <div className="split-figure">
              {tonnes(
                eco?.credits.reduce((sum, c) => sum + Number(c.tonnes), 0) ?? 0,
              )}{" "}
              t
            </div>
            Across {eco?.credits.length ?? 0} credits it can actually spend.
            Only EcoCorp can open those hashes, because only EcoCorp has the
            salt and the key.
          </>
        }
      />

      <Next setStep={setStep} step={step} />
    </>
  );
}

function Trading({ setStep, step, session, chain, refresh }: Props) {
  const action = useAction(session?.id, refresh);
  const eco = session?.companies.find((c) => c.role === "ecocorp");
  const fraud = session?.companies.find((c) => c.role === "fraudcorp");
  const sendable = eco?.credits.find((c) => !c.retired && !c.transferred);
  const moved = (chain?.transferEvents ?? 0) > 0;

  return (
    <>
      <h2>Credits change hands before anyone retires them.</h2>
      <p className="lede">
        On a public ledger every trade names the buyer, the seller and the size.
        Here it names none of them.
      </p>

      <div className="row">
        <button
          className="btn"
          disabled={action.busy || !sendable}
          onClick={() =>
            void action.run({
              action: "transfer",
              role: "ecocorp",
              to: "fraudcorp",
              serial: sendable?.serial,
            })
          }
        >
          {sendable
            ? `Send ${tonnes(sendable.tonnes)} t to ${fraud?.name ?? "the other company"}`
            : "Nothing left to send"}
        </button>
        <span style={{ color: "var(--text-faint)", fontSize: 13 }}>
          {chain?.transferEvents ?? 0} credits have changed hands
        </span>
      </div>

      <ActionFeedback state={action}>
        <div style={{ fontSize: 13.5, color: "var(--text-dim)" }}>
          Nullifier{" "}
          <code>{short(String(action.result?.result?.nullifier ?? ""))}</code>{" "}
          burnt the seller's note. The buyer's replacement went in as a
          commitment nobody can link to it.
        </div>
      </ActionFeedback>

      <Split
        who="the two parties"
        chain={
          <>
            <div className="split-figure">1 spent · 1 created</div>
            A nullifier and a fresh commitment, in the same transaction. They
            cannot be matched to each other — the new one carries a new blinding
            value. No buyer, no seller, no price, no size.
          </>
        }
        only={
          <>
            <div className="split-figure">450 t, moved</div>
            The seller loses a spendable credit. The buyer gains one worth
            exactly the same tonnage and can now retire it. Same serial, new
            owner.
          </>
        }
      />

      <div className="note">
        <strong>The seller cannot keep it too.</strong> They still know the
        serial, the size and the salt — everything a proof needs — but the
        nullifier is spent, so the circuit will not build a second one. You can
        try that yourself two steps from here.
      </div>

      <Next
        setStep={setStep}
        step={step}
        disabled={!moved}
        label={moved ? "Continue" : "Send one to continue"}
      />
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
      <p className="lede">
        The moment a credit is consumed. It has to be impossible to do twice,
        and it should not announce how much you are offsetting.
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

      <Split
        who="EcoCorp"
        chain={
          <>
            <div className="split-figure">+1 nullifier</div>
            That some credit, somewhere in the tree, was retired. Not which one.
            Not by whom. Not how many tonnes. Inserting the same one twice is
            what the contract refuses — so double counting has no transaction
            that expresses it.
          </>
        }
        only={
          <>
            <div className="split-figure">
              {tonnes(eco?.retiredTonnes ?? 0)} t
            </div>
            Its real running total, sealed into a commitment on chain that only
            its own key can reopen. Nobody else can read it, and EcoCorp cannot
            later change it.
          </>
        }
      />

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
      <p className="lede">
        EcoCorp retired <strong>{tonnes(actual)} tonnes</strong> — a number only
        it can read. It publishes a floor instead, proved against the sealed
        tally. Drag it past what it actually retired and the proof cannot be
        built.
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
  const resell = useAction(session?.id, refresh);

  const eco = session?.companies.find((c) => c.role === "ecocorp");
  const retired = eco?.credits.find((c) => c.retired);
  const held = eco?.credits.find((c) => !c.retired && !c.transferred);
  const sent = eco?.credits.find((c) => c.transferred && !c.retired);

  return (
    <>
      <h2>Now try to cheat.</h2>
      <p>
        These are the four frauds that matter in carbon markets. None of them
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

      <div className="card">
        <h3>4 · Sell it and retire it anyway</h3>
        <p style={{ fontSize: 14, marginBottom: 12 }}>
          The oldest trick in offsetting: bank the sale, then claim the tonnes
          as your own. EcoCorp still holds the note it sent away, and it opens
          to the same commitment it always did.
        </p>
        <button
          className="btn danger"
          disabled={resell.busy || !sent}
          onClick={() =>
            void resell.run({
              action: "retire",
              role: "ecocorp",
              serial: sent?.serial,
            })
          }
        >
          {sent
            ? `Retire the ${tonnes(sent.tonnes)} t it already sold`
            : "Send a credit in step 3 first"}
        </button>
        <ActionFeedback state={resell} />
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
      <p className="lede">
        The Green Claims Directive requires an accredited verifier. EcoCorp
        hands that one verifier the openings — serials, sizes, salts — and they
        recompute every commitment against the chain. Nobody else gets a line of
        it.
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
                ) : record.transferred ? (
                  <span className="tag held">passed on</span>
                ) : (
                  <span className="tag held">held</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Split
        who="the auditor"
        chain={
          <>
            <div className="split-figure">1 flag</div>
            An attestation against the claim, signed by the key fixed when the
            contract was deployed. That is the entire public record of this
            audit.
          </>
        }
        only={
          <>
            <div className="split-figure">Every line</div>
            Serials, tonnages and salts for each retirement, checked against the
            chain. Handed over off-chain, the way a real audit works.
          </>
        }
      />

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
      <p className="lede">
        You published a verifiable carbon claim and had it audited. The chain
        never learned a single commercially sensitive number.
      </p>

      <Split
        who="EcoCorp"
        chain={
          <>
            <div className="split-figure">
              {(chain?.issuedCredits ?? 0) +
                (chain?.retirementEvents ?? 0) +
                (chain?.transferEvents ?? 0)}{" "}
              hashes
            </div>
            <ul className="split-list">
              <li>{chain?.issuedCredits ?? 0} credit commitments</li>
              <li>{chain?.retirementEvents ?? 0} retirement nullifiers</li>
              <li>{chain?.transferEvents ?? 0} credits that changed hands</li>
              <li>{chain?.claims.length ?? 0} claims, with attestations</li>
              <li>Which registry and auditor are authoritative</li>
            </ul>
          </>
        }
        only={
          <>
            <div className="split-figure">
              {tonnes(eco?.retiredTonnes ?? 0)} t
            </div>
            <ul className="split-list">
              <li>The real total, sealed and unreadable</li>
              <li>Which credits it used</li>
              <li>What it still holds</li>
              <li>Who it bought from and sold to</li>
              <li>Anything about its emissions profile</li>
            </ul>
          </>
        }
      />

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
        are in the real market. Trading has no settlement leg: a credit moves
        when the seller says so, and payment is somebody else's problem.
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
