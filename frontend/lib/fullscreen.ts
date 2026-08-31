export function isAppDisplay() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    window.matchMedia("(display-mode: minimal-ui)").matches ||
    ("standalone" in navigator &&
      (navigator as Navigator & { standalone?: boolean }).standalone === true) ||
    Boolean(document.fullscreenElement || (document as Document & { webkitFullscreenElement?: Element }).webkitFullscreenElement)
  );
}

export function canRequestFullscreen() {
  if (typeof document === "undefined") return false;
  const el = document.documentElement as HTMLElement & {
    webkitRequestFullscreen?: () => Promise<void> | void;
  };
  return typeof el.requestFullscreen === "function" || typeof el.webkitRequestFullscreen === "function";
}

export async function enterAppFullscreen(): Promise<"ok" | "unsupported" | "denied"> {
  const el = document.documentElement as HTMLElement & {
    webkitRequestFullscreen?: () => void;
  };
  try {
    if (typeof el.requestFullscreen === "function") {
      await el.requestFullscreen({ navigationUI: "hide" });
      return "ok";
    }
    if (typeof el.webkitRequestFullscreen === "function") {
      el.webkitRequestFullscreen();
      return "ok";
    }
    return "unsupported";
  } catch {
    return "denied";
  }
}
