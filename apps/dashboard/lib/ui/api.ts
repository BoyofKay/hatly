'use client';

import useSWR, { SWRConfiguration } from 'swr';
import { apiClient } from '../api/client';
import { apiErrorMessage } from '../api/errors';

type Params = Record<string, string | number | boolean | null | undefined>;

export function cleanParams(params?: Params): Params {
  const out: Params = {};
  for (const [k, v] of Object.entries(params ?? {})) if (v !== undefined && v !== null && v !== '') out[k] = v;
  return out;
}

/** GET → the backend envelope `{ data, meta }`. */
export async function getEnvelope<T = any>(url: string, params?: Params): Promise<{ data: T; meta?: any }> {
  const res = await apiClient.get(url, { params: cleanParams(params) });
  return res.data;
}

export async function send<T = any>(method: 'post' | 'put' | 'patch' | 'delete', url: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
  const res = await apiClient.request({ method, url, data: body, headers });
  return res.data?.data as T;
}

/** A fresh idempotency key per user INTENT; reuse it only when retrying the same submission. */
export function newKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export interface ApiState<T> {
  data: T | undefined;
  meta: any;
  loading: boolean;
  error: string | null;
  status: number | null;
  reload: () => void;
}

/**
 * Server-state hook (SWR): loading / error / data in one place. `url = null` pauses the request. The error is the backend's own
 * sentence (never a stack trace); a 403 is reported as such so the page can say "you do not have access".
 */
export function useApi<T = any>(url: string | null, params?: Params, config?: SWRConfiguration): ApiState<T> {
  const key = url ? [url, JSON.stringify(cleanParams(params))] : null;
  const { data, error, isLoading, mutate } = useSWR(key, ([u]) => getEnvelope<T>(u as string, params), { revalidateOnFocus: false, shouldRetryOnError: false, keepPreviousData: true, ...config });
  return {
    data: data?.data,
    meta: data?.meta,
    loading: isLoading,
    error: error ? apiErrorMessage(error, 'Something went wrong. Please try again.') : null,
    status: (error as any)?.response?.status ?? null,
    reload: () => void mutate(),
  };
}
