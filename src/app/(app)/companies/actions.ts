"use server";

import { revalidatePath } from "next/cache";
import { createCompany, updateCompany } from "@/lib/companies/queries";
import { getCurrentBd } from "@/lib/queries";
import type { NewCompany } from "@/db/schema";
import { updateCompanyProperty } from "@/lib/companies/propertyEditDb";
import {
  isEditableCompanyProperty,
  type EditableCompanyProperty,
} from "@/lib/companies/propertyEdit";

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

/**
 * Single-property inline edit on the Company record page (company-fields
 * change, owner-approved 2026-09-26): Industria, Responsable, Ciudad, País.
 * Mirrors the Contact record page's per-property edit action. `property`
 * is validated against the allow-list here (not trusted from the client),
 * and `updateCompanyProperty` re-validates `ownerBdId` against real `bd`
 * rows before writing.
 */
export async function updateCompanyPropertyAction(
  companyKey: string,
  property: string,
  rawNewValue: string,
) {
  if (!isEditableCompanyProperty(property)) {
    throw new Error(`Property not editable: ${property}`);
  }
  const me = await getCurrentBd();

  const company = await updateCompanyProperty(
    companyKey,
    property as EditableCompanyProperty,
    rawNewValue,
    me.id,
  );

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
