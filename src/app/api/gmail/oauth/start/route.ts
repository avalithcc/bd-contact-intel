import { getCurrentBd } from "@/lib/queries";
import { redirect } from "next/navigation";

export async function GET() {
  const me = await getCurrentBd();

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!,
    redirect_uri: process.env.GOOGLE_OAUTH_REDIRECT_URI!,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/gmail.send",
    access_type: "offline",
    prompt: "consent",
    state: me.id,
  });

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  redirect(authUrl);
}
