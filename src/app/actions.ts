"use server";

import { revalidatePath } from "next/cache";
import { parseConnectionsCsv } from "@/lib/csv";
import { getCurrentBd, upsertContacts } from "@/lib/queries";

export interface UploadResult {
  ok: boolean;
  imported?: number;
  error?: string;
}

export async function uploadCsv(
  _prev: UploadResult | null,
  formData: FormData,
): Promise<UploadResult> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose a Connections.csv file first." };
  }
  try {
    const text = await file.text();
    const parsed = parseConnectionsCsv(text);
    if (!parsed.length) {
      return {
        ok: false,
        error:
          "No connections found. Make sure this is the LinkedIn Connections.csv export.",
      };
    }
    const me = await getCurrentBd();
    const imported = await upsertContacts(me.id, parsed);
    revalidatePath("/");
    return { ok: true, imported };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Upload failed." };
  }
}
