# Five-minute demo script

**Site:** https://d3rs3n5bwfxtd9.cloudfront.net. Two browser windows: the **Owner**
(bunny.vikram18@gmail.com) and the **Sales manager** (laharisuresh6666@gmail.com), both signed in
before you start. Synthetic data; say so once at the start.

**Before the demo:** check Availability shows 10 of 10 free on 1 and 2 Nov 2026. If a rehearsal
left rooms held, cancel those quotes first.

| Time | Who    | Do                                                                     | Point out                                                                                                                                            |
| ---- | ------ | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00 | Owner  | Open `evidence/00-baseline/README.md`                                  | The starting tool priced 12 rooms when only 10 exist (₹48,000): it over-sold, and quotes never expired                                               |
| 0:45 | Sales  | New quote: 1 Nov 2026, 2 nights, standard, **10 rooms**, rate **2000** | ₹40,000 revenue, ₹24,000 contribution, floor rate ₹2,000 (₹20,000 ÷ 10 rooms), "Ready to offer". Open "How this was calculated"                      |
| 1:30 | Sales  | Same, **12 rooms**                                                     | Partial offer for 10, shortfall 2: never more than exists. Availability page: the held rooms                                                         |
| 2:15 | Sales  | Same, 10 rooms, rate **1500**, issue it                                | Red meter, "Owner review required", suggestion "Use rate 2000"; try Confirm: refused                                                                 |
| 3:00 | Owner  | Review queue, open the quote, approve with a reason                    | Then Sales confirms; the audit trail shows created, approved, confirmed. The Owner cannot approve their own quote (four-eyes)                        |
| 3:45 | Owner  | Evidence page, or explain expiry                                       | Every offer is held 72 hours (never past 24 h before check-in); expired quotes give the rooms back automatically (tested in T15)                     |
| 4:15 | Owner  | Imports and exports: download the evidence bundle                      | Manifest with checksums; ledger tags every claim Observed, Derived or Assumption                                                                     |
| 4:45 | Either | Close                                                                  | Three public checks pass live (`02-final/public-checks-live.json`); what is not proven yet: demand and willingness to pay, and how we will test them |

## If something goes wrong

- **Sign-in fails:** use the second window's account, or show `02-final/public-checks-live.json`.
- **"Not on sale":** a date outside the seeded calendar (18 Oct 2026 to 31 Mar 2027).
- **Partial offer when you expected a full one:** rooms are held by an earlier rehearsal quote.
  That is the product working; cancel it or pick another date.
- **The site is down:** run locally (`README.md`, "Run it locally") or play the recording.

## After the demo

Cancel the demo quotes so the rooms are free for the next run.
