"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MediaHandler } from "@/lib/media-handler";
import { AtmosphereLights } from "@/components/AtmosphereLights";

function ClockIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8.1" stroke="white" strokeWidth="1.7" />
      <path d="M12 7.8V12l3.1 1.9" stroke="white" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ExpandIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M8.5 4.5H4.5V8.5M15.5 4.5H19.5V8.5M8.5 19.5H4.5V15.5M15.5 19.5H19.5V15.5"
        stroke="white"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CompassLogo() {
  return (
    <svg className="home-logo" viewBox="0 0 256 256" width={128} height={128} aria-hidden="true">
      <defs>
        <mask id="splash-needle-mask">
          <rect width="256" height="256" fill="white" />
          <circle cx="128" cy="128" r="9" fill="black" />
        </mask>
      </defs>
      <circle cx="128" cy="128" r="84" fill="none" stroke="#FFFFFF" strokeWidth="10" />
      <g className="home-logo-needle">
        <path
          d="M177 79 L141 145 L79 177 L115 111 Z"
          fill="#FFFFFF"
          mask="url(#splash-needle-mask)"
        />
      </g>
    </svg>
  );
}

function swipeLimit() {
  if (typeof window === "undefined") return 280;
  return Math.max(220, window.innerHeight * 0.42);
}

export function HomeView() {
  const router = useRouter();
  const [splash, setSplash] = useState(true);
  const [drag, setDrag] = useState(0);
  const [holding, setHolding] = useState(false);
  const [launching, setLaunching] = useState(false);
  const startY = useRef<number | null>(null);
  const dragRef = useRef(0);
  const launchingRef = useRef(false);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const hold = window.setTimeout(() => setSplash(false), reduce ? 400 : 2400);
    return () => window.clearTimeout(hold);
  }, []);

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (splash || launchingRef.current) return;
    startY.current = event.clientY;
    dragRef.current = 0;
    setHolding(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (splash || startY.current == null || launchingRef.current) return;
    const raw = Math.max(0, startY.current - event.clientY);
    const limit = swipeLimit();
    const next = raw < limit ? raw : limit + (raw - limit) * 0.18;
    dragRef.current = next;
    setDrag(next);
  }

  function finishGesture() {
    if (splash || startY.current == null || launchingRef.current) return;
    startY.current = null;
    if (dragRef.current >= swipeLimit() * 0.38) {
      launchingRef.current = true;
      setLaunching(true);
      window.sessionStorage.setItem("compass.fromHome", "1");
      void MediaHandler.primeAccess();
      window.setTimeout(() => router.push("/tutor?start=1"), 780);
      return;
    }
    dragRef.current = 0;
    setHolding(false);
    setDrag(0);
  }

  const active = holding || launching || drag > 0;
  const progress = Math.min(1, drag / swipeLimit());
  const fade = launching ? 1 : progress;

  return (
    <main className={`home-view${splash ? " is-splash" : ""}${launching ? " is-launching" : ""}`}>
      <AtmosphereLights />
      <div className="home-splash" aria-hidden={!splash}>
        <div className="home-splash-mark">
          <CompassLogo />
          <p className="home-splash-name">Compass</p>
        </div>
      </div>

      <header className="home-top" style={{ opacity: 1 - fade, transform: `translateY(${fade * -12}px)` }}>
        <Link href="/concepts" className="home-user" aria-label="Profile">
          <img src="/avatar.png" alt="" width={32} height={32} />
          <span>Chris</span>
        </Link>
        <div className="home-top-actions">
          <button
            type="button"
            className="home-clock home-fullscreen"
            aria-label="Full screen"
            onClick={() => window.dispatchEvent(new Event("compass:fullscreen"))}
          >
            <ExpandIcon />
          </button>
          <Link href="/sessions" className="home-clock" aria-label="Homework">
            <ClockIcon />
          </Link>
        </div>
      </header>

      <div
        className="home-welcome"
        style={{ opacity: 1 - fade, transform: `translateY(${fade * -24}px) scale(${1 - fade * 0.06})` }}
      >
        <h1 className="home-hello">
          <strong>Hi Chris,</strong>
          <span>Ready to study?</span>
        </h1>
        <p className="home-hint">Place your phone above your desk to get ready</p>
      </div>

      <div
        className={`home-arc${active ? " is-dragging" : ""}${launching ? " is-expanding" : ""}`}
        style={
          launching
            ? undefined
            : active
              ? {
                  transform: `translate3d(0, calc(100% - var(--arc-peek) - env(safe-area-inset-bottom, 0px) - ${drag}px), 0) scale(${1 + progress * 0.22})`,
                }
              : undefined
        }
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishGesture}
        onPointerCancel={finishGesture}
      >
        <div className="home-arc-face" style={{ opacity: launching ? 0 : 1 - progress * 0.35 }}>
          <p>Swipe up to start</p>
        </div>
      </div>
    </main>
  );
}
