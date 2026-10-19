"use client";

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { useToast } from "@/components/ToastProvider";
import {
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  EyeIcon,
  FolderIcon,
  PinIcon,
  PuzzleIcon,
  RefreshIcon,
  ArchiveTrayIcon,
  WarningIcon,
} from "@/components/icons";
import { fillTemplate as fill } from "@/lib/i18n/template";
import type { ExtensionRelease } from "@/lib/extension/release";
import type { ExtensionGuideLabels } from "./ExtensionGuide";
import styles from "./guide.module.css";

type L = ExtensionGuideLabels;

/** Dictionary strings mark **bold** and `mono` runs; everything else is plain text. */
function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*|`[^`]+`)/).map((part, i) =>
        part.startsWith("**") ? (
          <strong key={i}>{part.slice(2, -2)}</strong>
        ) : part.startsWith("`") ? (
          <span key={i} className="mono">
            {part.slice(1, -1)}
          </span>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}

function Step({ n, title, optional, meta, children }: { n: number; title: string; optional?: string; meta?: ReactNode; children?: ReactNode }) {
  return (
    <div className={styles.step}>
      <span className={styles.stepN}>{n}</span>
      <div className={styles.body}>
        <div>
          <h3>
            {title}
            {optional && (
              <>
                {" "}
                <span className="tag tag-backlog">{optional}</span>
              </>
            )}
          </h3>
          {meta && <p className="meta">{meta}</p>}
        </div>
        {children}
      </div>
    </div>
  );
}

function Frame({ url, urlHl, right, children }: { url: string; urlHl?: boolean; right?: ReactNode; children: ReactNode }) {
  return (
    <div className={styles.sch} aria-hidden="true">
      <div className={styles.schBar}>
        <span className={styles.dots}>
          <i />
          <i />
          <i />
        </span>
        <span className={`${styles.schUrl} ${urlHl ? styles.hl : ""}`}>{url}</span>
        {right}
      </div>
      {children}
    </div>
  );
}

const lines = (...widths: string[]) => widths.map((w) => <div key={w} className={styles.schLine} style={{ width: w }} />);

function DevToggle({ label, hl }: { label: string; hl?: boolean }) {
  return (
    <span className={`${styles.toggle} ${hl ? styles.hl : ""}`}>
      {label} <i />
    </span>
  );
}

function DownloadRow({ release, l, children }: { release: ExtensionRelease; l: L; children?: ReactNode }) {
  return (
    <div className="row">
      <a className="btn btn-primary" href={release.downloadHref} download={release.fileName}>
        <DownloadIcon className="icon" />
        {l.download}
      </a>
      <span className="meta mono">{release.fileName}</span>
      {children}
    </div>
  );
}

/** Browsers refuse links to their internal pages, so the address is copied; the button says "Copiado" for a few seconds. */
function CopyAddress({ address, l, showHelp }: { address: string; l: L; showHelp?: boolean }) {
  const { showToast } = useToast();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
    } catch {
      showToast(l.copyFailed, "error");
      return;
    }
    setCopied(true);
    showToast(l.copyToast, "success");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 3000);
  }

  return (
    <>
      <div className={styles.addr}>
        <span className="mono">{address}</span>
        <button className="btn btn-secondary btn-sm" type="button" onClick={copy}>
          {copied ? <CheckIcon className="icon" /> : <CopyIcon className="icon" />}
          <span aria-live="polite">{copied ? l.copied : l.copy}</span>
        </button>
      </div>
      {showHelp && <p className="help">{l.copyHelp}</p>}
    </>
  );
}

function FolderMove({ l }: { l: L }) {
  return (
    <div className={styles.sch} aria-hidden="true">
      <div className={styles.schBody}>
        <div className={styles.schRow}>
          <span className={styles.folder}>
            <ArchiveTrayIcon className="icon" />
            {`${l.folderName}.zip`}
          </span>
          <span className="meta">{l.schemaDoubleClick}</span>
          <span className={`${styles.folder} ${styles.folderSel} ${styles.hl}`}>
            <FolderIcon className="icon" />
            {l.folderName}
          </span>
        </div>
        <div className={styles.schRow}>
          <span className="meta">{l.schemaMoveTo}</span>
          <span className={styles.folder}>
            <FolderIcon className="icon" />
            {l.schemaDocuments}
          </span>
        </div>
      </div>
    </div>
  );
}

function FolderWarning({ l }: { l: L }) {
  return (
    <div className="alert alert-warn">
      <WarningIcon className="icon" />
      <div>{l.folderWarning}</div>
    </div>
  );
}

function ToolbarSchematic({ l, action }: { l: L; action: ReactNode }) {
  return (
    <Frame
      url="linkedin.com"
      right={
        <span className={`${styles.schIco} ${styles.hl}`}>
          <PuzzleIcon className="icon" />
        </span>
      }
    >
      <div className={styles.schBody}>
        <div className={`${styles.schCard} ${styles.schCardEnd}`}>
          <span className="meta grow">{l.extensionName}</span>
          <span className={`${styles.schIco} ${styles.hl}`}>{action}</span>
        </div>
      </div>
    </Frame>
  );
}

export function ChromeSteps({ l, release }: { l: L; release: ExtensionRelease }) {
  return (
    <>
      <Step n={1} title={l.step1Title} meta={l.step1Meta}>
        <DownloadRow release={release} l={l} />
      </Step>
      <Step n={2} title={l.step2Title} meta={l.step2MetaChrome}>
        <FolderMove l={l} />
        <FolderWarning l={l} />
      </Step>
      <Step n={3} title={l.step3Title} meta={l.step3MetaChrome}>
        <CopyAddress address="chrome://extensions" l={l} showHelp />
        <Frame url="chrome://extensions" urlHl>
          <div className={styles.schBody}>
            <div className={styles.schHead}>
              <strong>{l.extensionsHeading}</strong>
            </div>
            {lines("60%", "40%")}
          </div>
        </Frame>
      </Step>
      <Step n={4} title={l.step4Title} meta={l.step4MetaChrome}>
        <Frame url="chrome://extensions">
          <div className={styles.schBody}>
            <div className={styles.schHead}>
              <strong>{l.extensionsHeading}</strong>
              <DevToggle label={l.devMode} hl />
            </div>
            {lines("60%", "40%")}
          </div>
        </Frame>
      </Step>
      <Step n={5} title={l.step5TitleChrome} meta={<Rich text={l.step5MetaChrome} />}>
        <Frame url="chrome://extensions">
          <div className={styles.schBody}>
            <div className={styles.schHead}>
              <strong>{l.extensionsHeading}</strong>
              <DevToggle label={l.devMode} />
            </div>
            <div className={styles.schRow}>
              <span className={`btn btn-secondary btn-sm ${styles.hl}`}>{l.loadUnpackedChrome}</span>
              <span className="btn btn-secondary btn-sm">{l.packExtension}</span>
              <span className="btn btn-secondary btn-sm">{l.refresh}</span>
            </div>
            <div className={styles.schCard}>
              <span className={`${styles.folder} ${styles.folderSel} ${styles.hl}`}>{l.folderName}</span>
              <span className="meta">{l.containsManifest}</span>
            </div>
          </div>
        </Frame>
      </Step>
      <Step n={6} title={l.step6TitleChrome} optional={l.optional} meta={l.step6MetaChrome}>
        <ToolbarSchematic l={l} action={<PinIcon className="icon" />} />
      </Step>
      <Step n={7} title={l.step7Title} meta={l.step7MetaChrome}>
        <Frame url="linkedin.com/in/ana-perez">
          <div className={`${styles.schBody} ${styles.schBodyTall}`}>
            {lines("40%", "60%", "30%")}
            <div className={`${styles.schCard} ${styles.hl} ${styles.schCardFloat}`}>
              <strong>{l.extensionName}</strong>
              <span className="meta">{l.schemaCardMeta}</span>
            </div>
          </div>
        </Frame>
      </Step>
    </>
  );
}

export function EdgeSteps({ l, release }: { l: L; release: ExtensionRelease }) {
  return (
    <>
      <Step n={1} title={l.step1Title}>
        <DownloadRow release={release} l={l} />
      </Step>
      <Step n={2} title={l.step2Title} meta={l.step2MetaEdge}>
        <FolderWarning l={l} />
      </Step>
      <Step n={3} title={l.step3Title} meta={l.step3MetaEdge}>
        <CopyAddress address="edge://extensions" l={l} />
        <Frame url="edge://extensions" urlHl>
          <div className={styles.schBody}>{lines("50%")}</div>
        </Frame>
      </Step>
      <Step n={4} title={l.step4Title} meta={<Rich text={l.step4MetaEdge} />}>
        <Frame url="edge://extensions">
          <div className={styles.schSide}>
            <aside>
              <strong>{l.extensionsHeading}</strong>
              {lines("70%", "55%")}
              <DevToggle label={l.devMode} hl />
            </aside>
            <div className={styles.schBody}>{lines("60%", "40%")}</div>
          </div>
        </Frame>
      </Step>
      <Step n={5} title={l.step5TitleEdge} meta={<Rich text={l.step5MetaEdge} />}>
        <Frame url="edge://extensions">
          <div className={styles.schSide}>
            <aside>
              <strong>{l.extensionsHeading}</strong>
              <DevToggle label={l.devMode} />
            </aside>
            <div className={styles.schBody}>
              <div className={styles.schRow}>
                <span className={`btn btn-secondary btn-sm ${styles.hl}`}>{l.loadUnpackedEdge}</span>
                <span className="btn btn-secondary btn-sm">{l.refresh}</span>
              </div>
              <div className={styles.schCard}>
                <span className={`${styles.folder} ${styles.folderSel} ${styles.hl}`}>{l.folderName}</span>
              </div>
            </div>
          </div>
        </Frame>
      </Step>
      <Step n={6} title={l.step6TitleEdge} optional={l.optional} meta={l.step6MetaEdge}>
        <ToolbarSchematic l={l} action={<EyeIcon className="icon" />} />
      </Step>
      <Step n={7} title={l.step7Title} meta={l.step7MetaEdge} />
    </>
  );
}

/** Same page for Chrome and Edge: the three update steps, the collapsible FAQ. */
export function UpdateSection({ l, release }: { l: L; release: ExtensionRelease }) {
  return (
    <section id="actualizar" aria-labelledby="actualizar-title">
      <h2 id="actualizar-title" className="mt-2xl">
        {l.updateTitle}
      </h2>
      <p className="meta">{l.updateIntro}</p>
      <Step n={1} title={l.update1Title}>
        <div className="row">
          <a className="btn btn-primary btn-sm" href={release.downloadHref} download={release.fileName}>
            {fill(l.downloadVersion, { version: release.version })}
          </a>
          <span className="meta mono">{release.fileName}</span>
        </div>
      </Step>
      <Step n={2} title={l.update2Title} meta={l.update2Meta} />
      <Step n={3} title={l.update3Title} meta={<Rich text={l.update3Meta} />}>
        <div className={styles.sch} aria-hidden="true">
          <div className={styles.schBody}>
            <div className={styles.schCard}>
              <strong className="grow">
                {l.extensionName} <span className="meta">{`v${release.version}`}</span>
              </strong>
              <span className={`${styles.schIco} ${styles.hl}`}>
                <RefreshIcon className="icon" />
              </span>
            </div>
          </div>
        </div>
      </Step>
    </section>
  );
}

export function Faq({ l }: { l: L }) {
  const items = [
    [l.faq1Q, l.faq1A],
    [l.faq2Q, l.faq2A],
    [l.faq3Q, l.faq3A],
    [l.faq4Q, l.faq4A],
    [l.faq5Q, l.faq5A],
  ] as const;
  return (
    <section aria-labelledby="faq-title">
      <h2 id="faq-title" className="mt-2xl">
        {l.faqTitle}
      </h2>
      <div className={`${styles.faq} mt-md`}>
        {items.map(([question, answer], i) => (
          <details key={question} open={i === 0}>
            <summary>{question}</summary>
            <div className="meta">
              <Rich text={answer} />
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}
