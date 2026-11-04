import { useEffect, useLayoutEffect, useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";

type Step = { target?: string; mobileTarget?: string; title: string; text: string };
const STEPS: Step[] = [
  { title: "Welcome to your GST books", text: "This works like your order book. You write down each sale and each purchase bill, and the app adds up the GST and prepares the monthly returns. This tour takes one minute." },
  { target: "home", mobileTarget: "m-home", title: "This month", text: "Start here every day. It shows this month's sales, purchases and GST, and a checklist of what is left before the returns are filed." },
  { target: "sales", mobileTarget: "m-sales", title: "Sales", text: "Every bill you give a customer goes here, like a page of the order book: party name, date, number of plates, rate. GST is worked out for you." },
  { target: "purchases", mobileTarget: "m-purchases", title: "Purchases", text: "Enter supplier bills: provisions, oil, gas, plates. Take a photo of the bill and attach it, so everything is in one place." },
  { target: "returns", mobileTarget: "m-returns", title: "GST returns", text: "At month end, open the month here. Follow the eight steps: check, approve, download the file for the GST portal, and save the ARN after filing." },
  { target: "import", title: "Already have Excel sheets?", text: "Import old sales, purchases, customers or the GSTR-2B from the GST portal. The app checks every row before anything is saved, and you can undo an import." },
  { target: "guide", title: "Stuck? Open the guide", text: "Short answers in plain words: how to enter a bill, how to close the month, and what each GST word means. Words with a dotted underline explain themselves when you tap them." },
];

export function Tour({ onClose }: { onClose: () => void }) {
  const { user, setUser } = useAuth();
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const mobile = typeof window !== "undefined" && window.matchMedia("(max-width: 860px)").matches;
  const step = STEPS[i];
  const target = mobile ? step.mobileTarget : step.target;

  useLayoutEffect(() => {
    const el = target ? document.querySelector<HTMLElement>(`[data-tour="${target}"]`) : null;
    const update = () => setRect(el && el.offsetParent !== null ? el.getBoundingClientRect() : null);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [target]);

  const finish = async () => {
    onClose();
    if (user && !user.tutorial_done) {
      try {
        setUser(await api("/auth/me", { method: "PATCH", body: { tutorial_done: true } }));
      } catch { /* not critical */ }
    }
  };
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
      if (e.key === "ArrowRight") setI((x) => Math.min(x + 1, STEPS.length - 1));
      if (e.key === "ArrowLeft") setI((x) => Math.max(x - 1, 0));
    };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  });

  const cw = Math.min(360, window.innerWidth - 32);
  let cardStyle: React.CSSProperties = { left: (window.innerWidth - cw) / 2, top: Math.max(16, window.innerHeight / 2 - 150) };
  if (rect) {
    const w = Math.min(360, window.innerWidth - 32);
    if (mobile) cardStyle = { left: 16, bottom: window.innerHeight - rect.top + 16 };
    else cardStyle = { left: Math.min(rect.right + 20, window.innerWidth - w - 16), top: Math.max(16, Math.min(rect.top - 8, window.innerHeight - 260)) };
  }
  const last = i === STEPS.length - 1;
  return (
    <>
      {rect ? <div className="tour-ring" style={{ left: rect.left - 4, top: rect.top - 4, width: rect.width + 8, height: rect.height + 8 }} />
        : <div className="tour-ring" style={{ left: "50%", top: "50%", width: 0, height: 0 }} />}
      <div className="tour-card" role="dialog" aria-modal="true" aria-labelledby="tour-t" style={cardStyle} key={i}>
        <div className="count">Step {i + 1} of {STEPS.length}</div>
        <h2 className="h3" id="tour-t">{step.title}</h2>
        <p>{step.text}</p>
        <div className="btn-row" style={{ justifyContent: "space-between" }}>
          <button className="linkbtn" onClick={finish}>{last ? "Close" : "Skip the tour"}</button>
          <div className="btn-row">
            {i > 0 && <button className="btn quiet small" onClick={() => setI(i - 1)}>Back</button>}
            <button className="btn primary small" autoFocus onClick={() => (last ? finish() : setI(i + 1))}>{last ? "Start using it" : "Next"}</button>
          </div>
        </div>
      </div>
    </>
  );
}
