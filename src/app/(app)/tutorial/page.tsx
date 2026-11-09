"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useApp } from "@/components/shell";
import { TUTORIAL_KEY } from "@/components/tutorial-banner";

interface Step {
  title: string;
  body: React.ReactNode;
  action?: { href: string; label: string };
}

const STEPS: Step[] = [
  {
    title: "Welcome",
    body: (
      <>
        <p>This app keeps your GST accounts: the sales you make, the bills you pay, and the two returns you file each month (GSTR-1 and GSTR-3B).</p>
        <p>The tutorial takes about 10 minutes. Each step explains one part and has a button to open that page. Try it, then come back with <b>Back to the tutorial</b> at the top of the screen.</p>
        <p>You can skip it now and open it again any time from <b>Settings</b> or <b>More</b>.</p>
      </>
    ),
  },
  {
    title: "Your business details",
    body: (
      <>
        <p>Do this once. Open <b>Settings</b> and fill in <b>Business</b>:</p>
        <ul>
          <li>Legal name and GSTIN (PAN fills itself), address and state.</li>
          <li><b>Files returns</b>: monthly, or quarterly if you are in the QRMP scheme.</li>
          <li><b>Current financial year</b>.</li>
          <li>Tick <b>5% without input tax credit</b> if your catering is billed at 5% without ITC. Ask your accountant if unsure.</li>
        </ul>
        <p>Only the owner can change these. Click <b>Save business settings</b>.</p>
      </>
    ),
    action: { href: "/settings", label: "Open Settings" },
  },
  {
    title: "Customers and suppliers",
    body: (
      <>
        <p>Add the people you deal with often. Then their details fill in by themselves when you type their name on a bill.</p>
        <ul>
          <li>Go to <b>More → Customers and suppliers</b> and click <b>Add customer</b> or <b>Add supplier</b>.</li>
          <li>A GSTIN is only needed for registered businesses. Leave it empty for individuals.</li>
          <li>Have a list in Excel? You can bring it in at once from <b>More → Import and export</b>.</li>
        </ul>
      </>
    ),
    action: { href: "/parties", label: "Open Customers and suppliers" },
  },
  {
    title: "Make a sale (invoice)",
    body: (
      <>
        <ol>
          <li>Go to <b>Sales → New invoice</b>. The number is suggested for you.</li>
          <li>Type the customer&apos;s name. Saved customers fill in by themselves.</li>
          <li>For each item, fill <b>Description</b>, <b>HSN/SAC</b> (outdoor catering is <b>996334</b>), <b>Qty</b>, <b>Rate</b> and <b>GST</b>. The tax and total appear as you type.</li>
          <li>Click <b>Save</b>, then <b>Print / download PDF</b> to give the customer their invoice.</li>
        </ol>
        <p>Rates include GST? Open <b>More options</b> on the invoice and choose <b>Prices are: Including GST</b>.</p>
      </>
    ),
    action: { href: "/sales/new", label: "Make a sale now" },
  },
  {
    title: "When a sale needs correcting",
    body: (
      <ul>
        <li><b>Before the month is filed:</b> open the invoice from <b>Sales</b>, change it and save. If it should not exist at all, click <b>Cancel document</b>.</li>
        <li><b>Customer paid less, or fewer plates were served:</b> make a <b>credit note</b> (Sales → New credit note) against the original invoice number.</li>
        <li><b>After the month is filed:</b> the invoice is locked. Open it and click <b>Amend</b>. The correction is reported in the month you are filing now.</li>
      </ul>
    ),
  },
  {
    title: "Enter a purchase bill",
    body: (
      <>
        <ol>
          <li>Go to <b>Purchases → New purchase bill</b>.</li>
          <li>Type the supplier&apos;s bill number and date, the supplier&apos;s name and GSTIN, and the items as printed on their bill.</li>
          <li>Keep <b>Claim</b> ticked if you can take input tax credit (ITC) on that item; untick it if not.</li>
          <li>Click <b>Save</b>. Then, if you like, attach a photo of the bill in the <b>Attachments</b> box underneath.</li>
        </ol>
      </>
    ),
    action: { href: "/purchases/new", label: "Enter a bill now" },
  },
  {
    title: "The Home page",
    body: (
      <p>
        <b>Home</b> shows this month at a glance: how many sales and bills you have entered, the tax on your sales, the credit from your
        bills, roughly what you will pay, and when the returns are due. It also warns you if last month&apos;s returns were not filed.
      </p>
    ),
    action: { href: "/", label: "Open Home" },
  },
  {
    title: "Month end, part 1: check",
    body: (
      <>
        <p>After the month ends, open <b>Returns</b> and click the month. Work down the numbered steps:</p>
        <ol>
          <li>Read any notices at the top and fix them (for example a missing HSN code).</li>
          <li>On the GST portal, download <b>GSTR-2B</b> for the month (Returns → GSTR-2B → Download JSON) and load it in step 2. The app shows which supplier bills match, which differ, and which are missing.</li>
          <li>Make sure the <b>GSTR-1 vs GSTR-3B</b> check shows no differences.</li>
        </ol>
      </>
    ),
    action: { href: "/returns", label: "Open Returns" },
  },
  {
    title: "Month end, part 2: file",
    body: (
      <ol>
        <li>The owner clicks <b>Approve</b>.</li>
        <li>Download the <b>GSTR-1 JSON</b>. On the GST portal open GSTR-1 → <b>Prepare offline</b> → <b>Upload</b>, check the summary, then submit and file.</li>
        <li>Download the <b>GSTR-3B PDF</b> and use it to fill GSTR-3B on the portal. Pay any tax due, then file.</li>
        <li>Back in the app, type each <b>ARN</b> (the acknowledgement number from the portal) and mark the returns filed. The month then <b>locks</b>, so filed figures cannot change by accident.</li>
      </ol>
    ),
  },
  {
    title: "Reports, Excel and importing",
    body: (
      <ul>
        <li><b>More → Reports</b>: sales and purchase registers, tax summaries and more, as PDF or Excel. Handy for your accountant.</li>
        <li><b>More → Import and export</b>: bring in sales, bills or customers from Excel (download a template first), or export your data to Excel.</li>
      </ul>
    ),
    action: { href: "/reports", label: "Open Reports" },
  },
  {
    title: "Your accountant, and backups",
    body: (
      <ul>
        <li><b>Settings → Users</b>: add your accountant. The app gives a link; send it to them to set their own password.</li>
        <li><b>Settings → Backup</b>: after filing each month, click <b>Download backup</b> and keep the file safe.</li>
      </ul>
    ),
    action: { href: "/settings", label: "Open Settings" },
  },
  {
    title: "You're ready",
    body: (
      <>
        <p>That&apos;s everything. Start by entering last month&apos;s sales and bills, and compare the Returns page with what was actually filed. Show your accountant the GSTR-1 and GSTR-3B PDFs before relying on the app for a real filing.</p>
        <p>You can open this tutorial again any time from <b>Settings</b> or <b>More</b>.</p>
      </>
    ),
  },
];

function savedStep(): number {
  try {
    const n = Number(window.localStorage.getItem(TUTORIAL_KEY));
    return Number.isInteger(n) && n >= 0 && n < STEPS.length ? n : 0;
  } catch {
    return 0;
  }
}

function saveStep(n: number | null): void {
  try {
    if (n === null) window.localStorage.removeItem(TUTORIAL_KEY);
    else window.localStorage.setItem(TUTORIAL_KEY, String(n));
  } catch {
    /* storage unavailable: the tutorial simply starts from step 1 next time */
  }
}

export default function TutorialPage() {
  const { setTutorialDone } = useApp();
  const router = useRouter();
  const [i, setI] = useState(() => (typeof window === "undefined" ? 0 : savedStep()));
  const step = STEPS[i];
  const go = (n: number) => {
    setI(n);
    saveStep(n);
    window.scrollTo(0, 0);
  };
  const finish = async () => {
    saveStep(null);
    await setTutorialDone(true).catch(() => undefined);
    router.push("/");
  };

  return (
    <div className="tutorial">
      <h1>{step.title}</h1>
      <p className="progress">Tutorial · step {i + 1} of {STEPS.length}</p>
      {step.body}
      {step.action ? (
        <p>
          <Link className="button big" href={step.action.href} onClick={() => saveStep(i)}>{step.action.label}</Link>
        </p>
      ) : null}
      <div className="actions">
        {i > 0 ? <button className="big" onClick={() => go(i - 1)}>Back</button> : null}
        {i < STEPS.length - 1
          ? <button className="primary big" onClick={() => go(i + 1)}>Next</button>
          : <button className="primary big" onClick={finish}>Finish</button>}
        {i < STEPS.length - 1 ? <button className="link" onClick={finish}>Skip the tutorial</button> : null}
      </div>
      <details className="more">
        <summary>All steps</summary>
        <ol>
          {STEPS.map((s, n) => (
            <li key={s.title}>{n === i ? <b>{s.title}</b> : <button className="link" onClick={() => go(n)}>{s.title}</button>}</li>
          ))}
        </ol>
      </details>
    </div>
  );
}
