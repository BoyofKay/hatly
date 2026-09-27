export type DashboardRole = 'VENDOR' | 'VENDOR_MANAGER' | 'ADMIN' | 'SUPER_ADMIN';

export interface DashboardUser {
  id: string;
  role: DashboardRole;
  fullName: string;
}
