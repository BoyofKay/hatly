/**
 * "Switch account" on the sign-in page: the people who signed in on THIS browser and ticked "Remember me", so the next person picks
 * their name instead of typing the phone. Only a display name, the phone and the role label are kept — never a password or a token —
 * and each entry can be removed from the sign-in page. Browser storage only (per device); everything works when it is unavailable.
 */
export interface RecentAccount {
  phone: string;
  fullName: string | null;
  role: string;
  lastUsedAt: string;
}

const KEY = 'hatly_dashboard_recent_accounts';
const MAX = 5;

export function readRecentAccounts(): RecentAccount[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as RecentAccount[]) : [];
    return Array.isArray(list) ? list.filter((a) => a && typeof a.phone === 'string').slice(0, MAX) : [];
  } catch {
    return [];
  }
}

function write(list: RecentAccount[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    /* not remembered */
  }
}

export function rememberAccount(a: Omit<RecentAccount, 'lastUsedAt'>) {
  write([{ ...a, lastUsedAt: new Date().toISOString() }, ...readRecentAccounts().filter((x) => x.phone !== a.phone)]);
}

export function forgetAccount(phone: string) {
  write(readRecentAccounts().filter((x) => x.phone !== phone));
}

/** +201012345678 → +20 10•••• 5678 */
export function maskPhone(phone: string): string {
  const p = phone.replace(/\s+/g, '');
  if (p.length < 8) return p;
  return `${p.slice(0, 3)} ${p.slice(3, 5)}•••• ${p.slice(-4)}`;
}
