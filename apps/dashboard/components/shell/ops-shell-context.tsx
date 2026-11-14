'use client';

import { createContext, useContext, useEffect } from 'react';
import { OperationsFacts } from '../../lib/api/admin-control-tower';

/**
 * Stage 5 (2026-11-14): the shell's operations facts (already polled once for the banner and the menu badge) shared with the page, and a way
 * for the Operations board to say "I am on screen" — the board then shows those facts itself, so the shell banner steps aside instead of
 * repeating them above it (one place, not two). Display only.
 */
export const OpsShellContext = createContext<{ facts: OperationsFacts | null; setBoardShown: (shown: boolean) => void }>({ facts: null, setBoardShown: () => undefined });

export function useShellFacts(): OperationsFacts | null {
  return useContext(OpsShellContext).facts;
}

/** Called by the board while it is mounted. */
export function useBoardShown() {
  const { setBoardShown } = useContext(OpsShellContext);
  useEffect(() => {
    setBoardShown(true);
    return () => setBoardShown(false);
  }, [setBoardShown]);
}
