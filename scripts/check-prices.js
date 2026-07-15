/**
 * BD PC Build — Price Check Automation
 * ------------------------------------
 * Runs once a day (see README for scheduling options). For each tracked part:
 *   1. Loads the Amazon product page in a headless browser
 *   2. Extracts the current price
 *   3. Appends a row to the Google Sheet (internal log, not used by the site)
 *   4. Bakes the day's prices into index.html so the site has no runtime
 *      dependency on Sheets, CSV publishing, or any network fetch
 *   5. Fires a Discord webhook alert if price <= target
 *
 * IMPORTANT — read before relying on this:
 * - Amazon prohibits automated scraping in its Terms of Service. This was
 *   cleared internally (Alex/Legal) before this was built — see the repo
 *   handoff notes for context. Keep this at low frequency (daily, not
 *   hourly) and don't add more products without re-checking that decision.
 * - Amazon's bot detection is more aggressive than most retailers, so this
 *   uses a headless browser with stealth patches (see fetchPrice) rather
 *   than a plain fetch(). Even so, selectors and detection can change —
 *   expect to maintain this periodically.
 * - If a part fails to fetch, the script logs an error for that part
 *   and continues — it won't crash the whole run.
 * - If Amazon ever serves a CAPTCHA instead of a price, that's a signal to
 *   back off, not a thing to defeat — the script treats it as a failed
 *   fetch for that part rather than trying to solve it.
 */

const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
console.log('DEBUG: script started, googleapis + puppeteer-extra loaded');

// ---------------------------------------------------------------------------
// 1. CONFIG — the 3 tracked RAM kits. `key` must match the KITS entries in
//    index.html — that's what ties a scraped price to a card on the site.
// ---------------------------------------------------------------------------
const PARTS = [
  {
    id: 'ram_kingston',
    key: 'kingston',
    category: 'RAM',
    name: 'Kingston Fury Beast RGB 64GB DDR5-5600 CL36',
    url: 'https://www.amazon.com/dp/B0BRTHRY3F',
    target: 850,
  },
  {
    id: 'ram_crucial',
    key: 'crucial',
    category: 'RAM',
    name: 'Crucial Pro 64GB DDR5-5600 CL46',
    url: 'https://www.amazon.com/dp/B0BLTG7TN6',
    target: 680,
  },
  {
    id: 'ram_gskill',
    key: 'gskill',
    category: 'RAM',
    name: 'G.Skill Flare X5 64GB DDR5-6000 CL30',
    url: 'https://www.amazon.com/dp/B0CGQ3KS8X',
    target: 840,
  },
];

const REPO_ROOT = path.join(__dirname, '..');
const HISTORY_PATH = path.join(REPO_ROOT, 'price-history.json');
const INDEX_HTML_PATH = path.join(REPO_ROOT, 'index.html');

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// Amazon's price markup varies by product/page type — try each until one hits.
const PRICE_SELECTORS = [
  '#corePrice_feature_div .a-price .a-offscreen',
  '#corePriceDisplay_desktop_feature_div .a-price .a-offscreen',
  '#apex_desktop .a-price .a-offscreen',
  '.a-price .a-offscreen',
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomDelay(minMs, maxMs) {
  return sleep(minMs + Math.random() * (maxMs - minMs));
}

// ---------------------------------------------------------------------------
// 2. ENV VARS (set these as GitHub Actions secrets — see README)
// ---------------------------------------------------------------------------
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON; // full JSON key, as a string
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL; // optional but recommended

// ---------------------------------------------------------------------------
// 3. Fetch + parse a single part's price (headless browser — Amazon renders
//    price via JS, and a plain fetch() never sees it in the raw HTML)
// ---------------------------------------------------------------------------
async function fetchPrice(part, browser) {
  const page = await browser.newPage();
  try {
    await page.setUserAgent(USER_AGENT);
    await page.setViewport({ width: 1280, height: 800 });
    await page.goto(part.url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    let priceText = null;
    for (const selector of PRICE_SELECTORS) {
      priceText = await page.$eval(selector, (el) => el.textContent).catch(() => null);
      if (priceText) break;
    }
    if (!priceText) throw new Error(`Could not find a price on page for ${part.name}`);

    const price = parseFloat(priceText.replace(/[^0-9.]/g, ''));
    if (Number.isNaN(price)) throw new Error(`Parsed price is NaN for ${part.name} (raw text: "${priceText}")`);
    return price;
  } finally {
    await page.close();
  }
}

// ---------------------------------------------------------------------------
// 4. Google Sheets — append a row per part, per run
// ---------------------------------------------------------------------------
async function getSheetsClient() {
  const credentials = JSON.parse(GOOGLE_SERVICE_ACCOUNT_JSON);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const client = await auth.getClient();
  return google.sheets({ version: 'v4', auth: client });
}

async function appendRow(sheets, row) {
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: 'PriceLog!A:F', // Sheet tab must be named "PriceLog"
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [row] },
  });
}

// Maintains a "BuildTotal" tab that always reflects latest price per part
// and sums them — this is the "full price of the build at any given point" view.
async function updateBuildTotal(sheets, latestPrices) {
  const rows = [
    ['Category', 'Part', 'Latest Price', 'Target', 'Status'],
    ...latestPrices.map((p) => [
      p.category,
      p.name,
      p.price != null ? p.price : 'N/A',
      p.target,
      p.price != null ? (p.price <= p.target ? 'BUY' : 'above target') : 'error',
    ]),
    [
      '',
      'TOTAL',
      latestPrices.reduce((sum, p) => sum + (p.price || 0), 0).toFixed(2),
      '',
      '',
    ],
  ];

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: 'BuildTotal!A1',
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: rows },
  });
}

// ---------------------------------------------------------------------------
// 5. Bake today's prices into the site (price-history.json + index.html)
// ---------------------------------------------------------------------------
function updateSiteData(today, latestPrices) {
  let history = [];
  if (fs.existsSync(HISTORY_PATH)) {
    history = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8'));
  }

  const todayEntry = { date: today };
  for (const p of latestPrices) {
    todayEntry[p.key] = p.price;
  }

  const existingIndex = history.findIndex((h) => h.date === today);
  if (existingIndex >= 0) {
    history[existingIndex] = todayEntry;
  } else {
    history.push(todayEntry);
  }

  fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2) + '\n');

  const html = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
  const block = `/* PRICE_DATA_START */\n  const PRICE_DATA = ${JSON.stringify(history, null, 2)};\n  /* PRICE_DATA_END */`;
  const updatedHtml = html.replace(
    /\/\* PRICE_DATA_START \*\/[\s\S]*?\/\* PRICE_DATA_END \*\//,
    block
  );
  fs.writeFileSync(INDEX_HTML_PATH, updatedHtml);
}

// ---------------------------------------------------------------------------
// 6. Discord alert
// ---------------------------------------------------------------------------
async function sendAlert(message) {
  if (!DISCORD_WEBHOOK_URL) {
    console.log('[alert skipped — no DISCORD_WEBHOOK_URL set]', message);
    return;
  }
  await fetch(DISCORD_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: message }),
  });
}

// ---------------------------------------------------------------------------
// 7. Main
// ---------------------------------------------------------------------------
async function main() {
  console.log('DEBUG: main() started');
  const sheets = await getSheetsClient();
  console.log('DEBUG: sheets client created successfully');
  const today = new Date().toISOString().split('T')[0];
  const latestPrices = [];
  const alerts = [];

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--disable-blink-features=AutomationControlled'],
  });

  try {
    for (let i = 0; i < PARTS.length; i++) {
      const part = PARTS[i];
      let price = null;
      try {
        price = await fetchPrice(part, browser);
        console.log(`${part.name}: $${price}`);
      } catch (err) {
        console.error(`Error checking ${part.name}: ${err.message}`);
      }

      latestPrices.push({ ...part, price });

      await appendRow(sheets, [
        today,
        part.category,
        part.name,
        price != null ? price : '',
        part.target,
        price != null && price <= part.target ? 'BUY' : '',
      ]);

      if (price != null && price <= part.target) {
        alerts.push(`🟢 **${part.name}** hit $${price} (target: $${part.target}) — ${part.url}`);
      }

      // Space out requests within a run so this doesn't look like a bot
      // hammering the site back-to-back.
      if (i < PARTS.length - 1) {
        await randomDelay(4000, 10000);
      }
    }
  } finally {
    await browser.close();
  }

  await updateBuildTotal(sheets, latestPrices);
  updateSiteData(today, latestPrices);

  if (alerts.length) {
    await sendAlert(`RAM/Build price alert:\n${alerts.join('\n')}`);
  } else {
    console.log('No parts at or below target this run.');
  }
}

main().catch((err) => {
  console.error('Fatal error in price check run:', err);
  process.exit(1);
});
