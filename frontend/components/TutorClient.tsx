"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { GeminiClient } from "@/lib/gemini-client";
import { MediaHandler } from "@/lib/media-handler";
import { waitForSessionReady, wsUrl } from "@/lib/api";
import { observationLabel } from "@/lib/format";
import { MathText } from "@/components/MathText";
import { SessionComputing } from "@/components/SessionComputing";
import { AtmosphereLights } from "@/components/AtmosphereLights";

type Phase = "idle" | "live" | "ended";
type ChatItem = { id: number; role: "user" | "gemini" | "observation"; text: string; kind?: string };
type OverlayItem = ChatItem & { leaving?: boolean };

const OVERLAY_LIMIT = 3;
const OVERLAY_HOLD_MS = 4500;
const OVERLAY_FADE_MS = 420;
const OVERLAY_OPACITY = [0.34, 0.62, 1];
const CLOSE_FADE_MS = 2200;

function BackArrow() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M11 6.2 5.2 12 11 17.8M5.2 12h14"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CompassAvatar({ size = 20 }: { size?: number }) {
  return (
    <img src="/compass-mark.svg" alt="" width={size} height={size} />
  );
}

function CameraIcon({ off }: { off?: boolean }) {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4.5 8.2A2.2 2.2 0 0 1 6.7 6h3.1l1.1-1.6h2.2L14.2 6h3.1a2.2 2.2 0 0 1 2.2 2.2v8.6A2.2 2.2 0 0 1 17.3 19H6.7A2.2 2.2 0 0 1 4.5 16.8V8.2Z"
        stroke="white"
        strokeWidth="1.8"
      />
      <circle cx="12" cy="12.4" r="3.1" stroke="white" strokeWidth="1.8" />
      {off ? (
        <path d="M5 19.5 19.5 5" stroke="white" strokeWidth="2" strokeLinecap="round" />
      ) : null}
    </svg>
  );
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

function MicIcon({ off }: { off?: boolean }) {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="9" y="3.5" width="6" height="11" rx="3" stroke="white" strokeWidth="1.8" />
      <path d="M6.5 11.5a5.5 5.5 0 0 0 11 0M12 17v3.2" stroke="white" strokeWidth="1.8" strokeLinecap="round" />
      {off ? (
        <path d="M5 19.5 19.5 5" stroke="white" strokeWidth="2" strokeLinecap="round" />
      ) : null}
    </svg>
  );
}

export function TutorClient({ autoStart = false }: { autoStart?: boolean }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [status, setStatus] = useState("Ready");
  const [fromHome, setFromHome] = useState(autoStart);
  const [leaving, setLeaving] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [micOn, setMicOn] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [messages, setMessages] = useState<ChatItem[]>([]);
  const [overlay, setOverlay] = useState<OverlayItem[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [startFailed, setStartFailed] = useState(false);
  const [feedOpen, setFeedOpen] = useState(false);
  const [dragOffset, setDragOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const feedListRef = useRef<HTMLDivElement>(null);
  const mediaRef = useRef<MediaHandler | null>(null);
  const clientRef = useRef<GeminiClient | null>(null);
  const endingRef = useRef(false);
  const cancelledRef = useRef(false);
  const closingUiRef = useRef(false);
  const endTimeoutRef = useRef<number | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const openedStatsRef = useRef(false);
  const userBubbleRef = useRef<number | null>(null);
  const modelBubbleRef = useRef<number | null>(null);
  const lastNoteRef = useRef("");
  const nextId = useRef(1);
  const dragStartY = useRef<number | null>(null);
  const dragOffsetRef = useRef(0);
  const dragged = useRef(false);
  const hideTimer = useRef<number | null>(null);
  const fadeTimer = useRef<number | null>(null);

  const connectRef = useRef<(...args: never[]) => Promise<void>>(async () => undefined);
  const connectingRef = useRef(false);

  useEffect(() => {
    const fromSwipe = autoStart || window.sessionStorage.getItem("compass.fromHome") === "1";
    if (!fromSwipe) return;
    setFromHome(true);
    const startAt = window.setTimeout(() => void connectRef.current(), 160);
    return () => window.clearTimeout(startAt);
  }, [autoStart]);

  function clearBubbleTimers() {
    if (hideTimer.current != null) window.clearTimeout(hideTimer.current);
    if (fadeTimer.current != null) window.clearTimeout(fadeTimer.current);
    hideTimer.current = null;
    fadeTimer.current = null;
  }

  function scheduleStackHide() {
    clearBubbleTimers();
    hideTimer.current = window.setTimeout(() => {
      setOverlay((items) => items.map((item) => ({ ...item, leaving: true })));
      fadeTimer.current = window.setTimeout(() => {
        setOverlay([]);
        fadeTimer.current = null;
      }, OVERLAY_FADE_MS);
      hideTimer.current = null;
    }, OVERLAY_HOLD_MS);
  }

  useEffect(() => {
    return () => {
      clientRef.current?.disconnect();
      mediaRef.current?.stopAudio();
      mediaRef.current?.stopVideo(videoRef.current);
      if (endTimeoutRef.current != null) window.clearTimeout(endTimeoutRef.current);
      clearBubbleTimers();
    };
  }, []);

  useEffect(() => {
    const list = feedListRef.current;
    if (list && feedOpen) list.scrollTop = list.scrollHeight;
  }, [messages, feedOpen]);

  function media() {
    if (!mediaRef.current) mediaRef.current = new MediaHandler();
    return mediaRef.current;
  }

  function append(role: "user" | "gemini", text: string, continueLast: boolean) {
    const current = role === "user" ? userBubbleRef : modelBubbleRef;
    if (continueLast && current.current != null) {
      const id = current.current;
      setMessages((items) =>
        items.map((item) => (item.id === id ? { ...item, text: item.text + text } : item))
      );
      setOverlay((items) => {
        const next = items.map((item) =>
          item.id === id ? { ...item, text: item.text + text, leaving: false } : item
        );
        return next.some((item) => item.id === id)
          ? next
          : [...next, { id, role, text, leaving: false }].slice(-OVERLAY_LIMIT);
      });
      scheduleStackHide();
      return;
    }
    const id = nextId.current;
    nextId.current += 1;
    current.current = id;
    const item = { id, role, text };
    setMessages((items) => [...items, item]);
    setOverlay((items) => [...items.filter((entry) => entry.id !== id), item].slice(-OVERLAY_LIMIT));
    scheduleStackHide();
  }

  function appendObservation(kind: string | undefined, text: string) {
    const note = text.trim();
    if (!note) return;
    const key = `${kind || ""}:${note.toLowerCase()}`;
    if (lastNoteRef.current === key) return;
    lastNoteRef.current = key;
    const id = nextId.current;
    nextId.current += 1;
    const item: ChatItem = { id, role: "observation", text: note, kind };
    setMessages((items) => [...items, item]);
    setOverlay((items) => [...items.filter((entry) => entry.id !== id), item].slice(-OVERLAY_LIMIT));
    scheduleStackHide();
  }

  async function startMedia() {
    const handler = media();
    if (videoRef.current) {
      try {
        await handler.startVideo(videoRef.current, (frame) => {
          if (clientRef.current?.isConnected() && !closingUiRef.current) {
            clientRef.current.sendImage(frame);
          }
        });
        setCamOn(true);
      } catch (error) {
        window.alert(MediaHandler.describeError(error, "Camera"));
      }
    }
    try {
      await handler.startAudio((data) => {
        if (clientRef.current?.isConnected() && !closingUiRef.current) {
          clientRef.current.send(data);
        }
      });
      setMicOn(true);
    } catch (error) {
      window.alert(MediaHandler.describeError(error, "Microphone"));
    }
  }

  function rememberSession(id?: string) {
    if (typeof id === "string" && id) {
      sessionIdRef.current = id;
      setSessionId(id);
    }
  }

  function openSessionStats() {
    const id = sessionIdRef.current;
    if (!id || openedStatsRef.current) return false;
    openedStatsRef.current = true;
    router.push(`/sessions/${encodeURIComponent(id)}?fresh=1`);
    return true;
  }

  function beginClosingUi() {
    if (closingUiRef.current) return;
    closingUiRef.current = true;
    setLeaving(true);
    setFeedOpen(false);
    setStatus("The live session has ended.");
    media().stopAudio();
    setMicOn(false);
    const fadeMs = window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? 200
      : CLOSE_FADE_MS;
    window.setTimeout(() => {
      media().stopVideo(videoRef.current);
      setCamOn(false);
    }, fadeMs);
  }

  async function cancelAndLeave() {
    if (cancelledRef.current) return;
    cancelledRef.current = true;
    endingRef.current = false;
    closingUiRef.current = true;
    if (endTimeoutRef.current != null) {
      window.clearTimeout(endTimeoutRef.current);
      endTimeoutRef.current = null;
    }
    media().stopAudio();
    media().stopVideo(videoRef.current);
    setMicOn(false);
    setCamOn(false);
    const client = clientRef.current;
    if (client?.isConnected()) {
      client.cancelSession();
      await new Promise((resolve) => window.setTimeout(resolve, 80));
      client.disconnect();
    }
    router.replace("/");
  }

  async function endAfterGoodbye() {
    if (cancelledRef.current || endingRef.current) return;
    endingRef.current = true;
    if (endTimeoutRef.current != null) {
      window.clearTimeout(endTimeoutRef.current);
      endTimeoutRef.current = null;
    }
    beginClosingUi();
    await media().waitUntilPlaybackIdle(4000);
    clientRef.current?.disconnect();
    const id = sessionIdRef.current;
    if (id && !cancelledRef.current) {
      await waitForSessionReady(id);
      if (!cancelledRef.current) openSessionStats();
    }
  }

  async function connect() {
    if (connectingRef.current || clientRef.current?.isConnected()) return;
    connectingRef.current = true;
    clientRef.current?.disconnect();
    setBusy(true);
    setStartFailed(false);
    setStatus("Connecting…");
    try {
      await media().initializeAudio();
      const client = new GeminiClient({
        onOpen: () => {
          setPhase("live");
          setStatus("Connected");
          setBusy(false);
          window.sessionStorage.removeItem("compass.fromHome");
          void startMedia();
        },
        onMessage: (event) => {
          if (typeof event.data !== "string") {
            media().playAudio(event.data as ArrayBuffer);
            return;
          }
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === "session_start") {
              rememberSession(msg.session_id);
            } else if (msg.type === "interrupted") {
              if (!endingRef.current) media().stopAudioPlayback();
              userBubbleRef.current = null;
              modelBubbleRef.current = null;
            } else if (msg.type === "turn_complete") {
              userBubbleRef.current = null;
              modelBubbleRef.current = null;
            } else if (msg.type === "session_end") {
              if (cancelledRef.current) return;
              rememberSession(msg.session_id);
              endAfterGoodbye();
            } else if (msg.type === "user") {
              if (!closingUiRef.current) {
                append("user", msg.text, userBubbleRef.current != null);
              }
            } else if (msg.type === "gemini") {
              append("gemini", msg.text, modelBubbleRef.current != null);
            } else if (msg.type === "observation") {
              if (!closingUiRef.current) {
                appendObservation(typeof msg.kind === "string" ? msg.kind : undefined, msg.text || "");
              }
            }
          } catch {
            // ignore non-json
          }
        },
        onClose: () => {
          if (cancelledRef.current) return;
          const finished = endingRef.current;
          setMicOn(false);
          setCamOn(false);
          setFeedOpen(false);
          setOverlay([]);
          clearBubbleTimers();
          media().stopAudio();
          media().stopVideo(videoRef.current);
          if (finished) return;
          endingRef.current = false;
          setLeaving(false);
          setStatus("Disconnected");
          setPhase("ended");
        },
        onError: () => {
          connectingRef.current = false;
          setStatus("Connection error");
          setBusy(false);
          setStartFailed(true);
        },
      });
      clientRef.current = client;
      client.connect(wsUrl());
    } catch (error) {
      connectingRef.current = false;
      setStatus(error instanceof Error ? error.message : "Connection failed");
      setBusy(false);
      setStartFailed(true);
    }
  }
  connectRef.current = connect;

  async function toggleMic() {
    if (closingUiRef.current) return;
    const handler = media();
    if (handler.isRecording) {
      handler.stopAudio();
      setMicOn(false);
      return;
    }
    try {
      await handler.startAudio((data) => {
        if (clientRef.current?.isConnected() && !closingUiRef.current) {
          clientRef.current.send(data);
        }
      });
      setMicOn(true);
    } catch (error) {
      window.alert(MediaHandler.describeError(error, "Microphone"));
    }
  }

  async function toggleCamera() {
    if (closingUiRef.current) return;
    const handler = media();
    if (camOn) {
      handler.stopVideo(videoRef.current);
      setCamOn(false);
      return;
    }
    try {
      if (!videoRef.current) return;
      await handler.startVideo(videoRef.current, (frame) => {
        if (clientRef.current?.isConnected() && !closingUiRef.current) {
          clientRef.current.sendImage(frame);
        }
      });
      setCamOn(true);
    } catch (error) {
      window.alert(MediaHandler.describeError(error, "Camera"));
    }
  }

  function sendText() {
    const text = draft.trim();
    if (!text || closingUiRef.current || !clientRef.current?.isConnected()) return;
    clientRef.current.sendText(text);
    append("user", text, false);
    userBubbleRef.current = null;
    setDraft("");
  }

  function reset() {
    connectingRef.current = false;
    media().stopAudio();
    media().stopVideo(videoRef.current);
    setMessages([]);
    setOverlay([]);
    clearBubbleTimers();
    setPhase("idle");
    setStatus("Ready");
    setMicOn(false);
    setCamOn(false);
    setFeedOpen(false);
    endingRef.current = false;
    cancelledRef.current = false;
    closingUiRef.current = false;
    if (endTimeoutRef.current != null) {
      window.clearTimeout(endTimeoutRef.current);
      endTimeoutRef.current = null;
    }
    sessionIdRef.current = null;
    setSessionId(null);
    openedStatsRef.current = false;
    setLeaving(false);
  }

  function onHandlePointerDown(event: ReactPointerEvent) {
    dragged.current = false;
    dragStartY.current = event.clientY;
    dragOffsetRef.current = 0;
    setDragging(true);
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function onHandlePointerMove(event: ReactPointerEvent) {
    if (dragStartY.current == null) return;
    const delta = event.clientY - dragStartY.current;
    if (Math.abs(delta) > 8) dragged.current = true;
    const next = feedOpen ? Math.max(0, delta) : Math.min(0, delta);
    dragOffsetRef.current = next;
    setDragOffset(next);
  }

  function finishHandleGesture(toggleIfTap: "open" | "close") {
    if (dragStartY.current == null) return;
    const offset = dragOffsetRef.current;
    if (feedOpen && offset > 70) setFeedOpen(false);
    else if (!feedOpen && offset < -50) setFeedOpen(true);
    else if (!dragged.current) setFeedOpen(toggleIfTap === "open");
    dragStartY.current = null;
    dragOffsetRef.current = 0;
    setDragging(false);
    setDragOffset(0);
  }

  const sheetShift = feedOpen ? dragOffset : Math.max(dragOffset, -220);
  const sheetTransform = feedOpen
    ? `translateY(${sheetShift}px)`
    : `translateY(calc(100% + ${sheetShift}px))`;

  return (
    <main className={`tutor-view${leaving ? " is-closing" : ""}${fromHome ? " from-home" : ""}`}>
      <AtmosphereLights />
      <video ref={videoRef} className={`tutor-video${camOn ? " is-on" : ""}`} autoPlay playsInline muted />
      <div className="tutor-close-veil" aria-hidden="true" />
      {!camOn && !leaving && (
        <div className="tutor-fallback">
          {phase === "live" ? (
            <p>Turn on video so the tutor can see the exercise.</p>
          ) : null}
        </div>
      )}

      <header className="tutor-top" key={phase}>
        {phase === "live" ? (
          <button
            type="button"
            className="session-back tutor-back"
            aria-label="Cancel session"
            onClick={() => void cancelAndLeave()}
          >
            <BackArrow />
          </button>
        ) : (
          <Link href="/" className="session-back tutor-back" aria-label="Back to home">
            <BackArrow />
          </Link>
        )}
        <span className={`tutor-live-pill${phase === "live" && !leaving ? " is-live" : ""}`}>
          <i />
          {leaving || phase === "ended" ? "Ended" : phase === "live" ? "Live Session" : "Compass"}
        </span>
      </header>

      {phase === "idle" && (
        <div className="tutor-start">
          {fromHome && !startFailed ? (
            <p>Starting your session…</p>
          ) : (
            <>
              <p>Point your camera at the exercise and talk with your tutor.</p>
              <button className="tutor-start-btn" type="button" onClick={connect} disabled={busy}>
                {busy ? "Connecting…" : "Start tutoring"}
              </button>
            </>
          )}
        </div>
      )}

      {leaving && phase === "live" && (
        <div className="tutor-ended">
          <SessionComputing />
        </div>
      )}

      {phase === "ended" && (
        <div className="tutor-ended">
          <SessionComputing />
          <button className="tutor-start-btn" type="button" onClick={reset}>
            New session
          </button>
          {sessionId ? (
            <Link
              href={`/sessions/${encodeURIComponent(sessionId)}?fresh=1`}
              className="tutor-ended-link"
            >
              View session
            </Link>
          ) : (
            <Link href="/sessions" className="tutor-ended-link">
              View sessions
            </Link>
          )}
        </div>
      )}

      {phase === "live" && !feedOpen && !leaving && overlay.length > 0 && (
        <div className="tutor-live-stack">
          {overlay.map((item, index) => {
            const depth = overlay.length - 1 - index;
            const opacity = OVERLAY_OPACITY[OVERLAY_OPACITY.length - 1 - depth] ?? 1;
            return (
              <div
                key={item.id}
                className={`tutor-live-wrap${item.leaving ? " is-leaving" : ""}`}
                style={item.leaving ? undefined : { opacity }}
              >
                <div
                  className={`tutor-live-bubble${
                    item.role === "user" ? " is-user" : item.role === "observation" ? " is-note" : ""
                  }`}
                >
                  {item.role === "gemini" ? (
                    <span className="tutor-avatar">
                      <CompassAvatar />
                    </span>
                  ) : item.role === "observation" ? (
                    <span className="tutor-avatar note">
                      <EyeIcon />
                    </span>
                  ) : null}
                  <div className="tutor-live-copy">
                    <strong>
                      {item.role === "gemini"
                        ? "Compass"
                        : item.role === "observation"
                          ? observationLabel(item.kind)
                          : "You"}
                    </strong>
                    <p>
                      <MathText text={item.text} />
                    </p>
                  </div>
                  {item.role === "user" ? (
                    <span className="tutor-avatar user">
                      <UserIcon />
                    </span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {phase === "live" && !leaving && (
        <div className="tutor-controls">
          <button
            type="button"
            className={`tutor-ctl${camOn ? "" : " is-off"}`}
            onClick={toggleCamera}
            disabled={leaving}
          >
            <span className="tutor-round">
              <CameraIcon off={!camOn} />
            </span>
            <span>{camOn ? "Video On" : "Video Off"}</span>
          </button>
          <button
            type="button"
            className={`tutor-ctl${micOn ? "" : " is-off"}`}
            onClick={toggleMic}
            disabled={leaving}
          >
            <span className="tutor-round">
              <MicIcon off={!micOn} />
            </span>
            <span>{micOn ? "Mic On" : "Mic Off"}</span>
          </button>
        </div>
      )}

      {phase === "live" && !leaving && (
        <>
          <div
            className="tutor-handle-hit"
            onPointerDown={onHandlePointerDown}
            onPointerMove={onHandlePointerMove}
            onPointerUp={() => finishHandleGesture("open")}
            onPointerCancel={() => finishHandleGesture("open")}
          >
            <div className="tutor-handle" />
          </div>

          <button
            type="button"
            className={`tutor-feed-backdrop${feedOpen ? " is-open" : ""}`}
            aria-label="Close conversation"
            onClick={() => setFeedOpen(false)}
          />

          <section
            className={`tutor-feed${feedOpen ? " is-open" : ""}`}
            style={{
              transform: sheetTransform,
              transition: dragging ? "none" : undefined,
            }}
          >
            <div
              className="tutor-handle-hit sheet"
              onPointerDown={onHandlePointerDown}
              onPointerMove={onHandlePointerMove}
              onPointerUp={() => finishHandleGesture("close")}
              onPointerCancel={() => finishHandleGesture("close")}
            >
              <div className="tutor-handle" />
            </div>
            <h3>Conversation</h3>
            <div className="tutor-feed-list" ref={feedListRef}>
              {messages.length ? (
                messages.map((message) => (
                  <div key={message.id} className={`tutor-feed-item ${message.role}`}>
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
                <p className="tutor-feed-empty">Messages will appear here as you talk.</p>
              )}
            </div>
            <div className="tutor-composer">
              <input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") sendText();
                }}
                placeholder="Type a message"
              />
              <button type="button" onClick={sendText}>
                Send
              </button>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
