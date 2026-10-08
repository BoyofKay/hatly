import { EventEmitter } from 'events';
import { isImageUploadRequest, limitConcurrentUploads } from './upload-concurrency.middleware';

const fakeRes = () => {
  const res: any = new EventEmitter();
  res.headers = {} as Record<string, string>;
  res.setHeader = (k: string, v: string) => { res.headers[k] = v; };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; };
  return res;
};
const reqWith = (over: Record<string, unknown> = {}) => ({ method: 'POST', path: '/api/v1/uploads', headers: { authorization: 'Bearer valid' }, resume: jest.fn(), ...over }) as any;

describe('limitConcurrentUploads', () => {
  const make = (max: number, extra: Record<string, unknown> = {}) =>
    limitConcurrentUploads({ max, matches: isImageUploadRequest('api/v1'), isAuthenticated: (r) => r.headers.authorization === 'Bearer valid', ...extra });

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('processes up to `max` at once; the excess QUEUES (nothing refused, next() not yet called) and starts as slots free up, in order', () => {
    const mw = make(2);
    const nexts = [jest.fn(), jest.fn(), jest.fn(), jest.fn()];
    const res = [fakeRes(), fakeRes(), fakeRes(), fakeRes()];
    res.forEach((r, i) => mw(reqWith(), r, nexts[i]));
    expect(nexts.map((n) => n.mock.calls.length)).toEqual([1, 1, 0, 0]);
    expect(mw.inFlight()).toBe(2);
    expect(mw.queued()).toBe(2);
    res.forEach((r) => expect(r.statusCode).toBeUndefined()); // nobody was answered/refused

    res[0].emit('close');
    expect(nexts.map((n) => n.mock.calls.length)).toEqual([1, 1, 1, 0]); // FIFO hand-over
    expect(mw.inFlight()).toBe(2);
    res[1].emit('close');
    res[2].emit('close');
    expect(nexts[3]).toHaveBeenCalled();
    res[3].emit('close');
    expect(mw.inFlight()).toBe(0);
    expect(mw.queued()).toBe(0);
  });

  it('never has more than `max` in flight, however many arrive', () => {
    const mw = make(3);
    const res = Array.from({ length: 40 }, () => fakeRes());
    let peak = 0;
    res.forEach((r) => { mw(reqWith(), r, jest.fn()); peak = Math.max(peak, mw.inFlight()); });
    for (const r of res) { r.emit('close'); peak = Math.max(peak, mw.inFlight()); }
    expect(peak).toBe(3);
    expect(mw.inFlight()).toBe(0);
  });

  it('a client that disconnects mid-upload frees its slot exactly once; one that leaves while still queued just leaves the queue', () => {
    const mw = make(1);
    const first = fakeRes();
    const second = fakeRes();
    const third = fakeRes();
    const nextThird = jest.fn();
    mw(reqWith(), first, jest.fn());
    mw(reqWith(), second, jest.fn());
    mw(reqWith(), third, nextThird);
    second.emit('close'); // gave up while queued
    expect(mw.queued()).toBe(1);
    first.emit('close');
    first.emit('close'); // a second close must not free someone else's slot
    expect(nextThird).toHaveBeenCalledTimes(1);
    expect(mw.inFlight()).toBe(1);
  });

  it('a request that waits longer than maxWaitMs, or arrives when the queue is full, gets a 503 + Retry-After and its body is discarded', () => {
    const mw = make(1, { maxWaitMs: 1000, maxQueue: 1 });
    mw(reqWith(), fakeRes(), jest.fn());
    const queuedReq = reqWith();
    const queuedRes = fakeRes();
    const queuedNext = jest.fn();
    mw(queuedReq, queuedRes, queuedNext);
    const overflowReq = reqWith();
    const overflowRes = fakeRes();
    mw(overflowReq, overflowRes, jest.fn());
    expect(overflowRes.statusCode).toBe(503); // queue full: refused at once
    expect(overflowRes.headers['Retry-After']).toBe('2');
    expect(overflowReq.resume).toHaveBeenCalled();

    jest.advanceTimersByTime(1001);
    expect(queuedRes.statusCode).toBe(503); // waited too long
    expect(queuedRes.body.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(queuedNext).not.toHaveBeenCalled();
    expect(mw.queued()).toBe(0);
  });

  it('does NOT meter requests that are not authenticated: they pass straight through to be answered 401 by the guard (never queued, never reset)', () => {
    const mw = make(1);
    mw(reqWith(), fakeRes(), jest.fn()); // saturate
    for (const headers of [{}, { authorization: 'Bearer forged' }, { authorization: 'Basic abc' }]) {
      const next = jest.fn();
      const res = fakeRes();
      mw(reqWith({ headers }), res, next);
      expect(next).toHaveBeenCalled();
      expect(res.statusCode).toBeUndefined();
    }
    expect(mw.inFlight()).toBe(1);
    expect(mw.queued()).toBe(0);
  });

  it('only counts upload requests: everything else passes straight through, even when uploads are saturated', () => {
    const mw = make(1);
    mw(reqWith(), fakeRes(), jest.fn());
    for (const over of [{ method: 'GET' }, { path: '/api/v1/orders' }, { path: '/uploads/files/x.png', method: 'GET' }, { path: '/api/v1/uploads/extra' }]) {
      const next = jest.fn();
      mw(reqWith(over), fakeRes(), next);
      expect(next).toHaveBeenCalled();
    }
    expect(mw.inFlight()).toBe(1);
  });

  it('recognises the vendor product-image upload route', () => {
    const matches = isImageUploadRequest('api/v1');
    expect(matches({ method: 'POST', path: '/api/v1/vendor/products/abc-123/image' } as any)).toBe(true);
    expect(matches({ method: 'POST', path: '/api/v1/vendor/products/abc-123/activate' } as any)).toBe(false);
    expect(matches({ method: 'GET', path: '/api/v1/vendor/products/abc-123/image' } as any)).toBe(false);
  });
});
