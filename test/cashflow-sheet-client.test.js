const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  findHeaderRow,
  extractMonths,
  findRowByLabel,
  extractMoneyRow,
  extractBoolRow,
} = require('../lib/cashflow-sheet-client');

// A trimmed-down fixture shaped like the real sheet: a leading blank row,
// a header row with month names starting at column 2, and a few labeled
// summary rows scattered among unrelated rows -- mirrors how the real
// sheet repeats "Total Expenses" in more than one section.
const FIXTURE_ROWS = [
  [],
  ['', 'Income', 'June', 'July', 'August'],
  ['Income', 'Stripe Sales', 100, 200, 300],
  ['Income', 'Total Income', 1000, 2000, 3000],
  [],
  ['Expenses', 'Software', 50, 50, 50],
  ['Expenses', 'Total Expenses', 400, 500, 600],
  ['Summary', 'Net Profit', 600, 1500, 2400],
  ['Summary', 'Cash On Hand', 5000, 6500, 8900],
  ['Summary', 'Updated to Actual', true, 'FALSE', 'false'],
];

test('findHeaderRow: locates the row and column where month names start', () => {
  const { rowIndex, monthStartCol } = findHeaderRow(FIXTURE_ROWS);
  assert.equal(rowIndex, 1);
  assert.equal(monthStartCol, 2);
});

test('extractMonths: reads consecutive month names until a blank cell', () => {
  const months = extractMonths(FIXTURE_ROWS[1], 2);
  assert.deepEqual(months, ['June', 'July', 'August']);
});

test('findRowByLabel: matches a row by exact label regardless of which column it is in', () => {
  const row = findRowByLabel(FIXTURE_ROWS, 'Total Income');
  assert.deepEqual(row, ['Income', 'Total Income', 1000, 2000, 3000]);
});

test('findRowByLabel: is case-insensitive', () => {
  const row = findRowByLabel(FIXTURE_ROWS, 'net profit');
  assert.deepEqual(row, ['Summary', 'Net Profit', 600, 1500, 2400]);
});

test('findRowByLabel: returns null when no row matches', () => {
  assert.equal(findRowByLabel(FIXTURE_ROWS, 'Gross Margin'), null);
});

test('extractMoneyRow: converts dollar values to cents starting at the given column', () => {
  const row = findRowByLabel(FIXTURE_ROWS, 'Total Income');
  const cents = extractMoneyRow(row, 2, 3);
  assert.deepEqual(cents, [100000, 200000, 300000]);
});

test('extractBoolRow: treats a real boolean or the string "TRUE" (any case) as true', () => {
  const row = findRowByLabel(FIXTURE_ROWS, 'Updated to Actual');
  const bools = extractBoolRow(row, 2, 3);
  assert.deepEqual(bools, [true, false, false]);
});
