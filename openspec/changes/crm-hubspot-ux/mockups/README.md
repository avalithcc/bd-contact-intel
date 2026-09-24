# crm-hubspot-ux mockups

These are static, clickable HTML mockups of every screen, from sign-in onward. Nothing here is implemented. They exist so the owner can approve the design before any UI code is written (proposal R9).

## Open them

1. Open `index.html` in a browser, for example `open openspec/changes/crm-hubspot-ux/mockups/index.html` on macOS.
2. Click through from **Contacts**. Sidebar items, table rows, record links and dialog buttons all navigate between screens.
3. You need no server and no build step. The only external request is Google Fonts; without a network, the pages fall back to system fonts.

## What is where

| File | Purpose |
|---|---|
| `index.html` | Hub. Lists every screen and tags it *In scope*, *Restyle only (later change)* or *Backlog*. |
| `design-system.html` | Component sheet: tokens with contrast ratios, buttons in every state, inputs, badges, table, cards, tabs, dialog, toast, and empty/loading/error states. |
| `styles.css` | The **only** stylesheet. Its tokens mirror `src/app/globals.css`. Tokens marked `proposed` are additions for PR 8. |
| Other `*.html` | One file per screen. All screens share the same app shell (sidebar + top bar). |

## Conventions

- The dashed, striped **Mockup note** strip at the top of each page explains the mockup. It is not product UI.
- Dialogs open through URL fragments (for example `contact-record.html#discard`). Close them with the × button or **Cancel**.
- The only JavaScript is a few inline lines for record tabs and the board dialog.
- People are fictional. Companies are real LATAM companies, used only as realistic sample data.
