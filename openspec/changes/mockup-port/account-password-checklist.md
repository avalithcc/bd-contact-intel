# /account/password mockup parity checklist

Source mockup: `openspec/changes/crm-hubspot-ux/mockups/account-password.html`.
Task: require the CURRENT password before changing it, and match the form
content the mockup shows (fields, labels, order, helper text, minimum length,
error states) — see the task's own scope note below for what is explicitly
OUT of scope (the sidenav/topbar chrome).

Columns: element | mockup ref | status | evidence | notes

## Out of scope (owner-documented exception, not a silent omission)

| element | mockup ref | status | evidence | notes |
|---|---|---|---|---|
| Sidenav + topbar app shell | account-password.html:13-61 | deviation (pre-existing, documented) | `DESIGN.md` "App Shell" section: "Auth screens have no shell... `/account/password` render their own centered `.form-narrow` card with no Sidebar/TopBar chrome, matching mockups/login.html" | This is an existing, owner-approved decision (fresh-review fix on tasks.md 8.2, per `src/app/(auth)/layout.tsx`'s own doc comment), not something this task asked to change — the task's own "Why"/requirements only describe the form's fields/copy/minimum length, never the page chrome. Flagged here for visibility, not left silent. |
| Breadcrumbs "Cuenta / Contraseña" | account-password.html:36 | deviation (same reason) | — | Same shell exception as above. |
| Topbar search / "Crear" dropdown / account menu | account-password.html:37-59 | deviation (same reason) | — | Same shell exception as above. |

## Page header

| element | mockup ref | status | evidence | notes |
|---|---|---|---|---|
| Eyebrow "Cuenta" | account-password.html:64 | done | `PasswordForm.tsx` (`dict.account.eyebrow`), `es.ts`/`en.ts` `account.eyebrow` | Also fixes a pre-existing bug: the old value was the literal string `"// bienvenida"`, which combined with `design-system.css`'s `.eyebrow::before { content: "// " }` rendered as a doubled `"// // bienvenida"`. Now plain text, CSS supplies the `//`. |
| h1 "cambiar contraseña." | account-password.html:64 | done | `PasswordForm.tsx` (`dict.account.title` + `<span className="dot">`) | Recovery-session variant ("configura tu contraseña.") kept for the `/auth/confirm` landing case — see `isRecovery` below. |

## Form fields (`.card`/`.field` in the mockup → this page's existing `.panel` wrapper, see note)

| element | mockup ref | status | evidence | notes |
|---|---|---|---|---|
| "Contraseña actual" field | account-password.html:66 | done | `PasswordForm.tsx` (`id="cp"`, `.field`/`.label`/`.input`) | New — did not exist before this task. Rendered only when `requireCurrent` (i.e. NOT a detected recovery session); see requirement 2. |
| "Contraseña nueva" field + help "Al menos 12 caracteres." | account-password.html:67 | done | `PasswordForm.tsx` (`id="np"`, `aria-describedby="np-h"`), `src/lib/auth/passwordPolicy.ts` `MIN_NEW_PASSWORD_LENGTH = 12` | Minimum raised from the old hardcoded 8 to the mockup's 12, in one pure validator instead of an inline literal. |
| "Confirmar contraseña nueva" field | account-password.html:68 | done | `PasswordForm.tsx` (`id="np2"`) | Label text now matches the mockup exactly (was "Confirmar contraseña" before). |
| Per-field `is-invalid` + `error-text` (mockup demos this on confirm) | account-password.html:68 | done | `PasswordForm.tsx` (`className={`input${...}`}`, `<span className="error-text">`) | Same pattern reused for ALL three fields (current-password-incorrect, new-too-short, new-same-as-current, confirm-mismatch), not just the confirm field the static mockup happens to demo. |
| Footer: "Cancelar" (secondary, → `/account`) | account-password.html:69 | done | `PasswordForm.tsx` (`<Link href="/account" className="btn btn-secondary">`) | |
| Footer: "Actualizar contraseña" (primary submit) | account-password.html:69 | done | `PasswordForm.tsx` (`<button className="btn btn-primary">`) | Replaces the old "Guardar y continuar" copy. |

## Behavior (not visible markup, but required by the task)

| element | mockup ref | status | evidence | notes |
|---|---|---|---|---|
| Current password verified before changing anything | task requirement 1 | done | `PasswordForm.tsx` `submit()` — `supabase.auth.signInWithPassword({email, password: currentPassword})` before `updateUser` | Wrong current password → `{field:"current", code:"incorrect"}` → `dict.account.currentPasswordIncorrect`, nothing else called. Generic message only ("La contraseña actual no es correcta.") regardless of the provider's actual error (rate limit, etc.) |
| Recovery-session exception (skip current-password check) | task requirement 2 | done | `src/lib/auth/recoverySession.ts` `isRecoverySession`, `src/app/(auth)/account/password/page.tsx` | Reads the access token's `amr` JWT claim; fails closed (defaults to requiring current password) on any decode ambiguity — see module doc comment and `tests/unit/recoverySession.test.ts`. |
| New-password rules (min length, new≠current, confirm match) in one pure validator | task requirement 3 | done | `src/lib/auth/passwordPolicy.ts` `validatePasswordChange`, `tests/unit/passwordPolicy.test.ts` (11 tests) | Used by `PasswordForm.tsx`; no server path exists yet for this page (client-only, like the sibling `LoginForm`/`ForgotPasswordForm`), so there is only one call site today. |
| `scripts/reset-bd-password.ts` still covered by the normal path | task requirement 4 | done (confirmed, no change) | `scripts/reset-bd-password.ts:225-227` ("Tell {name} to sign in with it and change it immediately at /account/password") — read, not modified | The BD signs in normally with the temp password first (a real `signInWithPassword` grant → `amr` includes `"password"`), so `isRecoverySession` is false and the normal 3-field form (current password required) applies — exactly the flow requirement 1 protects. No change needed. |
| i18n symmetry `es.ts`/`en.ts` | task requirement 5 | done | `src/lib/i18n/dictionaries/es.ts`, `en.ts` `account.*` | Both updated in the same shape (`Dictionary = typeof en`, enforced by `tsc --noEmit`). |

## Deviations needing an owner decision

None found that block this task. The one pre-existing, documented deviation
(no sidenav/topbar shell on this page) is not new — it predates this change
and the task's own scope explicitly excludes it (see "Out of scope" above).

## Summary

Every row the task asked for is `done`. The three out-of-scope shell rows are
flagged, not silently dropped, and point at the exact `DESIGN.md` line that
already records the owner's decision for them.
