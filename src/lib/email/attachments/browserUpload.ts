import { EMAIL_ATTACHMENTS_BUCKET } from "./storagePath";

/**
 * Browser-side upload of one attachment straight to the private Storage bucket with the signed-in user's own token, so the
 * bytes never pass through a server action (Vercel caps request bodies at about 4.5 MB). XMLHttpRequest rather than
 * supabase-js because only XHR reports upload progress, which the composer shows per file, and can abort mid-way.
 * CLIENT ONLY: it uses XMLHttpRequest and the public anon key; nothing server-side is imported here.
 */
export interface UploadHandle {
  abort(): void;
  done: Promise<{ ok: true } | { ok: false; aborted: boolean }>;
}

export function uploadAttachmentObject(input: {
  supabaseUrl: string;
  anonKey: string;
  accessToken: string;
  path: string;
  file: Blob;
  contentType: string;
  onProgress(percent: number): void;
}): UploadHandle {
  const xhr = new XMLHttpRequest();
  let aborted = false;
  const done = new Promise<{ ok: true } | { ok: false; aborted: boolean }>((resolve) => {
    xhr.open("POST", `${input.supabaseUrl}/storage/v1/object/${EMAIL_ATTACHMENTS_BUCKET}/${input.path}`);
    xhr.setRequestHeader("Authorization", `Bearer ${input.accessToken}`);
    xhr.setRequestHeader("apikey", input.anonKey);
    xhr.setRequestHeader("Content-Type", input.contentType);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) input.onProgress(Math.min(99, Math.round((event.loaded / event.total) * 100)));
    };
    xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300 ? { ok: true } : { ok: false, aborted });
    xhr.onerror = () => resolve({ ok: false, aborted });
    xhr.onabort = () => resolve({ ok: false, aborted: true });
    xhr.send(input.file);
  });
  return {
    abort() {
      aborted = true;
      xhr.abort();
    },
    done,
  };
}
