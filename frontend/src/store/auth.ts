import { create } from 'zustand';
import { get, post, setCsrf } from '@/lib/api';

export interface Me { id: string; email: string; role: 'user' | 'admin' | 'super_admin'; emailVerified: boolean; twoFactorEnabled: boolean }
interface Auth { me: Me | null; loading: boolean; load: () => Promise<void>; login: (b: { email: string; password: string; totp?: string; recoveryCode?: string }) => Promise<void>; logout: () => Promise<void>; clear: () => void }

export const useAuth = create<Auth>((set) => ({
  me: null, loading: true,
  load: async () => { try { set({ me: await get<Me>('/auth/me'), loading: false }); } catch { set({ me: null, loading: false }); } },
  login: async (b) => { const r = await post<{ csrfToken: string }>('/auth/login', b); setCsrf(r.csrfToken); set({ me: await get<Me>('/auth/me') }); },
  logout: async () => { try { await post('/auth/logout'); } finally { setCsrf(null); set({ me: null }); } },
  clear: () => { setCsrf(null); set({ me: null }); },
}));
