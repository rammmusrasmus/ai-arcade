import { env } from "../env.js";
import { LocalStorage } from "./local.js";

export interface Storage {
  /** Save the original uploaded zip. Returns an opaque key. */
  putBundle(versionId: string, data: Buffer): Promise<string>;
  /** Absolute path (local driver) to a stored bundle, for streaming downloads. */
  bundlePath(key: string): string;
  readBundle(key: string): Promise<Buffer>;
  /** Directory a bundle is extracted into for validation. Never served over HTTP. */
  extractedDir(gameId: string, versionId: string): string;
  /** Remove an extracted game version directory. */
  removeExtracted(gameId: string, versionId: string): Promise<void>;
  /** Save an uploaded image; returns its public URL. */
  putImage(imageId: string, ext: string, data: Buffer): Promise<string>;
  /** Dir holding public/images, which is served at /files/images (local driver). */
  publicRoot(): string;
}

export const storage: Storage = new LocalStorage(env.storageDir, env.PUBLIC_API_URL);
