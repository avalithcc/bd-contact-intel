"use server";

import { cookies } from "next/headers";
import { isTheme, THEME_COOKIE } from "./constants";

/**
 * Sets the visitor's theme cookie. Invoked directly as a <form action>
 * (see ThemeSwitcher.tsx), so it works as a plain form POST without
 * client-side JS: the browser posts to the current route, Next.js re-runs
 * this action, and the invoking route re-renders with the new cookie.
 */
export async function setTheme(formData: FormData): Promise<void> {
  const value = formData.get("theme");
  if (typeof value !== "string" || !isTheme(value)) return;

  const cookieStore = await cookies();
  cookieStore.set(THEME_COOKIE, value, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
}
