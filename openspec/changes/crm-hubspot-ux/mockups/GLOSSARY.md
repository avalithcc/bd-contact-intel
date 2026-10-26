# Glossary — English term → Spanish UI term

Spanish register is decided by AUDIENCE, not by one house style. The rule below
describes what the code already does; the previous wording ("no voseo/tú"
everywhere) contradicted ~29 live strings and was corrected on 2026-10-26 by the
owner's decision.

| Where | Register | Example |
|---|---|---|
| Action labels (buttons, menu items) | Infinitive, never an imperative | "Guardar", "No contactar", "Posponer", "Reincorporar" — not "Guarda" and not "Guardá" |
| Prose addressed to the BD using the CRM | Rioplatense voseo | "Elegí una hora al menos 5 minutos adelante.", "Revisá su respuesta y decidí.", "Estás al día" |
| Copy a PROSPECT reads — the emails a sequence sends, the unsubscribe page | Neutral, professional Spanish. No voseo, no regional slang | the opt-out sentence, the legal footer, every draft body |

The third row is the one that matters commercially and is what the old blanket
rule was protecting: a prospect in Mexico or Colombia reading "Elegí" reads us as
foreign. The mistake was applying an outbound-email rule to the internal CRM.
No regional slang in any of the three.

Product/brand names (Gmail, LinkedIn, Avalith) stay as-is. "BD" stays as the
team's term. The sidebar item labelled "A quién contactar" (English: "Who to
contact") opens the contacts saved view `/contacts?view=outreach`; its internal
key stays `nav.outreach`. Changed 2026-10-26 because the team did not know what
"Outreach" meant; do not revert it. The separate `/outreach` route exists but
is not linked from the nav (its fate is undecided). The `/contacts` saved view
"Listos para Outreach" is a filter and is unchanged.

The section eyebrow above the Sequences and Scheduled titles is "Envíos"
(English: "Sends"). This deliberately deviates from `secuencias-lista.html`,
`envio-programado.html` and `secuencias-lista-admin.html`, which still say
"Outreach": the team did not recognise the word, and it names no real section
(the sidebar has only "Espacio de trabajo" and "Señales").

| English | Spanish |
|---|---|
| Contact / Contacts | Contacto / Contactos |
| Company / Companies | Empresa / Empresas |
| Owner | Responsable |
| Status | Estado |
| Lead status: new | Nuevo |
| Lead status: contacted | Contactado |
| Lead status: replied | Respondió |
| Lead status: meeting | Reunión |
| Lead status: discarded | Descartado |
| Saved views | Vistas guardadas (section/nav label: "Vistas") |
| Bulk actions | Acciones masivas |
| Log meeting | Registrar reunión |
| Connected BDs | BDs conectados |
| Duplicates | Duplicados |
| Dry run | Simulación |
| Search | Buscar |
| Filter(s) | Filtro(s) / Filtrar |
| View (noun) | Vista |
| View (verb) | Ver |
| Add | Agregar |
| Delete | Eliminar |
| Tasks | Tareas |
| Save | Guardar |
| Cancel | Cancelar |
| Discard contact | Descartar contacto |
| Create task | Crear tarea |
| Merge | Fusionar |
| Not a duplicate | No es duplicado |
| Undo merge | Deshacer fusión |
| Sign in | Iniciar sesión |
| Sign out | Cerrar sesión |
| Mockup hub | Panel de mockups |
| Design system | Sistema de diseño |
| In scope | En alcance |
| Restyle only (later change) | Solo rediseño (cambio posterior) |
| Backlog | Backlog (kept) |
| Company record | Ficha de empresa |
| Contact record | Ficha de contacto |
| Import | Importar |
| Timeline | Cronología |
| Account | Cuenta |
| Change password | Cambiar contraseña |
| Work email | Correo laboral |
| Meeting | Reunión |
| Note | Nota |
| Edit | Editar |
| Close | Cerrar |
| Open | Abrir |
| Confirm | Confirmar |
| Export | Exportar |
| Upload | Cargar |
| Column picker | Selector de columnas |
| Selection | Selección |
| Role group | Grupo de rol |
| Position / Title (job) | Cargo |
| Hiring | Vacantes abiertas |
| What's new | Novedades |
| Discovery | Descubrimiento de portales (full form: page title, breadcrumb, headings, prose). In the fixed-width sidebar nav item use the short form "Descubrimiento" — the full phrase overflows the nav row. |
| Approve / Reject | Aprobar / Rechazar |
| Board | Tablero |
| Drag | Arrastrar |
| Reason | Motivo |
| Notice | Aviso |
| Audit log | Registro de auditoría |
| Password | Contraseña |
| Connected | Conectado |
| Not configured | Sin configurar |
| Disconnect | Desconectar |
| Connect | Conectar |
| Preview | Vista previa |
| Send | Enviar |
| Draft | Borrador |
| AI | IA |
| Generate / Regenerate | Generar / Regenerar |
| Copy / Copied! | Copiar / ¡Copiado! |
| Language | Idioma |
| Profile | Perfil |
| Links | Enlaces |
| Loading... | Cargando… |
| Required | Obligatorio |
| Optional | Opcional |
