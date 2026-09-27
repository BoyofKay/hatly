import { apiClient } from './client';

export interface MarketplaceSector {
  id: string;
  name: string;
  nameAr: string | null;
  slug: string;
  sortOrder: number;
}

/** Reuses the EXISTING, unmodified public sectors endpoint — no new Sectors backend. */
export async function listSectors(): Promise<MarketplaceSector[]> {
  const res = await apiClient.get('/sectors');
  return res.data.data;
}
