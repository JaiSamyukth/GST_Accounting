import { Link } from "react-router-dom";
import { ICheck } from "./icons";

export type Step = { key: string; label: string; done: boolean; detail: string };

const LINK: Record<string, (p: string) => string> = {
  sales: () => "/sales/new", purchases: () => "/purchases/new", itc: (p) => `/returns/${p}?tab=itc`, gstr1: (p) => `/returns/${p}?tab=gstr1`,
  gstr3b: (p) => `/returns/${p}?tab=gstr3b`, approve: (p) => `/returns/${p}?tab=file`, file: (p) => `/returns/${p}?tab=file`, arn: (p) => `/returns/${p}?tab=file`,
};

export function Steps({ steps, period }: { steps: Step[]; period: string }) {
  const next = steps.findIndex((s) => !s.done);
  return (
    <ol className="steps">
      {steps.map((s, i) => (
        <li key={s.key} className={`${s.done ? "done" : ""} ${i === next ? "next" : ""}`}>
          <span className="box" aria-hidden="true">{s.done ? <ICheck /> : i + 1}</span>
          <span>
            <b>{s.label}</b>
            {s.detail && <small>{s.detail}</small>}
            <span className="sr">{s.done ? " (done)" : " (to do)"}</span>
          </span>
          {i === next ? <Link className="btn small primary" to={LINK[s.key](period)}>Do this</Link>
            : !s.done ? <Link className="linkbtn small" to={LINK[s.key](period)}>Open<span className="sr"> {s.label}</span></Link> : <span />}
        </li>
      ))}
    </ol>
  );
}
