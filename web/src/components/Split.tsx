import type { ReactNode } from "react";

// The product argument, as a picture: the same moment, seen from the chain and seen
// from inside the company. It appears at every step of the tour so the contrast is
// the thing a reader remembers rather than the paragraph above it.

const Eye = () => (
  <svg viewBox="0 0 20 20" aria-hidden className="split-icon">
    <path
      d="M1.8 10S4.8 4.5 10 4.5 18.2 10 18.2 10 15.2 15.5 10 15.5 1.8 10 1.8 10Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
    />
    <circle cx="10" cy="10" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
  </svg>
);

const Lock = () => (
  <svg viewBox="0 0 20 20" aria-hidden className="split-icon">
    <rect
      x="4"
      y="8.6"
      width="12"
      height="8"
      rx="2"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
    />
    <path
      d="M6.9 8.6V6.6a3.1 3.1 0 0 1 6.2 0v2"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
    />
  </svg>
);

export default function Split({
  chain,
  who,
  only,
}: {
  chain: ReactNode;
  who: string;
  only: ReactNode;
}) {
  return (
    <div className="split">
      <div className="split-pane">
        <div className="split-title">
          <Eye /> What the whole world sees
        </div>
        <div className="split-body">{chain}</div>
      </div>
      <div className="split-pane private">
        <div className="split-title">
          <Lock /> What only {who} sees
        </div>
        <div className="split-body">{only}</div>
      </div>
    </div>
  );
}
