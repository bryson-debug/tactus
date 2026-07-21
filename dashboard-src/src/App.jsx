import React, { useCallback, useEffect, useState } from 'react';

const PERIODS = [
  { value: 'today', label: 'Today' },
  { value: 'this_month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'this_quarter', label: 'This quarter' },
  { value: 'year_to_date', label: 'Year to date' },
  { value: 'custom', label: 'Custom range' },
];

const THEME_STORAGE_KEY = 'tactus-theme';

function getInitialTheme() {
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

// Default params only cover an omitted/undefined argument, not an explicit
// null (which the API can legitimately send for an account with no data) --
// guard with `|| 'usd'` too so a null currency never crashes formatting.
function formatCents(cents, currency) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: (currency || 'usd').toUpperCase(),
    maximumFractionDigits: 0,
  }).format((cents || 0) / 100);
}

function formatAmount(amount, currency) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: (currency || 'usd').toUpperCase(),
    maximumFractionDigits: 0,
  }).format(amount || 0);
}

function SourceCard({ title, result, render }) {
  const isQuickbooksNotConnected = !result?.ok && /not connected yet/i.test(result?.error || '');

  return (
    <div className="card">
      <div className="card__title">
        {result ? (
          <span className={`status-dot ${result.ok ? 'status-dot--good' : 'status-dot--error'}`} />
        ) : null}
        {title}
      </div>
      {!result ? (
        <div className="card__skeleton" />
      ) : result.ok ? (
        render(result.data)
      ) : isQuickbooksNotConnected ? (
        <>
          <div className="card__error">Not connected yet.</div>
          <a className="card__retry" href="/api/quickbooks/oauth-start">
            Connect QuickBooks
          </a>
        </>
      ) : (
        <div className="card__error">{result.error}</div>
      )}
    </div>
  );
}

// Combines two independent results (Stripe's exact MRR + PayPal's
// approximation) into one card, so it doesn't fit SourceCard's
// single-result shape.
function MrrCard({ mrr }) {
  if (!mrr) {
    return (
      <div className="card">
        <div className="card__title">MRR (EDGE)</div>
        <div className="card__skeleton" />
      </div>
    );
  }

  const stripeOk = mrr.stripe?.ok;
  const paypalOk = mrr.paypal?.ok;
  const anyOk = stripeOk || paypalOk;
  const currency = (stripeOk && mrr.stripe.data.currency) || (paypalOk && mrr.paypal.data.currency) || 'usd';
  const combinedCents = (stripeOk ? mrr.stripe.data.mrrCents : 0) + (paypalOk ? mrr.paypal.data.mrrCents : 0);
  // getEdgeMrr() always resolves "ok" even if every underlying Stripe
  // account failed (it settles per-account internally) -- so a real
  // failure (e.g. a restricted key missing the Products/Prices/
  // Subscriptions permissions the MRR lookup needs) would otherwise show
  // as a silent $0 instead of an error. Surface the per-account breakdown
  // here, same as the revenue card, so that's visible.
  const stripeAccounts = stripeOk ? mrr.stripe.data.accounts : [];

  return (
    <div className="card">
      <div className="card__title">
        <span className={`status-dot ${anyOk ? 'status-dot--good' : 'status-dot--error'}`} />
        MRR (EDGE)
      </div>
      <div className="card__value">{anyOk ? formatCents(combinedCents, currency) : '—'}</div>
      <div className="card__subvalue">
        {stripeOk ? `${mrr.stripe.data.activeSubscriptionCount} active Stripe subscriptions` : 'Stripe MRR error'} ·
        PayPal is approximate (trailing 30 days of matching payments, not a subscriber count)
      </div>
      <ul className="card__breakdown">
        {stripeOk ? (
          stripeAccounts.map((account) => (
            <li key={`stripe-${account.label}`}>
              <span>Stripe · {account.label}</span>
              <span className={account.ok ? '' : 'card__breakdown-error'}>
                {account.ok ? formatCents(account.data.mrrCents, account.data.currency) : account.error}
              </span>
            </li>
          ))
        ) : (
          <li>
            <span>Stripe</span>
            <span className="card__breakdown-error">{mrr.stripe?.error}</span>
          </li>
        )}
        <li>
          <span>PayPal (approx.)</span>
          <span className={paypalOk ? '' : 'card__breakdown-error'}>
            {paypalOk ? formatCents(mrr.paypal.data.mrrCents, mrr.paypal.data.currency) : mrr.paypal?.error}
          </span>
        </li>
      </ul>
    </div>
  );
}

export default function App() {
  const [theme, setTheme] = useState(getInitialTheme);
  const [period, setPeriod] = useState('this_month');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(null);
  const [needsAuth, setNeedsAuth] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  const load = useCallback(async (p, range) => {
    setLoading(true);
    setFetchError(null);
    setNeedsAuth(false);
    try {
      const params = new URLSearchParams({ period: p });
      if (p === 'custom' && range?.start && range?.end) {
        params.set('start', range.start);
        params.set('end', range.end);
      }
      const resp = await fetch(`/api/metrics/summary?${params.toString()}`);
      if (resp.status === 401) {
        setNeedsAuth(true);
        return;
      }
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body.detail || body.error || `Request failed: ${resp.status}`);
      }
      setSummary(await resp.json());
    } catch (err) {
      setFetchError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Custom range waits for an explicit Apply click (below) instead of
    // fetching on every keystroke/period change with an incomplete range.
    if (period === 'custom') return;
    load(period);
  }, [load, period]);

  const currentRange = period === 'custom' ? { start: customStart, end: customEnd } : undefined;

  if (needsAuth) {
    return (
      <div className="dashboard">
        <div className="dashboard__header">
          <div>
            <h1>Tactus</h1>
            <div className="dashboard__subtitle">Tarbet Education Network</div>
          </div>
        </div>
        <div className="dashboard__accent-bar" />
        <div className="card">
          <div className="card__title">Sign in required</div>
          <a className="card__retry" href="/api/login">
            Sign in
          </a>
        </div>
      </div>
    );
  }

  const combinedCents =
    (summary?.stripe?.ok ? summary.stripe.data.grossCents : 0) +
    (summary?.paypal?.ok ? summary.paypal.data.grossCents : 0) +
    (summary?.quickbooksInvoices?.ok ? summary.quickbooksInvoices.data.grossCents : 0);
  const anyRevenueSourceOk = summary?.stripe?.ok || summary?.paypal?.ok || summary?.quickbooksInvoices?.ok;

  return (
    <div className="dashboard">
      <div className="dashboard__header">
        <div>
          <h1>Tactus</h1>
          <div className="dashboard__subtitle">Tarbet Education Network</div>
        </div>
        <div className="dashboard__controls">
          <select value={period} onChange={(e) => setPeriod(e.target.value)}>
            {PERIODS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          {period === 'custom' ? (
            <>
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                aria-label="Custom range start"
              />
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                aria-label="Custom range end"
              />
              <button onClick={() => load('custom', currentRange)} disabled={!customStart || !customEnd || loading}>
                Apply
              </button>
            </>
          ) : (
            <button onClick={() => load(period)} disabled={loading}>
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
          )}
          <button
            className="theme-toggle"
            onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
            aria-label="Toggle color theme"
          >
            {theme === 'dark' ? 'Dark' : 'Light'}
          </button>
        </div>
      </div>
      <div className="dashboard__accent-bar" />

      <div className="hero">
        <div className="hero__label">Combined revenue (Stripe + PayPal + paid QuickBooks invoices)</div>
        <div className="hero__value">{anyRevenueSourceOk ? formatCents(combinedCents) : '—'}</div>
        <div className="hero__note">
          Naive sum across sources assuming USD; see individual cards for per-source detail and errors.
        </div>
      </div>

      {fetchError ? (
        <div className="card">
          <div className="card__error">Dashboard lookup failed: {fetchError}</div>
          <button className="card__retry" onClick={() => load(period, currentRange)}>
            Retry
          </button>
        </div>
      ) : (
        <div className="card-grid">
          <SourceCard
            title="Stripe revenue"
            result={summary?.stripe}
            render={(data) => (
              <>
                <div className="card__value">{formatCents(data.grossCents, data.currency)}</div>
                <div className="card__subvalue">
                  {data.transactionCount} transactions across {data.accounts.length} account
                  {data.accounts.length === 1 ? '' : 's'}
                </div>
                <ul className="card__breakdown">
                  {data.accounts.map((account) => (
                    <li key={account.label}>
                      <span>{account.label}</span>
                      <span className={account.ok ? '' : 'card__breakdown-error'}>
                        {account.ok ? formatCents(account.data.grossCents, account.data.currency) : account.error}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          />
          <SourceCard
            title="PayPal revenue"
            result={summary?.paypal}
            render={(data) => (
              <>
                <div className="card__value">{formatCents(data.grossCents, data.currency)}</div>
                <div className="card__subvalue">{data.transactionCount} transactions</div>
              </>
            )}
          />
          <SourceCard
            title="QuickBooks P&L"
            result={summary?.quickbooks}
            render={(data) => (
              <>
                <div className="card__value">{formatAmount(data.netIncome, data.currency)}</div>
                <div className="card__subvalue">
                  Income {formatAmount(data.totalIncome, data.currency)} · Expenses{' '}
                  {formatAmount(data.totalExpenses, data.currency)}
                </div>
              </>
            )}
          />
          <SourceCard
            title="QuickBooks paid invoices"
            result={summary?.quickbooksInvoices}
            render={(data) => (
              <>
                <div className="card__value">{formatCents(data.grossCents, data.currency)}</div>
                <div className="card__subvalue">{data.invoiceCount} invoices, dated in this period</div>
              </>
            )}
          />
          <MrrCard mrr={summary?.mrr} />
        </div>
      )}

      {summary ? (
        <div className="dashboard__meta">
          {summary.range.startDate} → {summary.range.endDate} · generated {new Date(summary.generatedAt).toLocaleString()}
        </div>
      ) : null}
    </div>
  );
}
