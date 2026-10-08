import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { UploadProvider } from './upload-provider.interface';

/**
 * Read path for PRIVATE object storage (M5 Batch 2). The stored reference stays `/uploads/files/<uuid>.<ext>` (so clients,
 * the Upload table and the Flutter media resolver are unchanged); this handler answers it with a 302 to a short-lived signed
 * GET URL for the private object. The bucket is never public and no credential reaches the client — only a time-limited,
 * single-object URL. Only exact `<uuid>.<ext>` names are ever resolved (everything else is a plain 404, so traversal
 * attempts or arbitrary keys can't be probed), and only GET/HEAD are handled.
 *
 * Access control note: like the local static route it replaces, possession of the unguessable name is the capability; per-user
 * authorisation for media is a separate, later item (the Flutter image widgets cannot send auth headers today).
 */
export function createPrivateMediaRedirect(provider: UploadProvider, signedUrlTtlSeconds: number): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    let fileName: string;
    try {
      fileName = decodeURIComponent((req.path ?? '').replace(/^\/+/, ''));
    } catch {
      res.status(404).end();
      return;
    }
    const target = provider.createReadUrl?.(fileName) ?? null;
    if (!target) {
      res.status(404).end();
      return;
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // The redirect itself may be cached privately for a little less than the signed URL lives, never longer.
    res.setHeader('Cache-Control', `private, max-age=${Math.max(0, signedUrlTtlSeconds - 30)}`);
    res.redirect(302, target);
  };
}
