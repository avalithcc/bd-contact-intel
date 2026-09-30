# BD playbook — content per role group

Sources read in full before writing this: `avalith/contexto/empresa.md`,
`avalith/contexto/rol-objetivos.md`, `avalith/contexto/hiring/target-companies.json`,
`avalith/CLAUDE.md`. Citations below point to the first file unless noted
otherwise. `avalith/contexto/rol-objetivos.md` and `target-companies.json`
contained no facts usable for role-targeting rationale (the former is
Cristian's own role and current YPF focus; the latter is a list of companies
to scrape for hiring signals, not a statement about who buys Avalith's
services) — they are not cited below because they have nothing on-topic to
cite.

**Reading of the source material.** `empresa.md` documents what Avalith
sells and who it has sold to; it explicitly flags that the real ICP ("who
actually buys") is *unconfirmed*. That means everything below connecting a
role group to "why they buy" is a reasoned inference from the service
catalog, not a documented fact. Every such inference is marked
**(supuesto)**. Nothing in this file states a role-buying pattern as
confirmed fact.

## Avalith facts used throughout (all from `empresa.md`)

- Six services: Staff Augmentation (pre-vetted senior engineers embedded
  within days), Dedicated Teams (multi-role squads with a technical PM),
  Turnkey/Product Delivery (end-to-end custom software and mobile), Product
  Discovery (research/estimation/roadmapping before building), US
  Placements (direct developer placement into US companies), AI MVPs
  (rapid AI-accelerated build from concept to launch).
- Positioning: "human-led, AI-accelerated delivery"; fills senior roles "the
  market can't hire fast enough"; production-ready quality since 2011;
  Avalith Academy trains talent in-house; small senior teams; timezone
  coverage from Mar del Plata (AR), Miami (US), Madrid (ES), Quito (EC);
  2,000+ pre-vetted developers in network.
- Named clients: Mercado Libre, Accenture, CookUnity, Global Hitss,
  GlobalLogic, Jampp, MODO, Ualá.
- Unconfirmed in `empresa.md` (marked `(?)` there): real target market/ICP,
  revenue model and target deal size, competitors. These gaps are the
  reason the role-to-service mapping below stays a labelled assumption
  instead of a stated fact.

## How to read each entry

- **Qué decide** — what this role typically controls in a company Avalith
  might sell to.
- **Qué dolor resuelve Avalith** — which service (cited above) answers that
  role's concern, and why.
- **Cuándo es la persona equivocada** — the situation where contacting this
  role wastes a BD's time.
- **Prioridad** — Alta / Media / Baja / No priorizar, per the owner's ask to
  flag which role groups aren't worth prioritising.

Order matches `ROLE_GROUPS` in `src/lib/roleGroups.ts`.

---

### `c_level_tech` — C-Level Tech (CTO, CIO, CDO, CPO tech-side)

- **Qué decide:** arquitectura y stack, presupuesto de ingeniería, la
  decisión de construir internamente vs. traer un proveedor externo, y
  suele tener la última palabra técnica sobre a quién se contrata.
  **(supuesto)**
- **Qué dolor resuelve Avalith:** cubrir posiciones senior que el equipo no
  puede llenar a tiempo — el propio posicionamiento de Avalith apunta a
  llenar roles "que el mercado no puede cubrir a tiempo" mediante Staff
  Augmentation, con ingenieros senior pre-evaluados incorporados en días
  (`empresa.md`). Si la conversación es sobre reconstruir o lanzar un
  producto completo, encaja mejor Turnkey/Product Delivery (`empresa.md`).
- **Cuándo es la persona equivocada:** en empresas donde la compra de
  proveedores la aprueba Finanzas o un C-level de negocio y el rol técnico
  solo opina — ahí es influenciador, no decisor final. **(supuesto)**
- **Prioridad:** Alta. **(supuesto)**

### `c_level_business` — C-Level / Fundadores (CEO, COO, CFO, CMO, founders, owners)

- **Qué decide:** presupuesto general y la aprobación final de gasto en
  proveedores externos; en empresas chicas suele concentrar también la
  decisión técnica. **(supuesto)**
- **Qué dolor resuelve Avalith:** necesidad de escalar el equipo de
  ingeniería/producto sin asumir el costo y el riesgo de contratar y
  gestionar directamente — la promesa de calidad "production-ready desde
  2011" (`empresa.md`) está pensada para quien pone el presupuesto en juego.
  Para decidir si vale la pena invertir en construir algo antes de
  construirlo, Product Discovery (`empresa.md`).
- **Cuándo es la persona equivocada:** en compañías más grandes con un
  CTO/VP de Ingeniería que ya tiene presupuesto delegado, este rol puede no
  involucrarse en la selección de un proveedor técnico puntual.
  **(supuesto)**
- **Prioridad:** Alta, en especial en startups/scale-ups donde el fundador
  concentra la decisión. **(supuesto)**

### `eng_leadership` — Liderazgo de Ingeniería (VP/Head/Director de Ingeniería o Tecnología)

- **Qué decide:** la dotación de su organización de ingeniería, y suele ser
  quien evalúa y selecciona proveedores de staff augmentation o dedicated
  teams. **(supuesto)**
- **Qué dolor resuelve Avalith:** es el destinatario más directo del
  mensaje "roles que el mercado no puede cubrir a tiempo" (`empresa.md`);
  Dedicated Teams, con un PM técnico incluido, encaja cuando necesita
  escalar sin sumar headcount fijo (`empresa.md`).
- **Cuándo es la persona equivocada:** si la empresa centraliza la compra
  de proveedores en Procurement/Finanzas y este rol solo define
  requerimientos técnicos. **(supuesto)**
- **Prioridad:** Alta — es, en general, el comprador técnico más directo.
  **(supuesto)**

### `engineering_manager` — Gerentes de Ingeniería

- **Qué decide:** la gestión diaria de un equipo o squad; rara vez controla
  el presupuesto de proveedores externos, aunque puede iniciar el pedido.
  **(supuesto)**
- **Qué dolor resuelve Avalith:** el mismo problema que Liderazgo de
  Ingeniería pero a escala de un equipo — cubrir una vacante puntual con
  Staff Augmentation (`empresa.md`).
- **Cuándo es la persona equivocada:** cuando no tiene autoridad de compra;
  sigue siendo útil como punto de entrada que puede escalar la
  conversación, no como quien cierra el trato. **(supuesto)**
- **Prioridad:** Media — buen punto de entrada; seguir la cadena hacia
  Liderazgo de Ingeniería o C-Level Tech para cerrar. **(supuesto)**

### `tech_lead_architect` — Tech Leads y Arquitectos

- **Qué decide:** decisiones técnicas de arquitectura y calidad de código;
  puede validar si un proveedor es técnicamente idóneo, casi nunca aprueba
  el gasto. **(supuesto)**
- **Qué dolor resuelve Avalith:** la garantía de calidad — "production-ready
  desde 2011" (`empresa.md`) — responde a su preocupación típica sobre la
  calidad de un equipo externo.
- **Cuándo es la persona equivocada:** como decisor de compra, casi siempre
  — es influenciador técnico, no comprador. **(supuesto)**
- **Prioridad:** Media-baja como contacto principal; útil para validar
  calidad técnica antes de escalar la conversación. **(supuesto)**

### `product` — Producto (Product Manager/Owner/Lead/Director)

- **Qué decide:** qué se construye y con qué prioridad; puede impulsar un
  Product Discovery o un Turnkey Delivery antes de involucrar a Ingeniería.
  **(supuesto)**
- **Qué dolor resuelve Avalith:** necesidad de research, estimación y
  roadmap antes de desarrollar — Product Discovery (`empresa.md`); llevar
  un MVP de concepto a lanzamiento rápido con IA — AI MVPs (`empresa.md`).
- **Cuándo es la persona equivocada:** si no participa de la decisión de a
  quién contratar para construir (eso suele quedar en Ingeniería o
  C-Level). **(supuesto)**
- **Prioridad:** Media — fuerte para Discovery/AI MVPs, débil para Staff
  Augmentation puro. **(supuesto)**

### `project_delivery` — Proyectos y Delivery (PM, Program Manager, Delivery Lead, Scrum Master, PMO)

- **Qué decide:** cronograma y coordinación de proveedores ya contratados;
  rara vez selecciona al proveedor. **(supuesto)**
- **Qué dolor resuelve Avalith:** Dedicated Teams ya incluye un PM técnico
  propio de Avalith (`empresa.md`), lo que puede aliviar o superponerse con
  este rol según el caso — vale la pena aclarar el encaje antes de vender.
- **Cuándo es la persona equivocada:** casi siempre como decisor de compra
  — es quien ejecuta, no quien elige al proveedor. **(supuesto)**
- **Prioridad:** Baja como contacto de venta; útil como referencia o
  influenciador. **(supuesto)**

### `developers` — Desarrolladores

- **Qué decide:** nada relacionado a la compra de un proveedor; a lo sumo
  opina sobre el enfoque técnico si se lo consultan. **(supuesto)**
- **Qué dolor resuelve Avalith:** ninguno de forma directa — no son
  compradores.
- **Cuándo es la persona equivocada:** siempre, a efectos de outreach
  comercial. **(supuesto)**
- **Prioridad:** No priorizar.

### `hr_recruiting` — RRHH y Reclutamiento

- **Qué decide:** procesos de contratación interna; en algunas empresas
  también gestiona proveedores de staffing, lo que le da injerencia sobre
  Staff Augmentation o US Placements. **(supuesto)**
- **Qué dolor resuelve Avalith:** la dificultad de contratar ingenieros
  senior rápido — US Placements coloca desarrolladores directamente en
  empresas de EE. UU. (`empresa.md`) y es una conversación natural con
  Talent/HR de la empresa contratante.
- **Cuándo es la persona equivocada:** cuando HR solo gestiona reclutamiento
  interno y no tiene mandato para evaluar proveedores externos de
  desarrollo. **(supuesto)**
- **Prioridad:** Media, específicamente para US Placements; baja para el
  resto de los servicios. **(supuesto)**

### `sales_bd` — Ventas y BD (incluye Marketing, Customer Success)

- **Qué decide:** nada relacionado a la compra de desarrollo de software,
  salvo que la empresa contactada sea un partner o un competidor a mapear.
  **(supuesto)**
- **Qué dolor resuelve Avalith:** en general, ninguno — no es el comprador
  de servicios de ingeniería.
- **Cuándo es la persona equivocada:** casi siempre — es el mismo tipo de
  rol que el propio equipo de BD de Avalith, no el cliente objetivo.
  **(supuesto)**
- **Prioridad:** No priorizar, salvo mapeo puntual de partners.
  **(supuesto)**

### `operations` — Operaciones

- **Qué decide:** procesos operativos; a veces controla presupuesto de
  herramientas o proveedores si el área depende de Operaciones.
  **(supuesto)**
- **Qué dolor resuelve Avalith:** variable según el caso — no hay evidencia
  en `empresa.md` de que Operaciones sea un comprador típico de desarrollo
  de software.
- **Cuándo es la persona equivocada:** cuando el área no tiene relación con
  ingeniería o producto. **(supuesto)**
- **Prioridad:** Baja, evaluar caso a caso. **(supuesto)**

### `other` — Otro

El clasificador (`src/lib/roleGroups.ts`) no reconoció el cargo textual en
ninguna regla. No hay contenido genérico posible aquí — revisar el cargo
real del contacto en LinkedIn antes de descartar o priorizar.

- **Prioridad:** revisar manualmente, caso a caso.

### `no_position` — Sin cargo

No hay cargo registrado para el contacto — no hay información para evaluar
ninguno de los puntos anteriores.

- **Prioridad:** no evaluable hasta completar el dato (buscar el cargo en
  LinkedIn o pedirlo antes de contactar).

---

## Grupos que no vale la pena priorizar

Resumen pedido explícitamente por el owner, para que sea visible sin abrir
cada grupo:

- **No priorizar:** `developers` (Desarrolladores), `sales_bd` (Ventas y
  BD) — no son compradores del servicio, salvo el caso puntual de mapeo de
  partners en `sales_bd`.
- **Prioridad baja:** `project_delivery` (Proyectos y Delivery),
  `tech_lead_architect` (Tech Leads y Arquitectos, bajo como contacto
  principal), `operations` (Operaciones).
- **No evaluable sin más datos:** `other` (Otro), `no_position` (Sin
  cargo) — requieren revisión manual del cargo real antes de decidir.

## Assumption list (for the owner to confirm)

Every item below is marked `(supuesto)` in the content above because
`empresa.md` itself flags the real ICP, pricing/deal size and competitors
as unconfirmed (`(?)` in that file). Confirming these would let a future
revision replace "(supuesto)" with a cited fact:

1. Who actually holds budget authority for each service, per role group —
   inferred from typical B2B software-staffing buying patterns, not from
   an Avalith-specific source.
2. Whether `c_level_business` or `eng_leadership` is the primary decision
   maker varies by company size — assumed here, not measured.
3. Whether `hr_recruiting` has real influence over US Placements decisions,
   or if that's always owned by `eng_leadership`/`c_level_tech`.
4. Whether `project_delivery` and `tech_lead_architect` are worth any BD
   time at all, or should also move to "No priorizar".
5. The real ICP and deal size (`empresa.md`'s own open question) would
   likely change which role groups are "Alta" vs. "Media" — this playbook
   cannot resolve that gap; it only structures the reasoning so the owner
   can correct it per group.
