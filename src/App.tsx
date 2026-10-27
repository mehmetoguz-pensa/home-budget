import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import './App.css'

type EntryKind = 'income' | 'expense'
type AccountKind = 'Loan' | 'Credit card' | 'Bank account'
type Page = 'Overview' | 'Transactions' | 'Recurring' | 'Salaries' | 'Accounts' | 'Loans' | 'Credit cards'

type Entry = {
  id: string
  title: string
  kind: EntryKind
  category: string
  amount: number
  date: string
  recurring: boolean
  recurrenceCount?: number
  linkedAccountId?: string
  currency?: string
  sourceAmount?: number
  exchangeRate?: number
}

type Account = {
  id: string
  name: string
  kind: AccountKind
  balance: number
  apr: number
  payment: number
  dueDay: number
  periodCount: number
}

type BudgetData = {
  currency: string
  entries: Entry[]
  accounts: Account[]
}

function isEntry(value: unknown): value is Entry {
  if (typeof value !== 'object' || value === null) return false
  const dateIsValid = 'date' in value && typeof value.date === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(value.date)
    && Number.isFinite(dateFromInput(value.date).getTime())
    && toDateInput(dateFromInput(value.date)) === value.date
  return 'id' in value && typeof value.id === 'string'
    && 'title' in value && typeof value.title === 'string'
    && 'kind' in value && (value.kind === 'income' || value.kind === 'expense')
    && 'category' in value && typeof value.category === 'string'
    && 'amount' in value && typeof value.amount === 'number' && Number.isFinite(value.amount) && value.amount > 0
    && dateIsValid
    && 'recurring' in value && typeof value.recurring === 'boolean'
    && (!('recurrenceCount' in value) || (typeof value.recurrenceCount === 'number' && Number.isInteger(value.recurrenceCount) && value.recurrenceCount > 0))
    && (!('linkedAccountId' in value) || typeof value.linkedAccountId === 'string')
    && (!('currency' in value) || (typeof value.currency === 'string' && CURRENCIES.some((currency) => currency === value.currency)))
    && (!('sourceAmount' in value) || (typeof value.sourceAmount === 'number' && Number.isFinite(value.sourceAmount) && value.sourceAmount > 0))
    && (!('exchangeRate' in value) || (typeof value.exchangeRate === 'number' && Number.isFinite(value.exchangeRate) && value.exchangeRate > 0))
}

function isAccount(value: unknown): value is Account {
  if (typeof value !== 'object' || value === null) return false
  return 'id' in value && typeof value.id === 'string'
    && 'name' in value && typeof value.name === 'string'
    && 'kind' in value && (value.kind === 'Loan' || value.kind === 'Credit card' || value.kind === 'Bank account')
    && 'balance' in value && typeof value.balance === 'number' && Number.isFinite(value.balance)
    && (value.kind === 'Bank account' || value.balance >= 0)
    && 'apr' in value && typeof value.apr === 'number' && Number.isFinite(value.apr) && value.apr >= 0 && value.apr <= 100
    && 'payment' in value && typeof value.payment === 'number' && Number.isFinite(value.payment) && value.payment >= 0
    && 'dueDay' in value && typeof value.dueDay === 'number' && Number.isFinite(value.dueDay) && value.dueDay >= 1 && value.dueDay <= 31
    && 'periodCount' in value && typeof value.periodCount === 'number' && Number.isInteger(value.periodCount) && value.periodCount >= 0
}

function isBudgetData(value: unknown): value is BudgetData {
  if (typeof value !== 'object' || value === null) return false
  return 'currency' in value && typeof value.currency === 'string' && CURRENCIES.some((currency) => currency === value.currency)
    && 'entries' in value && Array.isArray(value.entries) && value.entries.every(isEntry)
    && 'accounts' in value && Array.isArray(value.accounts) && value.accounts.every(isAccount)
}

type ForecastMonth = {
  date: Date
  income: number
  expenses: number
  net: number
  runningNet: number
}

const CURRENCIES = ['USD', 'EUR', 'GBP', 'TRY', 'CAD', 'AUD'] as const
const NAV_ITEMS: { label: Page; icon: string }[] = [
  { label: 'Overview', icon: 'grid' },
  { label: 'Transactions', icon: 'list' },
  { label: 'Recurring', icon: 'repeat' },
  { label: 'Salaries', icon: 'wallet' },
  { label: 'Accounts', icon: 'wallet' },
  { label: 'Loans', icon: 'wallet' },
  { label: 'Credit cards', icon: 'card' },
]

function emptyBudget(): BudgetData {
  return { currency: 'USD', entries: [], accounts: [] }
}

function monthStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function dateFromInput(value: string): Date {
  return new Date(`${value}T12:00:00`)
}

function toDateInput(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatMoney(value: number, currency: string, compact = false): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    notation: compact ? 'compact' : 'standard',
    maximumFractionDigits: compact ? 1 : 2,
  }).format(value)
}

function formatAmountInput(rawValue: string, allowNegative: boolean): string {
  const raw = rawValue.replace(/\s/g, '')
  const negative = allowNegative && raw.startsWith('-')
  const value = raw.replace(/-/g, '')
  const commaIndex = value.lastIndexOf(',')
  const dotIndexes = [...value.matchAll(/\./g)].map((match) => match.index ?? -1)
  let decimalIndex = commaIndex

  if (commaIndex < 0 && dotIndexes.length > 0) {
    const lastDotIndex = dotIndexes[dotIndexes.length - 1]
    const trailingDigits = value.length - lastDotIndex - 1
    if (trailingDigits <= 2) {
      decimalIndex = lastDotIndex
    }
  }

  const integerSource = (decimalIndex < 0 ? value : value.slice(0, decimalIndex)).replace(/\D/g, '')
  const decimalSource = decimalIndex < 0 ? '' : value.slice(decimalIndex + 1).replace(/\D/g, '').slice(0, 2)
  const integerDigits = integerSource.replace(/^0+(?=\d)/, '')
  const groupedInteger = integerDigits.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  const hasDecimalSeparator = decimalIndex >= 0
  const formattedDecimal = hasDecimalSeparator ? `,${decimalSource}` : ''
  return `${negative ? '-' : ''}${groupedInteger}${formattedDecimal}`
}

function parseAmountInput(value: string): number | undefined {
  const normalized = value.replace(/\./g, '').replace(',', '.')
  if (!normalized || normalized === '-' || normalized === '-,') return undefined
  const amount = Number(normalized)
  return Number.isFinite(amount) ? amount : undefined
}

function formatMonth(date: Date, options: Intl.DateTimeFormatOptions = { month: 'short' }): string {
  return new Intl.DateTimeFormat(undefined, options).format(date)
}

function makeForecast(data: BudgetData, today: Date): ForecastMonth[] {
  const current = monthStart(today)
  let runningNet = 0

  return Array.from({ length: 6 }, (_, index) => {
    const date = new Date(current.getFullYear(), current.getMonth() + index, 1)
    const key = monthKey(date)
    let income = 0
    let expenses = 0

    for (const entry of data.entries) {
      const entryDate = dateFromInput(entry.date)
      const monthOffset = (date.getFullYear() - entryDate.getFullYear()) * 12 + date.getMonth() - entryDate.getMonth()
      const isIncluded = entry.recurring
        ? monthOffset >= 0 && (entry.recurrenceCount === undefined || monthOffset < entry.recurrenceCount)
        : monthKey(entryDate) === key
      if (!isIncluded) continue
      if (entry.kind === 'income') income += entry.amount
      else expenses += entry.amount
    }

    for (const account of data.accounts) {
      if (account.kind === 'Credit card') {
        const dueDay = Math.min(account.dueDay, new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate())
        if (monthKey(date) !== monthKey(today) || dueDay >= today.getDate()) expenses += account.balance
      }
      else if (account.kind === 'Loan' && account.periodCount === 0) expenses += account.payment
    }
    const net = income - expenses
    runningNet += net
    return { date, income, expenses, net, runningNet }
  })
}

function Icon({ name, size = 19 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
    list: <><path d="M8 6h13M8 12h13M8 18h13" /><path d="M3 6h.01M3 12h.01M3 18h.01" /></>,
    repeat: <><path d="m17 2 4 4-4 4" /><path d="M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4" /><path d="M21 13v2a3 3 0 0 1-3 3H3" /></>,
    wallet: <><rect x="3" y="5" width="18" height="15" rx="2" /><path d="M3 9h18M16 14h2" /><path d="M7 5V3h10v2" /></>,
    card: <><rect x="2.5" y="5" width="19" height="14" rx="2" /><path d="M2.5 10h19M7 15h3" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    arrow: <><path d="M7 17 17 7M7 7h10v10" /></>,
    down: <><path d="M7 7 17 17M17 7v10H7" /></>,
    chevron: <path d="m9 18 6-6-6-6" />,
    close: <><path d="m18 6-12 12M6 6l12 12" /></>,
    trend: <><path d="m3 17 6-6 4 4 8-8" /><path d="M15 7h6v6" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 11h18" /></>,
    trash: <><path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6m4 4v6m6-6v6" /></>,
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name] ?? paths.grid}
    </svg>
  )
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div className="modal-heading">
          <div><span className="eyebrow">YOUR BUDGET</span><h2 id="modal-title">{title}</h2></div>
          <button className="icon-button" aria-label="Close dialog" onClick={onClose}><Icon name="close" /></button>
        </div>
        {children}
      </section>
    </div>
  )
}

function AmountInput({
  name,
  label,
  defaultValue = '',
  allowNegative = false,
  placeholder = '0,00',
  required = false,
}: {
  name: string
  label: string
  defaultValue?: string
  allowNegative?: boolean
  placeholder?: string
  required?: boolean
}) {
  const [displayValue, setDisplayValue] = useState(() => formatAmountInput(defaultValue, allowNegative))
  const inputRef = useRef<HTMLInputElement>(null)
  const pendingSelection = useRef<{ start: number; end: number } | null>(null)
  const amount = parseAmountInput(displayValue)

  useLayoutEffect(() => {
    const selection = pendingSelection.current
    if (!selection || !inputRef.current) return
    inputRef.current.setSelectionRange(selection.start, selection.end)
    pendingSelection.current = null
  }, [displayValue])

  function updateValue(rawValue: string, selectionStart: number | null, selectionEnd: number | null) {
    const formatted = formatAmountInput(rawValue, allowNegative)
    pendingSelection.current = {
      start: formatAmountInput(rawValue.slice(0, selectionStart ?? rawValue.length), allowNegative).length,
      end: formatAmountInput(rawValue.slice(0, selectionEnd ?? rawValue.length), allowNegative).length,
    }
    setDisplayValue(formatted)
  }

  return <>
    <input
      ref={inputRef}
      aria-label={label}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      maxLength={24}
      pattern={allowNegative ? '-?\\d[\\d.]*(,\\d{0,2})?' : '\\d[\\d.]*(,\\d{0,2})?'}
      title="Use dots for thousands and a comma for decimals, for example 1.234,56."
      placeholder={placeholder}
      value={displayValue}
      required={required}
      onChange={(event) => updateValue(event.currentTarget.value, event.currentTarget.selectionStart, event.currentTarget.selectionEnd)}
      onPaste={(event) => {
        event.preventDefault()
        const input = event.currentTarget
        const pasted = event.clipboardData.getData('text')
        const start = input.selectionStart ?? input.value.length
        const end = input.selectionEnd ?? input.value.length
        updateValue(`${input.value.slice(0, start)}${pasted}${input.value.slice(end)}`, start + pasted.length, start + pasted.length)
      }}
    />
    <input type="hidden" name={name} value={amount ?? ''} />
  </>
}

function EmptyState({ title, description, action }: { title: string; description: string; action: ReactNode }) {
  return <div className="empty-state"><span className="empty-icon"><Icon name="wallet" size={22} /></span><h3>{title}</h3><p>{description}</p>{action}</div>
}

function ForecastChart({ months, currency }: { months: ForecastMonth[]; currency: string }) {
  const max = Math.max(1, ...months.flatMap((month) => [month.income, month.expenses]))
  const chartHeight = 164
  const baseline = 174
  const groupWidth = 100
  const startX = 52
  const barWidth = 21

  return (
    <div className="chart-wrap">
      <div className="chart-legend"><span><i className="legend-income" />Income</span><span><i className="legend-expense" />Expenses</span></div>
      <svg className="forecast-chart" viewBox="0 0 700 222" role="img" aria-label="Six month income and expense forecast chart">
        {[0, 1, 2, 3].map((line) => {
          const y = 10 + line * (chartHeight / 3)
          return <g key={line}><line x1="35" y1={y} x2="678" y2={y} className="chart-grid" /><text x="0" y={y + 4} className="chart-axis">{formatMoney(max * (1 - line / 3), currency, true)}</text></g>
        })}
        {months.map((month, index) => {
          const x = startX + index * groupWidth
          const incomeHeight = (month.income / max) * chartHeight
          const expenseHeight = (month.expenses / max) * chartHeight
          return <g key={monthKey(month.date)}>
            <rect x={x} y={baseline - incomeHeight} width={barWidth} height={incomeHeight} rx="4" className="bar-income"><title>{formatMoney(month.income, currency)} income</title></rect>
            <rect x={x + barWidth + 5} y={baseline - expenseHeight} width={barWidth} height={expenseHeight} rx="4" className="bar-expense"><title>{formatMoney(month.expenses, currency)} expenses</title></rect>
            <text x={x + 23} y="207" textAnchor="middle" className="chart-month">{formatMonth(month.date)}</text>
          </g>
        })}
      </svg>
    </div>
  )
}

function App() {
  const [today] = useState(() => new Date())
  const [budget, setBudget] = useState(emptyBudget)
  const [dataLoaded, setDataLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'error'>('saved')
  const saveQueue = useRef<Promise<void>>(Promise.resolve())
  const saveSequence = useRef(0)
  const [page, setPage] = useState<Page>('Overview')
  const [modal, setModal] = useState<'entry' | 'account' | 'salary' | null>(null)
  const [entryKind, setEntryKind] = useState<EntryKind>('expense')
  const [entryFrequency, setEntryFrequency] = useState('once')
  const [accountKind, setAccountKind] = useState<AccountKind>('Loan')
  const [salaryCurrency, setSalaryCurrency] = useState<string>('USD')

  useEffect(() => {
    const controller = new AbortController()

    async function loadFromDatabase() {
      try {
        const response = await fetch('/api/budget', { signal: controller.signal })
        const result: unknown = await response.json()
        if (!response.ok) {
          const message = typeof result === 'object' && result !== null && 'error' in result && typeof result.error === 'string'
            ? result.error
            : `Request failed with status ${response.status}.`
          throw new Error(message)
        }
        if (!isBudgetData(result)) throw new Error('The SQLite API returned invalid budget data.')
        setBudget(result)
        setLoadError(null)
        setDataLoaded(true)
      } catch (error) {
        if (controller.signal.aborted) return
        const detail = error instanceof Error ? error.message : String(error)
        setLoadError(`Could not load your budget from SQLite: ${detail}`)
      }
    }

    void loadFromDatabase()
    return () => controller.abort()
  }, [loadAttempt])

  function saveBudget(next: BudgetData) {
    setBudget(next)
    setSaveError(null)
    setSaveStatus('saving')
    const sequence = ++saveSequence.current
    const pendingSave = saveQueue.current.then(async () => {
      const response = await fetch('/api/budget', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(next),
      })
      const result: unknown = await response.json()
      if (!response.ok) {
        const message = typeof result === 'object' && result !== null && 'error' in result && typeof result.error === 'string'
          ? result.error
          : `Request failed with status ${response.status}.`
        throw new Error(message)
      }
      if (!isBudgetData(result)) throw new Error('The SQLite API returned invalid budget data after saving.')
    })
    saveQueue.current = pendingSave.then(() => undefined, () => undefined)
    void pendingSave.then(() => {
      if (sequence === saveSequence.current) setSaveStatus('saved')
    }).catch((error: unknown) => {
      if (sequence !== saveSequence.current) return
      const detail = error instanceof Error ? error.message : String(error)
      setSaveError(`Could not save your budget to SQLite: ${detail}`)
      setSaveStatus('error')
    })
  }

  const forecast = useMemo(() => makeForecast(budget, today), [budget, today])
  const currentMonth = monthKey(today)
  const currentForecast = forecast[0]
  const totalDebt = budget.accounts.reduce((total, account) => total + (account.kind === 'Bank account' ? 0 : account.balance), 0)
  const bankAccounts = budget.accounts.filter((account) => account.kind === 'Bank account')
  const loans = budget.accounts.filter((account) => account.kind === 'Loan')
  const creditCards = budget.accounts.filter((account) => account.kind === 'Credit card')
  const upcomingEntries = [...budget.entries].sort((a, b) => b.date.localeCompare(a.date))
  const visibleEntries = page === 'Recurring'
    ? upcomingEntries.filter((entry) => entry.recurring)
    : page === 'Salaries'
      ? upcomingEntries.filter((entry) => entry.category === 'Salary' && entry.kind === 'income')
    : page === 'Overview'
      ? upcomingEntries.filter((entry) => monthKey(dateFromInput(entry.date)) === currentMonth).slice(0, 5)
      : upcomingEntries

  if (!dataLoaded) {
    return <main className="database-state">
      <span className="database-state-icon"><Icon name="wallet" size={24} /></span>
      <h1>{loadError ? 'Can’t connect to your budget.' : 'Opening your budget…'}</h1>
      <p>{loadError ?? 'Connecting to your local SQLite database.'}</p>
      {loadError && <button className="button button-primary" onClick={() => { setLoadError(null); setLoadAttempt((attempt) => attempt + 1) }}>Try again</button>}
    </main>
  }

  function addEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const fields = new FormData(event.currentTarget)
    const entry: Entry = {
      id: crypto.randomUUID(),
      title: String(fields.get('title')).trim(),
      kind: String(fields.get('kind')) as EntryKind,
      category: String(fields.get('category') || 'Other').trim(),
      amount: Number(fields.get('amount')),
      date: String(fields.get('date')),
      recurring: String(fields.get('frequency')) === 'monthly',
    }
    if (!entry.title || !Number.isFinite(entry.amount) || entry.amount <= 0 || !entry.date) return
    saveBudget({ ...budget, entries: [entry, ...budget.entries] })
    setModal(null)
  }

  function addSalary(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const fields = new FormData(event.currentTarget)
    const sourceAmount = Number(fields.get('amount'))
    const exchangeRate = salaryCurrency === budget.currency ? 1 : Number(fields.get('exchangeRate'))
    const convertedAmount = Math.round((sourceAmount * exchangeRate + Number.EPSILON) * 100) / 100
    const salary: Entry = {
      id: crypto.randomUUID(),
      title: String(fields.get('title')).trim(),
      kind: 'income',
      category: 'Salary',
      amount: convertedAmount,
      sourceAmount,
      currency: salaryCurrency,
      exchangeRate,
      date: String(fields.get('date')),
      recurring: true,
    }
    if (!salary.title || !Number.isFinite(sourceAmount) || sourceAmount <= 0 || !Number.isFinite(exchangeRate) || exchangeRate <= 0 || !Number.isFinite(convertedAmount) || convertedAmount <= 0 || !salary.date) return
    saveBudget({ ...budget, entries: [salary, ...budget.entries] })
    setModal(null)
  }

  function addAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const fields = new FormData(event.currentTarget)
    const name = String(fields.get('name')).trim()
    const loanFirstPaymentDate = String(fields.get('firstPaymentDate') ?? '')
    const periodCount = Number(fields.get('periodCount') || 0)
    const account: Account = {
      id: crypto.randomUUID(),
      name,
      kind: String(fields.get('kind')) as AccountKind,
      balance: Number(fields.get('balance')),
      apr: Number(fields.get('apr') || 0),
      payment: Number(fields.get('payment') || 0),
      dueDay: Number(fields.get('dueDay') || (loanFirstPaymentDate ? dateFromInput(loanFirstPaymentDate).getDate() : 1)),
      periodCount,
    }
    if (!account.name || !Number.isFinite(account.balance) || (account.kind !== 'Bank account' && account.balance < 0)) return
    if (account.kind === 'Loan' && (!Number.isFinite(account.payment) || account.payment <= 0 || !Number.isInteger(periodCount) || periodCount < 1 || !loanFirstPaymentDate)) return
    if (account.kind === 'Credit card') {
      account.apr = 0
      account.payment = 0
    }
    const loanEntry: Entry | null = account.kind === 'Loan' ? {
      id: crypto.randomUUID(),
      title: `${account.name} payment`,
      kind: 'expense',
      category: 'Loan repayment',
      amount: account.payment,
      date: loanFirstPaymentDate,
      recurring: true,
      recurrenceCount: periodCount,
      linkedAccountId: account.id,
    } : null
    saveBudget({
      ...budget,
      accounts: [account, ...budget.accounts],
      entries: loanEntry ? [loanEntry, ...budget.entries] : budget.entries,
    })
    setModal(null)
  }

  function removeEntry(id: string) {
    const entry = budget.entries.find((item) => item.id === id)
    const linkedAccount = entry?.linkedAccountId
      ? budget.accounts.find((account) => account.id === entry.linkedAccountId)
      : undefined
    const confirmation = linkedAccount
      ? `Delete this payment and its linked bank loan, ${linkedAccount.name}?`
      : 'Delete this budget item?'
    if (!window.confirm(confirmation)) return
    saveBudget({
      ...budget,
      entries: budget.entries.filter((item) => item.id !== id),
      ...(linkedAccount ? { accounts: budget.accounts.filter((account) => account.id !== linkedAccount.id) } : {}),
    })
  }

  function removeAccount(id: string) {
    const linkedEntries = budget.entries.filter((entry) => entry.linkedAccountId === id)
    if (!window.confirm(linkedEntries.length ? 'Remove this bank loan and its recurring payment?' : 'Remove this account from your budget?')) return
    saveBudget({
      ...budget,
      accounts: budget.accounts.filter((item) => item.id !== id),
      entries: budget.entries.filter((entry) => entry.linkedAccountId !== id),
    })
  }

  function changeCurrency(currency: string) {
    saveBudget({ ...budget, currency })
  }

  function openEntry(kind: EntryKind = 'expense', recurring = false) {
    setEntryKind(kind)
    setEntryFrequency(recurring ? 'monthly' : 'once')
    setModal('entry')
  }

  function openAccount(kind: AccountKind = 'Bank account') {
    setAccountKind(kind)
    setModal('account')
  }

  function openSalary() {
    setSalaryCurrency(budget.currency)
    setModal('salary')
  }

  const sectionTitle = page === 'Overview' ? 'Your money, in focus.' : page
  const sectionDescription = page === 'Overview'
    ? 'A clearer picture of where you are and where you’re headed.'
    : page === 'Transactions'
      ? 'Every income and expense, all in one place.'
      : page === 'Recurring'
        ? 'Monthly items included in your future outlook.'
        : page === 'Salaries'
          ? 'Manage recurring salary income and its currency.'
        : page === 'Accounts'
          ? 'Track cash in your bank accounts, including overdrafts.'
          : page === 'Loans'
            ? 'Track bank loans and their scheduled monthly repayments.'
            : 'Keep card balances and monthly payments in view.'

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#" onClick={(event) => { event.preventDefault(); setPage('Overview') }}>
          <span className="brand-mark"><span /></span><span>nest<span className="brand-light">egg</span></span>
        </a>
        <div className="sidebar-caption">WORKSPACE</div>
        <nav className="main-nav" aria-label="Main navigation">
          {NAV_ITEMS.map((item) => <button key={item.label} className={`nav-link ${page === item.label ? 'active' : ''}`} onClick={() => setPage(item.label)}><Icon name={item.icon} /><span>{item.label}</span>{item.label === 'Recurring' && budget.entries.some((entry) => entry.recurring) && <span className="nav-count">{budget.entries.filter((entry) => entry.recurring).length}</span>}</button>)}
        </nav>
        <div className="sidebar-bottom">
          <div className="privacy-note"><span className="privacy-lock">◈</span><div><strong>Private by design</strong><p>Saved in your local SQLite database.</p></div></div>
          <div className="profile"><span className="avatar">H</span><span><strong>Home budget</strong><small>Personal workspace</small></span><span className="profile-dots">•••</span></div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumb"><span>Workspace</span><Icon name="chevron" size={14} /><strong>{page}</strong></div>
          <div className="topbar-actions">
            <label className="currency-select"><span>Currency</span><select aria-label="Display currency" value={budget.currency} onChange={(event) => changeCurrency(event.target.value)}>{CURRENCIES.map((currency) => <option key={currency} value={currency}>{currency}</option>)}</select></label>
            <button className="button button-primary button-small" onClick={() => openEntry()}><Icon name="plus" size={16} /> Add item</button>
          </div>
        </header>

        <div className="page-wrap">
          {saveError && <div className="storage-alert" role="alert"><span>{saveError}</span><button onClick={() => saveBudget(budget)}>Retry save</button></div>}
          <div className="page-heading">
            <div><div className="eyebrow">{new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(today).toUpperCase()} <span className="eyebrow-dot">·</span> PERSONAL FINANCE</div><h1>{sectionTitle}</h1><p>{sectionDescription}</p></div>
            {page === 'Overview' && <div className="heading-actions"><span className="live-status"><i /> Live overview</span><button className="button button-outline" onClick={() => openEntry()}><Icon name="plus" size={16} /> New transaction</button></div>}
          </div>

          {page === 'Overview' && <>
            <section className="summary-grid" aria-label="This month's summary">
              <article className="summary-card summary-primary">
                <div className="summary-top"><span>Net cash flow <span className="info-dot" title="Income minus expenses for this month">i</span></span><span className="summary-icon"><Icon name="trend" /></span></div>
                <div className="summary-value">{formatMoney(currentForecast.net, budget.currency)}</div>
                <div className="summary-foot"><span className="trend-chip"><Icon name={currentForecast.net >= 0 ? 'arrow' : 'down'} size={13} /> {currentForecast.net >= 0 ? 'Looking positive' : 'Expenses are higher'}</span><span>this month</span></div>
                <div className="summary-decoration"><i /><i /><i /><i /><i /><i /><i /><i /></div>
              </article>
              <article className="summary-card">
                <div className="summary-top"><span>Income this month</span><span className="summary-icon income-icon"><Icon name="arrow" /></span></div>
                <div className="summary-value">{formatMoney(currentForecast.income, budget.currency)}</div>
                <div className="summary-foot"><span>Expected income</span><span className="soft-badge income-badge">INCOME</span></div>
                <div className="mini-bar"><span className="income-fill" style={{ width: `${currentForecast.income ? 80 : 0}%` }} /></div>
              </article>
              <article className="summary-card">
                <div className="summary-top"><span>Expenses this month</span><span className="summary-icon expense-icon"><Icon name="down" /></span></div>
                <div className="summary-value">{formatMoney(currentForecast.expenses, budget.currency)}</div>
                <div className="summary-foot"><span>Including debt payments</span><span className="soft-badge expense-badge">EXPENSES</span></div>
                <div className="mini-bar"><span className="expense-fill" style={{ width: `${currentForecast.expenses ? 56 : 0}%` }} /></div>
              </article>
              <article className="summary-card debt-card">
                <div className="summary-top"><span>Total debt</span><span className="summary-icon debt-icon"><Icon name="wallet" /></span></div>
                <div className="summary-value">{formatMoney(totalDebt, budget.currency)}</div>
                <div className="summary-foot"><span>{budget.accounts.length} linked {budget.accounts.length === 1 ? 'account' : 'accounts'}</span><button className="text-link" onClick={() => setPage('Accounts')}>View accounts <Icon name="chevron" size={13} /></button></div>
              </article>
            </section>

            <section className="content-grid">
              <article className="panel forecast-panel">
                <div className="panel-heading"><div><span className="eyebrow">PLAN AHEAD</span><h2>Monthly outlook</h2><p>Income and expenses over the next six months</p></div><span className="forecast-tag"><Icon name="calendar" size={14} /> 6 months</span></div>
                {budget.entries.length === 0 && budget.accounts.length === 0
                  ? <EmptyState title="Your forecast starts here" description="Add a recurring income, an expense, or a bill to see your month-by-month outlook." action={<button className="button button-outline" onClick={() => openEntry('income')}><Icon name="plus" size={15} /> Add your first item</button>} />
                  : <><ForecastChart months={forecast} currency={budget.currency} /><div className="forecast-footer"><span><i className="forecast-dot" /> Net change over 6 months</span><strong className={forecast[5].runningNet >= 0 ? 'positive' : 'negative'}>{formatMoney(forecast[5].runningNet, budget.currency)}</strong></div></>}
              </article>

              <article className="panel balance-panel">
                <div className="panel-heading"><div><span className="eyebrow">THE BIG PICTURE</span><h2>Future perspective</h2><p>Your projected cash flow</p></div><span className="round-icon"><Icon name="trend" size={17} /></span></div>
                <div className="projection-number">{formatMoney(forecast[5].runningNet, budget.currency)}</div>
                <div className="projection-caption">net change across the next 6 months</div>
                <div className="projection-list">{forecast.slice(0, 3).map((month) => <div className="projection-row" key={monthKey(month.date)}><span><i className="month-dot" />{formatMonth(month.date, { month: 'long', year: 'numeric' })}</span><strong className={month.net >= 0 ? 'positive' : 'negative'}>{month.net >= 0 ? '+' : ''}{formatMoney(month.net, budget.currency)}</strong></div>)}</div>
                <button className="text-link projection-link" onClick={() => setPage('Recurring')}>Manage recurring items <Icon name="chevron" size={14} /></button>
              </article>
            </section>

            <section className="panel activity-panel">
              <div className="panel-heading activity-heading"><div><span className="eyebrow">YOUR MONEY MOVING</span><h2>Recent activity</h2></div><button className="text-link" onClick={() => setPage('Transactions')}>All transactions <Icon name="chevron" size={14} /></button></div>
              <EntryTable entries={visibleEntries} currency={budget.currency} onDelete={removeEntry} />
            </section>
          </>}

          {page === 'Transactions' && <section className="panel page-panel"><div className="panel-heading activity-heading"><div><span className="eyebrow">INCOME & EXPENSES</span><h2>All transactions</h2><p>{budget.entries.length} {budget.entries.length === 1 ? 'item' : 'items'} in your budget</p></div><button className="button button-primary button-small" onClick={() => openEntry()}><Icon name="plus" size={15} /> Add transaction</button></div><EntryTable entries={visibleEntries} currency={budget.currency} onDelete={removeEntry} /></section>}

          {page === 'Recurring' && <section className="panel page-panel"><div className="panel-heading activity-heading"><div><span className="eyebrow">REPEATS EACH MONTH</span><h2>Recurring items</h2><p>These are included in every future month from their start date.</p></div><button className="button button-primary button-small" onClick={() => openEntry('expense', true)}><Icon name="plus" size={15} /> Add recurring</button></div><EntryTable entries={visibleEntries} currency={budget.currency} onDelete={removeEntry} /></section>}

          {page === 'Salaries' && <section className="panel page-panel"><div className="panel-heading activity-heading"><div><span className="eyebrow">RECURRING INCOME</span><h2>Your salaries</h2><p>{visibleEntries.length} {visibleEntries.length === 1 ? 'salary' : 'salaries'} · Added to income every month from the start date.</p></div><button className="button button-primary button-small" onClick={openSalary}><Icon name="plus" size={15} /> Add salary</button></div>{visibleEntries.length === 0 ? <EmptyState title="No salaries added yet" description="Add a salary with its monthly amount, currency, and start date." action={<button className="button button-outline" onClick={openSalary}><Icon name="plus" size={15} /> Add salary</button>} /> : <EntryTable entries={visibleEntries} currency={budget.currency} onDelete={removeEntry} />}</section>}

          {page === 'Accounts' && <section className="panel page-panel"><div className="panel-heading activity-heading"><div><span className="eyebrow">BANK ACCOUNTS</span><h2>Your accounts</h2><p>{bankAccounts.length} {bankAccounts.length === 1 ? 'bank account' : 'bank accounts'} · Positive and negative balances are supported.</p></div><button className="button button-primary button-small" onClick={() => openAccount('Bank account')}><Icon name="plus" size={15} /> Add bank account</button></div>{bankAccounts.length === 0 ? <EmptyState title="No bank accounts added yet" description="Add a bank account and enter its current balance. Negative balances are supported for overdrafts." action={<button className="button button-outline" onClick={() => openAccount('Bank account')}><Icon name="plus" size={15} /> Add bank account</button>} /> : <AccountList accounts={bankAccounts} currency={budget.currency} onDelete={removeAccount} />}</section>}

          {page === 'Loans' && <section className="panel page-panel"><div className="panel-heading activity-heading"><div><span className="eyebrow">BANK LOAN BALANCES</span><h2>Your bank loans</h2><p>{loans.length} {loans.length === 1 ? 'bank loan' : 'bank loans'} · Scheduled monthly payments stop after the selected period.</p></div><button className="button button-primary button-small" onClick={() => openAccount('Loan')}><Icon name="plus" size={15} /> Add bank loan</button></div>{loans.length === 0 ? <EmptyState title="No bank loans added yet" description="Add a bank loan with a monthly payment, first payment date, and number of payments." action={<button className="button button-outline" onClick={() => openAccount('Loan')}><Icon name="plus" size={15} /> Add bank loan</button>} /> : <AccountList accounts={loans} currency={budget.currency} onDelete={removeAccount} />}</section>}

          {page === 'Credit cards' && <section className="panel page-panel"><div className="panel-heading activity-heading"><div><span className="eyebrow">CARD BALANCES</span><h2>Your credit cards</h2><p>{creditCards.length} {creditCards.length === 1 ? 'card' : 'cards'} · Current debt is projected as a full monthly payment.</p></div><button className="button button-primary button-small" onClick={() => openAccount('Credit card')}><Icon name="plus" size={15} /> Add credit card</button></div>{creditCards.length === 0 ? <EmptyState title="No credit cards added yet" description="Add a credit card to track its current debt and monthly payment date." action={<button className="button button-outline" onClick={() => openAccount('Credit card')}><Icon name="plus" size={15} /> Add a credit card</button>} /> : <AccountList accounts={creditCards} currency={budget.currency} onDelete={removeAccount} />}</section>}

          <footer className="page-footer"><span>Made for the everyday moments that add up.</span><span className={saveStatus === 'saving' ? 'save-pending' : saveStatus === 'error' ? 'save-failed' : ''}><i /> {saveStatus === 'saving' ? 'Saving to SQLite…' : saveStatus === 'error' ? 'Save failed' : 'Saved to local SQLite'}</span></footer>
        </div>
      </main>

      {modal === 'entry' && <Modal title="Add budget item" onClose={() => setModal(null)}>
        <form className="form-stack" onSubmit={addEntry}>
          <div className="kind-toggle"><button type="button" className={entryKind === 'expense' ? 'selected expense-selected' : ''} onClick={() => setEntryKind('expense')}><Icon name="down" size={16} /> Expense</button><button type="button" className={entryKind === 'income' ? 'selected income-selected' : ''} onClick={() => setEntryKind('income')}><Icon name="arrow" size={16} /> Income</button></div>
          <input type="hidden" name="kind" value={entryKind} />
          <label className="form-field"><span>Name</span><input name="title" placeholder={entryKind === 'expense' ? 'e.g. Electricity bill' : 'e.g. Monthly salary'} autoFocus required maxLength={80} /></label>
          <div className="form-row"><label className="form-field"><span>Amount</span><div className="amount-input"><span>{new Intl.NumberFormat(undefined, { style: 'currency', currency: budget.currency }).formatToParts(0).find((part) => part.type === 'currency')?.value}</span><AmountInput name="amount" label="Amount" required /></div></label><label className="form-field"><span>Category</span><input name="category" placeholder="e.g. Housing, Food" maxLength={40} /></label></div>
          <div className="form-row"><label className="form-field"><span>{entryKind === 'expense' ? 'First payment date' : 'Start date'}</span><input name="date" type="date" defaultValue={toDateInput(today)} required /></label><label className="form-field"><span>Frequency</span><select name="frequency" value={entryFrequency} onChange={(event) => setEntryFrequency(event.target.value)}><option value="once">One time</option><option value="monthly">Monthly recurring</option></select></label></div>
          <div className="modal-note"><Icon name="repeat" size={16} /><span>Recurring items are included in your six-month outlook from their start date.</span></div>
          <div className="modal-actions"><button type="button" className="button button-plain" onClick={() => setModal(null)}>Cancel</button><button type="submit" className="button button-primary">Add {entryKind}</button></div>
        </form>
      </Modal>}

      {modal === 'salary' && <Modal title="Add salary" onClose={() => setModal(null)}>
        <form className="form-stack" onSubmit={addSalary}>
          <label className="form-field"><span>Salary name</span><input name="title" placeholder="e.g. Monthly salary" autoFocus required maxLength={80} /></label>
          <div className="form-row">
            <label className="form-field"><span>Amount</span><div className="amount-input"><span>{new Intl.NumberFormat(undefined, { style: 'currency', currency: salaryCurrency }).formatToParts(0).find((part) => part.type === 'currency')?.value}</span><AmountInput name="amount" label="Salary amount" required /></div></label>
            <label className="form-field"><span>Currency</span><select name="currency" value={salaryCurrency} onChange={(event) => setSalaryCurrency(event.target.value)}>{CURRENCIES.map((currency) => <option key={currency} value={currency}>{currency}</option>)}</select></label>
          </div>
          {salaryCurrency !== budget.currency && <label className="form-field"><span>Exchange rate to {budget.currency}</span><input name="exchangeRate" type="number" min="0.000001" step="any" defaultValue="1" required /><small>Value of 1 {salaryCurrency} in {budget.currency}.</small></label>}
          <label className="form-field"><span>First payment date</span><input name="date" type="date" defaultValue={toDateInput(today)} required /></label>
          <div className="modal-note"><Icon name="repeat" size={16} /><span>This salary repeats monthly. The exchange rate converts its amount to {budget.currency} for forecasts.</span></div>
          <div className="modal-actions"><button type="button" className="button button-plain" onClick={() => setModal(null)}>Cancel</button><button type="submit" className="button button-primary">Add salary</button></div>
        </form>
      </Modal>}

      {modal === 'account' && <Modal title={`Add ${accountKind === 'Bank account' ? 'bank account' : accountKind === 'Loan' ? 'bank loan' : 'credit card'}`} onClose={() => setModal(null)}>
        <form className="form-stack" onSubmit={addAccount}>
          <input type="hidden" name="kind" value={accountKind} />
          <label className="form-field"><span>{accountKind === 'Bank account' ? 'Bank account name' : accountKind === 'Loan' ? 'Bank loan name' : 'Credit card name'}</span><input name="name" placeholder={accountKind === 'Bank account' ? 'e.g. Everyday checking' : accountKind === 'Loan' ? 'e.g. Car loan' : 'e.g. Travel card'} autoFocus required maxLength={80} /></label>
          <label className="form-field"><span>{accountKind === 'Credit card' ? 'Current debt' : 'Current balance'}</span><AmountInput name="balance" label={accountKind === 'Credit card' ? 'Current debt' : 'Current balance'} allowNegative={accountKind === 'Bank account'} placeholder={accountKind === 'Bank account' ? 'e.g. -1.250,00' : '0,00'} required /></label>
          {accountKind === 'Loan' && <>
            <div className="form-row"><label className="form-field"><span>Monthly payment</span><AmountInput name="payment" label="Monthly payment" defaultValue="0" placeholder="0,00" required={accountKind === 'Loan'} /></label><label className="form-field"><span>Interest rate (APR %)</span><input name="apr" type="number" min="0" max="100" step="0.01" placeholder="0" defaultValue="0" /></label></div>
            <div className="form-row"><label className="form-field"><span>First payment date</span><input name="firstPaymentDate" type="date" defaultValue={toDateInput(today)} required /></label><label className="form-field"><span>Number of payments</span><input name="periodCount" type="number" min="1" step="1" placeholder="e.g. 60" required /></label></div>
          </>}
          {accountKind === 'Credit card' && <label className="form-field"><span>Payment date (day of month)</span><input name="dueDay" type="number" min="1" max="31" defaultValue="1" required /></label>}
          <div className="modal-note"><Icon name="calendar" size={16} /><span>{accountKind === 'Bank account' ? 'Enter a negative balance to show an overdraft. Bank balances do not count as debt payments in the forecast.' : accountKind === 'Loan' ? 'A recurring expense will be created for the selected number of monthly payments and will stop automatically. Interest is for reference only.' : 'The current debt is assumed paid in full on its payment date and each following month in your forecast.'}</span></div>
          <div className="modal-actions"><button type="button" className="button button-plain" onClick={() => setModal(null)}>Cancel</button><button type="submit" className="button button-primary">Add {accountKind === 'Bank account' ? 'bank account' : accountKind === 'Loan' ? 'bank loan' : 'credit card'}</button></div>
        </form>
      </Modal>}
    </div>
  )
}

function EntryTable({ entries, currency, onDelete }: { entries: Entry[]; currency: string; onDelete: (id: string) => void }) {
  if (entries.length === 0) return <EmptyState title="Nothing to show yet" description="Add an income or expense to start building your household budget." action={null} />

  return <div className="table-scroll"><table className="entry-table"><thead><tr><th>DESCRIPTION</th><th>CATEGORY</th><th>DATE</th><th>FREQUENCY</th><th className="amount-column">AMOUNT</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{entries.map((entry) => <tr key={entry.id}><td><span className={`entry-symbol ${entry.kind}`}><Icon name={entry.kind === 'income' ? 'arrow' : 'down'} size={16} /></span><span className="entry-title"><strong>{entry.title}</strong><small>{entry.kind === 'income' ? 'Income' : 'Expense'}</small></span></td><td><span className="category-label">{entry.category || 'Other'}</span></td><td>{new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(dateFromInput(entry.date))}</td><td>{entry.recurring ? <span className="frequency"><Icon name="repeat" size={13} /> {entry.recurrenceCount ? `Monthly · ${entry.recurrenceCount} payments` : 'Monthly'}</span> : <span className="frequency-once">One time</span>}</td><td className={`amount-column ${entry.kind === 'income' ? 'positive' : 'negative'}`}>{entry.kind === 'income' ? '+' : '−'}{formatMoney(entry.sourceAmount ?? entry.amount, entry.currency ?? currency)}</td><td><button className="icon-button delete-button" aria-label={`Delete ${entry.title}`} onClick={() => onDelete(entry.id)}><Icon name="trash" size={15} /></button></td></tr>)}</tbody></table></div>
}

function AccountList({ accounts, currency, onDelete }: { accounts: Account[]; currency: string; onDelete: (id: string) => void }) {
  return <div className="account-list">{accounts.map((account) => <article className="account-row" key={account.id}>
    <span className={`account-symbol ${account.kind === 'Loan' ? 'loan-symbol' : account.kind === 'Bank account' ? 'bank-symbol' : 'card-symbol'}`}><Icon name={account.kind === 'Credit card' ? 'card' : 'wallet'} size={19} /></span>
    <div className="account-name"><strong>{account.name}</strong><span>{account.kind === 'Loan' ? `Bank loan · ${account.apr}% APR · ${account.periodCount ? `${account.periodCount} payments` : 'Ongoing payments'}` : account.kind === 'Credit card' ? 'Credit card' : account.kind}</span></div>
    {account.kind === 'Loan' && <div className="account-payment"><span>Monthly payment</span><strong>{formatMoney(account.payment, currency)}</strong></div>}
    {account.kind === 'Credit card' && <div className="account-payment"><span>Payment date</span><strong>Day {account.dueDay}</strong></div>}
    <div className="account-balance"><span>{account.kind === 'Credit card' ? 'Current debt' : account.balance < 0 ? 'Overdrawn' : 'Balance'}</span><strong className={account.balance < 0 ? 'negative' : ''}>{formatMoney(account.balance, currency)}</strong></div>
    <button className="icon-button delete-button" aria-label={`Remove ${account.name}`} onClick={() => onDelete(account.id)}><Icon name="trash" size={16} /></button>
  </article>)}</div>
}

export default App
