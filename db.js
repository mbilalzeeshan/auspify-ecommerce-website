// db.js - data layer for Bazaarly.
//
// Uses better-sqlite3 when the native module is available, and falls back
// to a plain JSON file store with IDENTICAL behavior when it is not.
// Server code only ever talks to the exported functions, so it never has
// to care which storage mode is active.
//
// The exported "mode" string is "sqlite" or "json".

const path = require('node:path');
const fs = require('node:fs');

const DB_PATH = path.join(__dirname, 'bazaarly.db');
const JSON_PATH = path.join(__dirname, 'data', 'bazaarly-data.json');

let sqlite = null;
try {
  // NOTE: requiring better-sqlite3 does not touch the native binding.
  // The binding is only resolved inside the Database constructor, so we
  // must probe it here; otherwise a broken native build would crash the
  // server later instead of falling back to the JSON store.
  const Database = require('better-sqlite3');
  const probe = new Database(':memory:');
  probe.close();
  sqlite = Database;
} catch (err) {
  console.log('[db] better-sqlite3 unavailable (' + (err && err.message && err.message.split('\n')[0]) + '), using JSON file store');
}

const mode = sqlite ? 'sqlite' : 'json';

// ---------------------------------------------------------------------------
// Seed catalog: realistic products, no placeholder text.
// ---------------------------------------------------------------------------
function seedProducts() {
  return [
    { name: 'VoltPods Pro Wireless Earbuds', description: 'Bluetooth 5.3 true-wireless earbuds with active noise cancellation, 36-hour total battery life, and touch controls.', price: 4999, category: 'Electronics', stock: 24 },
    { name: 'PixelForge 65W GaN Fast Charger', description: 'Compact gallium-nitride wall charger with two USB-C and one USB-A port, safe for laptops, phones, and tablets.', price: 3299, category: 'Electronics', stock: 40 },
    { name: 'Lumina Mechanical Keyboard', description: 'Tenkeyless mechanical keyboard with tactile switches, per-key RGB, and hot-swappable keycaps for custom builds.', price: 7499, category: 'Electronics', stock: 15 },
    { name: 'Essential Cotton T-Shirt (3-Pack)', description: 'Three breathable 100% cotton crew-neck tees in white, black, and navy. Pre-shrunk and tag-free.', price: 1899, category: 'Clothing', stock: 60 },
    { name: 'Trailhead Denim Jacket', description: 'Classic mid-weight denim trucker jacket with a relaxed fit and copper hardware. Ages well with every wash.', price: 5499, category: 'Clothing', stock: 18 },
    { name: 'Cloudstep Running Sneakers', description: 'Lightweight knit running shoes with cushioned foam midsoles and reflective details for evening runs.', price: 6999, category: 'Clothing', stock: 30 },
    { name: 'HerbGarden Ceramic Planter Set', description: 'Set of three glazed ceramic planters with drainage holes and bamboo trays, sized for kitchen herbs.', price: 2499, category: 'Home & Kitchen', stock: 35 },
    { name: 'ChefLine Stainless Steel Knife Set', description: 'Five-piece German steel knife set with ergonomic handles, honing rod, and a wooden storage block.', price: 8999, category: 'Home & Kitchen', stock: 12 },
    { name: 'GlowRest LED Desk Lamp', description: 'Dimmable LED desk lamp with five color temperatures, a USB charging port, and a fold-flat arm.', price: 2799, category: 'Home & Kitchen', stock: 28 },
    { name: 'The Startup Playbook', description: 'A practical 320-page guide to launching a company, covering validation, funding, and early growth tactics.', price: 1499, category: 'Books', stock: 50 },
    { name: 'Deep Work: Rules for Focus', description: 'A bestselling book on building concentration habits and producing meaningful work in a distracted world.', price: 1299, category: 'Books', stock: 45 },
    { name: 'JavaScript: The Definitive Guide', description: 'Comprehensive 700-page reference covering modern JavaScript, the DOM, and Node.js fundamentals.', price: 3499, category: 'Books', stock: 20 },
    { name: 'ProGrip Yoga Mat', description: 'Extra-thick 6mm non-slip yoga mat with alignment lines and a carry strap. Sweat-resistant surface.', price: 2199, category: 'Sports', stock: 33 },
    { name: 'Velocity Resistance Band Set', description: 'Five stackable resistance bands from light to extra-heavy, with handles, ankle straps, and a door anchor.', price: 1799, category: 'Sports', stock: 42 },
    { name: 'Strider Insulated Water Bottle', description: '750ml double-wall vacuum-insulated steel bottle. Keeps drinks cold 24 hours, hot 12 hours.', price: 1599, category: 'Sports', stock: 55 },
    { name: 'Summit Trail Backpack 30L', description: 'Durable 30-liter daypack with padded hip belt, rain cover, and a ventilated back panel for long hikes.', price: 4799, category: 'Sports', stock: 16 },
  ];
}

// ---------------------------------------------------------------------------
// SQLite backend
// ---------------------------------------------------------------------------
function makeSqliteStore() {
  const db = sqlite(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      price INTEGER NOT NULL,
      category TEXT NOT NULL,
      stock INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS cart_items (
      owner TEXT NOT NULL,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      qty INTEGER NOT NULL,
      PRIMARY KEY (owner, product_id)
    );
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      address TEXT NOT NULL,
      phone TEXT NOT NULL,
      total INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS order_items (
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      price INTEGER NOT NULL,
      qty INTEGER NOT NULL,
      PRIMARY KEY (order_id, product_id)
    );
  `);

  const seed = db.transaction(() => {
    const count = db.prepare('SELECT COUNT(*) AS n FROM products').get().n;
    if (count > 0) return;
    const { hashPassword } = require('./auth');
    const insP = db.prepare('INSERT INTO products (name, description, price, category, stock) VALUES (?, ?, ?, ?, ?)');
    for (const p of seedProducts()) {
      insP.run(p.name, p.description, p.price, p.category, p.stock);
    }
    const insU = db.prepare('INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, ?)');
    insU.run('demo@example.com', 'Demo User', hashPassword('demo123'), 'user');
    insU.run('admin@example.com', 'Store Admin', hashPassword('admin123'), 'admin');
    console.log('[db] seeded 16 products + demo/admin users (sqlite)');
  });
  seed();

  const store = {};

  store.getUserByEmail = (email) =>
    db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).toLowerCase().trim());

  store.createUser = ({ email, name, password_hash, role }) => {
    const info = db.prepare('INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, ?)')
      .run(String(email).toLowerCase().trim(), name, password_hash, role || 'user');
    return db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  };

  store.createSession = (userId, token) =>
    db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(token, userId);

  store.getSessionUser = (token) =>
    db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?').get(token);

  store.deleteSession = (token) => db.prepare('DELETE FROM sessions WHERE token = ?').run(token);

  store.listProducts = ({ search, category }) => {
    let sql = 'SELECT * FROM products';
    const conds = [];
    const params = [];
    if (category) { conds.push('category = ?'); params.push(category); }
    if (search) { conds.push('(name LIKE ? OR description LIKE ?)'); params.push('%' + search + '%', '%' + search + '%'); }
    if (conds.length) sql += ' WHERE ' + conds.join(' AND ');
    sql += ' ORDER BY id';
    return db.prepare(sql).all(...params);
  };

  store.getProduct = (id) => db.prepare('SELECT * FROM products WHERE id = ?').get(Number(id));

  store.createProduct = ({ name, description, price, category, stock }) => {
    const info = db.prepare('INSERT INTO products (name, description, price, category, stock) VALUES (?, ?, ?, ?, ?)')
      .run(name, description || '', Math.round(Number(price)), category, Math.max(0, Math.round(Number(stock))));
    return store.getProduct(info.lastInsertRowid);
  };

  store.updateProduct = (id, fields) => {
    const allowed = ['name', 'description', 'price', 'category', 'stock'];
    const sets = [];
    const params = [];
    for (const key of allowed) {
      if (fields[key] === undefined) continue;
      let val = fields[key];
      if (key === 'price') val = Math.round(Number(val));
      if (key === 'stock') val = Math.max(0, Math.round(Number(val)));
      sets.push(key + ' = ?');
      params.push(val);
    }
    if (!sets.length) return store.getProduct(id);
    params.push(Number(id));
    db.prepare('UPDATE products SET ' + sets.join(', ') + ' WHERE id = ?').run(...params);
    return store.getProduct(id);
  };

  store.deleteProduct = (id) => {
    const info = db.prepare('DELETE FROM products WHERE id = ?').run(Number(id));
    return info.changes > 0;
  };

  store.listCategories = () =>
    db.prepare('SELECT DISTINCT category FROM products ORDER BY category').all().map((r) => r.category);

  store.getCartItems = (owner) =>
    db.prepare('SELECT ci.product_id, ci.qty, p.name, p.price, p.category, p.stock FROM cart_items ci JOIN products p ON p.id = ci.product_id WHERE ci.owner = ? ORDER BY ci.product_id').all(owner);

  store.setCartItem = (owner, productId, qty) => {
    if (qty <= 0) return store.deleteCartItem(owner, productId);
    db.prepare('INSERT INTO cart_items (owner, product_id, qty) VALUES (?, ?, ?) ON CONFLICT(owner, product_id) DO UPDATE SET qty = excluded.qty')
      .run(owner, Number(productId), Math.round(qty));
    return true;
  };

  store.deleteCartItem = (owner, productId) => {
    const info = db.prepare('DELETE FROM cart_items WHERE owner = ? AND product_id = ?').run(owner, Number(productId));
    return info.changes > 0;
  };

  store.clearCart = (owner) => db.prepare('DELETE FROM cart_items WHERE owner = ?').run(owner);

  // Checkout runs inside a transaction: validates stock, decrements it,
  // writes the order, and clears the cart atomically.
  store.createOrder = ({ userId, name, address, phone, items }) => {
    const txn = db.transaction(() => {
      let total = 0;
      for (const item of items) {
        const p = db.prepare('SELECT * FROM products WHERE id = ?').get(item.product_id);
        if (!p) throw Object.assign(new Error('Product no longer exists: ' + item.product_id), { code: 'MISSING_PRODUCT' });
        if (p.stock < item.qty) throw Object.assign(new Error('Not enough stock for "' + p.name + '" (have ' + p.stock + ')'), { code: 'INSUFFICIENT_STOCK' });
        total += p.price * item.qty;
      }
      const orderInfo = db.prepare('INSERT INTO orders (user_id, name, address, phone, total) VALUES (?, ?, ?, ?, ?)')
        .run(userId === null || userId === undefined ? null : userId, name, address, phone, total);
      const orderId = orderInfo.lastInsertRowid;
      const insItem = db.prepare('INSERT INTO order_items (order_id, product_id, name, price, qty) VALUES (?, ?, ?, ?, ?)');
      const decStock = db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?');
      for (const item of items) {
        const p = db.prepare('SELECT * FROM products WHERE id = ?').get(item.product_id);
        insItem.run(orderId, p.id, p.name, p.price, item.qty);
        decStock.run(item.qty, p.id);
      }
      return orderId;
    });
    const orderId = txn();
    return store.getOrder(orderId);
  };

  store.getOrder = (id) => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(id));
    if (!order) return null;
    order.items = db.prepare('SELECT product_id, name, price, qty FROM order_items WHERE order_id = ?').all(order.id);
    return order;
  };

  store.listOrders = (userId) => {
    const orders = db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC').all(userId);
    const getItems = db.prepare('SELECT product_id, name, price, qty FROM order_items WHERE order_id = ?');
    for (const o of orders) o.items = getItems.all(o.id);
    return orders;
  };

  return store;
}

// ---------------------------------------------------------------------------
// JSON file backend (used only if better-sqlite3 cannot load)
// ---------------------------------------------------------------------------
function makeJsonStore() {
  fs.mkdirSync(path.dirname(JSON_PATH), { recursive: true });

  let data;
  if (fs.existsSync(JSON_PATH)) {
    data = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
  } else {
    data = { users: [], sessions: [], products: [], cart_items: [], orders: [], order_items: [], seq: { users: 1, products: 1, orders: 1 } };
  }

  const save = () => fs.writeFileSync(JSON_PATH, JSON.stringify(data, null, 2));
  const nextId = (table) => data.seq[table]++;

  const store = {};

  store.seed = (hashPassword) => {
    if (data.products.length > 0) return;
    for (const p of seedProducts()) {
      data.products.push(Object.assign({ id: nextId('products'), created_at: new Date().toISOString() }, p));
    }
    data.users.push({ id: nextId('users'), email: 'demo@example.com', name: 'Demo User', password_hash: hashPassword('demo123'), role: 'user', created_at: new Date().toISOString() });
    data.users.push({ id: nextId('users'), email: 'admin@example.com', name: 'Store Admin', password_hash: hashPassword('admin123'), role: 'admin', created_at: new Date().toISOString() });
    save();
    console.log('[db] seeded 16 products + demo/admin users (json)');
  };

  store.getUserByEmail = (email) =>
    data.users.find((u) => u.email === String(email).toLowerCase().trim());

  store.createUser = ({ email, name, password_hash, role }) => {
    const user = { id: nextId('users'), email: String(email).toLowerCase().trim(), name, password_hash, role: role || 'user', created_at: new Date().toISOString() };
    data.users.push(user);
    save();
    return user;
  };

  store.createSession = (userId, token) => {
    data.sessions.push({ token, user_id: userId, created_at: new Date().toISOString() });
    save();
  };

  store.getSessionUser = (token) => {
    const s = data.sessions.find((x) => x.token === token);
    if (!s) return undefined;
    return data.users.find((u) => u.id === s.user_id);
  };

  store.deleteSession = (token) => {
    data.sessions = data.sessions.filter((x) => x.token !== token);
    save();
  };

  store.listProducts = ({ search, category }) => {
    let rows = data.products.slice();
    if (category) rows = rows.filter((p) => p.category === category);
    if (search) {
      const q = String(search).toLowerCase();
      rows = rows.filter((p) => p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q));
    }
    return rows.sort((a, b) => a.id - b.id);
  };

  store.getProduct = (id) => data.products.find((p) => p.id === Number(id));

  store.createProduct = ({ name, description, price, category, stock }) => {
    const p = { id: nextId('products'), name, description: description || '', price: Math.round(Number(price)), category, stock: Math.max(0, Math.round(Number(stock))), created_at: new Date().toISOString() };
    data.products.push(p);
    save();
    return p;
  };

  store.updateProduct = (id, fields) => {
    const p = store.getProduct(id);
    if (!p) return undefined;
    for (const key of ['name', 'description', 'price', 'category', 'stock']) {
      if (fields[key] === undefined) continue;
      if (key === 'price') p.price = Math.round(Number(fields[key]));
      else if (key === 'stock') p.stock = Math.max(0, Math.round(Number(fields[key])));
      else p[key] = fields[key];
    }
    save();
    return p;
  };

  store.deleteProduct = (id) => {
    const before = data.products.length;
    data.products = data.products.filter((p) => p.id !== Number(id));
    data.cart_items = data.cart_items.filter((c) => c.product_id !== Number(id));
    save();
    return data.products.length < before;
  };

  store.listCategories = () => [...new Set(data.products.map((p) => p.category))].sort();

  store.getCartItems = (owner) =>
    data.cart_items
      .filter((c) => c.owner === owner)
      .map((c) => Object.assign({}, c, (() => {
        const p = store.getProduct(c.product_id) || {};
        return { name: p.name, price: p.price, category: p.category, stock: p.stock };
      })()))
      .filter((c) => c.name !== undefined)
      .sort((a, b) => a.product_id - b.product_id);

  store.setCartItem = (owner, productId, qty) => {
    productId = Number(productId);
    const existing = data.cart_items.find((c) => c.owner === owner && c.product_id === productId);
    if (Math.round(qty) <= 0) return store.deleteCartItem(owner, productId);
    if (existing) existing.qty = Math.round(qty);
    else data.cart_items.push({ owner, product_id: productId, qty: Math.round(qty) });
    save();
    return true;
  };

  store.deleteCartItem = (owner, productId) => {
    const before = data.cart_items.length;
    data.cart_items = data.cart_items.filter((c) => !(c.owner === owner && c.product_id === Number(productId)));
    save();
    return data.cart_items.length < before;
  };

  store.clearCart = (owner) => {
    data.cart_items = data.cart_items.filter((c) => c.owner !== owner);
    save();
  };

  store.createOrder = ({ userId, name, address, phone, items }) => {
    let total = 0;
    for (const item of items) {
      const p = store.getProduct(item.product_id);
      if (!p) throw Object.assign(new Error('Product no longer exists: ' + item.product_id), { code: 'MISSING_PRODUCT' });
      if (p.stock < item.qty) throw Object.assign(new Error('Not enough stock for "' + p.name + '" (have ' + p.stock + ')'), { code: 'INSUFFICIENT_STOCK' });
      total += p.price * item.qty;
    }
    const order = { id: nextId('orders'), user_id: userId === null || userId === undefined ? null : userId, name, address, phone, total, created_at: new Date().toISOString() };
    data.orders.push(order);
    for (const item of items) {
      const p = store.getProduct(item.product_id);
      data.order_items.push({ order_id: order.id, product_id: p.id, name: p.name, price: p.price, qty: item.qty });
      p.stock -= item.qty;
    }
    save();
    return store.getOrder(order.id);
  };

  store.getOrder = (id) => {
    const order = data.orders.find((o) => o.id === Number(id));
    if (!order) return null;
    return Object.assign({}, order, { items: data.order_items.filter((i) => i.order_id === order.id) });
  };

  store.listOrders = (userId) =>
    data.orders
      .filter((o) => o.user_id === userId)
      .sort((a, b) => b.id - a.id)
      .map((o) => store.getOrder(o.id));

  return store;
}

// ---------------------------------------------------------------------------
// Build and export the store
// ---------------------------------------------------------------------------
const store = mode === 'sqlite' ? makeSqliteStore() : makeJsonStore();

if (mode === 'json') {
  const { hashPassword } = require('./auth');
  store.seed(hashPassword);
}

store.mode = mode;

module.exports = store;
