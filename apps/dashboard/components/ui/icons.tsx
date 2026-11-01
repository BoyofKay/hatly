import { ReactNode } from 'react';

/** Line icons for KPI cards and headers (24×24, current colour) — one set, so every page draws the same symbol for the same idea. */
const I = (d: ReactNode) => <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{d}</svg>;

export const ICONS = {
  cart: I(<><circle cx="9" cy="20" r="1.5" /><circle cx="18" cy="20" r="1.5" /><path d="M2 3h3l2.5 12h11L21 7H6" /></>),
  check: I(<><circle cx="12" cy="12" r="9" /><path d="M8 12.5l2.7 2.7L16 9.5" /></>),
  coins: I(<><ellipse cx="12" cy="6" rx="8" ry="3" /><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" /></>),
  store: I(<><path d="M4 21V8l8-5 8 5v13" /><path d="M9 21v-7h6v7" /></>),
  truck: I(<><path d="M2 6h12v10H2zM14 10h4l3 3v3h-7" /><circle cx="7" cy="18" r="1.8" /><circle cx="17" cy="18" r="1.8" /></>),
  bell: I(<><path d="M6 9a6 6 0 0112 0c0 5 2 6 2 6H4s2-1 2-6z" /><path d="M10 19a2 2 0 004 0" /></>),
  pot: I(<><path d="M4 11h16v3a6 6 0 01-6 6h-4a6 6 0 01-6-6z" /><path d="M8 7c0-2 2-2 2-4M13 7c0-2 2-2 2-4" /></>),
  bag: I(<><path d="M6 8h12l1 12H5z" /><path d="M9 8a3 3 0 016 0" /></>),
  box: I(<><path d="M3 7l9-4 9 4v10l-9 4-9-4z" /><path d="M3 7l9 4 9-4M12 11v10" /></>),
  alert: I(<><path d="M12 3l9.5 17h-19z" /><path d="M12 10v4M12 17.5v.5" /></>),
  empty: I(<><circle cx="12" cy="12" r="9" /><path d="M6 18L18 6" /></>),
  image: I(<><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="1.8" /><path d="M21 16l-5-5-9 9" /></>),
  users: I(<><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0113 0" /><circle cx="17" cy="9" r="2.5" /><path d="M17 14a4.5 4.5 0 014.5 4.5" /></>),
  user: I(<><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0116 0" /></>),
  userOff: I(<><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0113-6.2M16 17l5 5M21 17l-5 5" /></>),
  shield: I(<><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /><path d="M9 12l2 2 4-4" /></>),
  scale: I(<><path d="M12 4v16M7 20h10M5 8h14" /><path d="M5 8l-3 6a3 3 0 006 0zM19 8l-3 6a3 3 0 006 0z" /></>),
  list: I(<><path d="M8 6h13M8 12h13M8 18h13" /><circle cx="3.5" cy="6" r="1" /><circle cx="3.5" cy="12" r="1" /><circle cx="3.5" cy="18" r="1" /></>),
  star: I(<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" />),
  receipt: I(<><path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z" /><path d="M9 8h6M9 12h6" /></>),
};
export type IconName = keyof typeof ICONS;
