# sequence-generating-lock checklist

| element | mockup ref | status | evidence | notes |
|---|---|---|---|---|
| Persistent info banner with spinner, names the member | generando.html:63 | done | SequenceDetailView.tsx (lock.active block) | Disappears on success and failure (finally clears the id) |
| Banner failure line | generando.html:63 | deviation | es.ts generatingBannerFail | Mockup says "te lo decimos acá"; failure is reported by the existing toast, so the copy says "te avisamos" |
| Generating card: spinner + "Generando…" disabled button | generando.html:75 | done | MemberCard.tsx generate button | Spinner replaces the icon |
| Other cards: Generar borrador disabled with reason title | generando.html:86 | done | MemberCard.tsx waitTitle | |
| Regenerar in card menu disabled | generando.html:100 | done | MemberCard.tsx menu item | |
| Header approve-ready disabled with title | generando.html:60 | done | SequenceHeader.tsx | |
| Bulk "Aprobar los N listos" disabled | closing table | done | BulkBar.tsx | |
| Revisar / Aprobar of OTHER members enabled | closing table | done | generationLock.ts card() | Own card of the member in flight is locked (race on its own draft) |
| Quitar, Abrir ficha, navigation enabled | closing table | done | unchanged | |
| Review dialog Regenerar locked | (implied: every regenerate) | done | ReviewDialog.tsx regenerateLocked | |
| Reduced motion | design-system.css:760 | done | existing guard covers .btn .spinner and .spinner-standalone | |
