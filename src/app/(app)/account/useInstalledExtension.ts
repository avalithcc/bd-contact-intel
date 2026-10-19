import { useEffect, useState } from "react";
import { readInstalledVersion } from "@/lib/extension/install";

/**
 * The version the extension announced on this page, or null while nothing is detected. The extension's own script
 * on this origin writes `data-crm-extension="<version>"` on <html>; this reads it after mount and follows later
 * changes (the script can run after hydration). Shared by the Cuenta card and the install guide so the two never
 * disagree. Hooks may be imported by client components only.
 */
export function useInstalledExtensionVersion(): string | null {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    const read = () => setVersion(readInstalledVersion(root.getAttribute("data-crm-extension")));
    read();
    const observer = new MutationObserver(read);
    observer.observe(root, { attributes: true, attributeFilter: ["data-crm-extension"] });
    return () => observer.disconnect();
  }, []);

  return version;
}
