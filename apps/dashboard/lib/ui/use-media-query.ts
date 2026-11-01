'use client';

import { useEffect, useState } from 'react';

/** True while the viewport matches `query` (client only; false on the first render, then corrected immediately). */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const m = window.matchMedia(query);
    const update = () => setMatches(m.matches);
    update();
    m.addEventListener('change', update);
    return () => m.removeEventListener('change', update);
  }, [query]);
  return matches;
}

/** A phone-sized viewport (below Tailwind's `md`). Pages render a dedicated mobile layout instead of squeezing the desktop one. */
export const useIsMobile = () => useMediaQuery('(max-width: 767px)');
