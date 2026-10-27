import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { createBudgetServer } from '../server/index.js'

let directory

after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

test('budget data is stored in SQLite, validated, and available after a server restart', async () => {
  directory = await mkdtemp(join(tmpdir(), 'home-budget-test-'))
  const databasePath = join(directory, 'budget.sqlite')
  let server = createBudgetServer({ databasePath, staticDirectory: null })

  async function start(currentServer) {
    await new Promise((resolve, reject) => {
      currentServer.once('error', reject)
      currentServer.listen(0, '127.0.0.1', resolve)
    })
    return `http://127.0.0.1:${currentServer.address().port}`
  }

  async function stop(currentServer) {
    await new Promise((resolve, reject) => {
      currentServer.close((error) => error ? reject(error) : resolve())
    })
  }

  let baseUrl = await start(server)
  const initialResponse = await fetch(`${baseUrl}/api/budget`)
  assert.equal(initialResponse.status, 200)
  assert.deepEqual(await initialResponse.json(), { currency: 'USD', entries: [], accounts: [] })

  const unsupportedMethodResponse = await fetch(`${baseUrl}/api/budget`, { method: 'POST' })
  assert.equal(unsupportedMethodResponse.status, 405)
  assert.equal(unsupportedMethodResponse.headers.get('allow'), 'GET, PUT')

  const budget = {
    currency: 'EUR',
    entries: [{
      id: 'monthly-income-id',
      title: 'Monthly salary',
      kind: 'income',
      category: 'Work',
      amount: 4200,
      date: '2026-10-01',
      recurring: true,
    }, {
      id: 'loan-payment-id',
      title: 'Home loan payment',
      kind: 'expense',
      category: 'Loan repayment',
      amount: 750,
      date: '2026-10-15',
      recurring: true,
      recurrenceCount: 3,
      linkedAccountId: 'loan-id',
    }, {
      id: 'foreign-salary-id',
      title: 'Foreign currency salary',
      kind: 'income',
      category: 'Salary',
      amount: 3500,
      sourceAmount: 2500,
      currency: 'EUR',
      exchangeRate: 1.4,
      date: '2026-10-01',
      recurring: true,
    }],
    accounts: [{
      id: 'loan-id',
      name: 'Home loan',
      kind: 'Loan',
      balance: 85000,
      apr: 4.2,
      payment: 750,
      dueDay: 15,
      periodCount: 3,
    }, {
      id: 'bank-id',
      name: 'Checking',
      kind: 'Bank account',
      balance: -125.5,
      apr: 0,
      payment: 0,
      dueDay: 1,
      periodCount: 0,
    }, {
      id: 'card-id',
      name: 'Travel card',
      kind: 'Credit card',
      balance: 1600,
      apr: 0,
      payment: 0,
      dueDay: 24,
      periodCount: 0,
    }],
  }

  const saveResponse = await fetch(`${baseUrl}/api/budget`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(budget),
  })
  assert.equal(saveResponse.status, 200)
  assert.deepEqual(await saveResponse.json(), budget)

  const invalidResponse = await fetch(`${baseUrl}/api/budget`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...budget, currency: 'INVALID' }),
  })
  assert.equal(invalidResponse.status, 400)
  assert.deepEqual(await (await fetch(`${baseUrl}/api/budget`)).json(), budget)

  const invalidNegativeLoanResponse = await fetch(`${baseUrl}/api/budget`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...budget,
      accounts: [{ ...budget.accounts[0], balance: -1 }, budget.accounts[1]],
    }),
  })
  assert.equal(invalidNegativeLoanResponse.status, 400)
  assert.deepEqual(await (await fetch(`${baseUrl}/api/budget`)).json(), budget)

  await stop(server)
  server = createBudgetServer({ databasePath, staticDirectory: null })
  baseUrl = await start(server)
  assert.deepEqual(await (await fetch(`${baseUrl}/api/budget`)).json(), budget)
  await stop(server)
})

test('existing SQLite databases migrate loan balances and preserve existing budget data', async () => {
  const legacyDirectory = await mkdtemp(join(tmpdir(), 'home-budget-legacy-'))
  const databasePath = join(legacyDirectory, 'budget.sqlite')
  const legacyDatabase = new DatabaseSync(databasePath)
  legacyDatabase.exec(`
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO settings (key, value) VALUES ('currency', 'USD');
    CREATE TABLE entries (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('income', 'expense')),
      category TEXT NOT NULL,
      amount REAL NOT NULL CHECK (amount > 0),
      date TEXT NOT NULL,
      recurring INTEGER NOT NULL CHECK (recurring IN (0, 1))
    );
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('Loan', 'Credit card', 'Bank account')),
      balance REAL NOT NULL CHECK (kind = 'Bank account' OR balance >= 0),
      apr REAL NOT NULL CHECK (apr BETWEEN 0 AND 100),
      payment REAL NOT NULL CHECK (payment >= 0),
      due_day INTEGER NOT NULL CHECK (due_day BETWEEN 1 AND 31)
    );
    INSERT INTO entries VALUES ('legacy-salary', 'Salary', 'income', 'Work', 3000, '2025-01-01', 1);
    INSERT INTO accounts VALUES ('old-loan', 'Existing loan', 'Loan', 20000, 4.5, 400, 10);
    INSERT INTO accounts VALUES ('old-bank', 'Overdraft account', 'Bank account', -125.5, 0, 0, 1);
  `)
  legacyDatabase.close()

  const server = createBudgetServer({ databasePath, staticDirectory: null })
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const baseUrl = `http://127.0.0.1:${server.address().port}`
    const loadedBudget = await (await fetch(`${baseUrl}/api/budget`)).json()
    assert.deepEqual(loadedBudget.entries, [{
      id: 'legacy-salary',
      title: 'Salary',
      kind: 'income',
      category: 'Work',
      amount: 3000,
      date: '2025-01-01',
      recurring: true,
    }])
    assert.equal(loadedBudget.accounts[0].name, 'Existing loan')
    assert.equal(loadedBudget.accounts[0].balance, 20000)
    assert.equal(loadedBudget.accounts[0].periodCount, 0)
    assert.equal(loadedBudget.accounts[1].balance, -125.5)
    assert.equal(loadedBudget.accounts[1].periodCount, 0)

    const bankAccountBudget = {
      ...loadedBudget,
      accounts: [...loadedBudget.accounts, {
        id: 'overdrawn-bank',
        name: 'Checking account',
        kind: 'Bank account',
        balance: -325.75,
        apr: 0,
        payment: 0,
        dueDay: 1,
        periodCount: 0,
      }],
    }
    const response = await fetch(`${baseUrl}/api/budget`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(bankAccountBudget),
    })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), bankAccountBudget)
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    await rm(legacyDirectory, { recursive: true, force: true })
  }
})
