import { useCallback, useEffect, useRef, useState } from "react";
import {
  createSession,
  getChain,
  getHistory,
  getMeta,
  getSession,
  getStatus,
  type ChainView,
  type History,
  type Meta,
  type SessionView,
  type Status,
} from "./api.js";
import Live from "./components/Live.js";
import ChainInspector from "./components/ChainInspector.js";
import Tour, { STEPS, STAGE } from "./components/Tour.js";
import Lifecycle from "./components/Lifecycle.js";
import Explore from "./components/Explore.js";
import HowItWorks from "./components/HowItWorks.js";
import Benchmarks from "./components/Benchmarks.js";
import Trend from "./components/Trend.js";
import Verify from "./components/Verify.js";
import Seeding from "./components/Seeding.js";

const SESSION_KEY = "canopy.session";

const REPO = "https://github.com/opx0/canopy-midnight-hackathon";

// Tabs live in the URL so a judge can send somebody a link to the part that matters,
// and so the back button does what they expect.
type Tab = "tour" | "explore" | "how" | "bench";

const TABS: { key: Tab; label: string }[] = [
  { key: "tour", label: "Guided tour" },
  { key: "explore", label: "Explore freely" },
  { key: "how", label: "How it works" },
  { key: "bench", label: "What it costs" },
];

const tabFromHash = (): Tab => {
  const found = TABS.find((tab) => tab.key === location.hash.replace("#", ""));
  return found?.key ?? "tour";
};

export default function App() {
  const [meta, setMeta] = useState<Meta>();
  const [session, setSession] = useState<SessionView>();
  const [chain, setChain] = useState<ChainView>();
  const [sessionId, setSessionId] = useState<string>();
  const [step, setStep] = useState(0);
  const [tab, setTabState] = useState<Tab>(tabFromHash);
  const setTab = (next: Tab) => {
    setTabState(next);
    window.history.replaceState(null, "", next === "tour" ? "." : `#${next}`);
  };
  const [sandboxError, setSandboxError] = useState<string>();
  const [status, setStatus] = useState<Status>();
  const [history, setHistory] = useState<History>();

  // A sandbox costs four real transactions, and Midnight regenerates the DUST that
  // pays for them at a fixed rate — so it is not free to hand one to somebody who
  // came to read. Wait until they do something that needs one.
  const wanted = tab === "explore" || step > 0;
  const claiming = useRef(false);
  useEffect(() => {
    if (!wanted || !status?.ready || sessionId || claiming.current) return;
    claiming.current = true;

    const resumeOrCreate = async (): Promise<string> => {
      const saved = localStorage.getItem(SESSION_KEY);
      if (saved) {
        const found = await getSession(saved).then(
          () => saved,
          () => undefined,
        );
        if (found) return found;
      }
      const { id } = await createSession();
      localStorage.setItem(SESSION_KEY, id);
      return id;
    };

    resumeOrCreate().then(setSessionId, (error: Error) => {
      // Not fatal. The contract, the inspector and every explanation on this page
      // work without a sandbox; only the buttons need one.
      claiming.current = false;
      setSandboxError(error.message);
    });
  }, [wanted, status?.ready, sessionId]);

  // One poller. It runs from first paint, so a visitor who arrives while the backend
  // is restarting sees the panels fill in on their own rather than a dead page.
  const refresh = useCallback(() => {
    getStatus().then(setStatus).catch(() => undefined);
    getMeta().then(setMeta).catch(() => undefined);
    getChain().then(setChain).catch(() => undefined);
    getHistory().then(setHistory).catch(() => undefined);
    if (sessionId) getSession(sessionId).then(setSession).catch(() => undefined);
  }, [sessionId]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 4000);
    return () => clearInterval(timer);
  }, [refresh]);

  return (
    <div className="app">
      <main className="main">
        <header className="brand">
          <img className="brand-mark" src="/mark-512.png" alt="" aria-hidden />
          <div className="brand-name">Canopy</div>
          <div className="brand-tag">
            Carbon claims you can verify. Books you cannot read.
          </div>
        </header>

        {/* The picture first. Somebody who reads nothing else should still be able
            to say what this does, and the numbers underneath are the evidence that
            it is really doing it. */}
        <Lifecycle active={tab === "tour" ? STAGE[step] : undefined} />

        <Live history={history} chain={chain} meta={meta} status={status} />

        {status && !status.ready && meta?.contractAddress && (
          <div className="paused">
            <strong>Writing to the chain is paused</strong> while the server is{" "}
            {status.stage ?? "starting up"}
            {status.stageSeconds ? `, ${status.stageSeconds}s so far` : ""}.
            Everything you can see is live contract state read from Midnight's
            public indexer, and every page here works — the buttons come back
            when the fee wallet does.
          </div>
        )}

        <Trend history={history} />

        <nav className="tabs">
          {TABS.map((entry) => (
            <button
              key={entry.key}
              className={`tab${tab === entry.key ? " active" : ""}`}
              onClick={() => setTab(entry.key)}
            >
              {entry.label}
            </button>
          ))}
        </nav>

        {tab === "tour" && (
          <div className="steps">
            {STEPS.map((label, index) => (
              <button
                key={label}
                className={`step-chip${index === step ? " active" : ""}${
                  index < step ? " done" : ""
                }`}
                onClick={() => setStep(index)}
              >
                <span className="step-num">{index < step ? "✓" : index + 1}</span>
                {label}
              </button>
            ))}
          </div>
        )}

        {sandboxError && !sessionId && (
          <div className="rejected broken">
            <div className="rejected-head">
              <span>✕</span> Could not give you a sandbox
            </div>
            <div className="rejected-msg">{sandboxError}</div>
            <div style={{ fontSize: 12.5, color: "var(--text-faint)", marginTop: 10 }}>
              Only the buttons need one. The chain inspector, How it works and
              What it costs are all still live.
            </div>
          </div>
        )}

        {(tab === "tour" || tab === "explore") && <Seeding session={session} />}

        {tab === "how" && <HowItWorks meta={meta} />}

        {tab === "bench" && <Benchmarks />}

        {tab === "tour" && (
          <Tour
            step={step}
            setStep={setStep}
            session={session}
            chain={chain}
            meta={meta}
            refresh={refresh}
          />
        )}

        {tab === "explore" && (
          <Explore
            session={session}
            chain={chain}
            meta={meta}
            refresh={refresh}
          />
        )}
        <Verify />

        <footer className="site-foot">
          <div>
            <a href={REPO}>Source on GitHub</a> · one Compact contract, a Node
            backend and this page.
          </div>
          <div>
            <a href={`${REPO}/blob/main/contract/src/canopy.compact`}>
              canopy.compact
            </a>{" "}
            is the whole protocol, about 200 lines, and is the file worth
            reading first.
          </div>
          <div>
            <a href={`${REPO}/blob/main/docs/what-we-learned.md`}>
              What we learned building on Midnight
            </a>{" "}
            — what node error 117 really is, the DUST budget in numbers, and the
            witness rule that makes most fraud tests meaningless.
          </div>
          {meta?.contractAddress && (
            <div className="faint">
              Deployed on Midnight {meta.network} at{" "}
              <code>{meta.contractAddress}</code>. Apache-2.0.
            </div>
          )}
        </footer>
      </main>

      <ChainInspector chain={chain} meta={meta} history={history} />
    </div>
  );
}
