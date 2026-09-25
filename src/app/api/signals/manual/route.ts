import { getCurrentBd } from "@/lib/queries";
import { db } from "@/db";
import { signal } from "@/db/schema";
import { isIdentityDualWriteEnabled } from "@/lib/identity/resolve";
import { personIdLookupSql } from "@/lib/identity/resolveDb";
import { resolvePersonIdLookup } from "@/lib/identity/referenceWrite";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const me = await getCurrentBd();
    const { signal: signalText, leadId, companyKey, contactId } = await req.json();

    if (!signalText || !signalText.trim()) {
      return NextResponse.json(
        { error: "Signal text is required" },
        { status: 400 }
      );
    }

    const count = [leadId, companyKey, contactId].filter(Boolean).length;
    if (count !== 1) {
      return NextResponse.json(
        { error: "Exactly one subject (leadId, companyKey, or contactId) required" },
        { status: 400 }
      );
    }

    // `person_id` via the same `person_id_map` subquery as
    // createActivity/createTask (design "Reference writes"; task 4B.5) —
    // no matcher, no lock, since this never creates a person.
    const lookup = resolvePersonIdLookup({ leadId, contactId });
    const values = {
      source: "manual_paste",
      data: { body: signalText },
      leadId: leadId || undefined,
      companyKey: companyKey || undefined,
      contactId: contactId || undefined,
      actorBdId: me.id,
      ...(lookup && isIdentityDualWriteEnabled() ? { personId: personIdLookupSql(lookup) } : {}),
    };
    const [result] = await db.insert(signal).values(values).returning();

    return NextResponse.json(result);
  } catch (err) {
    console.error("Signal save error:", err);
    return NextResponse.json(
      { error: "Failed to save signal" },
      { status: 500 }
    );
  }
}
