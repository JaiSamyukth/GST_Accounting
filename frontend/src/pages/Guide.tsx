import { useState } from "react";
import { Link } from "react-router-dom";
import { GLOSSARY } from "../lib/glossary";
import { useTitle } from "../lib/hooks";
import { IBook } from "../components/icons";

const HOWTO: { id: string; q: string; a: React.ReactNode }[] = [
  { id: "sale", q: "Enter a sale from the order book", a: <ol>
    <li>Tap <b>Sales</b>, then <b>New sale bill</b>. The bill number fills in by itself.</li>
    <li>Write the <b>party name</b>. If the customer has a GSTIN (a company or hall), type it; otherwise leave it empty.</li>
    <li>Use <b>+ Morning meal</b>, <b>+ Afternoon meal</b> or <b>+ Night meal</b>. Put the number of members in <b>Plates / qty</b> and the rate per plate in <b>Rate</b>.</li>
    <li>Add <b>+ Service charge</b> and <b>+ Transport charge</b> if they are on the paper bill. They are taxed like the food.</li>
    <li>If the rate you agreed already includes GST, choose <b>Including GST</b> under the lines.</li>
    <li>Check the total at the bottom, then <b>Save bill</b>. Attach a photo of the paper copy if you like.</li>
  </ol> },
  { id: "purchase", q: "Enter a purchase bill", a: <ol>
    <li>Tap <b>Purchases</b>, then <b>New purchase bill</b>.</li>
    <li>Write the supplier name and their GSTIN from the top of the bill, and the bill number and date.</li>
    <li>One line per item, or one line for the whole bill per GST rate. Vegetables and milk are <b>Nil rated</b>.</li>
    <li>The <b>Credit</b> column says whether the GST can be claimed. If you charge 5% without ITC, it stays at <b>No claim</b>. Leave it on Auto unless your accountant says otherwise.</li>
    <li>Tap <b>Attach photo or PDF of the bill</b>, then <b>Save bill</b>.</li>
  </ol> },
  { id: "note", q: "Fewer plates were served after billing", a: <p>Do not edit the old bill once the month is filed. Make a <b>credit note</b>: Sales, <b>Credit or debit note</b>, choose Credit note, write the original bill number and the plates or amount to reduce. For extra plates, make a <b>debit note</b>.</p> },
  { id: "month", q: "Close the month and file GST", a: <ol>
    <li>By the 10th, make sure every sale and purchase bill of last month is entered.</li>
    <li>Open <b>GST returns</b> and the month. The <b>Checklist</b> tab shows what is left.</li>
    <li>Download GSTR-2B from the GST portal and import it. Look at <b>Match with GSTR-2B</b>.</li>
    <li>Check the <b>GSTR-1</b> tab. Fix anything marked <b>Fix</b> (usually a missing HSN code or a wrong GSTIN).</li>
    <li>The owner taps <b>Approve</b> on <b>File and save ARN</b>.</li>
    <li>Download the GSTR-1 JSON, upload it on the portal and file it by the 11th.</li>
    <li>Pay the cash amount shown in GSTR-3B and file GSTR-3B by the 20th.</li>
    <li>Type both <b>ARN</b> numbers into the app and attach the acknowledgements. The month then locks.</li>
  </ol> },
  { id: "import", q: "Bring in old records from Excel", a: <p>Open <b>Import from Excel</b>, choose what you are importing and download the template if you have nothing yet. Your own columns can have any names; you match them in step 3. Every row is checked (GSTIN, dates, rates, tax, duplicates) and you see the problems before anything is saved. If something went wrong, <b>Undo</b> removes exactly what that import added.</p> },
  { id: "accountant", q: "Give the accountant access", a: <p>Owner only: <b>Settings</b>, <b>Users</b>, <b>Add a person</b>. Send the link that appears on WhatsApp; it lets them set a password. Accountants can enter bills, import and prepare returns. Only the owner can approve a month, change business settings, or unlock a filed month.</p> },
  { id: "mistake", q: "I made a mistake in a filed month", a: <p>Open the bill and save it; the app says the month is filed and offers <b>Correct it as an amendment</b>. The corrected bill is reported in the current month's GSTR-1 as an amendment, which is how GST law wants it. The filed month stays as filed.</p> },
  { id: "rate", q: "Which GST rate do I charge?", a: <p>The app starts with outdoor catering (SAC 996334) at <b>5% without input tax credit</b>, which is what most outdoor caterers pay. Catering at hotels with rooms of ₹7,500 or more a night, or bundled with the hall rent, can be 18% with credit. Rates are changed by law from time to time, so ask your accountant and set them in <b>Settings</b>, <b>HSN / SAC codes</b>.</p> },
];

export function Guide() {
  useTitle("Guide");
  const [open, setOpen] = useState<string | null>("sale");
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="h1">Guide</h1>
          <p className="lede muted">Short answers for everyday work. Words with a dotted underline anywhere in the app explain themselves when tapped.</p>
        </div>
        <button className="btn" onClick={() => window.dispatchEvent(new Event("dc:tour"))}><IBook />Show me around again</button>
      </div>
      <div className="month-grid">
        <section className="sheet" aria-labelledby="how">
          <div className="sheet-head"><h2 className="h2" id="how">How do I…</h2></div>
          <div>
            {HOWTO.map((h) => (
              <div key={h.id} style={{ borderBottom: "1px solid var(--rule-2)" }}>
                <h3 style={{ margin: 0 }}>
                  <button aria-expanded={open === h.id} aria-controls={`a-${h.id}`} onClick={() => setOpen(open === h.id ? null : h.id)}
                    style={{ width: "100%", textAlign: "left", background: open === h.id ? "var(--carbon-2)" : "none", border: 0, padding: "16px 24px", cursor: "pointer", font: "600 17px/1.3 var(--sans)", color: "var(--ink)", display: "flex", justifyContent: "space-between", gap: 12 }}>
                    {h.q}<span aria-hidden="true">{open === h.id ? "−" : "+"}</span>
                  </button>
                </h3>
                {open === h.id && <div id={`a-${h.id}`} className="prose" style={{ padding: "4px 24px 18px" }}>{h.a}</div>}
              </div>
            ))}
          </div>
        </section>
        <section className="sheet" aria-labelledby="words">
          <div className="sheet-head"><h2 className="h2" id="words">GST words, in plain English</h2></div>
          <dl className="sheet-pad" style={{ margin: 0 }}>
            {Object.values(GLOSSARY).map((g) => (
              <div key={g.term} style={{ padding: "10px 0", borderBottom: "1px solid var(--rule-2)" }}>
                <dt className="strong">{g.term}</dt>
                <dd className="small" style={{ margin: "4px 0 0", color: "var(--ink-2)" }}>{g.text}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
      <p className="small muted" style={{ marginTop: 24 }}>This app prepares returns from your records. It does not replace your accountant's advice on rates and credit. <Link to="/settings">Settings</Link> shows the rates in use.</p>
    </div>
  );
}
