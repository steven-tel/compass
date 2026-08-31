"use client";

import { MathText } from "@/components/MathText";
import { observationLabel, type TranscriptTurn } from "@/lib/format";

function CompassAvatar() {
  return <img src="/compass-mark.svg" alt="" width={20} height={20} />;
}

function UserIcon() {
  return <img src="/avatar.png" alt="" width={42} height={42} />;
}

function EyeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M2.5 12s3.5-7 9.5-7 9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7Z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

export function TranscriptSheet({
  messages,
  onClose,
  title = "Conversation",
}: {
  messages: TranscriptTurn[];
  onClose: () => void;
  title?: string;
}) {
  return (
    <div className="transcript-sheet" role="dialog" aria-modal="true" aria-label={title}>
      <header>
        <strong>{title}</strong>
        <button className="transcript-close" type="button" onClick={onClose}>
          Close
        </button>
      </header>
      <div className="tutor-feed-list transcript-feed-list">
        {messages.length ? (
          messages.map((message, index) => (
            <div key={`${message.role}-${index}`} className={`tutor-feed-item ${message.role}`}>
              <div className="tutor-feed-who">
                <span
                  className={`tutor-avatar${
                    message.role === "user" ? " user" : message.role === "observation" ? " note" : ""
                  }`}
                >
                  {message.role === "gemini" ? (
                    <CompassAvatar />
                  ) : message.role === "observation" ? (
                    <EyeIcon />
                  ) : (
                    <UserIcon />
                  )}
                </span>
                <strong>
                  {message.role === "gemini"
                    ? "Compass"
                    : message.role === "observation"
                      ? observationLabel(message.kind)
                      : "You"}
                </strong>
              </div>
              <p>
                <MathText text={message.text} />
              </p>
            </div>
          ))
        ) : (
          <p className="tutor-feed-empty">No transcript saved.</p>
        )}
      </div>
    </div>
  );
}
