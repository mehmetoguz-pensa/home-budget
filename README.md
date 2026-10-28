# Nestegg — Home budget

A local-first household budget planner for tracking income, expenses, recurring monthly items, loans, and credit cards. No account or login is needed.

## Run locally

Requirements: Node.js 22.5 or later (for the built-in SQLite module).

```sh
npm install
npm run dev
```

Open the Vite URL printed in the terminal. The development command starts the frontend and the SQLite API together. To create a production frontend and run it with the API:

```sh
npm run build
npm start
```

The production server listens on `http://127.0.0.1:3001` by default and serves both the built app and its API. Configure `HOST` and `PORT` to change the bind address and port.

Run the API persistence tests with `npm test`.

## What it does

- Track one-time or monthly recurring income and expenses, with custom names and categories.
- Edit expense amounts, dates, categories, and recurrence settings from transaction and expense lists.
- Browse House, Family, Personal, and Car expense pages under the collapsible Spendings menu.
- Manage salaries in a dedicated section; salaries repeat monthly and use a live exchange rate for forecasts.
- Track one-time and monthly family, house, personal, and car expenses in dedicated sections, with a chosen month count for recurring items.
- View income and expense totals at the bottom of the transaction, recurring, salary, family, house, personal, and car lists; totals are shown in the selected budget currency.
- See monthly income, expenses, debt payments, rolling cash flow, and bank-balance-based deficit interest.
- Use Future Perspective for 12 monthly income/expense graphs and a month-by-month breakdown.
- Use Monthly Overview to inspect each of the next 12 months, including itemized income, expenses grouped by spending type, monthly net, and projected bank balance.
- Manage bank accounts, bank loans, and credit cards in separate left-menu sections.
- Track positive or negative bank-account balances, bank-loan terms, and credit-card debt with a monthly payment date.
- Schedule each bank loan's monthly repayment from its first payment date for a chosen number of payments.
- Enter monetary values with live dot-separated thousands and comma decimals (for example, `1.234,56`).
- Choose a display currency and remove budget items or accounts.

The forecast repeats monthly entries from their start dates; a salary is recurring income converted to the budget currency using a rate fetched from the free Frankfurter API when the salary is added. That rate and its effective date are saved with the salary so forecasts remain consistent; adding a salary sends the currency pair but not its amount to Frankfurter. A bank loan creates a linked recurring expense that ends after its selected payment count. A credit card's current debt is forecast as a one-time payment on its next monthly payment date. A one-time item is included only in the month it is dated. Positive accumulated forecast net earns 4% monthly interest. When the prior projected bank balance is negative, the carried deficit accrues 4% interest based on that projected bank balance; the resulting charge is included in forecast expenses and updates subsequent projected bank balances. Edit current bank-account balances only in Accounts. Future bank balances start with the current combined account balance and accumulate projected net cash flow by month. Loan APR is informational and is not used to estimate interest or payoff dates.

## SQLite data and privacy

The app writes budget data to `data/home-budget.sqlite` on the machine running the server. The SQLite database is created automatically and is excluded from Git. Set `BUDGET_DB_PATH` to store it at another path. Back up that database file to back up your budget.

The browser communicates with the local API; budget records are not saved in browser storage and are not sent to a third-party service. Any device that can reach the server may access its budget, because the app intentionally has no login or access control. Keep the server on a trusted network. For a future cloud deployment, add authentication and access controls, secure the API, and choose durable storage appropriate to the hosting environment.
