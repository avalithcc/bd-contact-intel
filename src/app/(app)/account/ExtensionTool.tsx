"use client";

import { useEffect, useState } from "react";
import { DownloadIcon, LinkedInIcon, LockIcon } from "@/components/icons";
import { readInstalledVersion } from "@/lib/extension/install";
import styles from "./page.module.css";

export interface ExtensionToolLabels {
  title: string;
  body: string;
  install: string;
  storeSoon: string;
  step1Title: string;
  step1Body: string;
  step2Title: string;
  step2Body: string;
  installedBadge: string;
  /** Contains `{version}`; a plain string because a function cannot cross the server/client boundary. */
  installedMeta: string;
  privacyTitle: string;
  privacyBody: string;
}

/**
 * Cuenta > Herramientas: the LinkedIn extension card (linkedin-extension mockup, section 3). The extension's own
 * script on this origin writes `data-crm-extension="<version>"` on <html>; this reads it after mount and
 * follows later changes, switching between "Instalar extensión" and the "Instalada" badge. When nothing is
 * detected the not-installed variant shows, as the mockup specifies.
 */
export function ExtensionTool({ labels: l, storeUrl }: { labels: ExtensionToolLabels; storeUrl: string | null }) {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    const read = () => setVersion(readInstalledVersion(root.getAttribute("data-crm-extension")));
    read();
    const observer = new MutationObserver(read);
    observer.observe(root, { attributes: true, attributeFilter: ["data-crm-extension"] });
    return () => observer.disconnect();
  }, []);

  return (
    <div className="stack">
      <div className="row row-lg">
        <span className={styles.toolIcon}>
          <LinkedInIcon className="icon" />
        </span>
        <div className="grow">
          <strong>{l.title}</strong>
          <p className="meta">{version ? l.installedMeta.replace("{version}", version) : l.body}</p>
        </div>
        {version && <span className="badge badge-success">{l.installedBadge}</span>}
      </div>
      {!version && (
        <>
          <div>
            {storeUrl ? (
              <a className="btn btn-primary" href={storeUrl} target="_blank" rel="noopener noreferrer">
                <DownloadIcon className="icon" />
                {l.install}
              </a>
            ) : (
              <>
                <button type="button" className="btn btn-primary" disabled aria-describedby="ext-store-soon">
                  <DownloadIcon className="icon" />
                  {l.install}
                </button>
                <p className="help mt-md" id="ext-store-soon">
                  {l.storeSoon}
                </p>
              </>
            )}
          </div>
          <div className={styles.step}>
            <span className={styles.stepN}>1</span>
            <div className="grow">
              <strong>{l.step1Title}</strong>
              <p className="meta">{l.step1Body}</p>
            </div>
          </div>
          <div className={styles.step}>
            <span className={styles.stepN}>2</span>
            <div className="grow">
              <strong>{l.step2Title}</strong>
              <p className="meta">{l.step2Body}</p>
            </div>
          </div>
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
