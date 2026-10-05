// Object storage for evidence documents. Files are encrypted (AES-256-GCM) BEFORE they reach the store,
// so the bucket / disk only ever holds ciphertext. Local disk in development, S3-compatible in production.
import { promises as fs } from "fs";
import path from "path";
import { createHash, randomBytes } from "crypto";
import { decryptBuffer, encryptBuffer } from "@/lib/security/crypto";

export interface BlobStore {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

class LocalStore implements BlobStore {
  constructor(private dir: string) {}
  private file(key: string) {
    if (!/^[A-Za-z0-9/_\-.]+$/.test(key) || key.includes("..")) throw new Error("invalid storage key");
    return path.join(this.dir, key);
  }
  async put(key: string, data: Buffer) {
    const f = this.file(key);
    await fs.mkdir(path.dirname(f), { recursive: true });
    await fs.writeFile(f, data, { mode: 0o600 });
  }
  get(key: string) { return fs.readFile(this.file(key)); }
  async delete(key: string) { await fs.rm(this.file(key), { force: true }); }
}

class S3Store implements BlobStore {
  private client: Promise<any>;
  constructor(private bucket: string, opts: { region: string; endpoint?: string; forcePathStyle?: boolean; accessKeyId: string; secretAccessKey: string }) {
    this.client = import("@aws-sdk/client-s3").then(m => new m.S3Client({
      region: opts.region, endpoint: opts.endpoint, forcePathStyle: opts.forcePathStyle,
      requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED",
      credentials: { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey },
    }));
  }
  async put(key: string, data: Buffer) {
    const m = await import("@aws-sdk/client-s3");
    await (await this.client).send(new m.PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data, ContentType: "application/octet-stream" }));
  }
  async get(key: string) {
    const m = await import("@aws-sdk/client-s3");
    const r = await (await this.client).send(new m.GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const chunks: Buffer[] = [];
    for await (const c of r.Body as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(c));
    return Buffer.concat(chunks);
  }
  async delete(key: string) {
    const m = await import("@aws-sdk/client-s3");
    await (await this.client).send(new m.DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

let store: BlobStore | undefined;

export function getStore(): BlobStore {
  if (store) return store;
  if (process.env.S3_BUCKET) {
    if (!process.env.S3_ACCESS_KEY_ID || !process.env.S3_SECRET_ACCESS_KEY) throw new Error("S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY are required with S3_BUCKET");
    store = new S3Store(process.env.S3_BUCKET, {
      region: process.env.S3_REGION ?? "ap-south-1",
      endpoint: process.env.S3_ENDPOINT,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    });
  } else {
    if (process.env.NODE_ENV === "production") throw new Error("S3_BUCKET must be set in production (documents cannot live on the app server's disk)");
    store = new LocalStore(process.env.LOCAL_STORAGE_DIR ?? path.join(process.cwd(), ".data", "uploads"));
  }
  return store;
}

export function setStoreForTests(s: BlobStore | undefined) { store = s; }

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

const SIGNATURES: { mime: string; ext: string; test: (b: Buffer) => boolean }[] = [
  { mime: "application/pdf", ext: "pdf", test: b => b.subarray(0, 5).toString("latin1") === "%PDF-" },
  { mime: "image/png", ext: "png", test: b => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: "image/jpeg", ext: "jpg", test: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
];

/** Decide the file type from its content, never from the client's claimed type or name. */
export function sniffFile(data: Buffer): { mime: string; ext: string } | null {
  const s = SIGNATURES.find(x => x.test(data));
  return s ? { mime: s.mime, ext: s.ext } : null;
}

/** Strip path parts and odd characters from a client-supplied filename. */
export function safeFilename(name: string, ext: string): string {
  const base = name.split(/[\\/]/).pop() ?? "document";
  const clean = base.replace(/\.[^.]*$/, "").replace(/[^A-Za-z0-9._ -]/g, "_").slice(0, 80).trim() || "document";
  return `${clean}.${ext}`;
}

export async function saveEncrypted(data: Buffer, prefix: string): Promise<{ key: string; sha256: string }> {
  const key = `${prefix}/${randomBytes(16).toString("hex")}.bin`;
  await getStore().put(key, encryptBuffer(data));
  return { key, sha256: createHash("sha256").update(data).digest("hex") };
}

export async function loadDecrypted(key: string): Promise<Buffer> {
  return decryptBuffer(await getStore().get(key));
}

export async function removeObject(key: string): Promise<void> {
  await getStore().delete(key);
}
