import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { Money, Progress } from '@/components/ui/primitives';
import { fmtMoney, chartNum } from '@/lib/utils';
import { LoginPage, RegisterPage } from '@/pages/auth';
import { useUI } from '@/store/ui';

describe('fmtMoney', () => {
  it('groups thousands and pads decimals without float maths', () => {
    expect(fmtMoney('1250.5')).toBe('Rs 1,250.50');
    expect(fmtMoney('-9999999999999.99')).toBe('-Rs 9,999,999,999,999.99');
    expect(fmtMoney('0')).toBe('Rs 0.00');
    expect(fmtMoney(null)).toBe('—');
  });
  it('masks when hidden', () => expect(fmtMoney('100', 'LKR', { hidden: true })).toBe('••••••'));
  it('chartNum is presentation only', () => expect(chartNum('12.5')).toBe(12.5));
});

describe('Money + balance hide toggle', () => {
  beforeEach(() => useUI.setState({ hideBalances: false }));
  it('hides and reveals', () => {
    const { rerender } = render(<Money value="500" />);
    expect(screen.getByText('Rs 500.00')).toBeInTheDocument();
    useUI.setState({ hideBalances: true });
    rerender(<Money value="500" />);
    expect(screen.getByText('••••••')).toBeInTheDocument();
  });
  it('non-sensitive values stay visible', () => {
    useUI.setState({ hideBalances: true });
    render(<Money value="5" sensitive={false} />);
    expect(screen.getByText('Rs 5.00')).toBeInTheDocument();
  });
});

describe('Progress', () => {
  it('clamps to 0-100 and is accessible', () => {
    render(<Progress value={250} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
  });
});

describe('auth forms validate before calling the API', () => {
  it('login shows field errors', async () => {
    render(<MemoryRouter><LoginPage /></MemoryRouter>);
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByText('Enter a valid email')).toBeInTheDocument();
    expect(screen.getByText('Enter your password')).toBeInTheDocument();
  });
  it('register enforces 12-char password and matching confirmation', async () => {
    render(<MemoryRouter><RegisterPage /></MemoryRouter>);
    await userEvent.type(screen.getByLabelText('Name'), 'Ann');
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.co');
    await userEvent.type(screen.getByLabelText(/^Password/), 'short');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'other');
    await userEvent.click(screen.getByRole('button', { name: /create account/i }));
    expect(await screen.findByText('Use at least 12 characters')).toBeInTheDocument();
  });
});

describe('Google sign-in button', () => {
  const mockProviders = (google: boolean) => { globalThis.fetch = (async () => new Response(JSON.stringify({ google }), { status: 200 })) as typeof fetch; };
  it('is shown only when the server has Google configured', async () => {
    mockProviders(true);
    const { unmount } = render(<MemoryRouter><LoginPage /></MemoryRouter>);
    const link = await screen.findByRole('link', { name: /continue with google/i });
    expect(link).toHaveAttribute('href', '/api/v1/auth/google');
    unmount();
    mockProviders(false);
    render(<MemoryRouter><LoginPage /></MemoryRouter>);
    await screen.findByRole('button', { name: /sign in/i });
    expect(screen.queryByRole('link', { name: /continue with google/i })).not.toBeInTheDocument();
  });
  it('explains a Google failure from the redirect query string', async () => {
    mockProviders(false);
    render(<MemoryRouter initialEntries={['/login?error=google_two_factor']}><LoginPage /></MemoryRouter>);
    expect(await screen.findByRole('alert')).toHaveTextContent(/two-factor/i);
  });
});

describe('fmtMoney accepts every shape the API sends', () => {
  it('multi-currency arrays pick the requested currency', () => {
    const v = [{ currency: 'USD', amount: '5.00' }, { currency: 'LKR', amount: '1250.5' }];
    expect(fmtMoney(v, 'LKR')).toBe('Rs 1,250.50');
    expect(fmtMoney(v, 'USD')).toBe('USD 5.00');
    expect(fmtMoney([], 'LKR')).toBe('Rs 0.00');
  });
  it('never throws on unexpected values', () => {
    for (const bad of [{}, { amount: 5 }, true, undefined, null, [{ currency: 'LKR' }]]) expect(() => fmtMoney(bad)).not.toThrow();
    expect(fmtMoney({})).toBe('—');
  });
  it('Money renders an array value', () => {
    useUI.setState({ hideBalances: false });
    render(<Money value={[{ currency: 'LKR', amount: '10' }]} />);
    expect(screen.getByText('Rs 10.00')).toBeInTheDocument();
  });
});
