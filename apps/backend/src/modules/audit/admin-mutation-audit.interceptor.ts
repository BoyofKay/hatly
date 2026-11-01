import { CallHandler, ExecutionContext, HttpException, Injectable, NestInterceptor, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, from } from 'rxjs';
import { catchError, concatMap } from 'rxjs/operators';
import { AdminAuditAction, AdminAuditService } from './admin-audit.service';
import { REQUIRED_PERMISSIONS_KEY } from '../permissions/decorators/requires-permission.decorator';

export const EXPLICITLY_AUDITED_KEY = 'hatly:explicitlyAudited';
/**
 * Marks a handler that already writes its own, richer audit entry (with its own action name and metadata) — the generic
 * interceptor below then stays out of the way, so one action is never on record twice.
 */
export const ExplicitlyAudited = () => SetMetadata(EXPLICITLY_AUDITED_KEY, true);

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const PRIVILEGED_ROLES = new Set(['ADMIN', 'SUPER_ADMIN']);
const MAX_FIELDS = 25;

/**
 * Security milestone — audit coverage for EVERY privileged mutation. Before this, `admin_audit_logs` held only a handful of explicit
 * call sites (sign-in, MFA, permissions, vendor staff, business config, sector switch); offers, vendors/branches, delivery zones,
 * driver verification, dispatch, settlement, manual-transfer approve/reject/refund, failed-delivery refunds, commissions, catalogue and
 * pricing changes left no audit record at all.
 *
 * Every POST/PUT/PATCH/DELETE made by an ADMIN or SUPER_ADMIN (outside `/auth/*`, whose events are audited explicitly) is recorded
 * as `admin.mutation` with: actor, route TEMPLATE, the target id from the path, the required permission, the HTTP outcome, and the
 * NAMES of the body fields that were sent — never their values (a value can be a payment destination, a price or a personal detail;
 * the domain records — financial events, payments, settlement rows — hold the amounts). Refused attempts (4xx/5xx from the handler)
 * are recorded too, as FAILURE. Requests a guard refuses never reach this point (401/403 are visible in the request log).
 *
 * Failure mode (documented in docs/security): this runs AFTER the handler has committed, so it is RESILIENT — an audit-write failure
 * is logged loudly by AdminAuditService and never turns a completed action into an error. Fail-closed auditing would mean writing the
 * entry inside each action's own transaction; the money-moving actions already persist their own durable, append-only domain records
 * (financial events with idempotency keys, payment rows with the verifier, settlement periods with `closedByUserId`), so this log is the
 * cross-cutting "who touched what" index, not the financial source of truth.
 */
@Injectable()
export class AdminMutationAuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AdminAuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest();
    const user = req.user as { id?: string; role?: string } | undefined;
    if (!MUTATING.has(req.method) || !user?.role || !PRIVILEGED_ROLES.has(user.role)) return next.handle();
    const routeTemplate: string = req.route?.path ?? req.path ?? '';
    if (/\/auth\//.test(routeTemplate)) return next.handle();
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(EXPLICITLY_AUDITED_KEY, targets)) return next.handle();

    const permissions = this.reflector.getAllAndOverride<string[]>(REQUIRED_PERMISSIONS_KEY, targets) ?? [];
    const params: Record<string, string> = req.params ?? {};
    const targetId = params.id ?? Object.values(params)[0] ?? null;
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const fields = Object.keys(body).slice(0, MAX_FIELDS).join(',');
    const targetType = (routeTemplate.match(/\/admin\/([^/]+)/)?.[1] ?? routeTemplate.split('/').filter((p: string) => p && !p.startsWith(':'))[2] ?? 'unknown').slice(0, 60);

    const write = (outcome: 'SUCCESS' | 'FAILURE', status: number) =>
      this.audit.record({
        actorUserId: user.id ?? null,
        actorRole: user.role ?? null,
        action: AdminAuditAction.ADMIN_MUTATION,
        targetType,
        targetId,
        outcome,
        ipAddress: req.ip ?? null,
        metadata: { method: req.method, route: routeTemplate, permission: permissions.join(',') || null, status, fields: fields || null },
      });

    return next.handle().pipe(
      concatMap((data) => from(write('SUCCESS', context.switchToHttp().getResponse()?.statusCode ?? 200).then(() => data))),
      catchError((error) => from(write('FAILURE', error instanceof HttpException ? error.getStatus() : 500).then(() => Promise.reject(error)))),
    );
  }
}
