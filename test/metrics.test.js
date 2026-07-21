const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolvePeriod } = require('../lib/metrics');
const { extractProfitAndLossTotals, sumInvoices } = require('../lib/quickbooks-client');

test('resolvePeriod: today spans midnight UTC to now', () => {
  const { startDate, endDate, sinceUnix, untilUnix } = resolvePeriod('today');
  assert.equal(startDate, endDate);
  assert.ok(sinceUnix <= untilUnix);
});

test('resolvePeriod: this_month spans the 1st of the month to now', () => {
  const { startDate, endDate, sinceUnix, untilUnix } = resolvePeriod('this_month');
  assert.match(startDate, /-01$/);
  assert.ok(sinceUnix < untilUnix);
  assert.ok(endDate >= startDate);
});

test('resolvePeriod: last_month spans the entire previous calendar month', () => {
  const now = new Date();
  const { startDate, endDate } = resolvePeriod('last_month');
  assert.match(startDate, /-01$/);
  // endDate is the exclusive upper bound, i.e. the 1st of this_month.
  const thisMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
  assert.equal(endDate, thisMonthStart);
});

test('resolvePeriod: this_quarter starts on a quarter boundary month', () => {
  const { startDate } = resolvePeriod('this_quarter');
  const month = Number(startDate.slice(5, 7));
  assert.ok([1, 4, 7, 10].includes(month));
});

test('resolvePeriod: year_to_date starts January 1st of this year', () => {
  const now = new Date();
  const { startDate } = resolvePeriod('year_to_date');
  assert.equal(startDate, `${now.getUTCFullYear()}-01-01`);
});

test('resolvePeriod: custom spans the given inclusive start/end dates', () => {
  const { startDate, endDate } = resolvePeriod('custom', { start: '2026-01-05', end: '2026-01-10' });
  assert.equal(startDate, '2026-01-05');
  // endDate is the exclusive upper bound -- one day past the inclusive end picked.
  assert.equal(endDate, '2026-01-11');
});

test('resolvePeriod: custom rejects a missing range', () => {
  assert.throws(() => resolvePeriod('custom'), /requires start and end/);
});

test('resolvePeriod: custom rejects a malformed date', () => {
  assert.throws(() => resolvePeriod('custom', { start: 'not-a-date', end: '2026-01-10' }), /YYYY-MM-DD/);
});

test('resolvePeriod: custom rejects start on or after end', () => {
  assert.throws(
    () => resolvePeriod('custom', { start: '2026-01-10', end: '2026-01-05' }),
    /start must be before end/
  );
});

test('resolvePeriod: rejects unknown periods', () => {
  assert.throws(() => resolvePeriod('last_quarter'), /Unknown period/);
});

test('extractProfitAndLossTotals: reads Income/Expenses/NetIncome from a QBO report tree', () => {
  const report = {
    Header: { Currency: 'USD' },
    Rows: {
      Row: [
        {
          group: 'Income',
          Summary: { ColData: [{ value: 'Total Income' }, { value: '1000.50' }] },
        },
        {
          group: 'Expenses',
          Summary: { ColData: [{ value: 'Total Expenses' }, { value: '400.25' }] },
        },
        {
          group: 'NetIncome',
          Summary: { ColData: [{ value: 'Net Income' }, { value: '600.25' }] },
        },
      ],
    },
  };

  const totals = extractProfitAndLossTotals(report);
  assert.equal(totals.totalIncome, 1000.5);
  assert.equal(totals.totalExpenses, 400.25);
  assert.equal(totals.netIncome, 600.25);
  assert.equal(totals.currency, 'USD');
});

test('extractProfitAndLossTotals: finds groups nested under sub-sections', () => {
  const report = {
    Rows: {
      Row: [
        {
          Rows: {
            Row: [
              {
                group: 'Income',
                Summary: { ColData: [{ value: 'Total Income' }, { value: '250' }] },
              },
            ],
          },
        },
      ],
    },
  };

  const totals = extractProfitAndLossTotals(report);
  assert.equal(totals.totalIncome, 250);
  assert.equal(totals.totalExpenses, 0);
  assert.equal(totals.netIncome, 0);
});

test('extractProfitAndLossTotals: defaults to zero when a group is missing', () => {
  const totals = extractProfitAndLossTotals({ Rows: { Row: [] } });
  assert.equal(totals.totalIncome, 0);
  assert.equal(totals.totalExpenses, 0);
  assert.equal(totals.netIncome, 0);
});

test('sumInvoices: sums TotalAmt in cents and counts invoices', () => {
  const result = sumInvoices([
    { TotalAmt: '100.50', CurrencyRef: { value: 'USD' } },
    { TotalAmt: '49.50' },
  ]);
  assert.equal(result.grossCents, 15000);
  assert.equal(result.invoiceCount, 2);
  assert.equal(result.currency, 'USD');
});

test('sumInvoices: returns zeros for an empty list', () => {
  const result = sumInvoices([]);
  assert.equal(result.grossCents, 0);
  assert.equal(result.invoiceCount, 0);
  assert.equal(result.currency, null);
});

test('sumInvoices: treats a missing/non-numeric TotalAmt as zero', () => {
  const result = sumInvoices([{ TotalAmt: undefined }, { TotalAmt: 'not-a-number' }]);
  assert.equal(result.grossCents, 0);
  assert.equal(result.invoiceCount, 2);
});
