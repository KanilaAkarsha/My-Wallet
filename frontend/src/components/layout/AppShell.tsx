import { GraduationCap, Bell, Eye, EyeOff, Landmark, LayoutDashboard, LogOut, Menu, Moon, PiggyBank, Plus, Receipt, Settings, Shield, Sun, Target, Repeat, CreditCard, BarChart3, Lightbulb, Wallet, Tags, ArrowLeftRight, CalendarClock, HandCoins, TrendingDown, TrendingUp, ChevronsLeft, ScanLine } from 'lucide-react';
import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { QuickAddHost } from '@/components/TransactionForm';
import { Button } from '@/components/ui/primitives';
import { useGet } from '@/components/ui/hooks';
import { cn } from '@/lib/utils';
import { useAuth } from '@/store/auth';
import { useUI } from '@/store/ui';

const NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/transactions', label: 'Transactions', icon: Receipt },
  { to: '/income', label: 'Income', icon: TrendingUp },
  { to: '/expenses', label: 'Expenses', icon: TrendingDown },
  { to: '/accounts', label: 'Accounts', icon: Landmark },
  { to: '/scan', label: 'Scan bill', icon: ScanLine },
  { to: '/transfers', label: 'Transfers', icon: ArrowLeftRight },
  { to: '/categories', label: 'Categories', icon: Tags },
  { to: '/budgets', label: 'Budgets', icon: Wallet },
  { to: '/goals', label: 'Savings goals', icon: Target },
  { to: '/debts', label: 'Debts & loans', icon: HandCoins },
  { to: '/bills', label: 'Bills', icon: CalendarClock },
  { to: '/recurring', label: 'Recurring', icon: Repeat },
  { to: '/subscriptions', label: 'Subscriptions', icon: CreditCard },
  { to: '/planner', label: 'Planner', icon: GraduationCap },
  { to: '/reports', label: 'Reports', icon: BarChart3 },
  { to: '/insights', label: 'Insights', icon: Lightbulb },
];
const BOTTOM = [
  { to: '/dashboard', label: 'Home', icon: LayoutDashboard },
  { to: '/transactions', label: 'Activity', icon: Receipt },
  { to: '/budgets', label: 'Budgets', icon: Wallet },
  { to: '/goals', label: 'Goals', icon: PiggyBank },
];

const linkCls = ({ isActive }: { isActive: boolean }) => cn('flex items-center gap-3 rounded-md px-3 min-h-10 text-sm font-medium', isActive ? 'bg-brand-soft text-brand' : 'text-muted-foreground hover:bg-muted hover:text-foreground');

export function AppShell() {
  const { me, logout } = useAuth();
  const { setTheme, hideBalances, toggleBalances, sidebarCollapsed, toggleSidebar, setQuickAdd } = useUI();
  const [more, setMore] = useState(false);
  const nav = useNavigate();
  const unread = useGet<{ unreadCount?: number }>(['notifications', 'bell'], '/notifications', { limit: 20, unread: 'true' });
  const count = unread.data?.unreadCount ?? 0;
  const isDark = document.documentElement.classList.contains('dark');

  return (
    <div className="flex min-h-dvh">
      <aside className={cn('sticky top-0 hidden h-dvh shrink-0 flex-col border-r bg-card p-3 md:flex', sidebarCollapsed ? 'w-[72px]' : 'w-60')} aria-label="Main navigation">
        <div className="mb-4 flex items-center gap-2 px-2 py-2">
          <div className="grid h-8 w-8 place-items-center rounded-md bg-brand text-brand-foreground"><Wallet className="h-4 w-4" /></div>
          {!sidebarCollapsed && <span className="font-semibold">MyWallet</span>}
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto">
          {NAV.map((n) => <NavLink key={n.to} to={n.to} className={linkCls} title={n.label}><n.icon className="h-4 w-4 shrink-0" />{!sidebarCollapsed && n.label}</NavLink>)}
          {(me?.role === 'admin' || me?.role === 'super_admin') && <NavLink to="/admin" className={linkCls}><Shield className="h-4 w-4" />{!sidebarCollapsed && 'Admin'}</NavLink>}
        </nav>
        <button className="mt-2 flex min-h-10 items-center gap-3 rounded-md px-3 text-sm text-muted-foreground hover:bg-muted" onClick={toggleSidebar} aria-label="Collapse sidebar"><ChevronsLeft className={cn('h-4 w-4', sidebarCollapsed && 'rotate-180')} />{!sidebarCollapsed && 'Collapse'}</button>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/90 px-3 backdrop-blur sm:px-6">
          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setMore(true)} aria-label="Open menu"><Menu className="h-5 w-5" /></Button>
          <div className="flex-1" />
          <Button variant="ghost" size="icon" onClick={toggleBalances} aria-label={hideBalances ? 'Show balances' : 'Hide balances'} aria-pressed={hideBalances}>{hideBalances ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</Button>
          <Button variant="ghost" size="icon" onClick={() => setTheme(isDark ? 'light' : 'dark')} aria-label="Toggle theme">{isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}</Button>
          <Button variant="ghost" size="icon" className="relative" onClick={() => nav('/notifications')} aria-label={`Notifications${count ? ` (${count} unread)` : ''}`}>
            <Bell className="h-4 w-4" />{count > 0 && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-expense" />}
          </Button>
          <Button variant="primary" size="sm" className="hidden md:inline-flex" onClick={() => setQuickAdd(true)}><Plus className="h-4 w-4" />Add</Button>
          <Button variant="ghost" size="icon" onClick={() => nav('/settings/profile')} aria-label="Settings"><Settings className="h-4 w-4" /></Button>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-5 pb-28 sm:px-6 md:pb-8"><Outlet /></main>
      </div>

      {/* Mobile: bottom nav + floating quick-add */}
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t bg-card md:hidden" aria-label="Primary">
        {BOTTOM.slice(0, 2).map((n) => <BottomLink key={n.to} {...n} />)}
        <div className="relative"><button onClick={() => setQuickAdd(true)} aria-label="Add transaction" className="absolute -top-6 left-1/2 grid h-14 w-14 -translate-x-1/2 place-items-center rounded-full bg-brand text-brand-foreground shadow-lg"><Plus className="h-6 w-6" /></button></div>
        {BOTTOM.slice(2).map((n) => <BottomLink key={n.to} {...n} />)}
      </nav>

      {more && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMore(false)} />
          <div className="absolute inset-y-0 left-0 w-72 overflow-y-auto bg-card p-3">
            <p className="px-3 py-2 text-xs text-muted-foreground">{me?.email}</p>
            {NAV.map((n) => <NavLink key={n.to} to={n.to} className={linkCls} onClick={() => setMore(false)}><n.icon className="h-4 w-4" />{n.label}</NavLink>)}
            <NavLink to="/settings/profile" className={linkCls} onClick={() => setMore(false)}><Settings className="h-4 w-4" />Settings</NavLink>
            {(me?.role === 'admin' || me?.role === 'super_admin') && <NavLink to="/admin" className={linkCls} onClick={() => setMore(false)}><Shield className="h-4 w-4" />Admin</NavLink>}
            <button className={cn(linkCls({ isActive: false }), 'w-full')} onClick={() => void logout().then(() => nav('/login'))}><LogOut className="h-4 w-4" />Log out</button>
          </div>
        </div>
      )}
      <QuickAddHost />
    </div>
  );
}

const BottomLink = ({ to, label, icon: I }: { to: string; label: string; icon: any }) => (
  <NavLink to={to} className={({ isActive }) => cn('flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px]', isActive ? 'text-brand' : 'text-muted-foreground')}><I className="h-5 w-5" />{label}</NavLink>
);
