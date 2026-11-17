# The Raw Bros POS

Offline-first Windows desktop POS for a garments shop: barcode billing, size/colour stock, labels, reports, users, backups.
Built by **The Raw Bros – Retail POS Solutions**.

Stack: Electron 45 + React 19 + TypeScript, SQLite through Node's built-in `node:sqlite` (no native modules), electron-vite, electron-builder (NSIS).

## Commands

| Command | What it does |
| --- | --- |
| `npm install` | Install dependencies (Node 22.12+). |
| `npm run dev` | Run with hot reload. |
| `npm run build` | Build to `out/`. |
| `npm run start` | Run the built app. |
| `npm run typecheck` | TypeScript check. |
| `npm run test:core` | 43 business-logic checks against a real SQLite file (sales, duplicate protection, overrides, voids, stock, reports, backup/restore). |
| `npm run dist` | Build the Windows installer → `release/TheRawBros-POS-Setup-<version>.exe`. |

> **VS Code terminal:** VS Code sets `ELECTRON_RUN_AS_NODE=1`, which stops Electron from opening a window.
> Clear it first: PowerShell `Remove-Item Env:ELECTRON_RUN_AS_NODE`, bash `unset ELECTRON_RUN_AS_NODE`.

## Structure

```
src/
  shared/          permissions + the fixed list of IPC channels (used by all three processes)
  main/            Electron main process – the only place with database, file and printer access
    db/            connection (WAL, synchronous=FULL), transactions, migrations
    ipc/           router: sender check → login/permission check → zod input validation → service
    services/      auth, users, settings, catalog, inventory, sales, reports, backup, print, updates
  preload/         contextBridge: forwards only channels listed in shared/channels.ts
  renderer/        React screens (sandboxed, no Node.js)
resources/raw-print.ps1   sends raw ESC/POS/TSPL bytes to a Windows printer queue (cash drawer, raw mode)
scripts/                  core test + dev-only UI QA flow
```

## Key behaviours

- **One transaction per sale**: sale, items, payments, stock movements and invoice number commit together.
- **Duplicate protection**: the sale ID is created when the cart opens; a repeated "Complete" returns the same invoice.
- **Crash recovery**: the cart is saved as a draft on every change and offered for resume after a restart.
- **Printing never blocks a sale**: printing runs after the commit; failures show a message and the receipt can be reprinted.
- **Owner approval (PIN)**: discounts above the cashier's limit, selling without stock, voids, opening the drawer.
- **Barcodes**: one Code 128 barcode per size/colour (`20` + 8 digits), SKU `CAT-0001-CLR-SZ`; maker barcodes can be added.
- **Backups**: hourly (keep 24), daily on close (keep 30 + 12 monthly), safety copy before restore/update, one-click copy to pen drive.
- **Data location**: `%APPDATA%\The Raw Bros POS\` (`data\pos.db`, `images\`, `backups\`). Reinstalling never deletes it.

## Hardware setup notes

- **Scanner**: USB keyboard (HID) mode with Enter suffix. Scans are read from physical key codes, so they work even with Avro/Bijoy active.
- **Receipt printer**: install the vendor driver; choose it in Settings → Printers. "Windows driver" mode works with any printer; "Raw ESC/POS" is optional.
- **Cash drawer**: RJ11 into the receipt printer; opened with the ESC/POS pulse through the Windows print queue.
- **Label printer**: install the driver, set the label size (default 38 × 25 mm) and gap in the driver, calibrate, then match the size in Settings.
  The barcode is sized in whole 203 dpi dots with blank quiet zones.

## Before the first client release

- [ ] Add the app icon (`build/icon.ico`) and shop branding.
- [ ] Set the real HTTPS update URL in `electron-builder.yml` (`publish.url`).
- [ ] Optional: code-signing certificate, to avoid the Windows SmartScreen warning on install.
- [ ] Test receipt, drawer and label printing on the client's purchased printer models.

## Dev-only QA hooks (ignored in the installed app)

`TRB_USER_DATA=<dir>` uses a separate data folder; `TRB_SCREENSHOT=<file.png>` saves screenshots and receipt/label previews, then quits;
`TRB_QA_SCRIPT=scripts/qa-flow.js` additionally drives setup → scan → crash recovery → payment → reports through the real UI.
