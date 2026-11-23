import { create } from 'zustand';

type Theme = 'light' | 'dark' | 'system';
const read = (k: string, d: string) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

interface UI {
  theme: Theme; hideBalances: boolean; sidebarCollapsed: boolean; quickAdd: boolean;
  setTheme: (t: Theme) => void; toggleBalances: () => void; setHide: (v: boolean) => void; toggleSidebar: () => void; setQuickAdd: (v: boolean) => void;
}

export const applyTheme = (t: Theme) => {
  const dark = t === 'dark' || (t === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
};

export const useUI = create<UI>((set, get) => ({
  theme: read('mw_theme', 'system') as Theme,
  hideBalances: read('mw_hide', '0') === '1',
  sidebarCollapsed: read('mw_side', '0') === '1',
  quickAdd: false,
  setTheme: (theme) => { write('mw_theme', theme); applyTheme(theme); set({ theme }); },
  toggleBalances: () => { const v = !get().hideBalances; write('mw_hide', v ? '1' : '0'); set({ hideBalances: v }); },
  setHide: (v) => { write('mw_hide', v ? '1' : '0'); set({ hideBalances: v }); },
  toggleSidebar: () => { const v = !get().sidebarCollapsed; write('mw_side', v ? '1' : '0'); set({ sidebarCollapsed: v }); },
  setQuickAdd: (quickAdd) => set({ quickAdd }),
}));
