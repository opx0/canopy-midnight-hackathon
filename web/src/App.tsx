import { useCallback, useEffect, useRef, useState } from "react";
import {
  createSession,
  getChain,
  getMeta,
  getSession,
  type ChainView,
  type Meta,
  type SessionView,
} from "./api.js";
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

  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    getMeta().then(setMeta).catch((error: Error) => setFatal(error.message));

    const saved = localStorage.getItem(SESSION_KEY);
    const resume = saved
      ? getSession(saved).then(() => saved)
      : Promise.reject(new Error("no saved session"));

    resume
      .catch(() =>
        createSession().then(({ id }) => {
          localStorage.setItem(SESSION_KEY, id);
          return id;
        }),
      )
      .then(setSessionId)
      .catch((error: Error) => setFatal(error.message));
  }, []);

  const refresh = useCallback(() => {
    getChain().then(setChain).catch(() => undefined);
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
          <div className="brand-mark" aria-hidden>
            🌲
          </div>
          <div className="brand-name">Canopy</div>
          <div className="brand-tag">
            Carbon claims you can verify. Books you cannot read.
          </div>
        </header>

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
              >
                <span className="step-num">{index < step ? "✓" : index + 1}</span>
                {label}
              </button>
            ))}
          </div>
        )}

        {tab !== "how" && <Seeding session={session} />}

        {tab === "how" && <HowItWorks meta={meta} />}

        {tab !== "how" && !sessionId && (
          <div className="working">
            <span className="spinner" />
            <span>
              Preparing a private sandbox on Midnight {meta?.network ?? "testnet"}…
            </span>
          </div>
        )}

        {sessionId &&
          tab !== "how" &&
          (tab === "tour" ? (
            <Tour
              step={step}
              setStep={setStep}
              session={session}
              chain={chain}
              meta={meta}
              refresh={refresh}
            />
          ) : (
            <Explore
              session={session}
              chain={chain}
              meta={meta}
              refresh={refresh}
            />
          ))}
      </main>

      <ChainInspector chain={chain} meta={meta} />
    </div>
  );
}
