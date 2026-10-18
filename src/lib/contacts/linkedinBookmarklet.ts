/**
 * The "Guardar desde LinkedIn" bookmarklet. It reads `location.href` and
 * nothing else (never the page content) and opens the CRM's capture route in
 * a new tab. Pure, no I/O.
 */

/** `javascript:` URL to drag to the bookmarks bar; also shown as copyable text. */
export function buildBookmarkletHref(appOrigin: string): string {
  return `javascript:(()=>{window.open('${appOrigin}/capture/linkedin?url='+encodeURIComponent(location.href),'_blank')})()`;
}

const HOST_RE = /^[a-z0-9.-]+(:\d{1,5})?$/i;

/**
 * The origin the BD is using right now (so a preview deployment installs a
 * bookmarklet that points at itself). A missing or odd Host header falls back
 * to the configured site URL instead of being trusted.
 */
export function resolveAppOrigin(
  request: { host: string | null; forwardedProto: string | null },
  siteUrl: string,
): string {
  const host = request.host?.trim();
  if (!host || !HOST_RE.test(host)) return siteUrl;
  const isLocal = host.startsWith("localhost") || host.startsWith("127.0.0.1");
  const proto =
    request.forwardedProto === "http" || request.forwardedProto === "https" ? request.forwardedProto : isLocal ? "http" : "https";
  return `${proto}://${host}`;
}
