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
import Tour, { STEPS } from "./components/Tour.js";
import Explore from "./components/Explore.js";
import HowItWorks from "./components/HowItWorks.js";
import Seeding from "./components/Seeding.js";

const SESSION_KEY = "canopy.session";

export default function App() {
  const [meta, setMeta] = useState<Meta>();
  const [session, setSession] = useState<SessionView>();
  const [chain, setChain] = useState<ChainView>();
  const [sessionId, setSessionId] = useState<string>();
  const [step, setStep] = useState(0);
  const [tab, setTab] = useState<"tour" | "explore" | "how">("tour");
  const [fatal, setFatal] = useState<string>();
  const [status, setStatus] = useState<Status>();
  const [history, setHistory] = useState<History>();

  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;

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

    const run = async () => {
      for (;;) {
        const current = await getStatus().catch(() => undefined);
        setStatus(current);
        getMeta().then(setMeta).catch(() => undefined);
        if (current?.ready) break;
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
      setSessionId(await resumeOrCreate());
    };

    run().catch((error: Error) => setFatal(error.message));
  }, []);

  const refresh = useCallback(() => {
    getChain().then(setChain).catch(() => undefined);
    getHistory().then(setHistory).catch(() => undefined);
    if (sessionId) getSession(sessionId).then(setSession).catch(() => undefined);
  }, [sessionId]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 4000);
    return () => clearInterval(timer);
  }, [refresh]);

  if (fatal) {
    return (
      <div className="main">
        <h2>Canopy is not reachable</h2>
        <p>
          The backend did not answer: <code>{fatal}</code>
        </p>
      </div>
    );
  }

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

        <Live history={history} chain={chain} meta={meta} status={status} />

        <nav className="tabs">
          <button
            className={`tab${tab === "tour" ? " active" : ""}`}
            onClick={() => setTab("tour")}
          >
            Guided tour
          </button>
          <button
            className={`tab${tab === "explore" ? " active" : ""}`}
            onClick={() => setTab("explore")}
          >
            Explore freely
          </button>
          <button
            className={`tab${tab === "how" ? " active" : ""}`}
            onClick={() => setTab("how")}
          >
            How it works
          </button>
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
                disabled={!sessionId && index > 0}
              >
                <span className="step-num">{index < step ? "✓" : index + 1}</span>
                {label}
              </button>
            ))}
          </div>
        )}

        {tab !== "how" && <Seeding session={session} />}

        {tab === "how" && <HowItWorks meta={meta} />}

        {tab === "explore" && !sessionId && (
          <div className="working">
            <span className="spinner" />
            <span>
              {status && !status.ready
                ? "The fee wallet is arming, so writing to the chain is paused for a moment. Everything to the right is the live contract, read straight from the indexer, and How it works explains the cryptography."
                : `Preparing a private sandbox on Midnight ${meta?.network ?? "testnet"}…`}
            </span>
          </div>
        )}

        {tab === "tour" && (
          <Tour
            step={sessionId ? step : 0}
            setStep={setStep}
            session={session}
            chain={chain}
            meta={meta}
            refresh={refresh}
          />
        )}

        {tab === "explore" && sessionId && (
          <Explore
            session={session}
            chain={chain}
            meta={meta}
            refresh={refresh}
          />
        )}
      </main>

      <ChainInspector chain={chain} meta={meta} history={history} />
    </div>
  );
}
