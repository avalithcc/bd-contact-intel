"use client";

import { useEffect, useRef, useState } from "react";
import { useToast } from "@/components/ToastProvider";
import { previewSignatureAction, saveSignatureAction } from "./signatureActions";
import styles from "./page.module.css";

export interface SignatureLabels {
  title: string;
  help: string;
  inputLabel: string;
  placeholder: string;
  policy: string;
  previewLabel: string;
  previewTitle: string;
  previewEmpty: string;
  save: string;
  saving: string;
  clear: string;
  saved: string;
  cleared: string;
  errorTooLong: string;
  errorNothingLeft: string;
  errorUnexpected: string;
}

const PREVIEW_DEBOUNCE_MS = 300;

/** The preview lives in a sandboxed iframe: no scripts and no app origin, even if the sanitizer ever had a hole. */
function previewDocument(html: string): string {
  return `<!doctype html><meta charset="utf-8"><body style="margin:12px;font:14px Arial,Helvetica,sans-serif;color:#222">${html}`;
}

/**
 * Own-signature editor on /account. The textarea holds what the BD pastes;
 * the preview shows what the server sanitizer returns for it (the same code
 * the save and the send use), so what they see is what recipients get.
 */
export function SignatureEditor({ initialHtml, labels: l }: { initialHtml: string | null; labels: SignatureLabels }) {
  const { showToast } = useToast();
  const [value, setValue] = useState(initialHtml ?? "");
  const [stored, setStored] = useState(initialHtml);
  const [preview, setPreview] = useState(initialHtml ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (value.trim() === "") {
      setPreview("");
      return;
    }
    const mine = ++seq.current;
    const timer = setTimeout(async () => {
      const html = await previewSignatureAction(value);
      if (mine === seq.current) setPreview(html);
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [value]);

  async function submit(raw: string) {
    setBusy(true);
    setError(null);
    try {
      const result = await saveSignatureAction(raw);
      if (result.ok) {
        setStored(result.html);
        setValue(result.html ?? "");
        setPreview(result.html ?? "");
        showToast(result.html === null ? l.cleared : l.saved);
      } else {
        const message =
          result.error === "too_long"
            ? l.errorTooLong
            : result.error === "nothing_left"
              ? l.errorNothingLeft
              : l.errorUnexpected;
        setError(message);
        showToast(message, "error");
      }
    } finally {
      setBusy(false);
    }
  }

  const dirty = value !== (stored ?? "");

  return (
    <form
      className={styles.signatureForm}
      onSubmit={(e) => {
        e.preventDefault();
        void submit(value);
      }}
    >
      <p className={styles.signatureHelp}>{l.help}</p>
      <div className="field">
        <label className="label" htmlFor="signature-html">
          {l.inputLabel}
        </label>
        <textarea
          id="signature-html"
          className={`textarea ${styles.signatureInput}`}
          value={value}
          placeholder={l.placeholder}
          spellCheck={false}
          onChange={(e) => setValue(e.target.value)}
          aria-describedby="signature-policy"
        />
        <span id="signature-policy" className={styles.signatureHelp}>
          {l.policy}
        </span>
      </div>
      <div className="field">
        <span className="label" id="signature-preview-label">
          {l.previewLabel}
        </span>
        {preview === "" ? (
          <p className={styles.signatureEmpty}>{l.previewEmpty}</p>
        ) : (
          <iframe
            className={styles.signaturePreview}
            title={l.previewTitle}
            aria-labelledby="signature-preview-label"
            sandbox=""
            srcDoc={previewDocument(preview)}
          />
        )}
      </div>
      {error && (
        <p className={styles.signatureError} role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        {stored !== null && (
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void submit("")}>
            {l.clear}
          </button>
        )}
        <button type="submit" className="btn btn-primary" disabled={busy || !dirty}>
          {busy ? l.saving : l.save}
        </button>
      </div>
    </form>
  );
}
