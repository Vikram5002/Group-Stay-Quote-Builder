import {
  GetObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Router, raw, type Request } from 'express';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';

/**
 * Where uploaded imports and generated exports live (blueprint 7.2: S3 documents bucket).
 * The browser uploads and downloads directly with short-lived URLs; the API never streams
 * large files through Lambda. Three implementations: S3 (AWS), a local folder (npm run dev)
 * and memory (tests).
 */
export interface FileStore {
  /** Short-lived URL the client PUTs the file to. */
  uploadUrl(key: string, contentType: string, expiresInSec: number): Promise<string>;
  /** Short-lived URL to download a file. */
  downloadUrl(key: string, expiresInSec: number, fileName?: string): Promise<string>;
  get(key: string): Promise<Buffer | null>;
  put(key: string, body: Buffer | string, contentType: string): Promise<void>;
  /** Keys under a prefix, sorted. */
  list(prefix: string): Promise<string[]>;
}

const SAFE_KEY = /^[A-Za-z0-9!_.*'()/-]{1,512}$/;

function assertKey(key: string): void {
  if (!SAFE_KEY.test(key) || key.includes('..') || key.startsWith('/')) {
    throw new RangeError(`Unsafe file key: ${key}`);
  }
}

export class MemoryFileStore implements FileStore {
  readonly files = new Map<string, { body: Buffer; contentType: string }>();

  async uploadUrl(key: string): Promise<string> {
    assertKey(key);
    return `https://files.test/upload/${key}`;
  }
  async downloadUrl(key: string): Promise<string> {
    assertKey(key);
    return `https://files.test/download/${key}`;
  }
  async get(key: string): Promise<Buffer | null> {
    return this.files.get(key)?.body ?? null;
  }
  async put(key: string, body: Buffer | string, contentType: string): Promise<void> {
    assertKey(key);
    this.files.set(key, { body: Buffer.from(body), contentType });
  }
  async list(prefix: string): Promise<string[]> {
    return [...this.files.keys()].filter((k) => k.startsWith(prefix)).sort();
  }
}

export class S3FileStore implements FileStore {
  constructor(
    private readonly s3: S3Client,
    private readonly bucket: string,
  ) {}

  uploadUrl(key: string, contentType: string, expiresInSec: number): Promise<string> {
    assertKey(key);
    return getSignedUrl(
      this.s3,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }),
      { expiresIn: expiresInSec },
    );
  }

  downloadUrl(key: string, expiresInSec: number, fileName?: string): Promise<string> {
    assertKey(key);
    return getSignedUrl(
      this.s3,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ...(fileName ? { ResponseContentDisposition: `attachment; filename="${fileName}"` } : {}),
      }),
      { expiresIn: expiresInSec },
    );
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      const out = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return out.Body ? Buffer.from(await out.Body.transformToByteArray()) : null;
    } catch (err) {
      if (err instanceof NoSuchKey) return null;
      throw err;
    }
  }

  async put(key: string, body: Buffer | string, contentType: string): Promise<void> {
    assertKey(key);
    await this.s3.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  async list(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const out = await this.s3.send(
        new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }),
      );
      for (const o of out.Contents ?? []) if (o.Key) keys.push(o.Key);
      token = out.NextContinuationToken;
    } while (token);
    return keys.sort();
  }
}

/** A folder on disk for local development, served by `localFilesRouter`. */
export class LocalFileStore implements FileStore {
  readonly root: string;
  constructor(
    root: string,
    private readonly baseUrl: string,
  ) {
    this.root = resolve(root);
  }

  /** Resolve a key inside the root; refuses anything that would escape it. */
  path(key: string): string {
    assertKey(key);
    const p = resolve(this.root, key);
    if (!p.startsWith(this.root + sep)) throw new RangeError(`Unsafe file key: ${key}`);
    return p;
  }

  async uploadUrl(key: string): Promise<string> {
    this.path(key);
    return `${this.baseUrl}/local-files/${key}`;
  }
  async downloadUrl(key: string): Promise<string> {
    this.path(key);
    return `${this.baseUrl}/local-files/${key}`;
  }
  async get(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.path(key));
    } catch {
      return null;
    }
  }
  async put(key: string, body: Buffer | string, _contentType?: string): Promise<void> {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, body);
  }
  async list(prefix: string): Promise<string[]> {
    const out: string[] = [];
    const walk = async (dir: string) => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const full = join(dir, e.name);
        if (e.isDirectory()) await walk(full);
        else out.push(relative(this.root, full).split(sep).join('/'));
      }
    };
    await walk(this.root);
    return out.filter((k) => k.startsWith(prefix)).sort();
  }
}

/** Dev-only PUT and GET for LocalFileStore URLs (stands in for S3 presigned URLs). */
export function localFilesRouter(store: LocalFileStore): Router {
  const router = Router();
  const keyOf = (req: Request) => decodeURIComponent(req.path.replace(/^\//, ''));
  router.put('/*path', raw({ type: () => true, limit: '10mb' }), async (req, res) => {
    await store.put(keyOf(req), req.body as Buffer);
    res.status(200).end();
  });
  router.get('/*path', async (req, res) => {
    const body = await store.get(keyOf(req));
    if (!body) {
      res.status(404).end();
      return;
    }
    res.type('application/octet-stream').send(body);
  });
  return router;
}
