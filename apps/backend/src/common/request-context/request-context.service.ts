import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';
import { RequestContext } from './request-context.interface';

/**
 * Request-scoped context, reliable across await/async boundaries,
 * concurrent requests, and nested service calls — backed by Node's
 * built-in `AsyncLocalStorage` (see this module's own design note in
 * the Group 3 report for why this was chosen over a request-object
 * property or a third-party CLS package).
 *
 * The `AsyncLocalStorage` instance below is a module-level singleton,
 * but it holds no per-request mutable state itself — it is a context
 * *propagation* mechanism, not a shared variable. `.getStore()`
 * correctly returns a different value depending on which async
 * continuation calls it; there is no single "current" correlation id
 * that concurrent requests could stomp on.
 */
/** What `getCorrelationId()` returns outside any request context (before/around the middleware). */
export const NO_REQUEST_CONTEXT = 'no-request-context';

@Injectable()
export class RequestContextService {
  private readonly als = new AsyncLocalStorage<RequestContext>();

  /** Establishes `context` for the entire synchronous + asynchronous continuation of `callback`. */
  run<T>(context: RequestContext, callback: () => T): T {
    return this.als.run(context, callback);
  }

  /** Undefined when called outside any request's continuation (e.g. a future background job). */
  get(): RequestContext | undefined {
    return this.als.getStore();
  }

  /**
   * Never fabricates a correlation id — an explicit, clearly-labeled
   * sentinel is returned when there is genuinely no active request
   * context, so a stray log line reads as "no context" rather than
   * looking like a real (but wrong) request id.
   */
  getCorrelationId(): string {
    return this.get()?.correlationId ?? NO_REQUEST_CONTEXT;
  }
}
