import { useCallback, useEffect, useRef, useState } from "react";
import { runAction, type Job } from "../api.js";

export type ActionState = {
  run: (body: Record<string, unknown>) => Promise<Job | undefined>;
  busy: boolean;
  elapsed: number;
  result?: Job;
  error?: string;
};

export const useAction = (
  sessionId: string | undefined,
  onSettled?: () => void,
): ActionState => {
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<Job>();
  const [error, setError] = useState<string>();
  const timer = useRef<ReturnType<typeof setInterval>>(undefined);

  useEffect(() => () => clearInterval(timer.current), []);

  const run = useCallback(
    async (body: Record<string, unknown>) => {
      if (!sessionId) return undefined;
      setBusy(true);
      setError(undefined);
      setResult(undefined);
      const startedAt = Date.now();
      setElapsed(0);
      timer.current = setInterval(
        () => setElapsed(Date.now() - startedAt),
        100,
      );
      try {
        const job = await runAction(sessionId, body);
        setResult(job);
        return job;
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
        return undefined;
      } finally {
        clearInterval(timer.current);
        setBusy(false);
        onSettled?.();
      }
    },
    [sessionId, onSettled],
  );

  return { run, busy, elapsed, result, error };
};

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

export function ActionFeedback({
  state,
  busyLabel = "Proving and submitting to Midnight",
  doneLabel = "Confirmed on chain",
  children,
}: {
  state: ActionState;
  busyLabel?: string;
  doneLabel?: string;
  children?: React.ReactNode;
}) {
  if (state.busy) {
    return (
      <div className="working">
        <span className="spinner" />
        <span>{busyLabel}…</span>
        <span className="elapsed">{seconds(state.elapsed)}</span>
      </div>
    );
  }
  if (state.error) {
    const unprovable = /no ownership proof can be constructed/.test(state.error);
    return (
      <div className="rejected">
        <div className="rejected-head">
          <span>✕</span>{" "}
          {unprovable ? "No valid proof exists" : "Rejected by the contract"}
        </div>
        <div className="rejected-msg">{state.error}</div>
        <div
          style={{
            fontSize: 12.5,
            color: "var(--text-faint)",
            marginTop: 10,
          }}
        >
          {unprovable
            ? "Refused before a proof could even be built — there is nothing to submit."
            : "Refused during local circuit execution. No transaction was submitted and nothing was spent."}
        </div>
      </div>
    );
  }
  if (state.result) {
    return (
      <div className="confirmed">
        <div className="confirmed-head">
          <span>✓</span> {doneLabel}
        </div>
        {children}
      </div>
    );
  }
  return null;
}
