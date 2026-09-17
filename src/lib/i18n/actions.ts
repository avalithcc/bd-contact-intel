"use server";

import { cookies } from "next/headers";
import { isLocale, LOCALE_COOKIE } from "./locales";

/**
 * Sets the visitor's locale cookie. Invoked directly as a <form action>
 * (see LocaleSwitcher.tsx), so it works as a plain form POST without
 * client-side JS: the browser posts to the current route, Next.js re-runs
 * this action, and the invoking route re-renders with the new cookie.
 */
export async function setLocale(formData: FormData): Promise<void> {
  const value = formData.get("locale");
  if (typeof value !== "string" || !isLocale(value)) return;

  const cookieStore = await cookies();
  cookieStore.set(LOCALE_COOKIE, value, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
}
