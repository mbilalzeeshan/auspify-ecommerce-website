// server.js - Bazaarly e-commerce REST API + static frontend.
//
// Run with: npm install && npm start   (listens on process.env.PORT or 3003)

const express = require('express');
const path = require('node:path');
const db = require('./db');
const { hashPassword, verifyPassword, newToken } = require('./auth');

const app = express();
const PORT = Number(process.env.PORT) || 3003;

app.use(express.json());

// Serve the single-page storefront from public/.
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

// Attach req.user when a valid "Authorization: Bearer <token>" header is present.
app.use('/api', (req, res, next) => {
  const header = req.get('Authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (match) {
    const user = db.getSessionUser(match[1].trim());
    if (user) req.user = user;
  }
  next();
});

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Login required' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Login required' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}

// Public view of a user row: never leak the password hash.
function publicUser(user) {
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

// ---------------------------------------------------------------------------
// Cart owner resolution
//
// Logged-in users: cart key "user:<id>".
// Guests: cart key "guest:<cartId>" where the id comes from the X-Cart-Id
// header (or a cartId body field). If the guest has no id yet we mint one
// and return it via the X-Cart-Id response header and JSON body so the
// frontend can persist it in localStorage.
// ---------------------------------------------------------------------------
function resolveCartOwner(req) {
  if (req.user) return { owner: 'user:' + req.user.id, guestCartId: null };
  let cartId = req.get('X-Cart-Id') || (req.body && req.body.cartId);
  let fresh = false;
  if (!cartId || typeof cartId !== 'string' || cartId.length < 8) {
    cartId = newToken().slice(0, 32);
    fresh = true;
  }
  return { owner: 'guest:' + cartId, guestCartId: cartId, fresh };
}

function cartView(req, owner, guestCartId) {
  const raw = db.getCartItems(owner);
  const items = raw.map((r) => ({
    productId: r.product_id,
    name: r.name,
    price: r.price,
    category: r.category,
    stock: r.stock,
    qty: r.qty,
    subtotal: r.price * r.qty,
  }));
  const total = items.reduce((sum, i) => sum + i.subtotal, 0);
  const count = items.reduce((sum, i) => sum + i.qty, 0);
  const body = { items, total, count };
  if (guestCartId) body.cartId = guestCartId;
  return body;
}

// Merge a guest cart into the user's cart on login (quantities are added).
function mergeGuestCart(userId, guestCartId) {
  if (!guestCartId) return;
  const guestOwner = 'guest:' + guestCartId;
  const userOwner = 'user:' + userId;
  if (guestOwner === userOwner) return;
  const guestItems = db.getCartItems(guestOwner);
  for (const item of guestItems) {
    const current = db.getCartItems(userOwner).find((c) => c.product_id === item.product_id);
    const product = db.getProduct(item.product_id);
    if (!product) continue;
    const qty = Math.min((current ? current.qty : 0) + item.qty, product.stock);
    if (qty > 0) db.setCartItem(userOwner, item.product_id, qty);
  }
  db.clearCart(guestOwner);
}

// ---------------------------------------------------------------------------
// Public catalog
// ---------------------------------------------------------------------------
app.get('/api/products', (req, res) => {
  const products = db.listProducts({ search: req.query.search, category: req.query.category });
  res.json({ products });
});

app.get('/api/categories', (req, res) => {
  res.json({ categories: db.listCategories() });
});

app.get('/api/products/:id', (req, res) => {
  const product = db.getProduct(req.params.id);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  res.json({ product });
});

// ---------------------------------------------------------------------------
// Admin product management
// ---------------------------------------------------------------------------
app.post('/api/products', requireAdmin, (req, res) => {
  const { name, description, price, category, stock } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Product name is required' });
  if (price === undefined || !Number.isFinite(Number(price)) || Number(price) < 0) {
    return res.status(400).json({ error: 'Price must be a non-negative number' });
  }
  if (!category || !String(category).trim()) return res.status(400).json({ error: 'Category is required' });
  const product = db.createProduct({
    name: String(name).trim(),
    description: description ? String(description) : '',
    price: Number(price),
    category: String(category).trim(),
    stock: stock === undefined ? 0 : Number(stock),
  });
  res.status(201).json({ product });
});

app.put('/api/products/:id', requireAdmin, (req, res) => {
  const existing = db.getProduct(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Product not found' });
  const { name, price } = req.body || {};
  if (name !== undefined && !String(name).trim()) return res.status(400).json({ error: 'Product name cannot be empty' });
  if (price !== undefined && (!Number.isFinite(Number(price)) || Number(price) < 0)) {
    return res.status(400).json({ error: 'Price must be a non-negative number' });
  }
  res.json({ product: db.updateProduct(req.params.id, req.body || {}) });
});

app.delete('/api/products/:id', requireAdmin, (req, res) => {
  const ok = db.deleteProduct(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Product not found' });
  res.json({ deleted: true });
});

// ---------------------------------------------------------------------------
// Auth: register / login / logout / me
// ---------------------------------------------------------------------------
app.post('/api/auth/register', (req, res) => {
  const { email, name, password } = req.body || {};
  if (!email || !String(email).includes('@')) return res.status(400).json({ error: 'A valid email is required' });
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Your name is required' });
  if (!password || String(password).length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (db.getUserByEmail(email)) return res.status(409).json({ error: 'An account with this email already exists' });
  const user = db.createUser({ email, name: String(name).trim(), password_hash: hashPassword(String(password)), role: 'user' });
  const token = newToken();
  db.createSession(user.id, token);
  mergeGuestCart(user.id, req.body && req.body.cartId);
  res.status(201).json({ token, user: publicUser(user) });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const user = email ? db.getUserByEmail(email) : undefined;
  if (!user || !verifyPassword(String(password || ''), user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  const token = newToken();
  db.createSession(user.id, token);
  mergeGuestCart(user.id, req.body && req.body.cartId);
  res.json({ token, user: publicUser(user) });
});

app.post('/api/auth/logout', requireAuth, (req, res) => {
  const header = req.get('Authorization') || '';
  const token = header.replace(/^Bearer\s+/i, '').trim();
  if (token) db.deleteSession(token);
  res.json({ loggedOut: true });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

// ---------------------------------------------------------------------------
// Cart
// ---------------------------------------------------------------------------
app.get('/api/cart', (req, res) => {
  const { owner, guestCartId, fresh } = resolveCartOwner(req);
  if (fresh) res.set('X-Cart-Id', guestCartId);
  res.json(cartView(req, owner, guestCartId));
});

app.post('/api/cart/items', (req, res) => {
  const { productId, qty } = req.body || {};
  const product = db.getProduct(productId);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  const quantity = Math.round(Number(qty));
  if (!Number.isFinite(quantity) || quantity < 1) return res.status(400).json({ error: 'Quantity must be at least 1' });
  const { owner, guestCartId, fresh } = resolveCartOwner(req);
  const current = db.getCartItems(owner).find((c) => c.product_id === product.id);
  const newQty = (current ? current.qty : 0) + quantity;
  if (newQty > product.stock) {
    return res.status(409).json({ error: 'Only ' + product.stock + ' in stock' });
  }
  db.setCartItem(owner, product.id, newQty);
  if (fresh) res.set('X-Cart-Id', guestCartId);
  res.status(201).json(cartView(req, owner, guestCartId));
});

app.put('/api/cart/items/:productId', (req, res) => {
  const product = db.getProduct(req.params.productId);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  const quantity = Math.round(Number(req.body && req.body.qty));
  if (!Number.isFinite(quantity) || quantity < 0) return res.status(400).json({ error: 'Quantity must be 0 or more' });
  if (quantity > product.stock) return res.status(409).json({ error: 'Only ' + product.stock + ' in stock' });
  const { owner, guestCartId, fresh } = resolveCartOwner(req);
  db.setCartItem(owner, product.id, quantity);
  if (fresh) res.set('X-Cart-Id', guestCartId);
  res.json(cartView(req, owner, guestCartId));
});

app.delete('/api/cart/items/:productId', (req, res) => {
  const { owner, guestCartId, fresh } = resolveCartOwner(req);
  db.deleteCartItem(owner, req.params.productId);
  if (fresh) res.set('X-Cart-Id', guestCartId);
  res.json(cartView(req, owner, guestCartId));
});

app.delete('/api/cart', (req, res) => {
  const { owner, guestCartId, fresh } = resolveCartOwner(req);
  db.clearCart(owner);
  if (fresh) res.set('X-Cart-Id', guestCartId);
  res.json(cartView(req, owner, guestCartId));
});

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------
app.post('/api/orders', (req, res) => {
  const { name, address, phone } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Name is required' });
  if (!address || !String(address).trim()) return res.status(400).json({ error: 'Delivery address is required' });
  if (!phone || !String(phone).trim()) return res.status(400).json({ error: 'Phone number is required' });

  const { owner } = resolveCartOwner(req);
  const cartItems = db.getCartItems(owner);
  if (!cartItems.length) return res.status(400).json({ error: 'Your cart is empty' });

  try {
    const order = db.createOrder({
      userId: req.user ? req.user.id : null,
      name: String(name).trim(),
      address: String(address).trim(),
      phone: String(phone).trim(),
      items: cartItems.map((c) => ({ product_id: c.product_id, qty: c.qty })),
    });
    db.clearCart(owner);
    res.status(201).json({ order });
  } catch (err) {
    if (err && (err.code === 'INSUFFICIENT_STOCK' || err.code === 'MISSING_PRODUCT')) {
      return res.status(409).json({ error: err.message });
    }
    throw err;
  }
});

app.get('/api/orders', requireAuth, (req, res) => {
  res.json({ orders: db.listOrders(req.user.id) });
});

// Fallback error handler so API errors always come back as JSON.
app.use('/api', (err, req, res, next) => {
  console.error('[api] error:', err && err.message);
  res.status(500).json({ error: 'Something went wrong on our end' });
});

app.listen(PORT, () => {
  console.log('Bazaarly store running at http://localhost:' + PORT + ' (storage: ' + db.mode + ')');
});
