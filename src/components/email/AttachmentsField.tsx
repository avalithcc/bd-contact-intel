"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ClipIcon, CloseIcon, FileIcon, WarningIcon } from "@/components/icons";
import type { ContactRecordLabels } from "@/lib/contacts/labels";
import { MAX_ATTACHMENTS, MAX_TOTAL_ATTACHMENT_BYTES, formatAttachmentLimit, formatAttachmentSize } from "@/lib/email/attachments/policy";
import type { AttachmentEntry, EmailAttachments } from "./useEmailAttachments";

/**
 * "Adjuntos" row of the composer (mockups/redactar-email.html sections 1, 2 and 3): the attach button, the live total,
 * one chip per file (uploading with a progress bar, ready, or errored with the reason) and the drop state. Dropping files
 * anywhere on the dialog attaches them. All state lives in the `useEmailAttachments` hook of whoever owns the composer.
 */
const ACCEPT = ".pdf,.docx,.xlsx,.pptx,.doc,.xls,.ppt,.png,.jpg,.jpeg,.txt,.csv";

function reasonText(l: ContactRecordLabels, entry: AttachmentEntry): string {
  switch (entry.reason) {
    case "type":
      return l.attachmentsErrType;
    case "size":
      return l.attachmentsErrTooLarge;
    case "empty":
      return l.attachmentsErrEmpty;
    case "too_many":
      return l.attachmentsErrTooMany;
    case "total":
      return l.attachmentsErrTotal;
    default:
      return l.attachmentsErrUpload;
  }
}

export function AttachmentsField({ labels: l, attachments, disabled }: { labels: ContactRecordLabels; attachments: EmailAttachments; disabled: boolean }) {
  const ids = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const { entries, totals } = attachments;
  const addRef = useRef(attachments.add);
  addRef.current = attachments.add;

  // Drag and drop works on the whole dialog (the mockup's "estado al arrastrar sobre el diálogo"), not just on this row.
  useEffect(() => {
    const dialog = rootRef.current?.closest(".dialog");
    if (!dialog || disabled) return;
    let depth = 0;
    const hasFiles = (e: Event) => Array.from((e as DragEvent).dataTransfer?.types ?? []).includes("Files");
    const enter = (e: Event) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth += 1;
      setDragging(true);
    };
    const over = (e: Event) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const leave = (e: Event) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const drop = (e: Event) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      addRef.current(Array.from((e as DragEvent).dataTransfer?.files ?? []));
    };
    dialog.addEventListener("dragenter", enter);
    dialog.addEventListener("dragover", over);
    dialog.addEventListener("dragleave", leave);
    dialog.addEventListener("drop", drop);
    return () => {
      dialog.removeEventListener("dragenter", enter);
      dialog.removeEventListener("dragover", over);
      dialog.removeEventListener("dragleave", leave);
      dialog.removeEventListener("drop", drop);
    };
  }, [disabled]);

  const totalText =
    totals.count === 0
      ? `${l.attachmentsNone} · 0 MB ${l.attachmentsOf} ${formatAttachmentLimit(MAX_TOTAL_ATTACHMENT_BYTES)}`
      : `${totals.count} ${totals.count === 1 ? l.attachmentsFileOne : l.attachmentsFileMany} · ${formatAttachmentSize(totals.bytes)} ${l.attachmentsOf} ${formatAttachmentLimit(MAX_TOTAL_ATTACHMENT_BYTES)}`;

  return (
    <div className="field" ref={rootRef}>
      <span className="label" id={`${ids}-label`}>
        {l.attachmentsLabel}
      </span>
      <div className="attach-bar" role="group" aria-labelledby={`${ids}-label`}>
        <button type="button" className="btn btn-secondary btn-sm" disabled={disabled || totals.count >= MAX_ATTACHMENTS} onClick={() => fileInput.current?.click()}>
          <ClipIcon className="icon" />
          {l.attachmentsAttach}
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          accept={ACCEPT}
          tabIndex={-1}
          onChange={(e) => {
            attachments.add(Array.from(e.target.files ?? []));
            e.target.value = ""; // picking the same file again must fire a change
          }}
        />
        <span className="help">{l.attachmentsDropHint}</span>
        <span className="total" aria-live="polite">
          {totalText}
        </span>
      </div>
      {entries.length > 0 && (
        <div className="files" role="list" aria-label={l.attachmentsListLabel}>
          {entries.map((e) => (
            <FileChip key={e.key} entry={e} l={l} disabled={disabled} onRemove={() => attachments.remove(e.key)} />
          ))}
        </div>
      )}
      {dragging && (
        <div className="dz-hint over" aria-live="polite">
          {l.attachmentsDropOver}
        </div>
      )}
      {entries.length > 0 && <p className="help">{l.attachmentsHelp}</p>}
    </div>
  );
}

function FileChip({ entry, l, disabled, onRemove }: { entry: AttachmentEntry; l: ContactRecordLabels; disabled: boolean; onRemove: () => void }) {
  const size = formatAttachmentSize(entry.size);
  if (entry.status === "uploading") {
    return (
      <span className="file up" role="listitem" aria-label={`${l.attachmentsUploadingPrefix} ${entry.filename}, ${entry.progress} %`}>
        <span className="top">
          <FileIcon className="icon" />
          <span className="fn">{entry.filename}</span>
          <span className="sz">
            {size} · {entry.progress} %
          </span>
          <button type="button" aria-label={`${l.attachmentsCancelUploadPrefix} ${entry.filename}`} onClick={onRemove}>
            <CloseIcon className="icon" />
          </button>
        </span>
        <span className="bar-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={entry.progress} aria-label={entry.filename}>
          <span className="bar-fill" style={{ width: `${entry.progress}%` }} />
        </span>
      </span>
    );
  }
  if (entry.status === "error") {
    return (
      <span className="file err" role="listitem">
        <WarningIcon className="icon" />
        <span className="fn">{entry.filename}</span>
        <span className="why">{reasonText(l, entry)}</span>
        <button type="button" aria-label={`${l.attachmentsDiscardPrefix} ${entry.filename}`} onClick={onRemove}>
          <CloseIcon className="icon" />
        </button>
      </span>
    );
  }
  return (
    <span className="file" role="listitem">
      <FileIcon className="icon" />
      <span className="fn">{entry.filename}</span>
      <span className="sz">{size}</span>
      <button type="button" aria-label={`${l.attachmentsRemovePrefix} ${entry.filename}`} disabled={disabled} onClick={onRemove}>
        <CloseIcon className="icon" />
      </button>
    </span>
  );
}
