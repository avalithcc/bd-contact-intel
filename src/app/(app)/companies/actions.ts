"use server";

import { revalidatePath } from "next/cache";
import { createCompany, updateCompany } from "@/lib/companies/queries";
import { getCurrentBd } from "@/lib/queries";
import type { NewCompany } from "@/db/schema";

export async function createCompanyAction(input: {
  companyKey: string;
  displayName: string;
  relationshipStage?: string;
  revenuePotential?: number;
  notes?: string;
}) {
  const me = await getCurrentBd();

  const company = await createCompany({
    ...input,
    createdByBdId: me.id,
    updatedByBdId: me.id,
  } as NewCompany);

  revalidatePath("/companies");

  return company;
}

export async function updateCompanyAction(
  companyKey: string,
  updates: {
    displayName?: string;
    relationshipStage?: string;
    revenuePotential?: number;
    notes?: string;
  },
) {
  const me = await getCurrentBd();

  const company = await updateCompany(companyKey, {
    ...updates,
    updatedByBdId: me.id,
  });

  revalidatePath("/companies");
  revalidatePath(`/companies/${companyKey}`);

  return company;
}

export async function updateCompanyStageAction(
  companyKey: string,
  newStage: "prospect" | "qualified" | "proposal_sent" | "won" | "lost",
) {
  return updateCompanyAction(companyKey, {
    relationshipStage: newStage,
  });
}
