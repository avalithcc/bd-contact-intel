import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;

function getKey(): Buffer {
  const raw = process.env.GMAIL_TOKEN_ENCRYPTION_KEY;
  if (!raw) throw new Error("GMAIL_TOKEN_ENCRYPTION_KEY is not set");
  // Derive a 32-byte key so any key length in env still yields a valid AES-256 key.
  return crypto.createHash("sha256").update(raw).digest();
}

export function encryptToken(plaintext: string): string {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return [
    iv.toString("hex"),
    cipher.getAuthTag().toString("hex"),
    ciphertext.toString("hex"),
  ].join(":");
}

export function decryptToken(payload: string): string {
  const [ivHex, authTagHex, ciphertextHex] = payload.split(":");
  if (!ivHex || !authTagHex || !ciphertextHex) {
    throw new Error("Malformed encrypted token");
  }
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    getKey(),
    Buffer.from(ivHex, "hex"),
  );
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextHex, "hex")),
    decipher.final(),
  ]).toString("utf8");
}
