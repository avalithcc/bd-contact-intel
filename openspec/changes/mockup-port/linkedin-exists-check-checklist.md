# LinkedIn exists-check mockup parity checklist

Source mockup: `openspec/changes/linkedin-exists-check/mockups/linkedin-ya-existe.html` (owner approved 2026-10-18,
all six items marked NEW). Shell chrome (sidenav, topbar, search) is the existing app shell and is not repeated here.

Columns: element | mockup ref | status | evidence | notes

## 1. Account: "Herramientas" card

| element | mockup ref | status | evidence | notes |
|---|---|---|---|---|
| Card between "Conexiones y seguridad" and "Importación", anchor `#herramientas` | s1 `#herramientas` | done | src/app/(app)/account/page.tsx:126 | |
| Card title "Herramientas" | s1 card-header | done | src/app/(app)/account/page.tsx:127 | |
| Tag "Nuevo" and accent outline on the card | s1 `.tag-scope`, `.new-outline` | deviation | — | Review annotation marking the NEW item, not product UI. Owner may ask for the tag. |
| Tool icon + "Guardar desde LinkedIn" + one-line description | s1 first `.row` | done | src/app/(app)/account/page.tsx:129-135 | Circle icon uses `page.module.css .toolIcon` (the DS `.qa-icon` is scoped under `.qa`). |
| Step 1 with number, title, draggable button "Guardar en el CRM" | s1 step-row 1 | done | src/app/(app)/account/page.tsx:138-149, src/app/(app)/account/LinkedinBookmarklet.tsx:28 | `javascript:` href set after mount (React blocks it as a prop). Origin from the request host, fallback `NEXT_PUBLIC_SITE_URL`. |
| Help text with Ctrl+Mayús+B / ⌘+Mayús+B kbd keys, `aria-describedby` | s1 `#bm-help` | done | src/app/(app)/account/page.tsx:146 | |
| Step 2 "Abre un perfil de LinkedIn y pulsa el botón" + description | s1 step-row 2 | done | src/app/(app)/account/page.tsx:151-157 | `.step`/`.stepN` in the account module, tokens only. |
| "Qué envía y qué no" neutral alert | s1 `.alert-neutral` | done | src/app/(app)/account/page.tsx:158-164 | |
| "Ver el código del botón" disclosure with read-only textarea | s1 `details` | done | src/app/(app)/account/page.tsx:165-173 | Mockup's `.more` class does not exist in the DS; native `details` + `.btn-ghost` summary. |

## 2. Contact record: "Ya está en el CRM" notice (`?from=linkedin`)

| element | mockup ref | status | evidence | notes |
|---|---|---|---|---|
| `.alert-info` with info icon, title, body | s2 `#ya-existe` | done | src/app/(app)/contacts/[id]/LinkedinExistsNotice.tsx:36-42 | Placed under the tab strip (RecordTabs `notice` slot), visible on both tabs. |
| Variant: other owner, "Responsable:" + owner chip | notes "Variantes" | done | src/app/(app)/contacts/[id]/LinkedinExistsNotice.tsx:46-52 | |
| Variant: "Este contacto es tuyo." | notes "Variantes" | done | src/app/(app)/contacts/[id]/LinkedinExistsNotice.tsx:44 | |
| Variant: "Sin responsable todavía." | notes "Variantes" | done | src/app/(app)/contacts/[id]/LinkedinExistsNotice.tsx:41 | |
| " · conexión más antigua (14 mar 2019)" suffix | s2 alert body | deviation | — | The app has no "oldest connection" owner hint anywhere (the About pane omits it too); showing a made-up basis would be fake data. |
| Dismiss button "Cerrar aviso", no persistence | s2 alert close | done | src/app/(app)/contacts/[id]/LinkedinExistsNotice.tsx:55 | |
| Merged-away key opens the survivor with the same notice | notes "Variantes" | done | src/lib/contacts/linkedinLookup.ts:20-31, src/app/(app)/contacts/[id]/page.tsx:120 | Lookup follows the chain; the record page redirect also keeps `?from=linkedin`. |

## 3. "Nuevo contacto" opened from `/contacts?new=1&linkedin=…`

| element | mockup ref | status | evidence | notes |
|---|---|---|---|---|
| `defaultOpen` and `initialLinkedin` props | notes NEW 3 | done | src/app/(app)/contacts/NewContactDialog.tsx:64-74 | |
| Page reads `new` and `linkedin`, re-validates the URL | notes NEW 3 | done | src/app/(app)/contacts/page.tsx:677 | A non-profile `linkedin` value is dropped. |
| Success alert "Esta persona aún no está en el CRM" | s3 `.alert-success` | done | src/app/(app)/contacts/NewContactDialog.tsx:121-128 | |
| Link field pre-filled; first name focused | s3 | done | src/app/(app)/contacts/NewContactDialog.tsx:79-84,138 | Pre-filled value is the normalized `https://linkedin.com/in/…` (no tracking query). |
| Field label "Enlace de LinkedIn", button "Crear contacto" | s3 | deviation | — | Existing, already approved dialog copy kept ("URL del perfil de LinkedIn", "Crear"), same as contacts.html. Owner decides if the copy should change everywhere. |

## 4. Route `/capture/linkedin` and the "enlace no válido" screen

| element | mockup ref | status | evidence | notes |
|---|---|---|---|---|
| Normalize to `profile_key`, find live person, redirect to record / new-contact | notes NEW 1 | done | src/app/(app)/capture/linkedin/page.tsx:24-28, src/lib/contacts/linkedinCapture.ts | |
| Error screen: eyebrow, h1 "enlace no válido", `.empty` card | s4 | done | src/app/(app)/capture/linkedin/page.tsx:41-62 | |
| Per-case messages (company, general, not LinkedIn, missing) | s4 table | done | src/lib/i18n/dictionaries/es.ts (`linkedinCapture.reason*`) | |
| "Recibimos <url>" line | s4 paragraph | done | src/app/(app)/capture/linkedin/page.tsx:60-65 | Host + path only, max 120 chars, no query string. |
| Buttons "Ir a contactos" / "Crear contacto sin enlace" | s4 | done | src/app/(app)/capture/linkedin/page.tsx:76-81 | Second goes to `/contacts?new=1` (empty dialog). |
| Table "Mensajes según el enlace recibido" | s4 second card | deviation | — | Spec documentation for the owner, not a screen element; its four rows are the messages above. |
| Breadcrumb "Contactos / Guardar desde LinkedIn" | s4 topbar | deviation | src/lib/shell/breadcrumbLabel.ts | The shell supports one label; shows "Contactos". |

## 5. Login with `next` to the capture route

| element | mockup ref | status | evidence | notes |
|---|---|---|---|---|
| Round trip of `/capture/linkedin?url=…` through `?next=` | s5 flow | done | tests/unit/linkedinCapture.test.ts ("survives the login") | Middleware and `sanitizeNextPath` unchanged. |
| Info alert "Inicia sesión para continuar con el perfil de LinkedIn que enviaste." | s5 `.alert-info` | done | src/app/(auth)/login/LoginForm.tsx:78-83 | The login form itself stays on the existing login styling (not part of this change). |
