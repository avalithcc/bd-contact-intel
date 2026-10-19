import { FileIcon } from "@/components/icons";
import { formatAttachmentSize } from "@/lib/email/attachments/policy";

/**
 * The files of a sent or scheduled email: name and size, nothing to click. The CRM does not keep the files (they are deleted
 * right after the send), so there is no download anywhere; the original stays in Gmail's Sent.
 */
export function AttachmentChips({ files, label }: { files: readonly { filename: string; size: number }[]; label: string }) {
  if (files.length === 0) return null;
  return (
    <div className="files" role="list" aria-label={label}>
      {files.map((f, index) => (
        <span className="file" role="listitem" key={`${f.filename}-${index}`}>
          <FileIcon className="icon" />
          <span className="fn" title={f.filename}>{f.filename}</span>
          <span className="sz">{formatAttachmentSize(f.size)}</span>
        </span>
      ))}
    </div>
  );
}

/** "Para: A, B, +1 · CC: x@avalith.net" (redactar-email.html section 4). */
export function RecipientsLine({ toPrefix, ccPrefix, shown, more, full, cc }: { toPrefix: string; ccPrefix: string; shown: string[]; more: number; full: string; cc: string[] }) {
  if (shown.length === 0 && cc.length === 0) return null;
  return (
    <p className="to-line">
      {shown.length > 0 && (
        <>
          <strong>{toPrefix}</strong> {shown.join(", ")}
          {more > 0 && (
            <>
              , <span title={full}>+{more}</span>
            </>
          )}
        </>
      )}
      {cc.length > 0 && (
        <>
          {shown.length > 0 && " · "}
          <strong>{ccPrefix}</strong> {cc.join(", ")}
        </>
      )}
    </p>
  );
}
