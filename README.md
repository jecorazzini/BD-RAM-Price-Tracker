# RAM Price Tracker

Tracks the price of 3 specific RAM kits on Amazon, once a day, and shows them
on `index.html`. That's the whole scope — no other parts, no manual entry.

## How it works

1. **`.github/workflows/price-check.yml`** runs `scripts/check-prices.js` once
   a day (and on-demand via the "Run workflow" button in the Actions tab).
2. **`scripts/check-prices.js`** opens each Amazon product page in a headless,
   stealth-patched browser (plain `fetch()` doesn't work — Amazon renders the
   price via JS), reads the price, and:
   - Bakes the result into `price-history.json` and directly into `index.html`
     (between the `PRICE_DATA_START`/`PRICE_DATA_END` markers), and commits
     both back to the repo.
   - Also logs the row to a Google Sheet, kept purely as an internal record —
     **the site does not read from the Sheet.** It has no live network
     dependency at all; the numbers are static HTML by the time you load it.
   - Fires a Discord alert if any kit is at or below its target price.
3. **`index.html`** just renders whatever's in `PRICE_DATA`. Open it directly
   in a browser, or host it anywhere (GitHub Pages, etc.) — it works either way.

## Why scraping instead of an official API / feed

Amazon prohibits automated scraping in its Terms of Service. This was raised
internally and cleared before this was built. Keep it at low frequency
(daily) and don't expand it to more products without re-checking that.
Amazon's bot detection is also the most aggressive of the retailers we
looked at, which is why the scraper uses:
- A headless browser with stealth patches (`puppeteer-extra` +
  `puppeteer-extra-plugin-stealth`) rather than a raw `fetch()`.
- A randomized delay between each product check within a run.
- Once-daily frequency — by far the biggest lever against getting flagged.
- GitHub-hosted runners (shared datacenter IPs) rather than nothing — if this
  ever starts getting blocked, moving the run to a residential machine
  (e.g. Windows Task Scheduler) is the next thing to try.

If Amazon ever serves a CAPTCHA instead of a price, the script treats that as
a failed fetch for that item and moves on — it does not try to solve it.

## Setup

### 1. Google Sheet (internal log only — not required for the site to work)
- Create a Sheet with two tabs named exactly `PriceLog` and `BuildTotal`.
- `PriceLog` header row: `Date, Category, Part, Price, Target, Buy`.
- Create a Google Service Account (Google Cloud Console → enable the Sheets
  API → create a Service Account → download its JSON key), and share the
  Sheet with that account's `client_email` as **Editor**.

### 2. GitHub repo secrets
Settings → Secrets and variables → Actions:

| Secret | Value |
|---|---|
| `SPREADSHEET_ID` | The ID from the Sheet's URL |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Full contents of the service account JSON key |
| `DISCORD_WEBHOOK_URL` | Optional — alerts are skipped if unset |

### 3. Allow the workflow to push
The Action commits `index.html` and `price-history.json` back to the repo
after each run. Under **Settings → Actions → General → Workflow permissions**,
make sure **"Read and write permissions"** is selected — otherwise the commit
step will fail with a 403.

### 4. Test it
Actions tab → "Price Check" → **Run workflow**. Check that `index.html` and
`price-history.json` get updated with a new commit, and that a Discord
message arrives if any kit is at/below target.

## Tracked kits & targets

Defined in `PARTS` in `scripts/check-prices.js` (must stay in sync with
`KITS` in `index.html` — same `key` on both sides):

| Kit | Target |
|---|---|
| Kingston Fury Beast RGB 64GB DDR5-5600 CL36 | $850 |
| Crucial Pro 64GB DDR5-5600 CL46 | $680 |
| G.Skill Flare X5 64GB DDR5-6000 CL30 | $840 |

Targets were set ~10% below the observed price at the time this was built —
adjust them in both files as you see fit.
