const { google } = require('googleapis');

// Reads the "Revenue Projections" Google Sheet -- a manually-maintained
// 14-month cash flow model (Income line items -> Total Income -> Expenses
// -> Total Expenses -> Net Profit -> running Cash On Hand), with an
// "Updated to Actual" row flagging which month columns are real vs. still
// projected pacing. Displayed as-is (see README) -- this does NOT blend in
// live QuickBooks/MRR data, it's shown alongside for comparison only.
//
// Parses by matching row LABELS (e.g. "Total Income"), not fixed row/column
// positions, the same defensive approach used for QuickBooks's P&L report
// in lib/quickbooks-client.js -- resilient to rows being added/reordered
// in the sheet, at the cost of depending on these exact label strings not
// changing. This was NOT validated against the real Sheets API response
// shape at build time (only against a flattened text preview of the sheet)
// -- if getCashFlowProjection() throws "missing an expected row," the
// labels below may need adjusting to match the sheet's actual text.

const DEFAULT_SHEET_ID = '1yXsqxWbmbl6vo_yECZ5XvU51-I57GhSFEsCiPSnykso';
const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

let sheetsClientPromise;
function getSheetsClient() {
  if (!sheetsClientPromise) {
    // A single base64 blob of the whole service account JSON key file,
    // rather than splitting client_email/private_key into separate env
    // vars -- the multi-line PEM private key is easy to mangle (lost
    // newlines, stray quotes) when copy-pasted through a web UI, which
    // surfaces as an opaque OpenSSL "DECODER routines::unsupported" error
    // at request time. Base64-encoding the whole file sidesteps that.
    const keyBase64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_BASE64;
    if (!keyBase64) {
      throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY_BASE64 is not configured');
    }
    const credentials = JSON.parse(Buffer.from(keyBase64, 'base64').toString('utf8'));
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    sheetsClientPromise = auth.getClient().then((authClient) => google.sheets({ version: 'v4', auth: authClient }));
  }
  return sheetsClientPromise;
}

// Finds the header row by locating the first cell that's an exact month
// name -- the column it's in is where the month columns start.
function findHeaderRow(rows) {
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r] || [];
    for (let c = 0; c < row.length; c++) {
      if (MONTH_NAMES.includes(String(row[c] ?? '').trim().toLowerCase())) {
        return { rowIndex: r, monthStartCol: c };
      }
    }
  }
  throw new Error('Could not find a header row with month names in the cash flow sheet');
}

function extractMonths(headerRow, monthStartCol) {
  const months = [];
  for (let c = monthStartCol; c < headerRow.length; c++) {
    const cell = String(headerRow[c] ?? '').trim();
    if (!cell) break;
    months.push(cell);
  }
  return months;
}

// Exact (not substring) match against any cell in the row, so this doesn't
// need to know which column a label ends up in.
function findRowByLabel(rows, label) {
  const needle = label.trim().toLowerCase();
  for (const row of rows) {
    for (const cell of row) {
      if (typeof cell === 'string' && cell.trim().toLowerCase() === needle) {
        return row;
      }
    }
  }
  return null;
}

function extractMoneyRow(row, monthStartCol, monthCount) {
  const values = [];
  for (let i = 0; i < monthCount; i++) {
    values.push(Math.round((Number(row?.[monthStartCol + i]) || 0) * 100));
  }
  return values;
}

function extractBoolRow(row, monthStartCol, monthCount) {
  const values = [];
  for (let i = 0; i < monthCount; i++) {
    const raw = row?.[monthStartCol + i];
    values.push(raw === true || String(raw ?? '').trim().toUpperCase() === 'TRUE');
  }
  return values;
}

async function getCashFlowProjection() {
  const spreadsheetId = process.env.CASHFLOW_SHEET_ID || DEFAULT_SHEET_ID;
  const sheets = await getSheetsClient();
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'A1:R60',
    valueRenderOption: 'UNFORMATTED_VALUE',
  });

  const rows = resp.data.values || [];
  const { rowIndex: headerRowIndex, monthStartCol } = findHeaderRow(rows);
  const months = extractMonths(rows[headerRowIndex], monthStartCol);

  const incomeRow = findRowByLabel(rows, 'Total Income');
  const expensesRow = findRowByLabel(rows, 'Total Expenses');
  const netProfitRow = findRowByLabel(rows, 'Net Profit');
  const cashRow = findRowByLabel(rows, 'Cash On Hand');
  const actualRow = findRowByLabel(rows, 'Updated to Actual');

  if (!incomeRow || !expensesRow || !netProfitRow || !cashRow) {
    throw new Error(
      'Cash flow sheet is missing an expected row (Total Income / Total Expenses / Net Profit / Cash On Hand) -- the sheet layout may not match what this integration expects'
    );
  }

  return {
    months,
    incomeCents: extractMoneyRow(incomeRow, monthStartCol, months.length),
    expensesCents: extractMoneyRow(expensesRow, monthStartCol, months.length),
    netProfitCents: extractMoneyRow(netProfitRow, monthStartCol, months.length),
    cashOnHandCents: extractMoneyRow(cashRow, monthStartCol, months.length),
    isActual: actualRow ? extractBoolRow(actualRow, monthStartCol, months.length) : months.map(() => false),
  };
}

module.exports = {
  getCashFlowProjection,
  findHeaderRow,
  extractMonths,
  findRowByLabel,
  extractMoneyRow,
  extractBoolRow,
};
