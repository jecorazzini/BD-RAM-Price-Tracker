# BD PC Build — Price Tracker Automation

This repo now does three things instead of one:

1. **Automated price checks** (GitHub Actions, runs every 6 hours)
2. **A shared Google Sheet** tracking the full build (not just RAM) that anyone can open
3. **Discord alerts** when a part hits its target price
4. **`index.html`** — a live dashboard that reads from the shared sheet

This replaces the old version, which only stored manual entries in your own
browser's localStorage (invisible to anyone else, including JD or Alex).

## Setup checklist (do this before handing off to JD)

### 1. Create the Google Sheet
- Create a new Google Sheet.
- Add two tabs named exactly: `PriceLog` and `BuildTotal`.
- `PriceLog` header row: `Date, Category, Part, Price, Target, Buy`
- `BuildTotal` can start empty — the script writes to it automatically.

### 2. Create a Google Service Account (so the script can write to the sheet)
- Go to [Google Cloud Console](https://console.cloud.google.com/) → create a project.
- Enable the **Google Sheets API**.
- Create a **Service Account**, then create a JSON key for it — this downloads a `.json` file.
- Open that JSON file, copy the whole contents.
- Share your Google Sheet with the service account's email address (found in the JSON, field `client_email`) — give it **Editor** access.

### 3. Publish the sheet as CSV (for the dashboard to read)
- In Google Sheets: **File → Share → Publish to web**
- Choose the `PriceLog` tab, format **CSV**, click Publish. Copy the URL.
- Repeat for the `BuildTotal` tab.
- Paste both URLs into `index.html`, near the top of the `<script>` block:
  ```js
  const PRICE_LOG_CSV_URL = 'PASTE_PRICELOG_CSV_URL_HERE';
  const BUILD_TOTAL_CSV_URL = 'PASTE_BUILDTOTAL_CSV_URL_HERE';
  ```

### 4. Create a Discord webhook (for alerts)
- In your Discord server: channel settings → Integrations → Webhooks → New Webhook.
- Copy the webhook URL.
- (No Discord server? Slack has an equivalent "Incoming Webhook" app, or you can skip
  alerts entirely and just check the dashboard/sheet manually.)

### 5. Add secrets to the GitHub repo
Go to your repo → **Settings → Secrets and variables → Actions → New repository secret**, and add:

| Secret name | Value |
|---|---|
| `SPREADSHEET_ID` | The long ID in your Sheet's URL, e.g. `docs.google.com/spreadsheets/d/THIS_PART/edit` |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | The full contents of the service account JSON key |
| `DISCORD_WEBHOOK_URL` | Your Discord webhook URL |

### 6. Fix the retailer URLs and selectors
Open `scripts/check-prices.js` and update the `PARTS` array:
- Real product URLs for each part (Newegg/B&H tend to scrape more reliably than Amazon)
- Verify the `selector` / price-matching logic actually finds the price on that
  specific page — retailer HTML changes, so **test this manually first** by running
  `node scripts/check-prices.js` locally with your env vars set, before trusting the
  scheduled run.
- Add the rest of the build (GPU, CPU, case, etc.) as more entries in `PARTS` — this
  is what makes `BuildTotal` reflect the *whole* build, not just RAM.

### 7. Test it
- Go to the **Actions** tab in GitHub → select "Price Check" → **Run workflow** manually.
- Check the Sheet updates and (if a part is at/below target) that a Discord message arrives.
- Once confirmed, the schedule in `.github/workflows/price-check.yml` handles the rest.

## What JD needs to know
- The shared sheet is the source of truth — not any one person's browser.
- `index.html` is a read-only live view of that sheet (plus an optional local-only
  manual entry field for spot checks).
- If a part's scraping selector breaks (retailer changed their page), the Actions log
  will show an error for that part — check the **Actions** tab if the dashboard looks stale.
