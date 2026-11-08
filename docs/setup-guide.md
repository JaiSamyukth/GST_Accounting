# GST-Invoice — setup and daily use

This guide takes you from nothing to a working app on the internet, then explains how to use it each month.
You need about 30 minutes for the setup. No programming is needed except copying and pasting a few lines.

**What you will create**

| Piece | What it is | Cost |
|---|---|---|
| Neon | The database that stores every bill and return | Free plan is enough to start |
| File storage | A private place for bill photos and supplier PDFs | Free tier is usually enough |
| Vercel | Runs the website | Free (Hobby) plan is enough |
| GitHub | Holds the code; Vercel reads it from here | Free |

You also need a computer with **Node.js 20 or newer** for two one-time commands
(download from <https://nodejs.org>, choose the LTS version).

---

## Part A — Create the database (Neon)

1. Go to <https://console.neon.tech> and sign up (Google or GitHub sign-in is fine).
2. Click **New project**.
   - Project name: `gst-invoice`
   - Postgres version: the default
   - Region: **AWS Asia Pacific (Singapore)** — closest to India
   - Click **Create project**.
3. On the project dashboard click **Connect**. A box shows a connection string that starts with `postgresql://`.
4. Copy **two** versions of it and keep them in a notepad:
   - With **Connection pooling ON** — the host name contains `-pooler`. This is `DATABASE_URL`.
   - With **Connection pooling OFF** — the same string without `-pooler`. This is `DATABASE_URL_UNPOOLED`.

   Both contain a password. Treat them like a bank password: never paste them into chat, email or a file you commit.

## Part B — Create file storage for bill photos

The app keeps uploaded bill photos and supplier PDFs in a **private, S3-compatible bucket**. Invoices,
returns and reports are generated on demand and are *not* stored, so the app works without storage — only
the Attachments boxes will say "File storage is not configured".

**Option 1 — Neon Object Storage** (what the project was designed for)

1. In the Neon console, open your `gst-invoice` project and look for **Object Storage** (or **Storage**).
2. Create a bucket named `gst-documents`. Keep it **private** (no public access).
3. Create an **access key**. Copy the **endpoint URL**, **access key ID** and **secret access key**.

If you do not see Object Storage in your Neon console, it may not be available on your account yet. Use Option 2;
nothing else changes.

**Option 2 — any other S3-compatible bucket** (Cloudflare R2, AWS S3, Backblaze B2, …)

1. Create a **private** bucket named `gst-documents`.
2. Create an API key/token with read and write access to that bucket only.
3. Note the **S3 endpoint URL**, **access key ID**, **secret access key** and the **region**
   (Cloudflare R2 uses region `auto`).

You now have five values: endpoint, key ID, secret, region, bucket name.

## Part C — Prepare the code and the database tables

Do this once on your computer.

```bash
git clone https://github.com/JaiSamyukth/GST-Invoice.git
cd GST-Invoice
npm install
cp .env.example .env.local
```

Open `.env.local` in a text editor and fill in:

```
DATABASE_URL="<pooled string from Part A>"
DATABASE_URL_UNPOOLED="<direct string from Part A>"
AWS_ENDPOINT_URL_S3="<endpoint from Part B>"
AWS_ACCESS_KEY_ID="<key id>"
AWS_SECRET_ACCESS_KEY="<secret>"
AWS_REGION="ap-southeast-1"        # or your storage region
S3_BUCKET="gst-documents"
COOKIE_SECURE="false"
SESSION_HOURS="12"
APP_URL="http://localhost:3000"
```

`.env.local` is ignored by git, so it never leaves your computer.

Create the tables in Neon:

```bash
npm run db:migrate
```

It should print `Migrations applied.` Run it again any time you update the code; it only applies what is new.

**Optional: try it on your computer first**

```bash
npm run dev
```

Open <http://localhost:3000>. You will be asked to create the owner account (see Part E).
Stop it with `Ctrl+C` when done.

No Neon yet and just want to look around? Put `DATABASE_URL="pglite:./.data/pglite"` in `.env.local` instead.
That runs a small built-in database on your computer. It is for trying things out only.

## Part D — Put it online (Vercel)

1. Push the code to your GitHub account (it is already there if you cloned `JaiSamyukth/GST-Invoice`).
2. Go to <https://vercel.com>, sign in with GitHub, click **Add New… → Project**, and **Import** the
   `GST-Invoice` repository. Vercel detects Next.js; leave the build settings as they are.
3. Before clicking Deploy, open **Environment Variables** and add each of these
   (same values as `.env.local`, except the last three):

   | Name | Value |
   |---|---|
   | `DATABASE_URL` | pooled Neon string |
   | `DATABASE_URL_UNPOOLED` | direct Neon string |
   | `AWS_ENDPOINT_URL_S3` | storage endpoint |
   | `AWS_ACCESS_KEY_ID` | storage key ID |
   | `AWS_SECRET_ACCESS_KEY` | storage secret |
   | `AWS_REGION` | storage region |
   | `S3_BUCKET` | `gst-documents` |
   | `COOKIE_SECURE` | `true` |
   | `SESSION_HOURS` | `12` |
   | `APP_URL` | your site address, e.g. `https://gst-invoice.vercel.app` (you can fix it after the first deploy) |

4. Click **Deploy**. After a minute or two you get an address like `https://gst-invoice-xxxx.vercel.app`.
5. If `APP_URL` was a guess, correct it under **Settings → Environment Variables** and click
   **Deployments → … → Redeploy**. `APP_URL` is used in password-reset links.

The repository's `vercel.json` runs the app in Singapore, next to the Neon database, which keeps pages fast.

## Part E — First visit

1. Open your Vercel address. The first visit shows **Set up**. Enter the business name, state, your name,
   email and a password (at least 10 characters with letters and numbers). This creates the **owner** account.
   It can only be done once.
2. You land on **Settings**. Fill in:
   - Legal name, trade name, **GSTIN** (PAN fills itself), address, state.
   - **Files returns**: Monthly, or Quarterly if you are on QRMP.
   - **Current financial year**.
   - **Invoice number prefix** (default `INV-`).
   - Tick **"We pay GST at 5% without input tax credit"** if your catering service uses the 5% no-ITC rate.
     Then no purchase ITC is ever claimed.
   - Click **Save business settings**.
3. Check **Tax rates** and **HSN / SAC codes**. Common catering codes (996334 outdoor catering and others) are already there.
4. Add your regular customers and suppliers under **Parties**, or import them (Part G).
5. To give your accountant access: **Settings → Users → Add user** with role *Accountant*. The app shows a
   one-time link. Send it to them; they open it and choose their own password. Links last 72 hours.

## Part F — Every month

**During the month**

- **Sales → New invoice** for each event. Pick the customer, add items with HSN, quantity, rate and GST %.
  The tax and total appear as you type. **Save**, then **Print / download PDF** to give the customer.
- Customer paid less or you served fewer plates? Make a **credit note** (Sales → New credit note) against the original invoice.
- **Purchases → New purchase bill** for each supplier bill. Leave **Claim** ticked for ITC unless the item is
  not eligible. Attach a photo of the bill in the Attachments box after saving.

**After the month ends** (before the 11th for GSTR-1, the 20th for GSTR-3B; 13th/22nd if quarterly)

1. On the GST portal, download **GSTR-2B** for the month (Returns → GSTR-2B → Download → JSON).
2. In the app open **Returns** and click the month.
3. Under **GSTR-2B matching**, choose the downloaded file and click **Load GSTR-2B**. The table shows:
   - **Matched** — fine.
   - **Amounts differ** — check the bill with the supplier.
   - **Not in 2B (ITC deferred)** — the supplier has not filed yet. ITC for that bill is held back. When it appears
     in a later month's 2B, open the bill and set **Claim ITC in period** to that month.
   - **Not in purchases** — a bill you have not entered. Enter it.
4. Read any notices at the top of the Returns page and fix them.
5. Check the **GSTR-1 vs GSTR-3B** table: the difference column should be all zeros.
6. The owner clicks **Approve both returns**.
7. Download **GSTR-1 JSON**. On the portal, open GSTR-1 → **Prepare offline → Upload** and upload it,
   check the summary, then submit and file with EVC/DSC.
8. For GSTR-3B, use the **GSTR-3B PDF or Excel** as your worksheet and enter the same figures on the portal,
   pay any cash due, and file. (The 3B JSON follows the portal's format but the portal does not accept
   3B uploads for every taxpayer.)
9. Back in the app, type each **ARN** and click **Mark GSTR-1 filed** / **Mark GSTR-3B filed**.
   When both are marked, the month **locks**: its bills can no longer be changed.
10. Record the challan under **Payment** and attach the acknowledgement PDFs if you like.

**Fixing a mistake after filing**

- Wrong amount or customer GSTIN on a B2B invoice: open the invoice and click **Amend**. Choose the
  month you are filing now, correct it, and **Save amendment**. That month's GSTR-1 reports it as an
  amended invoice, and its GSTR-3B takes only the difference. The filed month stays as filed.
- Small B2C sales and exports cannot be amended this way: issue a **credit or debit note** instead.
- If the owner truly needs to reopen a filed month: Returns → month → **Unlock period** (asks for a reason,
  recorded in the audit log). The returns go back to *approved* and the ARNs are cleared.

## Part G — Importing from Excel

**Import** in the top menu.

1. Choose what you are importing (sales, credit/debit notes, purchases, customers, suppliers, HSN codes or tax payments).
2. Download the **Excel template**, or use your own sheet. Column names like "Invoice No" or "GST %" are recognised.
   For invoices with several items, put each item on its own row with the same invoice number.
3. Choose the file and click **Check file**. Nothing is saved yet. You see how many rows are ready and which have
   problems. Fix the problems in your sheet (or **Download error report**), or change which column means what, then check again.
4. Click **Import**. Rows with errors are skipped.
5. Made a mistake? **Past imports → Undo** removes exactly what that import created, unless its month is locked.

## Part H — Users, backup and safety

- **Owner** can change settings, approve, lock/unlock, manage users, delete attachments and download backups.
  **Accountant** can enter and check everything else.
- **Settings → Backup → Download backup** gives a ZIP of every table. Do it monthly after filing and keep it somewhere safe.
  Neon also keeps its own history (see Neon's "Restore" / branching features).
- Every change is in **Settings → Audit log**.
- Forgot the owner password? Another owner can make a reset link under **Settings → Users**. If you are the only
  owner, run this on the computer where you did Part C (it uses `.env.local`) and open the link it prints:

  ```bash
  npm run user:reset-link -- owner@yourbusiness.in
  ```

## Part I — Updating the app later

1. Get the new code (`git pull`).
2. Run `npm install` and then `npm run db:migrate` (this updates the Neon tables).
3. Push to GitHub. Vercel deploys automatically.

Always run `db:migrate` **before** the new version goes live.

## Troubleshooting

| You see | Do this |
|---|---|
| "Something went wrong" on every page after deploy | A database variable is wrong. In Vercel, check `DATABASE_URL` is the **pooled** string, then redeploy. Vercel → Deployments → (latest) → Logs shows the exact error. |
| Pages work but the Returns page errors with "relation … does not exist" | Tables were not created. Run `npm run db:migrate` with `.env.local` pointing at Neon. |
| "File storage is not configured" | One of the five storage variables is missing in Vercel. Add it and redeploy. |
| "File storage is unavailable" | Endpoint, keys or bucket name are wrong, or the key has no write access. |
| Signed out straight after signing in on the live site | `COOKIE_SECURE` must be `true` on Vercel (https) and `false` on `localhost`. |
| Reset links point to localhost | Set `APP_URL` in Vercel to your real address and redeploy. |
| "Period … is locked" | That month is filed. Amend (sales), adjust in the current month, or have the owner unlock it with a reason. |
| "Too many failed attempts" | 8 wrong passwords in 15 minutes. Wait 15 minutes. |
| First page load is slow after a quiet night | Neon's free plan pauses the database when idle; the first request wakes it (a few seconds). |

Questions about tax treatment (for example which rate applies to an event) are for your accountant.
The app follows the rules written in `docs/spec.md`.
