"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { CheckIcon, InfoIcon, LockIcon, WarningIcon } from "@/components/icons";
import { extensionInstallState } from "@/lib/extension/install";
import type { ExtensionRelease } from "@/lib/extension/release";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import type { ClientStrings } from "@/lib/i18n/clientStrings";
import { useInstalledExtensionVersion } from "../useInstalledExtension";
import { fillTemplate as fill } from "@/lib/i18n/template";
import { ChromeSteps, EdgeSteps, Faq, UpdateSection } from "./GuideSteps";

export type ExtensionGuideLabels = ClientStrings<Dictionary["extensionGuide"]>;
type Browser = "chrome" | "edge";
const BROWSERS: Browser[] = ["chrome", "edge"];

/**
 * Body of /account/extension (instalar-extension mockup, sections 2 to 4): the live detection banner, the
 * Chrome | Edge tabs (client state only, the URL does not change), the seven steps of the active browser, then the
 * shared update, FAQ and privacy blocks. Detection reuses the Cuenta card's hook, so both always agree.
 */
export function ExtensionGuide({
  labels: l,
  release,
  initialBrowser,
  privacyTitle,
  privacyBody,
}: {
  labels: ExtensionGuideLabels;
  release: ExtensionRelease;
  initialBrowser: Browser;
  privacyTitle: string;
  privacyBody: string;
}) {
  const [browser, setBrowser] = useState<Browser>(initialBrowser);
  const tabRefs = useRef<Record<Browser, HTMLButtonElement | null>>({ chrome: null, edge: null });
  const state = extensionInstallState(useInstalledExtensionVersion(), release.version);

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const index = BROWSERS.indexOf(browser);
    const next =
      event.key === "ArrowRight" ? BROWSERS[(index + 1) % BROWSERS.length]
      : event.key === "ArrowLeft" ? BROWSERS[(index + BROWSERS.length - 1) % BROWSERS.length]
      : event.key === "Home" ? BROWSERS[0]
      : event.key === "End" ? BROWSERS[BROWSERS.length - 1]
      : null;
    if (!next) return;
    event.preventDefault();
    setBrowser(next);
    tabRefs.current[next]?.focus();
  }

  return (
    <>
      {state.kind === "not-installed" ? (
        <div className="alert alert-neutral" role="status">
          <InfoIcon className="icon" />
          <div>
            <div className="title">{l.notDetectedTitle}</div>
            {l.notDetectedBody}
          </div>
        </div>
      ) : state.kind === "outdated" ? (
        <div className="alert alert-warn" role="status">
          <WarningIcon className="icon" />
          <div>
            <div className="title">{fill(l.outdatedTitle, { latest: release.version })}</div>
            {fill(l.outdatedBody, { version: state.version })}{" "}
            <a href="#actualizar">{l.outdatedLink}</a>
          </div>
        </div>
      ) : (
        <div className="alert alert-success" role="status">
          <CheckIcon className="icon" />
          <div>
            <div className="title">{fill(l.detectedTitle, { version: state.version })}</div>
            {l.detectedBody}
          </div>
        </div>
      )}

      <div className="tabs mt-xl" role="tablist" aria-label={l.tabsLabel}>
        {BROWSERS.map((id) => (
          <button
            key={id}
            ref={(node) => {
              tabRefs.current[id] = node;
            }}
            id={`tab-${id}`}
            className={`tab${browser === id ? " active" : ""}`}
            role="tab"
            type="button"
            aria-selected={browser === id}
            aria-controls={`panel-${id}`}
            tabIndex={browser === id ? 0 : -1}
            onClick={() => setBrowser(id)}
            onKeyDown={onTabKeyDown}
          >
            {id === "chrome" ? l.tabChrome : l.tabEdge}
          </button>
        ))}
      </div>

      <div id="panel-chrome" role="tabpanel" aria-labelledby="tab-chrome" hidden={browser !== "chrome"}>
        <ChromeSteps l={l} release={release} />
      </div>
      <div id="panel-edge" role="tabpanel" aria-labelledby="tab-edge" hidden={browser !== "edge"}>
        <EdgeSteps l={l} release={release} />
      </div>

      <UpdateSection l={l} release={release} />
      <Faq l={l} />

      <div className="alert alert-neutral mt-2xl">
        <LockIcon className="icon" />
        <div>
          <div className="title">{privacyTitle}</div>
          {privacyBody}
        </div>
      </div>
    </>
  );
}
