/**
 * The extension release the CRM currently serves. The version comes from the extension manifest source at build
 * time (single source of truth): bumping `EXTENSION_VERSION` in extension/build/manifest.ts is the whole release.
 * Plain data only, so a server page can hand it to client components as props.
 */
import { EXTENSION_VERSION, extensionZipName } from "../../../extension/build/manifest";

/** Session-protected route that streams the zip built by `npm run extension:zip`. */
export const EXTENSION_DOWNLOAD_PATH = "/api/extension/download";

export interface ExtensionRelease {
  version: string;
  fileName: string;
  downloadHref: string;
}

export function currentExtensionRelease(): ExtensionRelease {
  return {
    version: EXTENSION_VERSION,
    fileName: extensionZipName(EXTENSION_VERSION),
    downloadHref: EXTENSION_DOWNLOAD_PATH,
  };
}
