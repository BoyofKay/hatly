'use client';

import { useEffect, useState } from 'react';
import { getMyAdminPermissions } from '../api/admin-me';

/**
 * Whether the signed-in admin holds `permission`: `null` while loading (and when the lookup failed — the control then stays
 * disabled, the safe default), otherwise true/false. Display only: the backend independently enforces the permission.
 */
export function useAdminPermission(permission: string): boolean | null {
  const [granted, setGranted] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    getMyAdminPermissions()
      .then((me) => !cancelled && setGranted(me.permissions.includes(permission)))
      .catch(() => !cancelled && setGranted(null));
    return () => {
      cancelled = true;
    };
  }, [permission]);
  return granted;
}
