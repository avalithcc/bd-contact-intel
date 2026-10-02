import type { RoleGroupKey } from "@/lib/roleGroups";

/**
 * Static BD playbook content ("Guía de roles" — openspec/changes/
 * bd-playbook). One entry per `RoleGroupKey` (src/lib/roleGroups.ts):
 * which role to contact, what they decide, what pain Avalith solves for
 * them, when they're the wrong person, and a priority tier.
 *
 * Copy is taken verbatim from the approved mockup
 * (openspec/changes/bd-playbook/mockups/bd-playbook.html), itself sourced
 * from `playbook-content.md` next to it, which cites `avalith/contexto/
 * empresa.md` for every Avalith fact. Every inferred/unconfirmed claim is
 * marked "" in the copy itself — visible to the BD reading it,
 * not buried in a footnote.
 *
 * Static and developer-edited on purpose (owner decision 2026-09-30): no
 * admin UI was asked for, so a content change is a PR to this file, not a
 * runtime edit. Not counted toward this change's code line budget (task
 * brief) — this file is content, not logic.
 */

export type PlaybookPriority = "alta" | "media" | "baja" | "no_priorizar" | "revisar";

// Badge classes already defined in design-system.css (`.badge-*`) — no new
// color was invented for this feature (README.md decision 4).
export const PRIORITY_BADGE_CLASS: Record<PlaybookPriority, string> = {
  alta: "badge badge-success",
  media: "badge badge-warn",
  baja: "badge badge-neutral",
  no_priorizar: "badge badge-danger",
  revisar: "badge badge-outline no-dot",
};

export interface RoleGroupPlaybookEntry {
  /** Subtitle under the card title, e.g. "CTO, CIO, CDO, CPO técnico". */
  subtitle: string;
  priority: PlaybookPriority;
  /** Exact badge text — differs from the generic tier for `other`/`no_position`. */
  priorityLabel: string;
  /** "Qué decide" — omitted (together with painSolved/wrongPerson) for
   * `other`/`no_position`, which use `note` instead. */
  decides?: string;
  /** "Qué dolor resuelve Avalith". */
  painSolved?: string;
  /** "Cuándo es la persona equivocada". */
  wrongPerson?: string;
  /** Explanatory note replacing the three fields above for `other`/`no_position`. */
  note?: string;
}

export const ROLE_GROUP_PLAYBOOK: Record<RoleGroupKey, RoleGroupPlaybookEntry> = {
  c_level_tech: {
    subtitle: "CTO, CIO, CDO, CPO técnico",
    priority: "alta",
    priorityLabel: "Alta",
    decides:
      "Arquitectura y stack, presupuesto de ingeniería, y suele tener la última palabra técnica sobre a quién se contrata.",
    painSolved:
      "Cubrir posiciones senior que el equipo no puede llenar a tiempo, con Staff Augmentation (ingenieros senior pre-evaluados, incorporados en días). Para reconstruir o lanzar un producto completo, Turnkey/Product Delivery.",
    wrongPerson:
      "Cuando la compra de proveedores la aprueba Finanzas o un C-Level de negocio y este rol solo opina técnicamente.",
  },
  c_level_business: {
    subtitle: "CEO, COO, CFO, CMO, founders, owners",
    priority: "alta",
    priorityLabel: "Alta",
    decides:
      "Presupuesto general y aprobación final de gasto en proveedores externos; en empresas chicas también la decisión técnica.",
    painSolved:
      "Escalar el equipo de ingeniería/producto sin asumir el costo y el riesgo de contratar directamente. Para decidir si vale la pena construir algo antes de construirlo, Product Discovery.",
    wrongPerson:
      "En empresas más grandes con un CTO/VP de Ingeniería que ya tiene presupuesto delegado.",
  },
  eng_leadership: {
    subtitle: "VP / Head / Director de Ingeniería o Tecnología",
    priority: "alta",
    priorityLabel: "Alta",
    decides:
      "La dotación de su organización de ingeniería; suele evaluar y seleccionar proveedores de staff augmentation o dedicated teams.",
    painSolved:
      'Es el destinatario más directo de "roles que el mercado no puede cubrir a tiempo". Dedicated Teams, con un PM técnico incluido, encaja para escalar sin sumar headcount fijo.',
    wrongPerson:
      "Si la empresa centraliza la compra de proveedores en Procurement/Finanzas y este rol solo define requerimientos técnicos.",
  },
  engineering_manager: {
    subtitle: "Engineering Manager",
    priority: "media",
    priorityLabel: "Media",
    decides:
      "La gestión diaria de un equipo o squad; rara vez controla el presupuesto de proveedores externos, aunque puede iniciar el pedido.",
    painSolved:
      "El mismo problema que Liderazgo de Ingeniería pero a escala de un equipo — cubrir una vacante puntual con Staff Augmentation.",
    wrongPerson:
      "Cuando no tiene autoridad de compra; sigue siendo un buen punto de entrada, no quien cierra el trato.",
  },
  tech_lead_architect: {
    subtitle: "Tech Lead, Team Lead, Architect, Staff/Principal Engineer",
    priority: "baja",
    priorityLabel: "Baja",
    decides:
      "Decisiones técnicas de arquitectura y calidad de código; puede validar si un proveedor es idóneo, casi nunca aprueba el gasto.",
    painSolved:
      'La garantía de calidad — "production-ready desde 2011" — responde a su preocupación típica sobre la calidad de un equipo externo.',
    wrongPerson: "Como decisor de compra, casi siempre — es influenciador técnico, no comprador.",
  },
  product: {
    subtitle: "Product Manager / Owner / Lead / Director",
    priority: "media",
    priorityLabel: "Media",
    decides:
      "Qué se construye y con qué prioridad; puede impulsar un Product Discovery o un Turnkey Delivery antes de involucrar a Ingeniería.",
    painSolved:
      "Research, estimación y roadmap antes de desarrollar (Product Discovery); llevar un MVP de concepto a lanzamiento rápido con IA (AI MVPs).",
    wrongPerson:
      "Si no participa de la decisión de a quién contratar para construir (suele quedar en Ingeniería o C-Level).",
  },
  project_delivery: {
    subtitle: "PM, Program Manager, Delivery Lead, Scrum Master, PMO",
    priority: "baja",
    priorityLabel: "Baja",
    decides: "Cronograma y coordinación de proveedores ya contratados; rara vez selecciona al proveedor.",
    painSolved:
      "Dedicated Teams ya incluye un PM técnico propio de Avalith, lo que puede aliviar o superponerse con este rol según el caso — aclarar el encaje antes de vender.",
    wrongPerson: "Casi siempre como decisor de compra — es quien ejecuta, no quien elige al proveedor.",
  },
  developers: {
    subtitle: "Developer, Engineer, QA, SRE, DevOps",
    priority: "no_priorizar",
    priorityLabel: "No priorizar",
    decides:
      "Nada relacionado a la compra de un proveedor; a lo sumo opina sobre el enfoque técnico si se lo consultan.",
    painSolved: "Ninguno de forma directa — no son compradores.",
    wrongPerson: "Siempre, a efectos de outreach comercial.",
  },
  hr_recruiting: {
    subtitle: "Recruiter, Talent, HR, People",
    priority: "media",
    priorityLabel: "Media",
    decides:
      "Procesos de contratación interna; en algunas empresas también gestiona proveedores de staffing.",
    painSolved:
      "La dificultad de contratar ingenieros senior rápido — US Placements coloca desarrolladores directamente en empresas de EE. UU. y es una conversación natural con Talent/HR.",
    wrongPerson:
      "Cuando HR solo gestiona reclutamiento interno y no tiene mandato para evaluar proveedores externos de desarrollo.",
  },
  hospitality_revenue: {
    subtitle: "Revenue Manager, Reservations, Channel / Distribution Manager",
    priority: "media",
    priorityLabel: "Media",
    decides:
      "El stack de reservas y distribución del hotel (PMS, channel manager, motor de reservas, herramientas de revenue) y las integraciones entre ellos; suele evaluar y proponer proveedores de tecnología.",
    painSolved:
      "Integraciones y desarrollo a medida sobre el stack de reservas y canales que el equipo interno no alcanza a cubrir — Staff Augmentation para reforzar un equipo chico, o un proyecto acotado de integración.",
    wrongPerson:
      "Como decisor de presupuesto: es un interlocutor real que conoce el problema, pero la aprobación final de gasto suele estar en la Dirección General o de Finanzas.",
  },
  sales_bd: {
    subtitle: "Sales, Account Manager, Marketing, Customer Success",
    priority: "no_priorizar",
    priorityLabel: "No priorizar",
    decides:
      "Nada relacionado a la compra de desarrollo de software, salvo que la empresa contactada sea un partner o un competidor a mapear.",
    painSolved: "En general, ninguno — no es el comprador de servicios de ingeniería.",
    wrongPerson:
      "Casi siempre — es el mismo tipo de rol que el propio equipo de BD de Avalith, no el cliente objetivo.",
  },
  operations: {
    subtitle: "Operations, Head of Ops, Guest & Event Operations",
    priority: "baja",
    priorityLabel: "Baja",
    decides:
      "Procesos operativos; a veces controla presupuesto de herramientas o proveedores si el área depende de Operaciones.",
    painSolved:
      "Variable según el caso — no hay evidencia de que Operaciones sea un comprador típico de desarrollo de software.",
    wrongPerson: "Cuando el área no tiene relación con ingeniería o producto.",
  },
  other: {
    subtitle: "Cargo no reconocido por el clasificador",
    priority: "revisar",
    priorityLabel: "Revisar",
    note: "El clasificador (src/lib/roleGroups.ts) no reconoció el cargo textual en ninguna regla. No hay contenido genérico posible acá — revisar el cargo real del contacto en LinkedIn antes de descartar o priorizar.",
  },
  no_position: {
    subtitle: "Sin Cargo registrado",
    priority: "revisar",
    priorityLabel: "No evaluable",
    note: "No hay Cargo registrado para el contacto — no hay información para evaluar ninguno de los puntos anteriores. Buscar el cargo en LinkedIn o pedirlo antes de contactar.",
  },
};

/** "Grupos que no vale la pena priorizar" alert (mockup bd-playbook.html:67-73). */
export const NOT_WORTH_PRIORITIZING: {
  noPriorizar: { keys: RoleGroupKey[]; note: string };
  baja: { keys: RoleGroupKey[]; note?: string };
  revisar: { keys: RoleGroupKey[]; note: string };
} = {
  noPriorizar: {
    keys: ["developers", "sales_bd"],
    note: "no son compradores del servicio, salvo mapeo puntual de partners en Ventas y BD.",
  },
  baja: {
    keys: ["project_delivery", "tech_lead_architect", "operations"],
  },
  revisar: {
    keys: ["other", "no_position"],
    note: "revisar el cargo real antes de decidir.",
  },
};
