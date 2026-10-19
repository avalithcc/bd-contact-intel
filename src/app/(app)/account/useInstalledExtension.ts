import { useEffect, useState } from "react";
import { readInstalledVersion } from "@/lib/extension/install";

/** How long to wait for the extension's script before saying it is not installed. */
const DETECTION_GRACE_MS = 800;

/**
 * The version the extension announced on this page: `undefined` while still checking, `null` when nothing was
 * detected. The extension's own script on this origin writes `data-crm-extension="<version>"` on <html>, possibly
 * after hydration, so "not installed" is only declared after a short grace period; until then callers render
 * neither state, which keeps an installed BD from seeing the download button flash. Follows later changes too.
 * Shared by the Cuenta card and the install guide so the two never disagree. Client components only.
 */
export function useInstalledExtensionVersion(): string | null | undefined {
  const [version, setVersion] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    const root = document.documentElement;
    const current = () => readInstalledVersion(root.getAttribute("data-crm-extension"));
    const found = current();
    if (found) setVersion(found);
    const timer = window.setTimeout(() => setVersion((v) => (v === undefined ? current() : v)), DETECTION_GRACE_MS);
    const observer = new MutationObserver(() => setVersion(current()));
    observer.observe(root, { attributes: true, attributeFilter: ["data-crm-extension"] });
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, []);

  return version;
}
