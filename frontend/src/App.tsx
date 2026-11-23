import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Suspense, lazy, useEffect, type ReactElement } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { setUnauthorizedHandler, ApiError } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { applyTheme, useUI } from '@/store/ui';
const AdminPage = lazy(() => import('./pages/Admin'));
import { ForgotPage, GoogleDonePage, LoginPage, RegisterPage, ResetPage, VerifyPage } from './pages/auth';
const Dashboard = lazy(() => import('./pages/Dashboard'));
import { CategoriesPage, InsightsPage, NotificationsPage, ReportsPage } from './pages/Misc';
const PlannerPage = lazy(() => import('./pages/Planner'));
const ScanBillPage = lazy(() => import('./pages/ScanBill'));
const Onboarding = lazy(() => import('./pages/Onboarding'));
import { AccountDetail, AccountsPage } from './pages/Accounts';
import { BudgetDetail, BudgetsPage, DebtDetail, DebtsPage, GoalDetail, GoalsPage } from './pages/Planning';
import { BillsPage, RecurringPage, SubscriptionsPage } from './pages/Schedules';
import { SettingsPage } from './pages/Settings';
import { NewTransactionPage, TransactionDetail, TransactionsPage } from './pages/Transactions';
import { TransfersPage } from './pages/Transfers';

const qc = new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2, refetchOnWindowFocus: false } } });

function Protected({ role }: { role?: 'admin' }) {
  const { me, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <div className="grid min-h-dvh place-items-center text-sm text-muted-foreground">Loading…</div>;
  if (!me) return <Navigate to="/login" state={{ from: loc.pathname }} replace />;
  if (role === 'admin' && me.role === 'user') return <Navigate to="/dashboard" replace />;
  return <Outlet />;
}
const Guest = ({ children }: { children: ReactElement }) => { const { me, loading } = useAuth(); return !loading && me ? <Navigate to="/dashboard" replace /> : children; };

function Boot() {
  const { load, clear } = useAuth();
  const theme = useUI((s) => s.theme);
  useEffect(() => { applyTheme(theme); }, [theme]);
  useEffect(() => { setUnauthorizedHandler(() => { clear(); qc.clear(); }); void load(); }, [load, clear]);
  return null;
}

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <Boot />
        <Suspense fallback={<div className="grid min-h-dvh place-items-center text-sm text-muted-foreground">Loading…</div>}>
        <Routes>
          <Route path="/login" element={<Guest><LoginPage /></Guest>} />
          <Route path="/register" element={<Guest><RegisterPage /></Guest>} />
          <Route path="/auth/google/done" element={<GoogleDonePage />} />
          <Route path="/forgot-password" element={<ForgotPage />} />
          <Route path="/reset-password" element={<ResetPage />} />
          <Route path="/verify-email" element={<VerifyPage />} />
          <Route element={<Protected />}>
            <Route path="/onboarding" element={<Onboarding />} />
            <Route element={<AppShell />}>
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/transactions" element={<TransactionsPage />} />
              <Route path="/transactions/new" element={<NewTransactionPage />} />
              <Route path="/transactions/:id" element={<TransactionDetail />} />
              <Route path="/income" element={<TransactionsPage fixedType="income" title="Income" />} />
              <Route path="/expenses" element={<TransactionsPage fixedType="expense" title="Expenses" />} />
              <Route path="/accounts" element={<AccountsPage />} />
              <Route path="/accounts/:id" element={<AccountDetail />} />
              <Route path="/transfers" element={<TransfersPage />} />
              <Route path="/categories" element={<CategoriesPage />} />
              <Route path="/budgets" element={<BudgetsPage />} />
              <Route path="/budgets/new" element={<BudgetsPage startOpen />} />
              <Route path="/budgets/:id" element={<BudgetDetail />} />
              <Route path="/goals" element={<GoalsPage />} />
              <Route path="/goals/:id" element={<GoalDetail />} />
              <Route path="/debts" element={<DebtsPage />} />
              <Route path="/debts/:id" element={<DebtDetail />} />
              <Route path="/bills" element={<BillsPage />} />
              <Route path="/recurring" element={<RecurringPage />} />
              <Route path="/subscriptions" element={<SubscriptionsPage />} />
              <Route path="/planner" element={<PlannerPage />} />
              <Route path="/scan" element={<ScanBillPage />} />
              <Route path="/reports" element={<ReportsPage />} />
              <Route path="/insights" element={<InsightsPage />} />
              <Route path="/notifications" element={<NotificationsPage />} />
              <Route path="/profile" element={<Navigate to="/settings/profile" replace />} />
              <Route path="/settings" element={<Navigate to="/settings/profile" replace />} />
              <Route path="/settings/:tab" element={<SettingsPage />} />
            </Route>
          </Route>
          <Route element={<Protected role="admin" />}><Route element={<AppShell />}><Route path="/admin" element={<AdminPage />} /></Route></Route>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="*" element={<div className="grid min-h-dvh place-items-center text-center"><div><h1 className="text-2xl font-semibold">Page not found</h1><a className="text-brand" href="/dashboard">Go to dashboard</a></div></div>} />
        </Routes>
        </Suspense>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
