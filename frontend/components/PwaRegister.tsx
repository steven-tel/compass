"use client";

import { useEffect, useState } from "react";
import { canRequestFullscreen, enterAppFullscreen, isAppDisplay } from "@/lib/fullscreen";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isIosChrome() {
  return isIos() && /crios/i.test(navigator.userAgent);
}

export function PwaRegister() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [forced, setForced] = useState(false);
  const [ios, setIos] = useState(false);
  const [iosChrome, setIosChrome] = useState(false);
  const [fullscreenOk, setFullscreenOk] = useState(false);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
    if (isAppDisplay()) return;

    setIos(isIos());
    setIosChrome(isIosChrome());
    setFullscreenOk(canRequestFullscreen());
    setVisible(true);

    const onPrompt = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setVisible(false);
    const onFullscreen = () => {
      if (isAppDisplay()) {
        setVisible(false);
        setForced(false);
      }
    };
    const onAsk = () => {
      if (isAppDisplay()) return;
      setForced(true);
      setVisible(true);
      void tryFullscreen();
    };

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    document.addEventListener("fullscreenchange", onFullscreen);
    document.addEventListener("webkitfullscreenchange", onFullscreen);
    window.addEventListener("compass:fullscreen", onAsk);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      document.removeEventListener("fullscreenchange", onFullscreen);
      document.removeEventListener("webkitfullscreenchange", onFullscreen);
      window.removeEventListener("compass:fullscreen", onAsk);
    };
  }, []);

  async function tryFullscreen() {
    const result = await enterAppFullscreen();
    if (result === "ok") {
      setVisible(false);
      setForced(false);
    }
    return result;
  }

  async function install() {
    if (!installEvent) return;
    await installEvent.prompt();
    const choice = await installEvent.userChoice;
    setInstallEvent(null);
    if (choice.outcome === "accepted") setVisible(false);
  }

  if (!visible) return null;

  return (
    <div className={`pwa-install${forced ? " is-open" : ""}`}>
      <p>
        {iosChrome
          ? "Open this page in Safari, then Share → Add to Home Screen. Chrome on iPhone cannot hide the address bar."
          : ios
            ? "On iPhone, tap Share, then Add to Home Screen, and open Compass from your home screen. That is the only way to hide the address bar."
            : "Use Full screen now, or install Compass and open it from your home screen."}
      </p>
      <div className="pwa-install-actions">
        {fullscreenOk ? (
          <button type="button" className="pwa-install-btn" onClick={() => void tryFullscreen()}>
            Full screen
          </button>
        ) : null}
        {installEvent ? (
          <button type="button" className="pwa-install-btn ghost" onClick={() => void install()}>
            Install app
          </button>
        ) : null}
        <button type="button" className="pwa-install-dismiss" onClick={() => { setVisible(false); setForced(false); }}>
          Not now
        </button>
      </div>
    </div>
  );
}
