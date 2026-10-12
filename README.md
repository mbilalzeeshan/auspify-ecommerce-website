# Bazaarly - E-Commerce Website

A full-stack e-commerce web application built for the Auspify Technologies
Full Stack Development internship. Customers can browse a product catalog,
search and filter, manage a server-side cart as a guest or logged-in user,
check out, and review their order history. An admin panel supports full
product management.

## Features

- Product catalog with search (`?search=`) and category filtering (`?category=`)
- Product detail pages with stock indicators and CSS-only product tiles
  (gradient backgrounds with the product initial, colored per category)
- Server-side shopping cart:
  - Guests get a cart id persisted in localStorage and sent via the
    `X-Cart-Id` header (or a `cartId` body field)
  - Logged-in users get their cart tied to their account, with guest-cart
    merging on login
  - Add, update quantity, remove single item, clear whole cart
- Checkout: validates stock inside a transaction, decrements stock,
  records the order, and clears the cart
- Order history per logged-in user
- User accounts: registration and login with salted scrypt password hashing
  (`node:crypto`), Bearer token sessions
- Admin-only product management: create, update, delete (403 for non-admins,
  401 when logged out)
- Responsive storefront: usable at 375px mobile width
- Zero network dependencies: no CDNs, no external images, no web fonts;
  works fully offline after `npm install`

## Tech Stack

- Backend: Node.js + Express, serving the REST API and the static frontend
- Persistence: SQLite via `better-sqlite3`; if the native module fails to
  build in an environment, the app automatically falls back to a JSON-file
  data layer (`data/bazaarly-data.json`) with identical API behavior
- Frontend: vanilla HTML, custom CSS, vanilla JavaScript (single-page app
  with hash routing). System fonts only.

## Setup

```bash
npm install
npm start
```

The server listens on `process.env.PORT` or port **3003** by default:
http://localhost:3003

On first boot the database is seeded with 16 products across five
categories, plus the demo accounts below.

## Demo Credentials

| Role  | Email              | Password  |
|-------|--------------------|-----------|
| User  | demo@example.com   | demo123   |
| Admin | admin@example.com  | admin123  |

The admin panel link appears in the header after logging in as
`admin@example.com`.

## API Reference

Base URL: `http://localhost:3003/api`

### Catalog (public)

| Method | Path                 | Description                                   | Auth |
|--------|----------------------|-----------------------------------------------|------|
| GET    | /api/products        | List products. Optional `?search=` and `?category=` | No   |
| GET    | /api/products/:id    | Product detail                                | No   |
| GET    | /api/categories      | Distinct category names                       | No   |

### Auth

| Method | Path              | Description                                  | Auth |
|--------|-------------------|----------------------------------------------|------|
| POST   | /api/auth/register | Register. Body: `{email, name, password, cartId?}`. Returns `{token, user}` | No |
| POST   | /api/auth/login    | Login. Body: `{email, password, cartId?}`. Returns `{token, user}` and merges the guest cart | No |
| POST   | /api/auth/logout   | Invalidate the current session token          | Bearer token |
| GET    | /api/auth/me       | Current user profile                          | Bearer token |

### Cart (guests + users)

Guests pass their cart id in the `X-Cart-Id` header (or a `cartId` body
field). If absent, the server mints one and returns it in the `X-Cart-Id`
response header and the JSON body. Logged-in users always use their
account cart.

| Method | Path                      | Description                                   | Auth |
|--------|---------------------------|-----------------------------------------------|------|
| GET    | /api/cart                 | Current cart: items, total, count             | No (guest or token) |
| POST   | /api/cart/items           | Add to cart. Body: `{productId, qty}`         | No (guest or token) |
| PUT    | /api/cart/items/:productId| Set quantity. Body: `{qty}` (0 removes)      | No (guest or token) |
| DELETE | /api/cart/items/:productId| Remove one item                               | No (guest or token) |
| DELETE | /api/cart                 | Clear the whole cart                          | No (guest or token) |

### Orders

| Method | Path         | Description                                   | Auth |
|--------|--------------|-----------------------------------------------|------|
| POST   | /api/orders  | Checkout. Body: `{name, address, phone}`. Validates stock, decrements it, clears the cart | No (guest orders allowed) |
| GET    | /api/orders  | Own order history, newest first               | Bearer token |

### Admin (product management)

| Method | Path                 | Description                                   | Auth |
|--------|----------------------|-----------------------------------------------|------|
| POST   | /api/products        | Create product. Body: `{name, description, price, category, stock}` | Admin (403 otherwise) |
| PUT    | /api/products/:id    | Update product fields                         | Admin (403 otherwise) |
| DELETE | /api/products/:id    | Delete product                                | Admin (403 otherwise) |

Error responses are JSON: `{ "error": "message" }` with status codes
400 (validation), 401 (login required), 403 (admin required),
404 (not found), 409 (conflict, e.g. insufficient stock).

## Project Structure

```
ecommerce-website/
  server.js          Express app: routes, auth middleware, cart handling
  db.js              Data layer: better-sqlite3 with a JSON-file fallback,
                     schema creation, and first-run seeding
  auth.js            Salted scrypt password hashing and session tokens
                     (node:crypto only)
  package.json       start script: node server.js
  .gitignore         Excludes node_modules and *.db / *.sqlite* files
  README.md          This file
  public/
    index.html       Storefront shell
    styles.css       Custom responsive styling (no frameworks)
    app.js           Single-page app: routing, shop, cart, checkout,
                     orders, login/register, admin panel
```

Prices are stored as integer rupees. Stock is validated both when adding
to the cart and atomically at checkout.
