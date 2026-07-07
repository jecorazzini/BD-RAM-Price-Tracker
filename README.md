# BD PC Build — RAM Price Tracker

A simple single-page web app to track DDR5 64GB RAM prices for the BD Custom PC Build project.

## What it does
- Shows the latest price for each of the three RAM candidates
- Highlights the cheapest option in green
- Flags any kit at or below the $500 buy target
- Lets you log new price checks as you do them
- Export to CSV or JSON at any time

## The three kits being tracked
| Kit | Model | Speed |
|---|---|---|
| Kingston Fury Beast RGB | KF560C30BBEAK2-64 | DDR5-6000 CL30 |
| Crucial Pro | CP2K32G56C46U5 | DDR5-5600 CL46 |
| G.Skill Flare X5 | F5-6000J3040G32GX2-FX5 | DDR5-6000 CL30 |

## How to host on GitHub Pages
1. Create a new GitHub repository (e.g. `bd-pc-ram-tracker`)
2. Upload `index.html` to the repo
3. Go to **Settings → Pages**
4. Under **Source**, select **Deploy from a branch**
5. Select **main** branch, **/ (root)** folder, click Save
6. Your site will be live at `https://yourusername.github.io/bd-pc-ram-tracker`

## How to use
- Open the site
- Each time you check prices on Amazon, enter them in the form at the bottom and hit **Add Entry**
- The cards at the top always show the latest price per kit
- The table shows full history, newest first
- When a kit hits $500 or under, the banner turns green — that's your buy signal

## CamelCamelCamel alerts (backup)
Price alerts are also active at the $500 threshold:
- Kingston: https://camelcamelcamel.com/product/B0CYM3WCXM
- Crucial Pro: search CP2K32G56C46U5 on camelcamelcamel.com
- G.Skill Flare X5: search F5-6000J3040G32GX2-FX5 on camelcamelcamel.com

## Notes
- Price data is stored in your browser's local storage — it persists between visits on the same device
- Use Export CSV or Export JSON to back up your data or share it
- All prices in USD
