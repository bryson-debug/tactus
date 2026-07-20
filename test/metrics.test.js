const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolvePeriod } = require('../lib/metrics');
const { extractProfitAndLossTotals } = require('../lib/quickbooks-client');

test('resolvePeriod: this_month spans the 1st of the month to now', () => {
  const { startDate, endDate, sinceUnix, untilUnix } = resolvePeriod('this_month');
  assert.match(startDate, /-01$/);
  assert.ok(sinceUnix < untilUnix);
  assert.ok(endDate >= startDate);
});

test('resolvePeriod: last_30_days spans roughly 30 days', () => {
  const { sinceUnix, untilUnix } = resolvePeriod('last_30_days');
  const days = (untilUnix - sinceUnix) / 86400;
  assert.ok(Math.abs(days - 30) < 1);
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
