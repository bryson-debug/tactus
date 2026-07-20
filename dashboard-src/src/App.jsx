import React, { useCallback, useEffect, useState } from 'react';

const PERIODS = [
  { value: 'this_month', label: 'This month' },
  { value: 'last_30_days', label: 'Last 30 days' },
];

function formatCents(cents, currency = 'usd') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
    maximumFractionDigits: 0,
  }).format((cents || 0) / 100);
}

function formatAmount(amount, currency = 'USD') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
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

export default function App() {
  const [period, setPeriod] = useState('this_month');
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(null);

  const load = useCallback(async (p) => {
    setLoading(true);
    setFetchError(null);
    try {
      const resp = await fetch(`/api/metrics/summary?period=${encodeURIComponent(p)}`);
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
    load(period);
  }, [load, period]);

  const combinedCents = summary?.stripe?.ok ? summary.stripe.data.grossCents : 0;
  const anyRevenueSourceOk = summary?.stripe?.ok;

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
          <button onClick={() => load(period)} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      <div className="hero">
        <div className="hero__label">Revenue (Stripe)</div>
        <div className="hero__value">{anyRevenueSourceOk ? formatCents(combinedCents) : '—'}</div>
        <div className="hero__note">PayPal is next -- will be added to this total once wired up.</div>
      </div>

      {fetchError ? (
        <div className="card">
          <div className="card__error">Dashboard lookup failed: {fetchError}</div>
          <button className="card__retry" onClick={() => load(period)}>
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
