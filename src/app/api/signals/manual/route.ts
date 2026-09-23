import { getCurrentBd } from "@/lib/queries";
import { db } from "@/db";
import { signal } from "@/db/schema";
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

    const [result] = await db
      .insert(signal)
      .values({
        source: "manual_paste",
        data: { body: signalText },
        leadId: leadId || undefined,
        companyKey: companyKey || undefined,
        contactId: contactId || undefined,
      })
      .returning();

    return NextResponse.json(result);
  } catch (err) {
    console.error("Signal save error:", err);
    return NextResponse.json(
      { error: "Failed to save signal" },
      { status: 500 }
    );
  }
}
