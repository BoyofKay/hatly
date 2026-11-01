import { apiClient } from './client';

/** Mirrors the backend `HomeBannerActionType`: where tapping the banner leads. There is deliberately no "external link". */
export type BannerActionType = 'NONE' | 'PRODUCT' | 'VENDOR' | 'SECTOR';
export type BannerDisplayStatus = 'DRAFT' | 'LIVE' | 'SCHEDULED' | 'EXPIRED';

/** A Home banner as the ADMIN API returns it (drafts, live, scheduled and ended alike). */
export interface HomeBanner {
  id: string;
  title: string;
  titleAr: string | null;
  /** The server's stable upload reference (`/uploads/files/<name>`); resolve it with `resolveMediaUrl` to display it. */
  imageUrl: string | null;
  actionType: BannerActionType;
  actionTargetId: string | null;
  sortOrder: number;
  isActive: boolean;
  startsAt: string | null;
  endsAt: string | null;
  displayStatus: BannerDisplayStatus;
}

export interface CreateHomeBannerInput {
  title: string;
  titleAr?: string;
  actionType?: BannerActionType;
  actionTargetId?: string;
  sortOrder?: number;
  startsAt?: string;
  endsAt?: string;
}

/** `null` clears an optional value. */
export interface UpdateHomeBannerInput {
  title?: string;
  titleAr?: string | null;
  actionType?: BannerActionType;
  actionTargetId?: string | null;
  sortOrder?: number;
  startsAt?: string | null;
  endsAt?: string | null;
}

export const MANAGE_HOME_BANNERS = 'MANAGE_HOME_BANNERS';
/** Same limit and types as the backend image endpoint (it re-checks both, and the real bytes). */
export const BANNER_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const BANNER_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export async function listHomeBanners(): Promise<HomeBanner[]> {
  const res = await apiClient.get('/admin/home-banners');
  return res.data.data;
}

export async function createHomeBanner(input: CreateHomeBannerInput): Promise<HomeBanner> {
  const res = await apiClient.post('/admin/home-banners', input);
  return res.data.data;
}

export async function updateHomeBanner(id: string, input: UpdateHomeBannerInput): Promise<HomeBanner> {
  const res = await apiClient.patch(`/admin/home-banners/${id}`, input);
  return res.data.data;
}

/** Multipart, field name "image" — the same contract as a product image. Content-Type is left to the browser (it must add the boundary). */
export async function uploadHomeBannerImage(id: string, file: File): Promise<HomeBanner> {
  const formData = new FormData();
  formData.append('image', file);
  const res = await apiClient.post(`/admin/home-banners/${id}/image`, formData);
  return res.data.data;
}

export async function setHomeBannerActive(id: string, active: boolean): Promise<HomeBanner> {
  const res = await apiClient.patch(`/admin/home-banners/${id}/${active ? 'activate' : 'deactivate'}`);
  return res.data.data;
}

export async function deleteHomeBanner(id: string): Promise<void> {
  await apiClient.delete(`/admin/home-banners/${id}`);
}

const FRIENDLY: Record<string, string> = {
  BANNER_IMAGE_REQUIRED: 'Upload an image before publishing this banner.',
  BANNER_SCHEDULE_INVALID: 'The end time must be after the start time.',
  BANNER_ACTION_TARGET_REQUIRED: 'Choose what this banner opens.',
  BANNER_ACTION_TARGET_UNEXPECTED: 'A banner with no action cannot have a destination.',
  BANNER_ACTION_TARGET_NOT_FOUND: 'The chosen destination no longer exists.',
  BANNER_NOT_FOUND: 'This banner no longer exists. Reload the list.',
  UNSUPPORTED_IMAGE_TYPE: 'Only JPEG, PNG or WebP images are allowed.',
  IMAGE_TOO_LARGE: 'The image is larger than 5 MB.',
  FILE_REQUIRED: 'Choose an image file first.',
};

/** The backend's reason for a failed call, in plain words — never swallowed, never a stack trace. */
export function bannerErrorMessage(err: any, fallback: string): string {
  const status = err?.response?.status;
  const body = err?.response?.data;
  if (status === 403) return 'You do not have permission to manage banners.';
  if (status === 413) return FRIENDLY.IMAGE_TOO_LARGE;
  const code = body?.error?.details?.code ?? body?.error?.code;
  if (code && FRIENDLY[code]) return FRIENDLY[code];
  const message = body?.error?.message ?? body?.message;
  if (Array.isArray(message)) return message.join(', ');
  return typeof message === 'string' ? message : fallback;
}
