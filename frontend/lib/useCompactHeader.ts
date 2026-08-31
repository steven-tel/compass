"use client";

import { useEffect, useRef, useState } from "react";

export function useCompactHeader() {
  const [compactHeader, setCompactHeader] = useState(false);
  const compactRef = useRef(false);
  const headerLockedRef = useRef(false);

  useEffect(() => {
    let unlockTimer = 0;
    const onScroll = () => {
      if (headerLockedRef.current) return;
      const y = window.scrollY;
      const next = compactRef.current ? y > 2 : y > 24;
      if (next === compactRef.current) return;

      headerLockedRef.current = true;
      const yBefore = y;
      compactRef.current = next;
      setCompactHeader(next);

      requestAnimationFrame(() => {
        if (next && window.scrollY < 24) {
          window.scrollTo({ top: Math.max(yBefore, 24), behavior: "auto" });
        }
        unlockTimer = window.setTimeout(() => {
          headerLockedRef.current = false;
        }, 400);
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.clearTimeout(unlockTimer);
    };
  }, []);

  return compactHeader;
}
