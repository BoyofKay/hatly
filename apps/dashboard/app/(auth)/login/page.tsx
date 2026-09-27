'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { loginWithPassword } from '../../../lib/auth/session';

/**
 * PHASE I-B, CHUNK 9: real Dashboard login — phone + password only,
 * no OTP step. Serves VENDOR/VENDOR_MANAGER/ADMIN/SUPER_ADMIN, all via
 * the same real `auth/password/login` endpoint (role-checked
 * server-side; never trusted from this form). Customer OTP is
 * untouched elsewhere — this dashboard never served Customer accounts.
 */
export default function LoginPage() {
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const user = await loginWithPassword(phone, password);
      if (user.role === 'ADMIN' || user.role === 'SUPER_ADMIN') {
        router.push('/vendors');
      } else if (user.role === 'VENDOR' || user.role === 'VENDOR_MANAGER') {
        router.push('/orders');
      } else {
        setError('This account does not have dashboard access.');
        setIsSubmitting(false);
      }
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Invalid phone number or password.');
      setIsSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm rounded-lg bg-white p-8 shadow">
        <h1 className="text-2xl font-semibold text-hatly-orange">Hatly Dashboard</h1>
        <p className="mt-1 text-sm text-gray-500">Sign in</p>

        <form onSubmit={handleLogin} className="mt-6 space-y-4">
          <div>
            <label htmlFor="login-phone" className="block text-sm font-medium text-gray-700">Phone number</label>
            <input
              id="login-phone"
              type="tel"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+20..."
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
            />
          </div>
          <div>
            <label htmlFor="login-password" className="block text-sm font-medium text-gray-700">Password</label>
            <input
              id="login-password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded bg-hatly-orange py-2 font-medium text-white disabled:opacity-50"
          >
            {isSubmitting ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
      </div>
    </main>
  );
}
