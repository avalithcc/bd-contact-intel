import { es } from "@/lib/i18n/dictionaries/es";
import { DEFAULT_SCHEDULE } from "@/lib/sequences/schedule";

/** What the Sequence screen hands its send controls, for the render tests of the presentational components. */
export const SEND = { labels: es.sendControl, schedule: DEFAULT_SCHEDULE, busy: false, error: null };
