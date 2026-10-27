import { mkdirSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { createServer as createHttpServer } from 'node:http'
import { extname, join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const currencies = new Set(['USD', 'EUR', 'GBP', 'TRY', 'CAD', 'AUD'])
const maxRequestBytes = 2 * 1024 * 1024
const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.woff2', 'font/woff2'],
])

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value, maxLength) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength
}

function isValidDate(value) {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`))
    && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value
}

function validateBudget(value) {
  if (!isRecord(value)
    || !currencies.has(value.currency)
    || !Array.isArray(value.entries)
    || !Array.isArray(value.accounts)
    || value.entries.length > 10000
    || value.accounts.length > 10000) {
    return 'Budget must include a supported currency and valid item lists.'
  }

  const entryIds = new Set()
  const linkedEntries = []
  for (const entry of value.entries) {
    if (!isRecord(entry)
      || !isNonEmptyString(entry.id, 100)
      || entryIds.has(entry.id)
      || !isNonEmptyString(entry.title, 80)
      || !['income', 'expense'].includes(entry.kind)
      || typeof entry.category !== 'string'
      || entry.category.length > 40
      || typeof entry.amount !== 'number'
      || !Number.isFinite(entry.amount)
      || entry.amount <= 0
      || !isValidDate(entry.date)
      || typeof entry.recurring !== 'boolean'
      || ('recurrenceCount' in entry && (!Number.isInteger(entry.recurrenceCount) || entry.recurrenceCount < 1))
      || ('linkedAccountId' in entry && !isNonEmptyString(entry.linkedAccountId, 100))
      || ('currency' in entry && !currencies.has(entry.currency))
      || ('sourceAmount' in entry && (typeof entry.sourceAmount !== 'number' || !Number.isFinite(entry.sourceAmount) || entry.sourceAmount <= 0))
      || ('exchangeRate' in entry && (typeof entry.exchangeRate !== 'number' || !Number.isFinite(entry.exchangeRate) || entry.exchangeRate <= 0))) {
      return 'Budget contains an invalid income or expense item.'
    }
    const hasSalaryMetadata = 'currency' in entry || 'sourceAmount' in entry || 'exchangeRate' in entry
    if (hasSalaryMetadata && (
      !('currency' in entry)
      || !('sourceAmount' in entry)
      || !('exchangeRate' in entry)
      || entry.kind !== 'income'
      || !entry.recurring
      || entry.category !== 'Salary'
      || 'recurrenceCount' in entry
      || 'linkedAccountId' in entry
      || Math.abs(entry.amount - Math.round((entry.sourceAmount * entry.exchangeRate + Number.EPSILON) * 100) / 100) > 0.001
    )) {
      return 'Budget contains invalid recurring salary details.'
    }
    entryIds.add(entry.id)
    if ('linkedAccountId' in entry) linkedEntries.push(entry)
  }

  const accountIds = new Set()
  for (const account of value.accounts) {
    if (!isRecord(account)
      || !isNonEmptyString(account.id, 100)
      || accountIds.has(account.id)
      || !isNonEmptyString(account.name, 80)
      || !['Loan', 'Credit card', 'Bank account'].includes(account.kind)
      || typeof account.balance !== 'number'
      || !Number.isFinite(account.balance)
      || (account.kind !== 'Bank account' && account.balance < 0)
      || typeof account.apr !== 'number'
      || !Number.isFinite(account.apr)
      || account.apr < 0
      || account.apr > 100
      || typeof account.payment !== 'number'
      || !Number.isFinite(account.payment)
      || account.payment < 0
      || !Number.isInteger(account.dueDay)
      || account.dueDay < 1
      || account.dueDay > 31
      || ('periodCount' in account && (!Number.isInteger(account.periodCount) || account.periodCount < 0))
      || (account.kind !== 'Loan' && account.periodCount > 0)) {
      return 'Budget contains an invalid loan or credit card.'
    }
    accountIds.add(account.id)
  }

  for (const entry of linkedEntries) {
    const account = value.accounts.find((candidate) => candidate.id === entry.linkedAccountId)
    if (!account
      || account.kind !== 'Loan'
      || entry.kind !== 'expense'
      || !entry.recurring
      || !entry.recurrenceCount
      || (account.periodCount ?? 0) !== entry.recurrenceCount) {
      return 'Budget contains an invalid loan repayment item.'
    }
  }

  return null
}

function initializeDatabase(databasePath) {
  const database = new DatabaseSync(databasePath)
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS entries (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('income', 'expense')),
      category TEXT NOT NULL,
      amount REAL NOT NULL CHECK (amount > 0),
      date TEXT NOT NULL,
      recurring INTEGER NOT NULL CHECK (recurring IN (0, 1)),
      recurrence_count INTEGER CHECK (recurrence_count IS NULL OR recurrence_count > 0),
      linked_account_id TEXT,
      source_currency TEXT,
      source_amount REAL CHECK (source_amount IS NULL OR source_amount > 0),
      exchange_rate REAL CHECK (exchange_rate IS NULL OR exchange_rate > 0)
    );
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('Loan', 'Credit card', 'Bank account')),
      balance REAL NOT NULL CHECK (kind = 'Bank account' OR balance >= 0),
      apr REAL NOT NULL CHECK (apr BETWEEN 0 AND 100),
      payment REAL NOT NULL CHECK (payment >= 0),
      due_day INTEGER NOT NULL CHECK (due_day BETWEEN 1 AND 31),
      period_count INTEGER NOT NULL DEFAULT 0 CHECK (period_count >= 0)
    );
    INSERT INTO settings (key, value)
      VALUES ('currency', 'USD')
      ON CONFLICT (key) DO NOTHING;
  `)
  migrateEntries(database)
  migrateAccounts(database)
  return database
}

function migrateEntries(database) {
  const columns = new Set(database.prepare('PRAGMA table_info(entries)').all().map((column) => column.name))
  if (!columns.has('recurrence_count')) {
    database.exec('ALTER TABLE entries ADD COLUMN recurrence_count INTEGER CHECK (recurrence_count IS NULL OR recurrence_count > 0)')
  }
  if (!columns.has('linked_account_id')) {
    database.exec('ALTER TABLE entries ADD COLUMN linked_account_id TEXT')
  }
  if (!columns.has('source_currency')) {
    database.exec('ALTER TABLE entries ADD COLUMN source_currency TEXT')
  }
  if (!columns.has('source_amount')) {
    database.exec('ALTER TABLE entries ADD COLUMN source_amount REAL CHECK (source_amount IS NULL OR source_amount > 0)')
  }
  if (!columns.has('exchange_rate')) {
    database.exec('ALTER TABLE entries ADD COLUMN exchange_rate REAL CHECK (exchange_rate IS NULL OR exchange_rate > 0)')
  }
}

function migrateAccounts(database) {
  const table = database.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'accounts'").get()
  const columns = new Set(database.prepare('PRAGMA table_info(accounts)').all().map((column) => column.name))
  if (table.sql.includes("'Bank account'") && columns.has('period_count')) return

  database.exec(`
    BEGIN IMMEDIATE;
    CREATE TABLE accounts_new (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('Loan', 'Credit card', 'Bank account')),
      balance REAL NOT NULL CHECK (kind = 'Bank account' OR balance >= 0),
      apr REAL NOT NULL CHECK (apr BETWEEN 0 AND 100),
      payment REAL NOT NULL CHECK (payment >= 0),
      due_day INTEGER NOT NULL CHECK (due_day BETWEEN 1 AND 31),
      period_count INTEGER NOT NULL DEFAULT 0 CHECK (period_count >= 0)
    );
    INSERT INTO accounts_new (id, name, kind, balance, apr, payment, due_day, period_count)
      SELECT id, name, kind, balance, apr, payment, due_day, ${columns.has('period_count') ? 'period_count' : '0'} FROM accounts;
    DROP TABLE accounts;
    ALTER TABLE accounts_new RENAME TO accounts;
    COMMIT;
  `)
}

function readBudget(database) {
  const currency = database.prepare("SELECT value FROM settings WHERE key = 'currency'").get()
  const entries = database.prepare(`
    SELECT id, title, kind, category, amount, date, recurring, recurrence_count, linked_account_id,
      source_currency, source_amount, exchange_rate
    FROM entries
    ORDER BY rowid ASC
  `).all().map((entry) => ({
    id: entry.id,
    title: entry.title,
    kind: entry.kind,
    category: entry.category,
    amount: entry.amount,
    date: entry.date,
    recurring: entry.recurring === 1,
    ...(entry.recurrence_count === null ? {} : { recurrenceCount: entry.recurrence_count }),
    ...(entry.linked_account_id === null ? {} : { linkedAccountId: entry.linked_account_id }),
    ...(entry.source_currency === null ? {} : {
      currency: entry.source_currency,
      sourceAmount: entry.source_amount,
      exchangeRate: entry.exchange_rate,
    }),
  }))
  const accounts = database.prepare(`
    SELECT id, name, kind, balance, apr, payment, due_day, period_count
    FROM accounts
    ORDER BY rowid ASC
  `).all().map((account) => ({
    id: account.id,
    name: account.name,
    kind: account.kind,
    balance: account.balance,
    apr: account.apr,
    payment: account.payment,
    dueDay: account.due_day,
    periodCount: account.period_count,
  }))
  return { currency: currency.value, entries, accounts }
}

function replaceBudget(database, budget) {
  database.exec('BEGIN IMMEDIATE')
  try {
    database.prepare("UPDATE settings SET value = ? WHERE key = 'currency'").run(budget.currency)
    database.exec('DELETE FROM entries; DELETE FROM accounts;')

    const insertEntry = database.prepare(`
      INSERT INTO entries (
        id, title, kind, category, amount, date, recurring, recurrence_count, linked_account_id,
        source_currency, source_amount, exchange_rate
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const entry of budget.entries) {
      insertEntry.run(
        entry.id,
        entry.title.trim(),
        entry.kind,
        entry.category.trim(),
        entry.amount,
        entry.date,
        entry.recurring ? 1 : 0,
        entry.recurrenceCount ?? null,
        entry.linkedAccountId ?? null,
        entry.currency ?? null,
        entry.sourceAmount ?? null,
        entry.exchangeRate ?? null,
      )
    }

    const insertAccount = database.prepare(`
      INSERT INTO accounts (id, name, kind, balance, apr, payment, due_day, period_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const account of budget.accounts) {
      insertAccount.run(
        account.id,
        account.name.trim(),
        account.kind,
        account.balance,
        account.kind === 'Bank account' ? 0 : account.apr,
        account.kind === 'Bank account' ? 0 : account.payment,
        account.kind === 'Bank account' ? 1 : account.dueDay,
        account.kind === 'Loan' ? account.periodCount ?? 0 : 0,
      )
    }

    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

function sendJson(response, statusCode, value, headers = {}) {
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8', ...headers })
  response.end(JSON.stringify(value))
}

async function readJson(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > maxRequestBytes) {
      const error = new Error('Request body is too large.')
      error.statusCode = 413
      throw error
    }
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    const error = new Error('Request body must be valid JSON.')
    error.statusCode = 400
    throw error
  }
}

async function serveStatic(request, response, staticDirectory) {
  if (!staticDirectory || !['GET', 'HEAD'].includes(request.method)) {
    sendJson(response, 404, { error: 'Not found.' })
    return
  }

  let pathname
  try {
    pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
  } catch {
    sendJson(response, 400, { error: 'Invalid URL.' })
    return
  }

  const relativePath = pathname === '/' ? 'index.html' : pathname.slice(1)
  let filePath = resolve(staticDirectory, relativePath)
  if (filePath !== staticDirectory && !filePath.startsWith(`${staticDirectory}${sep}`)) {
    sendJson(response, 404, { error: 'Not found.' })
    return
  }

  try {
    const fileInfo = await stat(filePath)
    if (!fileInfo.isFile()) throw new Error('Not a file.')
  } catch {
    if (extname(relativePath)) {
      sendJson(response, 404, { error: 'Not found.' })
      return
    }
    filePath = join(staticDirectory, 'index.html')
  }

  try {
    const file = await readFile(filePath)
    const contentType = contentTypes.get(extname(filePath)) ?? 'application/octet-stream'
    response.writeHead(200, {
      'content-type': contentType,
      'content-length': file.length,
      'cache-control': filePath.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
    })
    response.end(request.method === 'HEAD' ? undefined : file)
  } catch {
    sendJson(response, 503, { error: 'The frontend build is unavailable. Run npm run build first.' })
  }
}

export function createBudgetServer({
  databasePath = process.env.BUDGET_DB_PATH ?? resolve('data', 'home-budget.sqlite'),
  staticDirectory = process.env.NODE_ENV === 'production' || process.argv.includes('--production')
    ? resolve('dist')
    : null,
} = {}) {
  const absoluteDatabasePath = resolve(databasePath)
  mkdirSyncForDatabase(absoluteDatabasePath)
  const database = initializeDatabase(absoluteDatabasePath)

  const server = createHttpServer((request, response) => {
    void handleRequest(request, response, database, staticDirectory)
  })

  server.on('close', () => database.close())
  return server
}

async function handleRequest(request, response, database, staticDirectory) {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname
    if (!pathname.startsWith('/api/')) {
      await serveStatic(request, response, staticDirectory)
      return
    }

    if (pathname === '/api/health' && request.method === 'GET') {
      sendJson(response, 200, { status: 'ok' })
      return
    }
    if (pathname !== '/api/budget') {
      sendJson(response, 404, { error: 'API route not found.' })
      return
    }

    if (request.method === 'GET') {
      sendJson(response, 200, readBudget(database))
      return
    }
    if (request.method !== 'PUT') {
      sendJson(response, 405, { error: 'Method not allowed.' }, { allow: 'GET, PUT' })
      return
    }

    const budget = await readJson(request)
    const validationError = validateBudget(budget)
    if (validationError) {
      sendJson(response, 400, { error: validationError })
      return
    }
    replaceBudget(database, budget)
    sendJson(response, 200, readBudget(database))
  } catch (error) {
    const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500
    if (statusCode >= 500) console.error('Failed to handle budget API request:', error)
    if (!response.headersSent) {
      sendJson(response, statusCode, {
        error: statusCode === 500 ? 'The budget request could not be completed.' : error.message,
      })
    } else {
      response.destroy()
    }
  }
}

function mkdirSyncForDatabase(databasePath) {
  const directory = databasePath.slice(0, databasePath.lastIndexOf(sep))
  if (directory) {
    mkdirSync(directory, { recursive: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const server = createBudgetServer()
  const port = Number(process.env.PORT ?? 3001)
  server.listen(port, process.env.HOST ?? '127.0.0.1', () => {
    console.log(`SQLite budget API listening on http://${process.env.HOST ?? '127.0.0.1'}:${port}`)
  })
}
