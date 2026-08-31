"use client";

import { useEffect, useId, useState } from "react";

const LINES = [
  "Nice work — wrapping this up…",
  "Looking over what you practiced…",
  "Finding each exercise…",
  "Noting how it went…",
  "Putting your recap together…",
];

function CompassMark({ maskId }: { maskId: string }) {
  return (
    <svg className="session-computing-logo" viewBox="0 0 256 256" width={88} height={88} aria-hidden="true">
      <defs>
        <mask id={maskId}>
          <rect width="256" height="256" fill="white" />
          <circle cx="128" cy="128" r="9" fill="black" />
        </mask>
      </defs>
      <circle cx="128" cy="128" r="84" fill="none" stroke="white" strokeWidth="10" />
      <g className="session-computing-needle">
        <path d="M177 79 L141 145 L79 177 L115 111 Z" fill="white" mask={`url(#${maskId})`} />
      </g>
    </svg>
  );
}

export function SessionComputing({
  headline = "Putting it all together",
}: {
  headline?: string;
}) {
  const maskId = `computing-needle-${useId().replace(/:/g, "")}`;
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % LINES.length);
    }, 2800);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="session-computing">
      <CompassMark maskId={maskId} />
      <h2>{headline}</h2>
      <p key={index}>{LINES[index]}</p>
      <span className="session-computing-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    </div>
  );
}
