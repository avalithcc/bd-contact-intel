/**
 * Bare layout for auth-flow pages (/login, /account/password): no
 * Sidebar/TopBar chrome, matching mockups/login.html (fresh-review fix on
 * tasks.md 8.2). Each page already renders its own centered card via the
 * `.form-narrow` class in globals.css, so this layout only needs to pass
 * children through.
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
