/**
 * BD PC Build — Price Check Automation
 * ------------------------------------
 * Runs on a schedule via GitHub Actions. For each tracked part:
 *   1. Fetches the retailer product page
 *   2. Extracts the current price
 *   3. Appends a row to the shared Google Sheet
 *   4. Fires a Discord webhook alert if price <= target
 *
 * IMPORTANT — read before relying on this:
 * - Scraping retailer pages is fragile. Sites change their HTML often,
 *   and some (notably Amazon) actively block scrapers and prohibit it
 *   in their Terms of Service. Test each selector yourself and expect
 *   to fix them periodically. Newegg / B&H / Micro Center are generally
 *   more scrape-tolerant than Amazon.
 * - If a part fails to fetch, the script logs an error for that part
 *   and continues — it won't crash the whole run.
 */

const { google } = require('googleapis');
console.log('DEBUG: script started, googleapis loaded');

// ---------------------------------------------------------------------------
// 1. CONFIG — the full build, not just RAM. Add/edit parts here.
// ---------------------------------------------------------------------------
const PARTS = [
  {
    id: 'ram_kingston',
    category: 'RAM',
    name: 'Kingston Fury Beast RGB 64GB DDR5-6000 CL30',
url: 'https://www.newegg.com/kingston-technology-corp-fury-beast-64gb-ddr5-6000-cas-latency-cl30-memory-black/p/N82E16820242865', // Kingston Fury Beast RGB Black CL30
    selector: '.price-current',        // VERIFY against actual page HTML
    target: 500,
  },
  {
    id: 'ram_crucial',
    category: 'RAM',
    name: 'Crucial Pro 64GB DDR5-5600 CL46',
 url: 'https://www.newegg.com/crucial-pro-64gb-ddr5-5600-cas-latency-cl46-desktop-memory-black/p/N82E16820156380', // Crucial Pro CL46
    selector: '.price-current',
    target: 500,
  },
  {
    id: 'ram_gskill',
    category: 'RAM',
    name: 'G.Skill Flare X5 64GB DDR5-6000 CL30',
url: 'https://www.newegg.com/g-skill-64gb/p/N82E16820374518', // G.Skill Flare X5 CL30
    selector: '.price-current',
    target: 500,
  },
  // Add the rest of the build here as you lock in parts, e.g.:
  // { id: 'gpu', category: 'GPU', name: 'RTX 5070', url: '...', selector: '...', target: 600 },
  // { id: 'cpu', category: 'CPU', name: 'Ryzen 9 9900X', url: '...', selector: '...', target: 400 },
];

// ---------------------------------------------------------------------------
// 2. ENV VARS (set these as GitHub Actions secrets — see README)
// ---------------------------------------------------------------------------
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON; // full JSON key, as a string
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL; // optional but recommended

// ---------------------------------------------------------------------------
// 3. Fetch + parse a single part's price
// ---------------------------------------------------------------------------
async function fetchPrice(part) {
  const res = await fetch(part.url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${part.url}`);
  const html = await res.text();

  // Simple regex-based extraction so we don't need a full HTML parser dependency.
  // This looks for a dollar amount near a price-like class name. You WILL need
  // to tune this per retailer — view page source and find the right pattern.
  const priceMatch = html.match(/\$([0-9]{1,4}(?:\.[0-9]{2})?)/);
  if (!priceMatch) throw new Error(`Could not find a price on page for ${part.name}`);

  return parseFloat(priceMatch[1]);
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
// 5. Discord alert
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
// 6. Main
// ---------------------------------------------------------------------------
async function main() {
  console.log('DEBUG: main() started');
  const sheets = await getSheetsClient();
  console.log('DEBUG: sheets client created successfully');
  const today = new Date().toISOString().split('T')[0];
  const latestPrices = [];
  const alerts = [];

  for (const part of PARTS) {
    let price = null;
    try {
      price = await fetchPrice(part);
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
  }

  await updateBuildTotal(sheets, latestPrices);

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
