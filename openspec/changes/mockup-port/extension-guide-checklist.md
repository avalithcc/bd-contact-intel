# Extension install guide checklist

Mockup: `openspec/changes/linkedin-extension/mockups/instalar-extension.html` (sections 1 to 4). Copy is the mockup's Spanish, through
`src/lib/i18n/dictionaries/{es,en}.ts` (`extensionGuide`, `accountSettings.extension*`). Distribution is "Load unpacked"; the Web Store path is removed.

Status key: done / deviation / todo. Paths are relative to `src/app/(app)/account/` unless absolute-looking.

## Section 1 - Cuenta, card "Herramientas"

| element | mockup ref | status | evidence | notes |
| --- | --- | --- | --- | --- |
| Card shell + tool icon + title "Extensión para Chrome y Edge" (Brave removed) | s1 a/b/c | done | ExtensionTool.tsx:55-60 | Owner decision: Brave dropped from the title |
| State a: body copy | s1 a | done | ExtensionTool.tsx:59 | `extensionBody` |
| State a: "Descargar extensión" btn-primary btn-block with download icon | s1 a | done | ExtensionTool.tsx:70-73 | links to `/api/extension/download` |
| State a: file name + version help line | s1 a | done | ExtensionTool.tsx:74 | from the manifest version, never hand-written |
| State a: "Ver guía de instalación" link | s1 a | done | ExtensionTool.tsx:75 | to `/account/extension` |
| State b: badge "Instalada · vX" (success) | s1 b | done | ExtensionTool.tsx:61-65 | |
| State b: "Abre cualquier perfil..." body | s1 b | done | ExtensionTool.tsx:59 | |
| State b: secondary small "Ver guía de instalación" | s1 b | done | ExtensionTool.tsx:79-85 | |
| State c: warn badge "Instalada · vX" | s1 c | done | ExtensionTool.tsx:61-65 | |
| State c: warn alert "Hay una versión nueva (vY)" / "Tienes la vX." | s1 c | done | ExtensionTool.tsx:89-95 | |
| State c: "Descargar vY" primary + "Cómo actualizar" ghost (to `#actualizar`) | s1 c | done | ExtensionTool.tsx:96-104 | |
| State c: file name help line | s1 c | done | ExtensionTool.tsx:106 | |
| Privacy alert (all states) | s1 | done | ExtensionTool.tsx:109-115 | |
| Detection via `data-crm-extension`; no value = state a | note 1 | done | useInstalledExtension.ts:11-20, install.ts `extensionInstallState` | |
| "Nueva" = different from what the CRM serves; semver-numeric | note 2 | done | install.ts `compareVersions`, tests/unit/extensionInstall.test.ts | 1.10.0 > 1.9.0 tested |
| File name and version come from the current zip, never hand-written | note 3 | done | src/lib/extension/release.ts:15-23 | single source: `EXTENSION_VERSION` in extension/build/manifest.ts |
| "¿Usas Safari?" disclosure and the store state removed | note 4 | done | ExtensionTool.tsx (no store branch); `NEXT_PUBLIC_EXTENSION_STORE_URL` and `resolveExtensionStoreUrl` deleted | |
| Open question: drop "Brave" from the title | s1 q | done | es.ts `extensionTitle` | Resolved by the owner decision (Chrome and Edge only) |

## Section 2 - /account/extension, Chrome tab

| element | mockup ref | status | evidence | notes |
| --- | --- | --- | --- | --- |
| Breadcrumb "Cuenta / Extensión de LinkedIn" | s2 | done | extension/page.tsx:24-28 | plus TopBar label via `src/lib/shell/breadcrumbLabel.ts` |
| Page header h1 + subtitle with bold "Tarda unos 2 minutos..." | s2 | done | extension/page.tsx:30-41 | |
| Live banner: detected (success) | s2 | done | extension/ExtensionGuide.tsx:73-80 | |
| Live banner: not detected (neutral) | s2 | done | extension/ExtensionGuide.tsx:56-62 | only one alert at a time |
| Live banner: outdated variant | - | deviation | extension/ExtensionGuide.tsx:64-71 | Mockup has no outdated variant on the guide; shows the Cuenta warning ("Hay una versión nueva") with a link to the update section instead of a green "detectada". Owner to confirm |
| Tabs Chrome / Edge (real tablist, arrows/Home/End, client state, no URL change) | s2, note 3 | done | extension/ExtensionGuide.tsx:82-101 | |
| Initial tab from user agent (Edge if `Edg/`) | s2 note 3 | done | install.ts `defaultBrowserTab`, extension/page.tsx:45 | tested |
| Step 1 download button + file name | s2 | done | extension/GuideSteps.tsx `DownloadRow`, :197 | |
| Step 2 text + folder schematic + warn alert | s2 | done | GuideSteps.tsx `FolderMove`, `FolderWarning` | |
| Step 3 `chrome://extensions` + Copiar (-> "Copiado", toast) + help + schematic | s2 | done | GuideSteps.tsx `CopyAddress`, :204-214 | clipboard failure shows an error toast |
| Step 4 Modo de desarrollador schematic (toggle top right) | s2 | done | GuideSteps.tsx:215-225 | |
| Step 5 "Cargar descomprimida" schematic with folder | s2 | done | GuideSteps.tsx:226-244 | |
| Step 6 optional tag + puzzle/pin schematic | s2 | done | GuideSteps.tsx:245-247 | |
| Step 7 check + profile schematic with CRM card | s2 | done | GuideSteps.tsx:248-260 | |
| Illustrations are CSS blocks only (no logos/screenshots) | s2 note | done | extension/guide.module.css | |
| Brave note | s2 note | done | n/a | Not documented, as the mockup says |

## Section 3 - Edge tab

| element | mockup ref | status | evidence | notes |
| --- | --- | --- | --- | --- |
| Steps 1, 2 (short), 3 (`edge://extensions` + Copiar), 7 (short) | s3 | done | GuideSteps.tsx:263-277, 312 | |
| Step 4 toggle in the left menu (side-panel schematic) | s3 | done | GuideSteps.tsx:278-289 | |
| Step 5 "Cargar desempaquetada" | s3 | deviation | GuideSteps.tsx:290-308, es.ts `loadUnpackedEdge` | Label exactly as the mockup (open question in the mockup): not verified on an Edge in Spanish |
| Step 6 eye icon to show in toolbar | s3 | done | GuideSteps.tsx:309-311 | |
| No mention of "Permitir extensiones de otras tiendas" | s3 note | done | n/a | |

## Section 4 - Update, FAQ, privacy

| element | mockup ref | status | evidence | notes |
| --- | --- | --- | --- | --- |
| "Cómo actualizar..." heading + intro, anchor `#actualizar` | s4 | done | GuideSteps.tsx:318-324 | |
| Update step 1 "Descargar vY" + file name (same route as the first step) | s4 | done | GuideSteps.tsx:325-332 | |
| Update step 2 replace folder contents | s4 | done | GuideSteps.tsx:333 | |
| Update step 3 reload extension + schematic | s4 | done | GuideSteps.tsx:334-348 | |
| "Problemas frecuentes" five collapsibles, only the first open | s4 | done | GuideSteps.tsx:352-376 | native `<details>` |
| Privacy alert | s4 | done | extension/ExtensionGuide.tsx:114-120 | reuses `toolPrivacy*` strings |
| Loading skeleton | - | done | extension/loading.tsx | |

## Distribution (owner decisions)

| element | status | evidence | notes |
| --- | --- | --- | --- |
| Zip `crm-linkedin-v<version>.zip`, single top folder `crm-linkedin/` with manifest.json | done | extension/build/pack.ts, zip.ts; tests/unit/extensionZip.test.ts | store manifest variant only |
| Built in `npm run build` (Vercel), fails loudly when missing/stale/dev variant | done | package.json `build`, `extension:zip`; pack.ts `assertDistComplete` | |
| Served behind the session | done | src/app/api/extension/download/route.ts | `next.config.mjs` traces `extension/zip/**` |
| Release = bump `EXTENSION_VERSION` only | done | extension/build/manifest.ts, extension/README.md | |
| README rewritten (load unpacked, release, Web Store note at the end) | done | extension/README.md | |
