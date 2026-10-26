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
- See monthly income, expenses, debt payments, and a rolling six-month cash-flow forecast.
- Manage bank accounts, bank loans, and credit cards in separate left-menu sections.
- Track positive or negative bank-account balances, plus loan and credit-card balances, APR, and monthly payment.
- Schedule each bank loan's monthly repayment from its first payment date for a chosen number of payments.
- Enter monetary values with live dot-separated thousands and comma decimals (for example, `1.234,56`).
- Choose a display currency and remove budget items or accounts.

The forecast repeats monthly entries from their start dates; a bank loan creates a linked recurring expense that ends after its selected payment count. Credit-card payments are included in each forecast month. A one-time item is included only in the month it is dated. The six-month net is the cumulative difference between forecast income and expenses; it does not assume a starting bank balance. Bank account balances are tracked separately and do not count as debt or change that forecast. APR is informational and is not used to estimate interest or payoff dates.

## SQLite data and privacy

The app writes budget data to `data/home-budget.sqlite` on the machine running the server. The SQLite database is created automatically and is excluded from Git. Set `BUDGET_DB_PATH` to store it at another path. Back up that database file to back up your budget.

The browser communicates with the local API; budget records are not saved in browser storage and are not sent to a third-party service. Any device that can reach the server may access its budget, because the app intentionally has no login or access control. Keep the server on a trusted network. For a future cloud deployment, add authentication and access controls, secure the API, and choose durable storage appropriate to the hosting environment.
