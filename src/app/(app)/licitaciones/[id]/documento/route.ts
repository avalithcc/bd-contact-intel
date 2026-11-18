import { NextResponse } from "next/server";
import { AdminRequiredError } from "@/lib/auth/adminRole";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { createClient } from "@/lib/supabase/server";
import { TENDER_DOCUMENTS_BUCKET } from "@/lib/tenders/document";
import { getCurrentTenderDocument } from "@/lib/tenders/workspace";

/** Opens the tender's current pliego through a short-lived signed URL; the bucket itself stays private. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return new NextResponse(null, { status: 401 });
  // Admin-only like the section: a non-admin gets the same 404 as an id that does not exist, never a signed URL.
  try {
    await requireAdmin();
  } catch (err) {
    if (err instanceof AdminRequiredError) return new NextResponse(null, { status: 404 });
    throw err;
  }
  const { id } = await params;
  const doc = await getCurrentTenderDocument(id);
  if (!doc) return new NextResponse(null, { status: 404 });
  const { data, error } = await supabase.storage.from(TENDER_DOCUMENTS_BUCKET).createSignedUrl(doc.storagePath, 60, { download: doc.filename });
  if (error || !data) return new NextResponse(null, { status: 502 });
  return NextResponse.redirect(data.signedUrl);
}
