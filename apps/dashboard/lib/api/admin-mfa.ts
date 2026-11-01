import { apiClient } from './client';

export async function getMfaStatus(): Promise<{ enabled: boolean }> {
  return (await apiClient.get('/auth/mfa/status')).data.data;
}
export async function beginMfaSetup(): Promise<{ secret: string; otpauthUrl: string }> {
  return (await apiClient.post('/auth/mfa/setup')).data.data;
}
export async function enableMfa(code: string): Promise<{ recoveryCodes: string[] }> {
  return (await apiClient.post('/auth/mfa/enable', { code })).data.data;
}
export async function disableMfa(password: string, code: string): Promise<void> {
  await apiClient.post('/auth/mfa/disable', { password, code });
}
