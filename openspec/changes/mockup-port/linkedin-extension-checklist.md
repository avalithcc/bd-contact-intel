# LinkedIn extension mockup parity checklist

Source mockup: `openspec/changes/linkedin-extension/mockups/extension-linkedin.html` (owner approved).
One row per visible element. Columns: element | mockup ref | status | evidence | notes

"Verified" means a test or a rendered screenshot, not only that the code exists. The one thing no test can prove is LinkedIn's live
markup: the profile reader's selectors were exercised against synthetic fixtures only (see the last section).

## 1. Card on a LinkedIn profile (extension, shadow DOM)

| element | mockup ref | status | evidence | notes |
| --- | --- | --- | --- | --- |
| Card shell: `aside` role complementary, aria-label "CRM de avalith", fixed right | s1 .xcard (l.101) | done | extension/src/content/card.ts:104, cardStyles.ts | closed shadow root, CSS from CRM tokens |
| Header: brand mark "a.", title "CRM avalith" | l.101 .xcard-head | done | card.ts:109-113 | |
| Header collapse button, aria-label "Plegar tarjeta" | l.101 | done | card.ts:105-108 | persists in chrome.storage.local (linkedin.ts:50) |
| State a: Buscando (spinner + 2 skeletons, aria-busy) | l.98-102 | done | viewModel.ts:60, card.ts:134 | rendered, tests/unit/extensionBrowser.test.ts |
| State b: found (badge "En el CRM", avatar, name, "Cargo · Empresa") | l.104-111 | done | viewModel.ts:67, card.ts:143 | |
| State b: Responsable owner chip | l.109 | done | card.ts:152-160 | row omitted when the contact has no owner (never invented) |
| State b: Última actividad "15 oct 2026 · Llamada" | l.109 | done | viewModel.ts:51 (Argentina time) | row omitted when no activity |
| State b: "Ver en el CRM" + help "Se abre la ficha en una pestaña nueva." | l.110-111 | done | card.ts:165-166, worker.ts open-view | opens in a new tab |
| State c: badge "No está en el CRM", message, "Agregar al CRM", help | l.113-119 | done | viewModel.ts:86, card.ts:170 | |
| "Agregar al CRM" reads name/title/company/location only on click | l.119, s2 a | done | linkedin.ts:35, profileReader.ts | unit + browser fixtures |
| State d: alert-info "Inicia sesión…", "Iniciar sesión", help | l.121-127 | done | viewModel.ts:93, card.ts:179 | redirect/401/non-JSON => this state (lookupResponse.ts) |
| State e: collapsed pill with dot (green found, grey otherwise), aria-label, aria-expanded | l.129-132 | done | card.ts:89-102, viewModel.ts pill | remembered across profiles |
| State f: alert-danger + "Reintentar" | l.134-139 | done | viewModel.ts:100, card.ts:185 | |
| Only on `linkedin.com/in/<slug>/`, not feed/search/messages/company | l.144-145 | done | shared/profileUrl.ts, manifest content_scripts | profile sub-pages (details, activity) also excluded, see deviations |
| Updates on SPA navigation without reload (back to "Buscando…") | l.145 | done | linkedin.ts:71-103 (Navigation API, 1 s URL check fallback) | |
| Same-profile result reused for a few minutes | l.146 | done | background/worker.ts:16 (60 s TtlCache) | |
| Refreshes when the tab regains focus | l.212 | done | linkedin.ts:84-87, worker force => cache bypass | |
| Brand mark / pill use CRM tokens only | l.49-58 | done | extension/build/extractCardCss.ts + test | token values copied from globals.css at build |

## 2. Agregar al CRM with data (CRM side)

| element | mockup ref | status | evidence | notes |
| --- | --- | --- | --- | --- |
| Opens `/contacts?new=1&linkedin=…` in a new tab with li_* params | s2 a/b | done | background/crmUrls.ts, worker.ts open-add | params capped to 200 chars |
| Dialog: info alert "Revisa los datos antes de guardar" + body | l.174 | done | NewContactDialog.tsx:191-199, es.ts newContactReviewTitle | |
| Nombre / Apellido with "Desde LinkedIn" badge | l.175 | done | NewContactDialog.tsx:214-227 | CRM name rules: stuffedNameFirstTokenSplit (linkedinProfilePrefill.ts) |
| URL del perfil de LinkedIn + help | l.176 | done | NewContactDialog.tsx:232-243 | unchanged |
| Correo electrónico | l.177 | done | NewContactDialog.tsx:244-250 | unchanged |
| Empresa with badge | l.177 | done | NewContactDialog.tsx:251-253 | |
| NEW field Cargo with badge | l.178 | done | NewContactDialog.tsx:258-260; person.job_title | persisted by createContactActions.ts |
| NEW field Ubicación with badge | l.178 | done | NewContactDialog.tsx:263-265; person.city/country | split only on a known trailing country (locationSplit.ts) |
| Badge disappears when the BD edits the field | l.185 | done | NewContactDialog.tsx edit() | |
| b2: unread field stays empty with help "No se pudo leer del perfil. Complétala si la conoces." | l.191-199 | done | NewContactDialog.tsx notReadHelp | company copy per mockup; other fields use the neutral variant |
| "Ana Pérez, MBA" suffix removed with the CRM name rule | l.198 | done | linkedinProfilePrefill.ts + tests/unit/linkedinProfilePrefill.test.ts | |
| Footer: Cancelar / "Crear contacto" | l.180 | done | es.ts newContactCreate = "Crear contacto" | copy changed from "Crear" to match the mockup |
| Duplicate warnings kept | l.186 | done | NewContactDialog.tsx (unchanged result alerts) | |
| Nothing saved until Crear contacto | l.186 | done | createContactActions.ts is the only write | |
| c: back on LinkedIn the card flips to "Ya está en el CRM" after saving | l.204-212 | done | refresh on focus (linkedin.ts:84) | cancel keeps "No está en el CRM" |

## 3. Cuenta > Herramientas

| element | mockup ref | status | evidence | notes |
| --- | --- | --- | --- | --- |
| Card "Herramientas" with LinkedIn icon, title, body | l.220-222 | done | account/ExtensionTool.tsx, page.tsx:118 | |
| "Tag: Nuevo" in the card header | l.220 | deviation | n/a | proposal-stage scaffolding of the mockup ("pendiente de aprobación"), not product UI |
| "Instalar extensión" -> NEXT_PUBLIC_EXTENSION_STORE_URL | l.223 | done | ExtensionTool.tsx, lib/extension/install.ts | https only |
| Disabled button + "Disponible pronto en la Chrome Web Store" when unset | owner decision | done | ExtensionTool.tsx | |
| Step 1 "Instálala una sola vez" | l.224 | done | ExtensionTool.tsx | |
| Step 2 "Abre cualquier perfil de LinkedIn" | l.225 | done | ExtensionTool.tsx | |
| Privacidad alert | l.226 | done | ExtensionTool.tsx, es.ts toolPrivacyBody | |
| Variant installed: "Versión 1.0.0 · …" + badge "Instalada", no button/steps | l.230-233 | done | ExtensionTool.tsx, crmMarker.ts | detected via data-crm-extension on html |
| "¿Usas Safari?" details with the bookmarklet | l.227, l.234 | deviation | removed | owner decision: bookmarklet UI removed, no Safari fallback; /capture/linkedin route kept |

## 4. Qué hace y qué no

| element | mockup ref | status | evidence | notes |
| --- | --- | --- | --- | --- |
| "Qué hace" / "Qué no hace" lists | s4 | done | extension/README.md "Store listing text" | the mockup places it next to the store listing and in CRM help; no CRM page added |
| Permissions note: only linkedin.com and the CRM, no tabs/history | l.252 | done | extension/build/manifest.ts + test | `storage` added for the collapsed state; webNavigation deliberately not used (history warning) |

## CRM API and extension plumbing

| element | mockup ref | status | evidence | notes |
| --- | --- | --- | --- | --- |
| GET /api/extension/linkedin-lookup (found / not_found / invalid) | notes l.86 | done | src/app/api/extension/linkedin-lookup/route.ts | |
| No recordBdSeen, same allowed-domain + confirmed rules | owner decision | done | src/lib/auth/lightSession.ts | |
| Unauthenticated never returns person data | owner decision | done | tests/unit/extensionLinkedinLookup.test.ts | middleware 307 + route 401 |
| Installed-state marker content script on the CRM origin | l.239 | done | extension/src/content/crmMarker.ts | |
| README with load-unpacked, localhost and store checklist | owner decision | done | extension/README.md | |

## Deviations needing an owner decision

1. Profile sub-pages (`/in/<slug>/details/…`, recent activity) get no card: only the profile root, where the top card the reader targets exists.
2. No `webNavigation` permission (it triggers an install warning about browsing history, which the mockup promises not to need); SPA changes are detected with the Navigation API plus a 1 s URL check.
3. `esbuild` was added as a devDependency (already in the lockfile through drizzle-kit and tsx) to bundle the extension; the alternative was an unbundled, dynamic-import content script.
4. Content script matches only `https://www.linkedin.com/*`; country subdomains such as `ar.linkedin.com` get no card.

## Not verified (cannot be, here)

- LinkedIn's real DOM: `extension/src/content/selectors.ts` lists best-effort selectors with fallbacks and is covered by synthetic fixtures only.
  Name, headline, company and location must be checked on a real profile (Spanish and English UI) before publishing.
- Install detection and the cookie-based session in a real Chrome/Edge/Brave install (needs the unpacked extension and the deployed CRM).
