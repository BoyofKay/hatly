import { randomUUID } from 'crypto';

/**
 * Object naming shared by every storage provider (M5 Batch 2). A stored object's name is ALWAYS server-generated:
 * `<uuid><ext>`, where the extension comes from a fixed allow-list (and, upstream, from the DETECTED image type — see
 * image-validation.ts), never from client input. A caller-supplied name can therefore neither choose nor traverse anywhere.
 */
export const ALLOWED_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'] as const;

export const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

/** `<uuid>.<jpg|jpeg|png|webp>` — the only object names this API will ever serve or redirect to. */
export const STORED_FILE_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$/;

export function safeExtensionOf(filename: string): string {
  const match = /\.([a-zA-Z0-9]{1,5})$/.exec(filename);
  const ext = match ? `.${match[1].toLowerCase()}` : '';
  return (ALLOWED_IMAGE_EXTENSIONS as readonly string[]).includes(ext) ? ext : '';
}

export function newStoredFileName(filename: string): string {
  return `${randomUUID()}${safeExtensionOf(filename)}`;
}
