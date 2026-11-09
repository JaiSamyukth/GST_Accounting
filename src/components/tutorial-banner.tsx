"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

export const TUTORIAL_KEY = "gst-tutorial-step";

/** While the tutorial is in progress, a one-line way back to it from any page. */
export function TutorialBanner() {
  const path = usePathname();
  const [step, setStep] = useState<number | null>(null);
  useEffect(() => {
    let n: number | null = null;
    try {
      const v = window.localStorage.getItem(TUTORIAL_KEY);
      n = v === null ? null : Number(v);
    } catch {
      n = null;
    }
    // Reading browser storage after navigation: an external system, so state is set here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStep(Number.isInteger(n) ? n : null);
  }, [path]);
  if (step === null || path === "/tutorial") return null;
  const stop = () => {
    try {
      window.localStorage.removeItem(TUTORIAL_KEY);
    } catch {
      /* ignore */
    }
    setStep(null);
  };
  return (
    <div className="notice">
      You are in the tutorial (step {step + 1}). <Link href="/tutorial">Back to the tutorial</Link> ·{" "}
      <button className="link" onClick={stop}>Hide this</button>
    </div>
  );
}
