"use client";

import Link from "next/link";
import { DownloadIcon, LinkedInIcon, LockIcon, WarningIcon } from "@/components/icons";
import { extensionInstallState } from "@/lib/extension/install";
import { fillTemplate as fill } from "@/lib/i18n/template";
import type { ExtensionRelease } from "@/lib/extension/release";
import { useInstalledExtensionVersion } from "./useInstalledExtension";
import styles from "./page.module.css";

export interface ExtensionToolLabels {
  title: string;
  body: string;
  install: string;
  /** Contains `{file}` and `{version}`; plain strings because a function cannot cross the server/client boundary. */
  fileMeta: string;
  guideLink: string;
  installedBody: string;
  /** Contains `{version}`. */
  installedBadge: string;
  /** Contain `{latest}` / `{version}`. */
  outdatedTitle: string;
  outdatedBody: string;
  downloadVersion: string;
  howToUpdate: string;
  privacyTitle: string;
  privacyBody: string;
}

/**
 * Cuenta > Herramientas: the LinkedIn extension card (instalar-extension mockup, section 1). Three states from what
 * the extension announces on <html> versus the version this deploy serves: not installed (download + guide),
 * installed and current (badge), installed but older (warning + download of the new version + how to update).
 * "Older" needs a proven numeric comparison; an installed version that cannot be compared never nags.
 */
export function ExtensionTool({
  labels: l,
  release,
  guideHref,
  updateHref,
}: {
  labels: ExtensionToolLabels;
  release: ExtensionRelease;
  guideHref: string;
  updateHref: string;
}) {
  const installed = useInstalledExtensionVersion();
  const state = extensionInstallState(installed, release.version);
  const downloadIcon = <DownloadIcon className="icon" />;

  return (
    <div className="stack">
      <div className="row row-lg">
        <span className={styles.toolIcon}>
          <LinkedInIcon className="icon" />
        </span>
        <div className="grow">
          <strong>{l.title}</strong>
          <p className="meta">{state.kind === "not-installed" ? l.body : l.installedBody}</p>
        </div>
        {state.kind !== "not-installed" && (
          <span className={`badge ${state.kind === "outdated" ? "badge-warn" : "badge-success"}`}>
            {fill(l.installedBadge, { version: state.version })}
          </span>
        )}
      </div>

      {state.kind === "not-installed" && (
        <div className="stack-sm">
          <a className="btn btn-primary btn-block" href={release.downloadHref} download={release.fileName}>
            {downloadIcon}
            {l.install}
          </a>
          <p className="help">{fill(l.fileMeta, { file: release.fileName, version: release.version })}</p>
          <Link href={guideHref}>{l.guideLink}</Link>
        </div>
      )}

      {state.kind === "current" && (
        <div>
          <Link className="btn btn-secondary btn-sm" href={guideHref}>
            {l.guideLink}
          </Link>
        </div>
      )}

      {state.kind === "outdated" && (
        <>
          <div className="alert alert-warn">
            <WarningIcon className="icon" />
            <div>
              <div className="title">{fill(l.outdatedTitle, { latest: release.version })}</div>
              {fill(l.outdatedBody, { version: state.version })}
            </div>
          </div>
          <div className="row">
            <a className="btn btn-primary" href={release.downloadHref} download={release.fileName}>
              {downloadIcon}
              {fill(l.downloadVersion, { latest: release.version })}
            </a>
            <Link className="btn btn-ghost" href={updateHref}>
              {l.howToUpdate}
            </Link>
          </div>
          <p className="help">{release.fileName}</p>
        </>
      )}

      <div className="alert alert-neutral">
        <LockIcon className="icon" />
        <div>
          <div className="title">{l.privacyTitle}</div>
          {l.privacyBody}
        </div>
      </div>
    </div>
  );
}
