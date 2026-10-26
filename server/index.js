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
      || typeof entry.recurring !== 'boolean') {
      return 'Budget contains an invalid income or expense item.'
    }
    entryIds.add(entry.id)
  }

  const accountIds = new Set()
  for (const account of value.accounts) {
    if (!isRecord(account)
      || !isNonEmptyString(account.id, 100)
      || accountIds.has(account.id)
      || !isNonEmptyString(account.name, 80)
      || !['Loan', 'Credit card'].includes(account.kind)
      || typeof account.balance !== 'number'
      || !Number.isFinite(account.balance)
      || account.balance < 0
      || typeof account.apr !== 'number'
      || !Number.isFinite(account.apr)
      || account.apr < 0
      || account.apr > 100
      || typeof account.payment !== 'number'
      || !Number.isFinite(account.payment)
      || account.payment < 0
      || !Number.isInteger(account.dueDay)
      || account.dueDay < 1
      || account.dueDay > 31) {
      return 'Budget contains an invalid loan or credit card.'
    }
    accountIds.add(account.id)
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
      recurring INTEGER NOT NULL CHECK (recurring IN (0, 1))
    );
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('Loan', 'Credit card')),
      balance REAL NOT NULL CHECK (balance >= 0),
      apr REAL NOT NULL CHECK (apr BETWEEN 0 AND 100),
      payment REAL NOT NULL CHECK (payment >= 0),
      due_day INTEGER NOT NULL CHECK (due_day BETWEEN 1 AND 31)
    );
    INSERT INTO settings (key, value)
      VALUES ('currency', 'USD')
      ON CONFLICT (key) DO NOTHING;
  `)
  return database
}

function readBudget(database) {
  const currency = database.prepare("SELECT value FROM settings WHERE key = 'currency'").get()
  const entries = database.prepare(`
    SELECT id, title, kind, category, amount, date, recurring
    FROM entries
    ORDER BY rowid DESC
  `).all().map((entry) => ({
    id: entry.id,
    title: entry.title,
    kind: entry.kind,
    category: entry.category,
    amount: entry.amount,
    date: entry.date,
    recurring: entry.recurring === 1,
  }))
  const accounts = database.prepare(`
    SELECT id, name, kind, balance, apr, payment, due_day
    FROM accounts
    ORDER BY rowid DESC
  `).all().map((account) => ({
    id: account.id,
    name: account.name,
    kind: account.kind,
    balance: account.balance,
    apr: account.apr,
    payment: account.payment,
    dueDay: account.due_day,
  }))
  return { currency: currency.value, entries, accounts }
}

function replaceBudget(database, budget) {
  database.exec('BEGIN IMMEDIATE')
  try {
    database.prepare("UPDATE settings SET value = ? WHERE key = 'currency'").run(budget.currency)
    database.exec('DELETE FROM entries; DELETE FROM accounts;')

    const insertEntry = database.prepare(`
      INSERT INTO entries (id, title, kind, category, amount, date, recurring)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    for (const entry of budget.entries) {
      insertEntry.run(entry.id, entry.title.trim(), entry.kind, entry.category.trim(), entry.amount, entry.date, entry.recurring ? 1 : 0)
    }

    const insertAccount = database.prepare(`
      INSERT INTO accounts (id, name, kind, balance, apr, payment, due_day)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    for (const account of budget.accounts) {
      insertAccount.run(account.id, account.name.trim(), account.kind, account.balance, account.apr, account.payment, account.dueDay)
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
