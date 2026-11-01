import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { HomeSectionsCache } from './home-sections.cache';

/**
 * Catalogue mutations that can change what the Home product rows show — product / category / offer / branch / vendor / sector / delivery-zone
 * edits made through the admin and vendor APIs. After one SUCCEEDS the cache epoch is bumped, so the next Home request recomputes instead of
 * serving a stale row (no Redis flush, no key scan; the old keys simply stop being reachable and expire by TTL).
 * Changes that no admin API makes — stock running out through an order, delivered counts growing — are covered by the short TTL instead.
 */
const CATALOGUE_MUTATION = /^\/(?:api\/v\d+\/)?(?:admin\/(?:products|product-categories|catalog-products|offers|vendors|vendor-branches|sectors|subcategories|delivery-zones|service-areas|home-banners|media|marketplace|campaigns)|vendor\/(?:products|categories|branches))(?:\/|$|\?)/;

@Injectable()
export class HomeCacheEpochInterceptor implements NestInterceptor {
  constructor(private readonly cache: HomeSectionsCache) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const request = context.switchToHttp().getRequest<{ method: string; originalUrl?: string; url: string }>();
    if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') return next.handle();
    const affectsHome = CATALOGUE_MUTATION.test(request.originalUrl ?? request.url);
    return next.handle().pipe(tap({ next: () => affectsHome && void this.cache.bumpEpoch() }));
  }
}

export const isHomeCatalogueMutation = (method: string, url: string): boolean =>
  method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS' && CATALOGUE_MUTATION.test(url);
