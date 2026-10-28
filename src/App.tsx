import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent, type ReactNode } from 'react'
import './App.css'

type EntryKind = 'income' | 'expense'
type AccountKind = 'Loan' | 'Credit card' | 'Bank account'
type Page = 'Overview' | 'Future Perspective' | 'Monthly Overview' | 'Transactions' | 'Recurring' | 'Salaries' | 'Family' | 'House' | 'Personal' | 'Car' | 'Accounts' | 'Loans' | 'Credit cards'

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
  exchangeRateDate?: string
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
    && (!('exchangeRateDate' in value) || (typeof value.exchangeRateDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.exchangeRateDate)))
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
  projectedBalance: number
  incomeItems: ForecastItem[]
  expenseItems: ForecastItem[]
}

type ForecastItem = {
  id: string
  title: string
  category: string
  amount: number
  date: Date
}

const CURRENCIES = ['USD', 'EUR', 'GBP', 'TRY', 'CAD', 'AUD'] as const
const MONTHLY_NET_INTEREST_RATE = 0.04
const NAV_ITEMS: { label: Page; icon: string }[] = [
  { label: 'Overview', icon: 'grid' },
  { label: 'Future Perspective', icon: 'trend' },
  { label: 'Monthly Overview', icon: 'calendar' },
  { label: 'Transactions', icon: 'list' },
  { label: 'Recurring', icon: 'repeat' },
  { label: 'Salaries', icon: 'wallet' },
  { label: 'Accounts', icon: 'wallet' },
  { label: 'Loans', icon: 'wallet' },
  { label: 'Credit cards', icon: 'card' },
]
const SPENDING_ITEMS: { label: Extract<Page, 'House' | 'Family' | 'Personal' | 'Car'>; icon: string }[] = [
  { label: 'House', icon: 'house' },
  { label: 'Family', icon: 'family' },
  { label: 'Personal', icon: 'person' },
  { label: 'Car', icon: 'car' },
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

function occurrenceDateInMonth(day: number, year: number, month: number): Date {
  const clampedDay = Math.min(day, new Date(year, month + 1, 0).getDate())
  return new Date(year, month, clampedDay, 12)
}

function remainingLoanPayments(account: Account, entries: Entry[], today: Date): number | null {
  const repayment = entries.find((entry) => entry.linkedAccountId === account.id)
  const totalPayments = repayment?.recurrenceCount ?? (account.periodCount > 0 ? account.periodCount : null)
  if (!totalPayments) return null
  if (!repayment) return totalPayments

  const firstPayment = dateFromInput(repayment.date)
  const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  let remaining = 0

  for (let paymentIndex = 0; paymentIndex < totalPayments; paymentIndex += 1) {
    const month = firstPayment.getMonth() + paymentIndex
    const year = firstPayment.getFullYear() + Math.floor(month / 12)
    const paymentMonth = month % 12
    const day = Math.min(firstPayment.getDate(), new Date(year, paymentMonth + 1, 0).getDate())
    if (new Date(year, paymentMonth, day) >= todayDate) remaining += 1
  }

  return remaining
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

function makeForecast(data: BudgetData, today: Date, monthCount = 6): ForecastMonth[] {
  const current = monthStart(today)
  let runningNet = 0
  let projectedBalance = data.accounts
    .filter((account) => account.kind === 'Bank account')
    .reduce((total, account) => total + account.balance, 0)
  const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate())

  return Array.from({ length: monthCount }, (_, index) => {
    const date = new Date(current.getFullYear(), current.getMonth() + index, 1)
    const key = monthKey(date)
    let income = 0
    let expenses = 0
    let remainingIncome = 0
    let remainingExpenses = 0
    const incomeItems: ForecastItem[] = []
    const expenseItems: ForecastItem[] = []

    for (const entry of data.entries) {
      const entryDate = dateFromInput(entry.date)
      const monthOffset = (date.getFullYear() - entryDate.getFullYear()) * 12 + date.getMonth() - entryDate.getMonth()
      const isIncluded = entry.recurring
        ? monthOffset >= 0 && (entry.recurrenceCount === undefined || monthOffset < entry.recurrenceCount)
        : monthKey(entryDate) === key
      if (!isIncluded) continue
      const occurrenceDate = entry.recurring
        ? occurrenceDateInMonth(entryDate.getDate(), date.getFullYear(), date.getMonth())
        : entryDate
      const isFutureOccurrence = index > 0 || occurrenceDate >= todayDate
      const forecastItem = {
        id: entry.id,
        title: entry.title,
        category: entry.category,
        amount: entry.amount,
        date: occurrenceDate,
      }
      if (entry.kind === 'income') {
        income += entry.amount
        incomeItems.push(forecastItem)
        if (isFutureOccurrence) remainingIncome += entry.amount
      } else {
        expenses += entry.amount
        expenseItems.push(forecastItem)
        if (isFutureOccurrence) remainingExpenses += entry.amount
      }
    }

    for (const account of data.accounts) {
      if (account.kind === 'Credit card') {
        const thisMonthPaymentDate = occurrenceDateInMonth(account.dueDay, today.getFullYear(), today.getMonth())
        const nextPaymentDate = thisMonthPaymentDate >= todayDate
          ? thisMonthPaymentDate
          : occurrenceDateInMonth(account.dueDay, today.getFullYear(), today.getMonth() + 1)
        if (monthKey(date) === monthKey(nextPaymentDate)) {
          expenses += account.balance
          expenseItems.push({
            id: `credit-card-${account.id}`,
            title: `${account.name} payment`,
            category: 'Credit card payment',
            amount: account.balance,
            date: nextPaymentDate,
          })
          remainingExpenses += account.balance
        }
      }
      else if (account.kind === 'Loan' && account.periodCount === 0) {
        expenses += account.payment
        expenseItems.push({
          id: `ongoing-loan-${account.id}`,
          title: `${account.name} payment`,
          category: 'Loan repayment',
          amount: account.payment,
          date: occurrenceDateInMonth(account.dueDay, date.getFullYear(), date.getMonth()),
        })
        if (index > 0 || account.dueDay >= today.getDate()) remainingExpenses += account.payment
      }
    }
    const netInterest = runningNet > 0
      ? Math.round((runningNet * MONTHLY_NET_INTEREST_RATE + Number.EPSILON) * 100) / 100
      : projectedBalance < 0
        ? Math.round((projectedBalance * MONTHLY_NET_INTEREST_RATE - Number.EPSILON) * 100) / 100
        : 0
    if (netInterest > 0) {
      income += netInterest
      incomeItems.push({
        id: `net-interest-${key}`,
        title: 'Interest on carried net',
        category: 'Interest',
        amount: netInterest,
        date: occurrenceDateInMonth(1, date.getFullYear(), date.getMonth()),
      })
      remainingIncome += netInterest
    } else if (netInterest < 0) {
      const interestCharge = Math.abs(netInterest)
      expenses += interestCharge
      expenseItems.push({
        id: `net-interest-${key}`,
        title: 'Interest on carried deficit',
        category: 'Interest',
        amount: interestCharge,
        date: occurrenceDateInMonth(1, date.getFullYear(), date.getMonth()),
      })
      remainingExpenses += interestCharge
    }
    const net = income - expenses
    const remainingNet = remainingIncome - remainingExpenses
    runningNet += remainingNet
    projectedBalance += remainingNet
    return { date, income, expenses, net, runningNet, projectedBalance, incomeItems, expenseItems }
  })
}

function Icon({ name, size = 19 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
    list: <><path d="M8 6h13M8 12h13M8 18h13" /><path d="M3 6h.01M3 12h.01M3 18h.01" /></>,
    repeat: <><path d="m17 2 4 4-4 4" /><path d="M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4" /><path d="M21 13v2a3 3 0 0 1-3 3H3" /></>,
    wallet: <><rect x="3" y="5" width="18" height="15" rx="2" /><path d="M3 9h18M16 14h2" /><path d="M7 5V3h10v2" /></>,
    family: <><circle cx="9" cy="7" r="3" /><circle cx="17" cy="9" r="2" /><path d="M3.5 20v-2a5.5 5.5 0 0 1 11 0v2M14 15a4 4 0 0 1 6.5 3v2" /></>,
    person: <><circle cx="12" cy="8" r="4" /><path d="M5 21v-2a7 7 0 0 1 14 0v2" /></>,
    car: <><path d="m5 11 1.5-4.5A2 2 0 0 1 8.4 5h7.2a2 2 0 0 1 1.9 1.5L19 11" /><path d="M3 11h18v7H3zM6 18v2M18 18v2" /><circle cx="7" cy="14.5" r="1" /><circle cx="17" cy="14.5" r="1" /></>,
    house: <><path d="m3 10 9-7 9 7" /><path d="M5 9v12h14V9M9 21v-7h6v7" /></>,
    card: <><rect x="2.5" y="5" width="19" height="14" rx="2" /><path d="M2.5 10h19M7 15h3" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    arrow: <><path d="M7 17 17 7M7 7h10v10" /></>,
    down: <><path d="M7 7 17 17M17 7v10H7" /></>,
    chevron: <path d="m9 18 6-6-6-6" />,
    close: <><path d="m18 6-12 12M6 6l12 12" /></>,
    trend: <><path d="m3 17 6-6 4 4 8-8" /><path d="M15 7h6v6" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 11h18" /></>,
    trash: <><path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6m4 4v6m6-6v6" /></>,
    edit: <><path d="m15 5 4 4" /><path d="M4 20l4.5-1 10.8-10.8a2.1 2.1 0 0 0-3-3L5.5 16 4 20Z" /></>,
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
  const [hoveredMonth, setHoveredMonth] = useState<{ index: number; x: number; y: number } | null>(null)
  const chartWidth = 920
  const chartHeight = 430
  const plotTop = 42
  const plotBottom = 352
  const plotHeight = plotBottom - plotTop
  const baseline = plotTop + plotHeight / 2
  const plotLeft = 76
  const plotRight = 850
  const groupWidth = (plotRight - plotLeft) / months.length
  const startX = plotLeft
  const barWidth = Math.min(25, groupWidth * 0.28)
  const maxCashFlow = Math.max(1, ...months.flatMap((month) => [month.income, month.expenses]))
  const maxAbsoluteBalance = Math.max(0, ...months.map((month) => Math.abs(month.projectedBalance)))
  const maxAxisValue = Math.max(maxCashFlow, maxAbsoluteBalance)
  const cashY = (value: number) => baseline - (value / maxAxisValue) * (plotHeight / 2)
  const balanceY = (balance: number) => baseline - (balance / maxAxisValue) * (plotHeight / 2)
  const balanceSegments = months.slice(1).reduce<{ positive: string[]; negative: string[] }>((paths, month, index) => {
    const previous = months[index]
    const previousX = startX + index * groupWidth + groupWidth / 2
    const currentX = startX + (index + 1) * groupWidth + groupWidth / 2
    const previousY = balanceY(previous.projectedBalance)
    const currentY = balanceY(month.projectedBalance)
    const previousPositive = previous.projectedBalance >= 0
    const currentPositive = month.projectedBalance >= 0

    if (previousPositive === currentPositive) {
      paths[previousPositive ? 'positive' : 'negative'].push(`M ${previousX} ${previousY} L ${currentX} ${currentY}`)
    } else {
      const ratio = Math.abs(previous.projectedBalance) / Math.abs(month.projectedBalance - previous.projectedBalance)
      const zeroX = previousX + (currentX - previousX) * ratio
      const zeroY = balanceY(0)
      paths[previousPositive ? 'positive' : 'negative'].push(`M ${previousX} ${previousY} L ${zeroX} ${zeroY}`)
      paths[currentPositive ? 'positive' : 'negative'].push(`M ${zeroX} ${zeroY} L ${currentX} ${currentY}`)
    }

    return paths
  }, { positive: [], negative: [] })
  const showTooltip = (event: PointerEvent<SVGSVGElement>) => {
    const svgBounds = event.currentTarget.getBoundingClientRect()
    const wrapperBounds = event.currentTarget.parentElement?.getBoundingClientRect() ?? svgBounds
    const svgX = ((event.clientX - svgBounds.left) / svgBounds.width) * chartWidth
    const svgY = ((event.clientY - svgBounds.top) / svgBounds.height) * chartHeight
    if (svgX < plotLeft || svgX > plotRight || svgY < plotTop || svgY > plotBottom) {
      setHoveredMonth(null)
      return
    }
    const index = Math.max(0, Math.min(months.length - 1, Math.floor((svgX - plotLeft) / groupWidth)))
    setHoveredMonth({
      index,
      x: event.clientX - wrapperBounds.left,
      y: event.clientY - wrapperBounds.top,
    })
  }

  return (
    <div className="chart-wrap">
      <div className="chart-legend"><span><i className="legend-income" />Income (+)</span><span><i className="legend-expense" />Expenses (−)</span><span><i className="legend-balance" />Total bank balance (+)</span><span><i className="legend-balance-negative" />Total bank balance (−)</span></div>
      <svg className="forecast-chart" viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img" aria-label={`${months.length} month income and expense forecast chart`} onPointerMove={showTooltip} onPointerLeave={() => setHoveredMonth(null)}>
        {[0, 1, 2, 3, 4].map((line) => {
          const y = plotTop + line * (plotHeight / 4)
          const cashTick = maxAxisValue * (1 - line / 2)
          const balanceTick = cashTick
          return <g key={line}><line x1={plotLeft} y1={y} x2={plotRight} y2={y} className="chart-grid" /><text x={plotLeft - 10} y={y + 4} textAnchor="end" className="chart-axis">{formatMoney(cashTick, currency, true)}</text><text x={chartWidth - 8} y={y + 4} textAnchor="end" className="chart-axis">{formatMoney(balanceTick, currency, true)}</text></g>
        })}
        <line x1={plotLeft} y1={baseline} x2={plotRight} y2={baseline} className="forecast-cash-zero" />
        {months.map((month, index) => {
          const x = startX + index * groupWidth + (groupWidth - barWidth * 2 - 5) / 2
          const incomeHeight = baseline - cashY(month.income)
          const expenseHeight = cashY(-month.expenses) - baseline
          return <g key={monthKey(month.date)}>
            <rect x={x} y={baseline - incomeHeight} width={barWidth} height={incomeHeight} rx="4" className="bar-income"><title>{formatMoney(month.income, currency)} income</title></rect>
            <rect x={x + barWidth + 5} y={baseline} width={barWidth} height={expenseHeight} rx="4" className="bar-expense"><title>{formatMoney(-month.expenses, currency)} expenses</title></rect>
            <text x={startX + index * groupWidth + groupWidth / 2} y="392" textAnchor="middle" className="chart-month">{formatMonth(month.date)}</text>
          </g>
        })}
        <path d={balanceSegments.positive.join(' ')} className="forecast-balance-line" />
        <path d={balanceSegments.negative.join(' ')} className="forecast-balance-negative-line" />
        {months.map((month, index) => <circle
          key={`balance-${monthKey(month.date)}`}
          cx={startX + index * groupWidth + groupWidth / 2}
          cy={balanceY(month.projectedBalance)}
          r="3.5"
          className={month.projectedBalance < 0 ? 'forecast-balance-point forecast-balance-negative-point' : 'forecast-balance-point'}
        ><title>{formatMonth(month.date, { month: 'long', year: 'numeric' })} total bank balance: {formatMoney(month.projectedBalance, currency)}</title></circle>)}
      </svg>
      {hoveredMonth && <div className="forecast-tooltip" style={{ left: hoveredMonth.x, top: hoveredMonth.y }} role="status">
        <strong>{formatMonth(months[hoveredMonth.index].date, { month: 'long', year: 'numeric' })}</strong>
        <span className="tooltip-income">Income: +{formatMoney(months[hoveredMonth.index].income, currency)}</span>
        <span className="tooltip-expense">Expenses: −{formatMoney(months[hoveredMonth.index].expenses, currency)}</span>
        <span>Net: {months[hoveredMonth.index].net >= 0 ? '+' : '−'}{formatMoney(Math.abs(months[hoveredMonth.index].net), currency)}</span>
        <span className={months[hoveredMonth.index].projectedBalance < 0 ? 'tooltip-negative' : 'tooltip-balance'}>Total bank balance: {formatMoney(months[hoveredMonth.index].projectedBalance, currency)}</span>
      </div>}
    </div>
  )
}

function BalanceChart({ months, currency }: { months: ForecastMonth[]; currency: string }) {
  const chartWidth = Math.max(900, months.length * 82)
  const chartHeight = 230
  const left = 72
  const right = chartWidth - 24
  const top = 20
  const bottom = chartHeight - 36
  const values = months.map((month) => month.projectedBalance)
  let min = Math.min(0, ...values)
  let max = Math.max(0, ...values)
  if (min === max) {
    min -= 1
    max += 1
  }
  const range = max - min
  const x = (index: number) => left + (months.length === 1 ? 0 : index * (right - left) / (months.length - 1))
  const y = (value: number) => top + (max - value) * (bottom - top) / range
  const path = months.map((month, index) => `${index === 0 ? 'M' : 'L'} ${x(index)} ${y(month.projectedBalance)}`).join(' ')
  const zeroY = y(0)

  return <div className="balance-chart-scroll">
    <svg className="balance-chart" viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img" aria-label="Projected total bank-account balance by month">
      {[0, 1, 2, 3].map((step) => {
        const value = max - (range * step) / 3
        const gridY = y(value)
        return <g key={step}>
          <line x1={left} y1={gridY} x2={right} y2={gridY} className="chart-grid" />
          <text x={left - 8} y={gridY + 4} textAnchor="end" className="chart-axis">{formatMoney(value, currency, true)}</text>
        </g>
      })}
      <line x1={left} y1={zeroY} x2={right} y2={zeroY} className="chart-zero" />
      <path d={path} className="balance-line" />
      {months.map((month, index) => <g key={monthKey(month.date)}>
        <circle cx={x(index)} cy={y(month.projectedBalance)} r="4" className="balance-point">
          <title>{formatMonth(month.date, { month: 'long', year: 'numeric' })}: {formatMoney(month.projectedBalance, currency)}</title>
        </circle>
        <text x={x(index)} y={chartHeight - 12} textAnchor="middle" className="chart-month">{formatMonth(month.date)}</text>
      </g>)}
    </svg>
  </div>
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
  const [spendingsExpanded, setSpendingsExpanded] = useState(false)
  const [modal, setModal] = useState<'entry' | 'account' | 'edit-account' | 'salary' | null>(null)
  const [entryKind, setEntryKind] = useState<EntryKind>('expense')
  const [entryFrequency, setEntryFrequency] = useState('once')
  const [editingEntry, setEditingEntry] = useState<Entry | null>(null)
  const [expenseGroup, setExpenseGroup] = useState<'Family' | 'House' | 'Personal' | 'Car' | null>(null)
  const [accountKind, setAccountKind] = useState<AccountKind>('Loan')
  const [editingAccount, setEditingAccount] = useState<Account | null>(null)
  const [salaryCurrency, setSalaryCurrency] = useState<string>('USD')
  const [salaryExchangeRate, setSalaryExchangeRate] = useState<number | null>(null)
  const [salaryExchangeRateDate, setSalaryExchangeRateDate] = useState<string | null>(null)
  const [salaryRateStatus, setSalaryRateStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [salaryRateError, setSalaryRateError] = useState<string | null>(null)
  const [salaryRateAttempt, setSalaryRateAttempt] = useState(0)

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

  useEffect(() => {
    if (modal !== 'salary') return

    if (salaryCurrency === budget.currency) return
    const controller = new AbortController()

    async function loadSalaryExchangeRate() {
      try {
        const query = new URLSearchParams({ base: salaryCurrency, quote: budget.currency })
        const response = await fetch(`/api/exchange-rate?${query}`, { signal: controller.signal })
        const result: unknown = await response.json()
        if (!response.ok) {
          const message = typeof result === 'object' && result !== null && 'error' in result && typeof result.error === 'string'
            ? result.error
            : `Request failed with status ${response.status}.`
          throw new Error(message)
        }
        if (typeof result !== 'object' || result === null
          || !('rate' in result) || typeof result.rate !== 'number' || !Number.isFinite(result.rate) || result.rate <= 0
          || !('date' in result) || typeof result.date !== 'string'
          || !('base' in result) || result.base !== salaryCurrency
          || !('quote' in result) || result.quote !== budget.currency) {
          throw new Error('The exchange-rate service returned invalid data.')
        }
        setSalaryExchangeRate(result.rate)
        setSalaryExchangeRateDate(result.date)
        setSalaryRateStatus('ready')
      } catch (error) {
        if (controller.signal.aborted) return
        setSalaryRateError(error instanceof Error ? error.message : String(error))
        setSalaryRateStatus('error')
      }
    }

    void loadSalaryExchangeRate()
    return () => controller.abort()
  }, [modal, salaryCurrency, budget.currency, salaryRateAttempt])

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

  const forecast = useMemo(() => makeForecast(budget, today, 12), [budget, today])
  const sixMonthForecast = forecast.slice(0, 6)
  const currentMonth = monthKey(today)
  const currentForecast = forecast[0]
  const totalBankBalance = budget.accounts
    .filter((account) => account.kind === 'Bank account')
    .reduce((total, account) => total + account.balance, 0)
  const bankAccounts = budget.accounts.filter((account) => account.kind === 'Bank account')
  const loans = budget.accounts.filter((account) => account.kind === 'Loan')
  const creditCards = budget.accounts.filter((account) => account.kind === 'Credit card')
  const upcomingEntries = [...budget.entries].sort((a, b) => b.date.localeCompare(a.date))
  const visibleEntries = page === 'Recurring'
    ? upcomingEntries.filter((entry) => entry.recurring)
    : page === 'Salaries'
      ? upcomingEntries.filter((entry) => entry.category === 'Salary' && entry.kind === 'income')
    : page === 'Family'
      ? upcomingEntries.filter((entry) => (entry.category === 'Family' || entry.category === 'Kids') && entry.kind === 'expense')
    : page === 'House'
      ? upcomingEntries.filter((entry) => entry.category === 'House' && entry.kind === 'expense')
    : page === 'Personal'
      ? upcomingEntries.filter((entry) => entry.category === 'Personal' && entry.kind === 'expense')
    : page === 'Car'
      ? upcomingEntries.filter((entry) => entry.category === 'Car' && entry.kind === 'expense')
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
    const recurring = String(fields.get('frequency')) === 'monthly'
    const recurrenceCountValue = fields.get('recurrenceCount')
    const recurrenceCount = recurring && (expenseGroup || recurrenceCountValue)
      ? Number(recurrenceCountValue)
      : undefined
    const entry: Entry = {
      id: editingEntry?.id ?? crypto.randomUUID(),
      title: String(fields.get('title')).trim(),
      kind: String(fields.get('kind')) as EntryKind,
      category: editingEntry?.category === 'Kids' && expenseGroup === 'Family'
        ? 'Kids'
        : expenseGroup ?? String(fields.get('category') || 'Other').trim(),
      amount: Number(fields.get('amount')),
      date: String(fields.get('date')),
      recurring,
      ...(recurrenceCount === undefined ? {} : { recurrenceCount }),
    }
    if (!entry.title || !Number.isFinite(entry.amount) || entry.amount <= 0 || !entry.date
      || (recurrenceCount !== undefined && (!Number.isInteger(recurrenceCount) || recurrenceCount < 1))) return
    saveBudget({
      ...budget,
      entries: editingEntry
        ? budget.entries.map((current) => current.id === editingEntry.id ? entry : current)
        : [entry, ...budget.entries],
    })
    setModal(null)
    setExpenseGroup(null)
    setEditingEntry(null)
  }

  function addSalary(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const fields = new FormData(event.currentTarget)
    const sourceAmount = Number(fields.get('amount'))
    const exchangeRate = salaryExchangeRate
    if (salaryRateStatus !== 'ready' || exchangeRate === null) return
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
      ...(salaryExchangeRateDate ? { exchangeRateDate: salaryExchangeRateDate } : {}),
      date: String(fields.get('date')),
      recurring: true,
    }
    if (!salary.title || !Number.isFinite(sourceAmount) || sourceAmount <= 0 || !Number.isFinite(convertedAmount) || convertedAmount <= 0 || !salary.date) return
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
      id: editingAccount?.id ?? crypto.randomUUID(),
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
    const existingLoanEntry = editingAccount?.kind === 'Loan'
      ? budget.entries.find((entry) => entry.linkedAccountId === editingAccount.id)
      : undefined
    const loanEntry: Entry | null = account.kind === 'Loan' ? {
      id: existingLoanEntry?.id ?? crypto.randomUUID(),
      title: `${account.name} payment`,
      kind: 'expense',
      category: 'Loan repayment',
      amount: account.payment,
      date: loanFirstPaymentDate,
      recurring: true,
      recurrenceCount: periodCount,
      linkedAccountId: account.id,
    } : null
    const accounts = editingAccount
      ? budget.accounts.map((current) => current.id === editingAccount.id
        ? account
        : current)
      : [account, ...budget.accounts]
    saveBudget({
      ...budget,
      accounts,
      entries: loanEntry
        ? [loanEntry, ...budget.entries.filter((entry) => entry.linkedAccountId !== account.id)]
        : budget.entries,
    })
    setEditingAccount(null)
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
    setEditingEntry(null)
    setExpenseGroup(null)
    setEntryKind(kind)
    setEntryFrequency(recurring ? 'monthly' : 'once')
    setModal('entry')
  }

  function openGroupedExpense(group: 'Family' | 'House' | 'Personal' | 'Car') {
    setEditingEntry(null)
    setExpenseGroup(group)
    setEntryKind('expense')
    setEntryFrequency('monthly')
    setModal('entry')
  }

  function editEntry(entry: Entry) {
    setEditingEntry(entry)
    setEntryKind(entry.kind)
    setEntryFrequency(entry.recurring ? 'monthly' : 'once')
    setExpenseGroup(
      entry.category === 'Family' || entry.category === 'Kids'
        ? 'Family'
        : entry.category === 'House' || entry.category === 'Personal' || entry.category === 'Car'
          ? entry.category
          : null,
    )
    setModal('entry')
  }

  function openAccount(kind: AccountKind = 'Bank account') {
    setAccountKind(kind)
    setEditingAccount(null)
    setModal('account')
  }

  function editBankAccount(account: Account) {
    setAccountKind('Bank account')
    setEditingAccount(account)
    setModal('edit-account')
  }

  function editLoan(account: Account) {
    setAccountKind('Loan')
    setEditingAccount(account)
    setModal('edit-account')
  }

  function editCreditCard(account: Account) {
    setAccountKind('Credit card')
    setEditingAccount(account)
    setModal('edit-account')
  }

  function openSalary() {
    setSalaryCurrency(budget.currency)
    setSalaryExchangeRate(1)
    setSalaryExchangeRateDate(null)
    setSalaryRateStatus('ready')
    setSalaryRateError(null)
    setModal('salary')
  }

  function changeSalaryCurrency(currency: string) {
    setSalaryCurrency(currency)
    setSalaryExchangeRate(currency === budget.currency ? 1 : null)
    setSalaryExchangeRateDate(null)
    setSalaryRateStatus(currency === budget.currency ? 'ready' : 'loading')
    setSalaryRateError(null)
  }

  function retrySalaryRate() {
    setSalaryRateStatus('loading')
    setSalaryRateError(null)
    setSalaryRateAttempt((attempt) => attempt + 1)
  }

  const sectionTitle = page === 'Overview' ? 'Your money, in focus.' : page
  const sectionDescription = page === 'Overview'
    ? 'A clearer picture of where you are and where you’re headed.'
    : page === 'Transactions'
      ? 'Every income and expense, all in one place.'
      : page === 'Future Perspective'
      ? 'See monthly cash flow, 4% interest on positive carried net, and deficit interest based on projected bank balance.'
      : page === 'Monthly Overview'
        ? 'Review income, expenses, carried net, bank-balance-based deficit interest, and monthly details for the next 12 months.'
      : page === 'Recurring'
        ? 'Monthly items included in your future outlook.'
        : page === 'Salaries'
          ? 'Manage recurring salary income and its currency.'
        : page === 'Family'
          ? 'Plan and track one-time or recurring family expenses.'
        : page === 'House'
          ? 'Plan and track one-time or recurring house expenses.'
        : page === 'Personal'
          ? 'Plan and track one-time or recurring personal expenses.'
        : page === 'Car'
          ? 'Plan and track one-time or recurring car expenses.'
        : page === 'Accounts'
          ? 'Track cash in your bank accounts, including overdrafts.'
          : page === 'Loans'
            ? 'Track bank loans and their scheduled monthly repayments.'
            : 'Keep card balances and monthly payments in view.'
  const spendingPageIsActive = SPENDING_ITEMS.some((item) => item.label === page)
  const renderNavItem = (item: (typeof NAV_ITEMS)[number]) => (
    <button key={item.label} className={`nav-link ${page === item.label ? 'active' : ''}`} onClick={() => setPage(item.label)}>
      <Icon name={item.icon} /><span>{item.label}</span>
      {item.label === 'Recurring' && budget.entries.some((entry) => entry.recurring) && <span className="nav-count">{budget.entries.filter((entry) => entry.recurring).length}</span>}
    </button>
  )

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#" onClick={(event) => { event.preventDefault(); setPage('Overview') }}>
          <span className="brand-mark"><span /></span><span>nest<span className="brand-light">egg</span></span>
        </a>
        <div className="sidebar-caption">WORKSPACE</div>
        <nav className="main-nav" aria-label="Main navigation">
          {NAV_ITEMS.slice(0, 6).map(renderNavItem)}
          <div className="nav-group">
            <button
              className={`nav-link nav-group-toggle ${spendingPageIsActive ? 'active' : ''}`}
              aria-expanded={spendingsExpanded}
              aria-controls="spendings-submenu"
              onClick={() => setSpendingsExpanded((expanded) => !expanded)}
              title="Spendings"
            >
              <Icon name="list" /><span>Spendings</span><span className="nav-group-chevron"><Icon name="chevron" size={14} /></span>
            </button>
            <div className="nav-subitems" id="spendings-submenu" hidden={!spendingsExpanded}>
              {SPENDING_ITEMS.map((item) => <button
                key={item.label}
                className={`nav-link nav-sub-link ${page === item.label ? 'active' : ''}`}
                onClick={() => { setPage(item.label); setSpendingsExpanded(true) }}
                title={item.label}
              >
                <Icon name={item.icon} /><span>{item.label}</span>
              </button>)}
            </div>
          </div>
          {NAV_ITEMS.slice(6).map(renderNavItem)}
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
            <button className="button button-primary button-small" onClick={page === 'Family' || page === 'House' || page === 'Personal' || page === 'Car' ? () => openGroupedExpense(page) : () => openEntry()}><Icon name="plus" size={16} /> {page === 'Family' || page === 'House' || page === 'Personal' || page === 'Car' ? `Add ${page.toLowerCase()} expense` : 'Add item'}</button>
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
            </section>

            <section className="content-grid">
              <article className="panel forecast-panel">
                <div className="panel-heading"><div><span className="eyebrow">PLAN AHEAD</span><h2>Monthly outlook</h2><p>Income and expenses over the next six months</p></div><span className="forecast-tag"><Icon name="calendar" size={14} /> 6 months</span></div>
                {budget.entries.length === 0 && budget.accounts.length === 0
                  ? <EmptyState title="Your forecast starts here" description="Add a recurring income, an expense, or a bill to see your month-by-month outlook." action={<button className="button button-outline" onClick={() => openEntry('income')}><Icon name="plus" size={15} /> Add your first item</button>} />
                  : <><ForecastChart months={sixMonthForecast} currency={budget.currency} /><div className="forecast-footer"><span><i className="forecast-dot" /> Carried-net interest; deficit interest uses projected bank balance</span><strong className={sixMonthForecast[5].runningNet >= 0 ? 'positive' : 'negative'}>{formatMoney(sixMonthForecast[5].runningNet, budget.currency)}</strong></div></>}
              </article>

              <article className="panel balance-panel">
                <div className="panel-heading"><div><span className="eyebrow">THE BIG PICTURE</span><h2>Future perspective</h2><p>Your projected cash flow</p></div><span className="round-icon"><Icon name="trend" size={17} /></span></div>
                <div className="projection-number">{formatMoney(sixMonthForecast[5].runningNet, budget.currency)}</div>
                <div className="projection-caption">carried-net interest; deficit interest uses projected bank balance</div>
                <div className="projection-list">{sixMonthForecast.slice(0, 3).map((month) => <div className="projection-row" key={monthKey(month.date)}><span><i className="month-dot" />{formatMonth(month.date, { month: 'long', year: 'numeric' })}</span><strong className={month.net >= 0 ? 'positive' : 'negative'}>{month.net >= 0 ? '+' : ''}{formatMoney(month.net, budget.currency)}</strong></div>)}</div>
                <button className="text-link projection-link" onClick={() => setPage('Future Perspective')}>View 12-month perspective <Icon name="chevron" size={14} /></button>
              </article>
            </section>

            <section className="panel activity-panel">
              <div className="panel-heading activity-heading"><div><span className="eyebrow">YOUR MONEY MOVING</span><h2>Recent activity</h2></div><button className="text-link" onClick={() => setPage('Transactions')}>All transactions <Icon name="chevron" size={14} /></button></div>
              <EntryTable entries={visibleEntries} currency={budget.currency} onDelete={removeEntry} onEdit={editEntry} />
            </section>
          </>}

          {page === 'Future Perspective' && <>
            <section className="summary-grid future-summary" aria-label="12 month budget perspective">
              <article className="summary-card">
                <div className="summary-top"><span>Current bank balance</span><span className="summary-icon"><Icon name="wallet" /></span></div>
                <div className="summary-value">{formatMoney(totalBankBalance, budget.currency)}</div>
                <div className="summary-foot"><span>Combined current account balances</span></div>
              </article>
              <article className="summary-card">
                <div className="summary-top"><span>12-month accumulated net</span><span className="summary-icon income-icon"><Icon name="trend" /></span></div>
                <div className={`summary-value ${forecast[11].runningNet >= 0 ? 'positive' : 'negative'}`}>{formatMoney(forecast[11].runningNet, budget.currency)}</div>
                <div className="summary-foot"><span>Deficit interest uses projected bank balance</span></div>
              </article>
              <article className="summary-card summary-primary">
                <div className="summary-top"><span>Projected bank balance</span><span className="summary-icon"><Icon name="wallet" /></span></div>
                <div className="summary-value">{formatMoney(forecast[11].projectedBalance, budget.currency)}</div>
                <div className="summary-foot"><span>Current account balances + projected cash flow</span></div>
              </article>
            </section>

            {bankAccounts.length > 0 && <section className="panel future-panel bank-account-panel">
              <div className="panel-heading"><div><span className="eyebrow">CURRENT BALANCES</span><h2>Bank accounts</h2><p>Current balance snapshot; monthly projected amounts are entered separately in Monthly Overview.</p></div></div>
              <BankAccountRows accounts={bankAccounts} currency={budget.currency} />
            </section>}

            <section className="panel future-panel">
              <div className="panel-heading"><div><span className="eyebrow">MONTHLY CASH FLOW</span><h2>Income and expenses</h2><p>Positive carried net earns 4% monthly; carried deficits accrue 4% based on the previous projected bank balance. Bank balances start from current Accounts balances.</p></div><span className="forecast-tag"><Icon name="calendar" size={14} /> 12 months</span></div>
              <ForecastChart months={forecast} currency={budget.currency} />
            </section>

            <section className="panel future-panel">
              <div className="panel-heading"><div><span className="eyebrow">ACCUMULATED BALANCE</span><h2>Projected bank-account balance</h2><p>Starts with current balances set in Accounts and adds each month’s projected net cash flow.</p></div><span className="round-icon"><Icon name="trend" size={17} /></span></div>
              <div className="chart-legend"><span><i className="balance-legend" />Projected balance</span></div>
              <BalanceChart months={forecast} currency={budget.currency} />
            </section>

            <section className="panel future-panel future-table-panel">
              <div className="panel-heading"><div><span className="eyebrow">MONTH-BY-MONTH</span><h2>Detailed outlook</h2><p>Bank balance starts from account amounts set in Accounts and accumulates forecast net cash flow.</p></div></div>
              <div className="table-scroll"><table className="entry-table forecast-details-table"><thead><tr><th>MONTH</th><th className="amount-column">INCOME</th><th className="amount-column">EXPENSES</th><th className="amount-column">NET</th><th className="amount-column">BANK BALANCE</th></tr></thead><tbody>{forecast.map((month) => <tr key={monthKey(month.date)}><td>{formatMonth(month.date, { month: 'long', year: 'numeric' })}</td><td className="amount-column positive">{formatMoney(month.income, budget.currency)}</td><td className="amount-column negative">{formatMoney(month.expenses, budget.currency)}</td><td className={`amount-column ${month.net >= 0 ? 'positive' : 'negative'}`}>{month.net >= 0 ? '+' : ''}{formatMoney(month.net, budget.currency)}</td><td className="amount-column projected-balance-cell">{formatMoney(month.projectedBalance, budget.currency)}</td></tr>)}</tbody></table></div>
            </section>
          </>}

          {page === 'Monthly Overview' && <section className="monthly-overview-page">
            <div className="panel monthly-overview-intro">
              <div><span className="eyebrow">12-MONTH BREAKDOWN</span><h2>Month-by-month details</h2><p>Review forecast income, expenses, net cash flow, and projected bank balance for each month.</p></div>
              <span className="forecast-tag"><Icon name="calendar" size={14} /> 12 months</span>
            </div>
            {forecast.map((month) => <MonthlyOverviewCard key={monthKey(month.date)} month={month} currency={budget.currency} />)}
          </section>}

          {page === 'Transactions' && <section className="panel page-panel"><div className="panel-heading activity-heading"><div><span className="eyebrow">INCOME & EXPENSES</span><h2>All transactions</h2><p>{budget.entries.length} {budget.entries.length === 1 ? 'item' : 'items'} in your budget</p></div><button className="button button-primary button-small" onClick={() => openEntry()}><Icon name="plus" size={15} /> Add transaction</button></div><EntryTable entries={visibleEntries} currency={budget.currency} onDelete={removeEntry} onEdit={editEntry} showTotals /></section>}

          {page === 'Recurring' && <section className="panel page-panel"><div className="panel-heading activity-heading"><div><span className="eyebrow">REPEATS EACH MONTH</span><h2>Recurring items</h2><p>These are included in every future month from their start date.</p></div><button className="button button-primary button-small" onClick={() => openEntry('expense', true)}><Icon name="plus" size={15} /> Add recurring</button></div><EntryTable entries={visibleEntries} currency={budget.currency} onDelete={removeEntry} onEdit={editEntry} showTotals /></section>}

          {page === 'Salaries' && <section className="panel page-panel"><div className="panel-heading activity-heading"><div><span className="eyebrow">RECURRING INCOME</span><h2>Your salaries</h2><p>{visibleEntries.length} {visibleEntries.length === 1 ? 'salary' : 'salaries'} · Added to income every month from the start date.</p></div><button className="button button-primary button-small" onClick={openSalary}><Icon name="plus" size={15} /> Add salary</button></div>{visibleEntries.length === 0 ? <EmptyState title="No salaries added yet" description="Add a salary with its monthly amount, currency, and start date." action={<button className="button button-outline" onClick={openSalary}><Icon name="plus" size={15} /> Add salary</button>} /> : <EntryTable entries={visibleEntries} currency={budget.currency} onDelete={removeEntry} onEdit={editEntry} showTotals />}</section>}

          {(page === 'Family' || page === 'House' || page === 'Personal' || page === 'Car') && <section className="panel page-panel"><div className="panel-heading activity-heading"><div><span className="eyebrow">{page.toUpperCase()} EXPENSES</span><h2>{page} expenses</h2><p>{visibleEntries.length} {visibleEntries.length === 1 ? 'expense' : 'expenses'} · Monthly items can be scheduled for a chosen number of months.</p></div><button className="button button-primary button-small" onClick={() => openGroupedExpense(page)}><Icon name="plus" size={15} /> Add {page.toLowerCase()} expense</button></div>{visibleEntries.length === 0 ? <EmptyState title={`No ${page.toLowerCase()} expenses added yet`} description={`Track one-time and recurring expenses for your ${page.toLowerCase()}.`} action={<button className="button button-outline" onClick={() => openGroupedExpense(page)}><Icon name="plus" size={15} /> Add {page.toLowerCase()} expense</button>} /> : <EntryTable entries={visibleEntries} currency={budget.currency} onDelete={removeEntry} onEdit={editEntry} showTotals />}</section>}

          {page === 'Accounts' && <section className="panel page-panel"><div className="panel-heading activity-heading"><div><span className="eyebrow">BANK ACCOUNTS</span><h2>Your accounts</h2><p>{bankAccounts.length} {bankAccounts.length === 1 ? 'bank account' : 'bank accounts'} · Positive and negative balances are supported.</p></div><button className="button button-primary button-small" onClick={() => openAccount('Bank account')}><Icon name="plus" size={15} /> Add bank account</button></div>{bankAccounts.length === 0 ? <EmptyState title="No bank accounts added yet" description="Add a bank account and enter its current balance. Negative balances are supported for overdrafts." action={<button className="button button-outline" onClick={() => openAccount('Bank account')}><Icon name="plus" size={15} /> Add bank account</button>} /> : <AccountList accounts={bankAccounts} currency={budget.currency} entries={budget.entries} today={today} onDelete={removeAccount} onEdit={editBankAccount} />}</section>}

          {page === 'Loans' && <section className="panel page-panel"><div className="panel-heading activity-heading"><div><span className="eyebrow">BANK LOAN BALANCES</span><h2>Your bank loans</h2><p>{loans.length} {loans.length === 1 ? 'bank loan' : 'bank loans'} · Scheduled monthly payments stop after the selected period.</p></div><button className="button button-primary button-small" onClick={() => openAccount('Loan')}><Icon name="plus" size={15} /> Add bank loan</button></div>{loans.length === 0 ? <EmptyState title="No bank loans added yet" description="Add a bank loan with a monthly payment, first payment date, and number of payments." action={<button className="button button-outline" onClick={() => openAccount('Loan')}><Icon name="plus" size={15} /> Add bank loan</button>} /> : <AccountList accounts={loans} currency={budget.currency} entries={budget.entries} today={today} onDelete={removeAccount} onEdit={editLoan} />}</section>}

          {page === 'Credit cards' && <section className="panel page-panel"><div className="panel-heading activity-heading"><div><span className="eyebrow">CARD BALANCES</span><h2>Your credit cards</h2><p>{creditCards.length} {creditCards.length === 1 ? 'card' : 'cards'} · Current debt is projected once on the next payment date.</p></div><button className="button button-primary button-small" onClick={() => openAccount('Credit card')}><Icon name="plus" size={15} /> Add credit card</button></div>{creditCards.length === 0 ? <EmptyState title="No credit cards added yet" description="Add a credit card to track its current debt and monthly payment date." action={<button className="button button-outline" onClick={() => openAccount('Credit card')}><Icon name="plus" size={15} /> Add a credit card</button>} /> : <AccountList accounts={creditCards} currency={budget.currency} entries={budget.entries} today={today} onDelete={removeAccount} onEdit={editCreditCard} />}</section>}

          <footer className="page-footer"><span>Made for the everyday moments that add up.</span><span className={saveStatus === 'saving' ? 'save-pending' : saveStatus === 'error' ? 'save-failed' : ''}><i /> {saveStatus === 'saving' ? 'Saving to SQLite…' : saveStatus === 'error' ? 'Save failed' : 'Saved to local SQLite'}</span></footer>
        </div>
      </main>

      {modal === 'entry' && <Modal title={editingEntry ? `Edit ${editingEntry.category.toLowerCase()} expense` : expenseGroup ? `Add ${expenseGroup.toLowerCase()} expense` : 'Add budget item'} onClose={() => { setModal(null); setExpenseGroup(null); setEditingEntry(null) }}>
        <form className="form-stack" onSubmit={addEntry}>
          {!expenseGroup && !editingEntry && <div className="kind-toggle"><button type="button" className={entryKind === 'expense' ? 'selected expense-selected' : ''} onClick={() => setEntryKind('expense')}><Icon name="down" size={16} /> Expense</button><button type="button" className={entryKind === 'income' ? 'selected income-selected' : ''} onClick={() => setEntryKind('income')}><Icon name="arrow" size={16} /> Income</button></div>}
          <input type="hidden" name="kind" value={entryKind} />
          <label className="form-field"><span>Name</span><input name="title" defaultValue={editingEntry?.title} placeholder={expenseGroup === 'Family' ? 'e.g. School payments' : expenseGroup === 'House' ? 'e.g. Rent or utilities' : expenseGroup === 'Personal' ? 'e.g. Gym membership' : expenseGroup === 'Car' ? 'e.g. Fuel or insurance' : entryKind === 'expense' ? 'e.g. Electricity bill' : 'e.g. Monthly salary'} autoFocus required maxLength={80} /></label>
          <div className="form-row"><label className="form-field"><span>Amount</span><div className="amount-input"><span>{new Intl.NumberFormat(undefined, { style: 'currency', currency: budget.currency }).formatToParts(0).find((part) => part.type === 'currency')?.value}</span><AmountInput name="amount" label="Amount" defaultValue={editingEntry ? String(editingEntry.amount) : ''} required /></div></label>{expenseGroup ? <div className="form-field"><span>Category</span><span className="category-label">{expenseGroup}</span></div> : <label className="form-field"><span>Category</span><input name="category" defaultValue={editingEntry?.category} placeholder="e.g. Housing, Food" maxLength={40} /></label>}</div>
          <div className="form-row"><label className="form-field"><span>{entryKind === 'expense' ? 'First payment date' : 'Start date'}</span><input name="date" type="date" defaultValue={editingEntry?.date ?? toDateInput(today)} required /></label><label className="form-field"><span>Frequency</span><select name="frequency" value={entryFrequency} onChange={(event) => setEntryFrequency(event.target.value)}><option value="once">One time</option><option value="monthly">Monthly recurring</option></select></label></div>
          {(expenseGroup || editingEntry?.recurrenceCount !== undefined) && entryFrequency === 'monthly' && <label className="form-field"><span>Repeat for (months)</span><input name="recurrenceCount" type="number" min="1" step="1" placeholder="e.g. 10" defaultValue={editingEntry?.recurrenceCount} required /></label>}
          <div className="modal-note"><Icon name="repeat" size={16} /><span>{expenseGroup ? 'Monthly payments are included in your budget forecast for the number of months you choose.' : 'Recurring items are included in your six-month outlook from their start date.'}</span></div>
          <div className="modal-actions"><button type="button" className="button button-plain" onClick={() => { setModal(null); setExpenseGroup(null); setEditingEntry(null) }}>Cancel</button><button type="submit" className="button button-primary">{editingEntry ? 'Save changes' : `Add ${expenseGroup ? 'expense' : entryKind}`}</button></div>
        </form>
      </Modal>}

      {modal === 'salary' && <Modal title="Add salary" onClose={() => setModal(null)}>
        <form className="form-stack" onSubmit={addSalary}>
          <label className="form-field"><span>Salary name</span><input name="title" placeholder="e.g. Monthly salary" autoFocus required maxLength={80} /></label>
          <div className="form-row">
            <label className="form-field"><span>Amount</span><div className="amount-input"><span>{new Intl.NumberFormat(undefined, { style: 'currency', currency: salaryCurrency }).formatToParts(0).find((part) => part.type === 'currency')?.value}</span><AmountInput name="amount" label="Salary amount" required /></div></label>
            <label className="form-field"><span>Currency</span><select name="currency" value={salaryCurrency} onChange={(event) => changeSalaryCurrency(event.target.value)}>{CURRENCIES.map((currency) => <option key={currency} value={currency}>{currency}</option>)}</select></label>
          </div>
          {salaryCurrency !== budget.currency && <div className="form-field exchange-rate-status" aria-live="polite">
            {salaryRateStatus === 'loading' && <span>Getting current rate from Frankfurter…</span>}
            {salaryRateStatus === 'ready' && salaryExchangeRate !== null && <span>1 {salaryCurrency} = {new Intl.NumberFormat(undefined, { maximumSignificantDigits: 8 }).format(salaryExchangeRate)} {budget.currency}{salaryExchangeRateDate ? ` · Rate date ${salaryExchangeRateDate}` : ''}</span>}
            {salaryRateStatus === 'error' && <><span role="alert">{salaryRateError}</span><button type="button" className="text-link" onClick={retrySalaryRate}>Retry exchange rate</button></>}
          </div>}
          <label className="form-field"><span>First payment date</span><input name="date" type="date" defaultValue={toDateInput(today)} required /></label>
          <div className="modal-note"><Icon name="repeat" size={16} /><span>This salary repeats monthly. The latest rate is fetched from Frankfurter when you add it and saved with the salary for consistent forecasts.</span></div>
          <div className="modal-actions"><button type="button" className="button button-plain" onClick={() => setModal(null)}>Cancel</button><button type="submit" className="button button-primary" disabled={salaryRateStatus !== 'ready'}>Add salary</button></div>
        </form>
      </Modal>}

      {(modal === 'account' || modal === 'edit-account') && <Modal title={modal === 'edit-account' ? `Edit ${accountKind === 'Loan' ? 'bank loan' : accountKind === 'Credit card' ? 'credit card' : 'bank account'}` : `Add ${accountKind === 'Bank account' ? 'bank account' : accountKind === 'Loan' ? 'bank loan' : 'credit card'}`} onClose={() => { setModal(null); setEditingAccount(null) }}>
        <form className="form-stack" onSubmit={addAccount}>
          <input type="hidden" name="kind" value={accountKind} />
          <label className="form-field"><span>{accountKind === 'Bank account' ? 'Bank account name' : accountKind === 'Loan' ? 'Bank loan name' : 'Credit card name'}</span><input name="name" defaultValue={editingAccount?.name} placeholder={accountKind === 'Bank account' ? 'e.g. Everyday checking' : accountKind === 'Loan' ? 'e.g. Car loan' : 'e.g. Travel card'} autoFocus required maxLength={80} /></label>
          <label className="form-field"><span>{accountKind === 'Credit card' ? 'Current debt' : 'Current balance'}</span><AmountInput name="balance" label={accountKind === 'Credit card' ? 'Current debt' : 'Current balance'} defaultValue={editingAccount ? String(editingAccount.balance) : ''} allowNegative={accountKind === 'Bank account'} placeholder={accountKind === 'Bank account' ? 'e.g. -1.250,00' : '0,00'} required /></label>
          {accountKind === 'Loan' && <>
            <div className="form-row"><label className="form-field"><span>Monthly payment</span><AmountInput name="payment" label="Monthly payment" defaultValue={editingAccount?.kind === 'Loan' ? String(editingAccount.payment) : '0'} placeholder="0,00" required={accountKind === 'Loan'} /></label><label className="form-field"><span>Interest rate (APR %)</span><input name="apr" type="number" min="0" max="100" step="0.01" placeholder="0" defaultValue={editingAccount?.kind === 'Loan' ? String(editingAccount.apr) : '0'} /></label></div>
            <div className="form-row"><label className="form-field"><span>First payment date</span><input name="firstPaymentDate" type="date" defaultValue={editingAccount?.kind === 'Loan' ? budget.entries.find((entry) => entry.linkedAccountId === editingAccount.id)?.date ?? toDateInput(today) : toDateInput(today)} required /></label><label className="form-field"><span>Number of payments</span><input name="periodCount" type="number" min="1" step="1" placeholder="e.g. 60" defaultValue={editingAccount?.kind === 'Loan' && editingAccount.periodCount > 0 ? String(editingAccount.periodCount) : undefined} required /></label></div>
          </>}
          {accountKind === 'Credit card' && <label className="form-field"><span>Payment date (day of month)</span><input name="dueDay" type="number" min="1" max="31" defaultValue={editingAccount?.kind === 'Credit card' ? String(editingAccount.dueDay) : '1'} required /></label>}
          <div className="modal-note"><Icon name="calendar" size={16} /><span>{accountKind === 'Bank account' ? 'Enter a negative balance to show an overdraft. Bank balances do not count as debt payments in the forecast.' : accountKind === 'Loan' ? 'A recurring expense will be created for the selected number of monthly payments and will stop automatically. Interest is for reference only.' : 'The current debt is forecast as a one-time payment on the next payment date.'}</span></div>
          <div className="modal-actions"><button type="button" className="button button-plain" onClick={() => { setModal(null); setEditingAccount(null) }}>Cancel</button><button type="submit" className="button button-primary">{editingAccount ? 'Save changes' : `Add ${accountKind === 'Bank account' ? 'bank account' : accountKind === 'Loan' ? 'bank loan' : 'credit card'}`}</button></div>
        </form>
      </Modal>}
    </div>
  )
}

function MonthlyOverviewCard({ month, currency }: { month: ForecastMonth; currency: string }) {
  return <article className="panel monthly-overview-card">
    <header className="monthly-overview-heading">
      <h2>{formatMonth(month.date, { month: 'long', year: 'numeric' })}</h2>
      <div className="monthly-overview-totals">
        <div><span>Income</span><strong className="positive">{formatMoney(month.income, currency)}</strong></div>
        <div><span>Expenses</span><strong className="negative">{formatMoney(month.expenses, currency)}</strong></div>
        <div><span>Net cash flow</span><strong className={month.net >= 0 ? 'positive' : 'negative'}>{month.net >= 0 ? '+' : '−'}{formatMoney(Math.abs(month.net), currency)}</strong></div>
        <div><span>Projected bank balance</span><strong className={month.projectedBalance < 0 ? 'negative' : 'positive'}>{formatMoney(month.projectedBalance, currency)}</strong></div>
      </div>
    </header>
    <div className="monthly-overview-details">
      <MonthlyOverviewItems title="Income details" items={month.incomeItems} currency={currency} emptyMessage="No income scheduled this month." />
      <MonthlyOverviewItems title="Expense details" items={month.expenseItems} currency={currency} emptyMessage="No expenses scheduled this month." />
    </div>
  </article>
}

function BankAccountRows({ accounts, currency }: { accounts: Account[]; currency: string }) {
  return <ul className="bank-account-rows">{accounts.map((account) => <li key={account.id}>
    <span>{account.name}</span>
    <strong className={account.balance < 0 ? 'negative' : 'positive'}>{formatMoney(account.balance, currency)}</strong>
  </li>)}</ul>
}

function MonthlyOverviewItems({ title, items, currency, emptyMessage }: { title: string; items: ForecastItem[]; currency: string; emptyMessage: string }) {
  const groupedExpenses = title === 'Expense details'
    ? groupMonthlyExpenses(items)
    : []

  return <section className="monthly-overview-items">
    <h3>{title}<span>{items.length}</span></h3>
    {items.length === 0
      ? <p className="monthly-overview-empty">{emptyMessage}</p>
      : title === 'Expense details'
        ? <div className="monthly-expense-groups">{groupedExpenses.map((group) => <section className="monthly-expense-group" key={group.name}>
          <h4><span>{group.name}<small>{group.items.length} {group.items.length === 1 ? 'item' : 'items'}</small></span><strong>{formatMoney(group.total, currency)}</strong></h4>
          <ul>{group.items.map((item) => <li key={item.id}>
            <span className="monthly-item-description"><strong>{item.title}</strong><small>{item.category} · {new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(item.date)}</small></span>
            <strong className="negative">−{formatMoney(item.amount, currency)}</strong>
          </li>)}</ul>
        </section>)}</div>
        : <ul>{items.map((item) => <li key={item.id}>
          <span className="monthly-item-description"><strong>{item.title}</strong><small>{item.category} · {new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(item.date)}</small></span>
          <strong className="positive">+{formatMoney(item.amount, currency)}</strong>
        </li>)}</ul>}
  </section>
}

function groupMonthlyExpenses(items: ForecastItem[]) {
  const groupOrder = ['House', 'Family', 'Personal', 'Car', 'Loans', 'Credit cards', 'Interest', 'Other']
  const grouped = new Map<string, ForecastItem[]>()

  for (const item of items) {
    const group = item.category === 'Kids' ? 'Family'
      : item.category === 'House' || item.category === 'Family' || item.category === 'Personal' || item.category === 'Car'
        ? item.category
        : item.category === 'Loan repayment' ? 'Loans'
          : item.category === 'Credit card payment' ? 'Credit cards'
            : item.category === 'Interest' ? 'Interest'
              : 'Other'
    grouped.set(group, [...(grouped.get(group) ?? []), item])
  }

  return groupOrder.flatMap((name) => {
    const groupItems = grouped.get(name)
    return groupItems
      ? [{ name, items: groupItems, total: groupItems.reduce((sum, item) => sum + item.amount, 0) }]
      : []
  })
}

function EntryTable({ entries, currency, onDelete, onEdit, showTotals = false }: { entries: Entry[]; currency: string; onDelete: (id: string) => void; onEdit: (entry: Entry) => void; showTotals?: boolean }) {
  if (entries.length === 0) return <EmptyState title="Nothing to show yet" description="Add an income or expense to start building your household budget." action={null} />

  const totals = entries.reduce((result, entry) => {
    result[entry.kind] += entry.amount
    return result
  }, { income: 0, expense: 0 })
  const shownKinds = [...new Set(entries.map((entry) => entry.kind))]

  return <div className="table-scroll"><table className="entry-table"><thead><tr><th>DESCRIPTION</th><th>CATEGORY</th><th>DATE</th><th>FREQUENCY</th><th className="amount-column">AMOUNT</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{entries.map((entry) => <tr key={entry.id}><td><span className={`entry-symbol ${entry.kind}`}><Icon name={entry.kind === 'income' ? 'arrow' : 'down'} size={16} /></span><span className="entry-title"><strong>{entry.title}</strong><small>{entry.exchangeRate && entry.currency && entry.currency !== currency ? `Salary rate · 1 ${entry.currency} = ${new Intl.NumberFormat(undefined, { maximumSignificantDigits: 8 }).format(entry.exchangeRate)} ${currency}${entry.exchangeRateDate ? ` · ${entry.exchangeRateDate}` : ''}` : entry.kind === 'income' ? 'Income' : 'Expense'}</small></span></td><td><span className="category-label">{entry.category === 'Kids' ? 'Family' : entry.category || 'Other'}</span></td><td>{new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(dateFromInput(entry.date))}</td><td>{entry.recurring ? <span className="frequency"><Icon name="repeat" size={13} /> {entry.recurrenceCount ? `Monthly · ${entry.recurrenceCount} ${entry.category === 'Family' || entry.category === 'Kids' || entry.category === 'House' ? 'months' : 'payments'}` : 'Monthly'}</span> : <span className="frequency-once">One time</span>}</td><td className={`amount-column ${entry.kind === 'income' ? 'positive' : 'negative'}`}>{entry.kind === 'income' ? '+' : '−'}{formatMoney(entry.sourceAmount ?? entry.amount, entry.currency ?? currency)}</td><td><span className="entry-actions">{entry.kind === 'expense' && !entry.linkedAccountId && <button className="icon-button" aria-label={`Edit ${entry.title}`} onClick={() => onEdit(entry)}><Icon name="edit" size={15} /></button>}<button className="icon-button delete-button" aria-label={`Delete ${entry.title}`} onClick={() => onDelete(entry.id)}><Icon name="trash" size={15} /></button></span></td></tr>)}</tbody>{showTotals && <tfoot>{shownKinds.map((kind) => <tr key={kind}><th colSpan={4}>Total {kind === 'income' ? 'income' : 'expenses'} <span>({currency})</span></th><td className={`amount-column ${kind === 'income' ? 'positive' : 'negative'}`}>{formatMoney(totals[kind], currency)}</td><td /></tr>)}</tfoot>}</table></div>
}

function AccountList({ accounts, currency, entries, today, onDelete, onEdit }: { accounts: Account[]; currency: string; entries: Entry[]; today: Date; onDelete: (id: string) => void; onEdit?: (account: Account) => void }) {
  const total = accounts.reduce((sum, account) => sum + account.balance, 0)
  const accountKind = accounts[0]?.kind
  const totalLabel = accountKind === 'Loan'
    ? 'Total loan balance'
    : accountKind === 'Credit card'
      ? 'Total credit card debt'
      : 'Total bank-account balance'

  return <>
    <div className="account-list">{accounts.map((account) => <article className="account-row" key={account.id}>
      <span className={`account-symbol ${account.kind === 'Loan' ? 'loan-symbol' : account.kind === 'Bank account' ? 'bank-symbol' : 'card-symbol'}`}><Icon name={account.kind === 'Credit card' ? 'card' : 'wallet'} size={19} /></span>
      <div className="account-name"><strong>{account.name}</strong><span>{account.kind === 'Loan' ? `Bank loan · ${account.apr}% APR · ${remainingLoanPayments(account, entries, today) === null ? 'Ongoing payments' : `${remainingLoanPayments(account, entries, today)} payments left`}` : account.kind === 'Credit card' ? 'Credit card' : account.kind}</span></div>
      {account.kind === 'Loan' && <div className="account-payment"><span>Monthly payment</span><strong>{formatMoney(account.payment, currency)}</strong></div>}
      {account.kind === 'Credit card' && <div className="account-payment"><span>Payment date</span><strong>Day {account.dueDay}</strong></div>}
      <div className="account-balance"><span>{account.kind === 'Credit card' ? 'Current debt' : account.balance < 0 ? 'Overdrawn' : 'Balance'}</span><strong className={account.balance < 0 ? 'negative' : ''}>{formatMoney(account.balance, currency)}</strong></div>
      {(account.kind === 'Bank account' || account.kind === 'Loan' || account.kind === 'Credit card') && onEdit && <button className="icon-button" aria-label={`Edit ${account.name}`} onClick={() => onEdit(account)}><Icon name="edit" size={16} /></button>}
      <button className="icon-button delete-button" aria-label={`Remove ${account.name}`} onClick={() => onDelete(account.id)}><Icon name="trash" size={16} /></button>
    </article>)}</div>
    {accountKind && <div className="account-total"><strong>{totalLabel}</strong><strong className={total < 0 ? 'negative' : ''}>{formatMoney(total, currency)}</strong></div>}
  </>
}

export default App
