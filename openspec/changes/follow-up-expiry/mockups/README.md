# follow-up-expiry — mockup (documents what already shipped)

**This is not a proposal.** `seguimientos-vencidos.html` reconstructs the
"Vencidos" section of `/follow-ups` and its drop dialog as they exist in
production today, so the screen can be audited at all.

## Why it exists

`src/app/(app)/follow-ups/DropFollowUpButton.tsx:27` cites its design as
"follow-up-expiry mockup seguimientos-vencidos.html". That file was never
committed — `git log --all -- '*seguimientos-vencidos*'` returns nothing,
and it is nowhere under `openspec/`.

So the Vencidos cards, the deadline badges, the warning alert and the whole
drop dialog have been in production with **no approved contract to check
them against**. Found by the first `ux-auditor` run, 2026-11-17.

## How it was built

From the shipped code, not from memory or taste:

- Markup reproduced from `src/app/(app)/follow-ups/page.tsx` (`renderCard`
  with its `due` branch, and the `overdue` section) and
  `DropFollowUpButton.tsx`.
- **Every string was pulled verbatim out of
  `src/lib/i18n/dictionaries/es.ts`** by the generator, not retyped. If the
  copy reads oddly here, it reads that way in the product.
- Badge tones follow `deadlineBadgeClass` in `page.tsx`: danger at one day
  or less, warn at three or less, neutral beyond.

## What to do with it

Read it as the owner and ask of each piece: *would I have approved this?*

Anything that looks wrong here is a real finding, because it is already
being shown to BDs. If a piece is right, this file becomes the contract and
the screen stops being invisible to the auditor.

Two things worth a deliberate look, neither of which is a defect on its own:

1. The card markup is `card-body row` with no `align-items: flex-start`.
   That is the same omission that made the sequence member card float its
   action column, and a Vencido card is taller than a normal one. The
   `follow-up-queue` mockup has the same markup, so this is not drift from
   it — but it may be a defect both inherited.
2. The drop dialog's reason list is fixed in the component. A BD who does
   not fit a reason must pick "Otro" and write the detail, which is
   required in that case.

**Desktop only, by owner direction.**
