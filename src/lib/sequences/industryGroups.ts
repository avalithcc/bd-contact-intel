/**
 * The industry groups the roster picker filters by. A group is only a SHORTCUT for its raw values: the query carries the
 * raw values (pickerFilters.industries), never a group key, so what is filtered is always visible and exact.
 *
 * Inlined as a typed const rather than imported from the JSON in openspec/: that folder is a planning artifact that is not
 * part of the bundle, and a mapping the app depends on belongs next to its test. The 91 values were verified against
 * production (2026-10-23): they sum to the measured 3,828 contacts, none is without a group, none is in two. They are
 * matched EXACTLY, as stored: one value really has a double space ("Tecnología y servicios  de la Información"), the data has no
 * case or whitespace variants that collapse, and a normalizing match would only hide a typo. Do not "fix" that value.
 *
 * Client-safe (no ORM import). The Spanish and English labels live in the dictionaries; the keys are identifiers.
 */
export const INDUSTRY_GROUPS = {
  tecnologia: ["Software de ordenador", "Tecnología y servicios  de la Información", "Telecomunicaciones", "Hardware de ordenador", "Inalámbrico", "Desarrollo del programas", "Redes informáticas", "Seguridad informática y de red", "Internet", "Externalización/Offshoring"],
  energia: ["Petróleo y energía", "Agua, luz, gas", "Renovables y medio ambiente", "Minería y metales", "Productos químicos"],
  finanzas: ["Servicios financieros", "Banca", "Mercados de capitales", "Seguros", "Contabilidad", "Banca de inversión", "Gestión de inversiones"],
  salud: ["Ámbito sanitario y hospitalario", "Productos farmacéuticos", "Salud, bienestar y fitness", "Biotecnología", "Práctica médica", "Dispositivos médicos"],
  educacion_rh: ["Formación profesional y coaching", "Recursos humanos", "Administración de educación", "Educación superior", "Educación primaria/secundaria", "Dotación de personal y reclutamiento", "E-Learning"],
  industria_ingenieria: ["Ingeniería civil", "Ingeniería industrial o mecánica", "Construcción", "Materiales de construcción", "Maquinaria", "Automoción", "Nanotecnología", "Defensa y espacio", "Manufactura eléctrica/electrónica"],
  marketing_diseno: ["Diseño", "Diseño gráfico", "Marketing y publicidad", "Entretenimiento", "Impresión", "Relaciones públicas y comunicaciones", "Publicación", "Medios de difusión", "Periódicos", "Fotografía", "Medios en línea", "Producción de medios", "Investigación de mercado"],
  consumo_retail: ["Minoristas", "Bienes de consumo", "Alimentos y bebidas", "Producción de alimentos", "Servicio al consumidor", "Restaurantes", "Vino y licores", "Supermercados", "Textiles", "Ropa y moda", "Productos cosméticos", "Electrónica de consumo", "Artículos deportivos", "Venta al por mayor", "Envases y contenedores", "Productos de papel y forestales", "Tabaco"],
  logistica: ["Transporte/camiones/ferrocarril", "Logística y cadena de suministros", "Aerolíneas/aviación"],
  otras: ["Administración pública", "Bienes inmuebles", "Bienes inmuebles comerciales", "Consultoría de gestión", "Práctica de derecho", "Servicios jurídicos", "Seguridad e Investigaciones", "Ocio, viajes y turismo", "Sector hotelero", "Artículos y equipamiento de oficina", "Juegos de apuestas y casinos", "Servicios individuales y familiares", "Comercio internacional y desarrollo", "Deportes"],
} as const satisfies Record<string, readonly string[]>;

export type IndustryGroupKey = keyof typeof INDUSTRY_GROUPS;
/** Display order of the chips. */
export const INDUSTRY_GROUP_KEYS = Object.keys(INDUSTRY_GROUPS) as IndustryGroupKey[];

const GROUP_OF = new Map<string, IndustryGroupKey>(INDUSTRY_GROUP_KEYS.flatMap((k) => INDUSTRY_GROUPS[k].map((v) => [v, k] as const)));

/** Every raw value the picker may filter on: the only strings `normalizePickerQuery` lets through. */
export const KNOWN_INDUSTRY_VALUES: ReadonlySet<string> = new Set(GROUP_OF.keys());

export const industryValuesOf = (group: IndustryGroupKey): readonly string[] => INDUSTRY_GROUPS[group];
export const industryGroupOf = (value: string): IndustryGroupKey | null => GROUP_OF.get(value) ?? null;
