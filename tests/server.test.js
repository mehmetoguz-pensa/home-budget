import assert from 'node:assert/strict'
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
      id: 'salary-id',
      title: 'Monthly salary',
      kind: 'income',
      category: 'Work',
      amount: 4200,
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

  await stop(server)
  server = createBudgetServer({ databasePath, staticDirectory: null })
  baseUrl = await start(server)
  assert.deepEqual(await (await fetch(`${baseUrl}/api/budget`)).json(), budget)
  await stop(server)
})
