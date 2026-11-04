# DESIGN.md: Dev Caters GST Accounting

## Brief
- **Who:** Dev Caters, an outdoor caterer at 513 Vasan Nagar, Trichy. Proprietor C. Maria Sangeetha; one accountant.
- **Today:** a carbonless duplicate order book (white original, yellow copy, navy print) plus WhatsApp.
- **Job of the app:** record sales and purchase bills, then close each month's GST (GSTR-1, GSTR-3B) with no training.
- **Constraint:** used by non-technical people, on a phone at events and on a desktop for month-end. Indian number format, ₹.
- **Assumption:** English UI. Dates shown as 15 Oct 2026, entered with the browser date picker.

## Concept
Three territories considered:
1. *The order book* (their material): screens that look like the duplicate book they already fill. Signature: saving tears off the original and leaves the yellow carbon copy, stamped with the number. Originality 4, fit 5, feasibility 5, portability 1.
2. *The month as a thali* (catering): the month's return as compartments filling up. Cute, but hides numbers. Fit 2.
3. *Ledger ink* (formal system): navy-ruled ledger lines, no metaphor. Fit 3, generic.

Picked **1**: the users already know this form, so the UI needs no introduction.

```
Idea:        Your order book, but it adds up the GST for you.
Metaphor:    The carbon duplicate book: white original over a yellow copy, navy print, dotted fill-in lines.
Signature:   Saving a bill: the white sheet lifts away and the yellow carbon copy settles, stamped "Saved · No. 044".
Emotion:     Familiar, calm, certain. "I know this page."
Motion verb: settle like paper (short y-travel, slight shadow change, 180 to 320 ms, ease-out).
Screenshot:  The month page: "October 2026" in slab, the return's eight steps ticked like a form, dotted leaders to the amounts.
```

## Art direction
- **Palette (by role):**
  - ground / paper `#FFFFFF`, sunken paper `#F6F6F2`
  - ink (form navy) `#1D2B6B`, ink-soft `#46507F`
  - rule (printed grid) `#C9CDE3`
  - carbon (the yellow copy) `#F6E35A`, carbon-soft `#FCF4BF`
  - stamp (rubber-stamp red, errors and due dates) `#B3261E`
  - filed (green ink) `#1E6B45`
- **Type:** Zilla Slab 600/700 for display and amounts that matter (echoes the slab "DEV CATERS" on the book). IBM Plex Sans 400/500/600 for text and UI, `tabular-nums` for every figure. Indian digit grouping (1,23,450.00).
- **Grid:** desktop 240 px nav rail + content max 1120 px, 12 columns, 24 px gutter. Phone: single column, 16 px gutter, bottom tab bar.
- **Shape:** 4 px radius on inputs and buttons (paper corners), 0 on sheets. Sheets get a 1 px rule and a flat offset "copy" edge, never soft drop shadows.
- **Form fields:** labels sit left like the printed form ("Party Name : ....."); inputs are dotted-underline fields, filled navy text. Leaders (`......`) connect labels to amounts in summaries.
- **Motion:** only state changes move: sheet settle on page change (opacity + 8 px y), carbon copy on save, row highlight. Reduced motion: everything instant.
- **Idle:** this is a tool, so the page stays still at rest. Decision recorded: no idle motion; life is in hovers (rows lift to carbon yellow, buttons press 1 px like a stamp).

## Genericness test
- Default would be: Inter, white cards with soft shadows, purple primary, dashboard of KPI tiles and a chart. Replaced with: slab + Plex, ruled sheets with carbon edge, navy/yellow from the actual book, a checklist that mirrors filing steps instead of charts.
- No eyebrow labels, no gradient, no three-card row.
