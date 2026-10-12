// app.js - Bazaarly single-page storefront.
//
// Vanilla JS, no frameworks. Hash-based routing, fetch calls to the REST API,
// cart id persisted in localStorage for guests, Bearer token for logins.

(function () {
  'use strict';

  var TOKEN_KEY = 'bazaarly_token';
  var CART_KEY = 'bazaarly_cart_id';

  var state = {
    user: JSON.parse(localStorage.getItem('bazaarly_user') || 'null'),
    cart: null,
    products: [],
    categories: [],
    filter: { search: '', category: '' },
    editingProduct: null,
  };

  var app = document.getElementById('app');
  var cartCountEl = document.getElementById('cartCount');

  // ---------------------------------------------------------------- helpers
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function money(n) {
    return 'Rs ' + Number(n || 0).toLocaleString('en-US');
  }

  // CSS-only tile class per category.
  function tileClass(category) {
    var slug = String(category || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    var known = ['electronics', 'clothing', 'home-kitchen', 'books', 'sports'];
    return known.indexOf(slug) >= 0 ? 'tile-' + slug : 'tile-default';
  }

  function tileHtml(product, big) {
    var initial = esc((product.name || '?').trim().charAt(0).toUpperCase());
    var cls = 'product-tile ' + tileClass(product.category) + (big ? ' detail-tile' : '');
    return '<div class="' + cls + '"><span class="initial">' + initial + '</span></div>';
  }

  function headers(json) {
    var h = {};
    if (json) h['Content-Type'] = 'application/json';
    var token = localStorage.getItem(TOKEN_KEY);
    if (token) h['Authorization'] = 'Bearer ' + token;
    var cartId = localStorage.getItem(CART_KEY);
    if (cartId) h['X-Cart-Id'] = cartId;
    return h;
  }

  function api(path, opts) {
    opts = opts || {};
    return fetch(path, {
      method: opts.method || 'GET',
      headers: headers(!!opts.body),
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    }).then(function (res) {
      // Pick up a minted guest cart id from the response header.
      var newCartId = res.headers.get('X-Cart-Id');
      if (newCartId) localStorage.setItem(CART_KEY, newCartId);
      return res.json().then(function (data) {
        if (!res.ok) throw new Error((data && data.error) || 'Request failed');
        return data;
      });
    });
  }

  function setUser(user) {
    state.user = user;
    if (user) localStorage.setItem('bazaarly_user', JSON.stringify(user));
    else localStorage.removeItem('bazaarly_user');
    renderNav();
  }

  function renderNav() {
    var loggedIn = !!state.user;
    document.querySelectorAll('[data-auth]').forEach(function (el) { el.hidden = !loggedIn; });
    document.querySelectorAll('[data-guest]').forEach(function (el) { el.hidden = loggedIn; });
    document.querySelectorAll('[data-admin]').forEach(function (el) {
      el.hidden = !(loggedIn && state.user.role === 'admin');
    });
    var chip = document.getElementById('userChip');
    chip.hidden = !loggedIn;
    chip.textContent = loggedIn ? 'Hi, ' + state.user.name : '';
    document.getElementById('logoutBtn').hidden = !loggedIn;
  }

  function refreshCartBadge() {
    api('/api/cart').then(function (data) {
      state.cart = data;
      cartCountEl.textContent = data.count;
    }).catch(function () { /* cart loads lazily elsewhere */ });
  }

  // ---------------------------------------------------------------- views

  // Shop: grid + search + category filter.
  function viewShop() {
    var search = state.filter.search;
    var category = state.filter.category;
    var params = new URLSearchParams();
    if (search) params.set('search', search);
    if (category) params.set('category', category);

    app.innerHTML =
      '<h1 class="page-title">Shop all products</h1>' +
      '<p class="lead">Quality picks across electronics, clothing, home, books, and sports.</p>' +
      '<div class="filter-bar">' +
      '<div class="chip-row">' +
      '<button class="chip' + (category === '' ? ' active' : '') + '" data-cat="">All</button>' +
      state.categories.map(function (c) {
        return '<button class="chip' + (category === c ? ' active' : '') + '" data-cat="' + esc(c) + '">' + esc(c) + '</button>';
      }).join('') +
      '</div></div>' +
      '<div id="grid" class="product-grid"><p class="empty">Loading products...</p></div>';

    app.querySelectorAll('.chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        state.filter.category = chip.getAttribute('data-cat');
        viewShop();
      });
    });

    api('/api/categories').then(function (d) { state.categories = d.categories; });
    api('/api/products?' + params.toString()).then(function (data) {
      state.products = data.products;
      var grid = document.getElementById('grid');
      if (!data.products.length) {
        grid.innerHTML = '<p class="empty">No products found. Try a different search.</p>';
        return;
      }
      grid.innerHTML = data.products.map(function (p) {
        var stockNote = p.stock === 0
          ? '<span class="out-of-stock">Out of stock</span>'
          : (p.stock <= 5 ? '<span class="stock-low">Only ' + p.stock + ' left</span>' : '<span class="stock-ok">' + p.stock + ' in stock</span>');
        return '<article class="product-card" data-id="' + p.id + '" tabindex="0" role="link" aria-label="' + esc(p.name) + '">' +
          tileHtml(p) +
          '<div class="product-body">' +
          '<p class="product-cat">' + esc(p.category) + '</p>' +
          '<h3 class="product-name">' + esc(p.name) + '</h3>' +
          stockNote +
          '<p class="product-price">' + money(p.price) + '</p>' +
          '</div></article>';
      }).join('');
      grid.querySelectorAll('.product-card').forEach(function (card) {
        var go = function () { location.hash = '#/product/' + card.getAttribute('data-id'); };
        card.addEventListener('click', go);
        card.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
      });
    }).catch(function (err) {
      document.getElementById('grid').innerHTML = '<div class="error-box">' + esc(err.message) + '</div>';
    });
  }

  // Product detail.
  function viewProduct(id) {
    app.innerHTML = '<p class="empty">Loading product...</p>';
    api('/api/products/' + encodeURIComponent(id)).then(function (data) {
      var p = data.product;
      var stockNote = p.stock === 0
        ? '<p class="out-of-stock">Out of stock</p>'
        : (p.stock <= 5 ? '<p class="stock-low">Hurry, only ' + p.stock + ' left in stock</p>' : '<p class="stock-ok">' + p.stock + ' in stock</p>');
      app.innerHTML =
        '<p><a href="#/">&larr; Back to shop</a></p>' +
        '<div class="detail-layout">' +
        tileHtml(p, true) +
        '<div class="detail-info">' +
        '<p class="product-cat">' + esc(p.category) + '</p>' +
        '<h1>' + esc(p.name) + '</h1>' +
        '<p>' + esc(p.description) + '</p>' +
        '<p class="detail-price">' + money(p.price) + '</p>' +
        stockNote +
        (p.stock > 0 ?
          '<div class="qty-row"><label for="qty">Qty</label>' +
          '<input id="qty" type="number" min="1" max="' + p.stock + '" value="1">' +
          '<button id="addBtn" class="btn btn-amber" type="button">Add to cart</button></div>' +
          '<div id="msg"></div>'
          : '') +
        '</div></div>';
      var addBtn = document.getElementById('addBtn');
      if (addBtn) {
        addBtn.addEventListener('click', function () {
          var qty = Math.max(1, parseInt(document.getElementById('qty').value, 10) || 1);
          api('/api/cart/items', { method: 'POST', body: { productId: p.id, qty: qty } }).then(function (cart) {
            state.cart = cart;
            cartCountEl.textContent = cart.count;
            document.getElementById('msg').innerHTML = '<div class="notice">Added to cart. <a href="#/cart">View cart</a></div>';
          }).catch(function (err) {
            document.getElementById('msg').innerHTML = '<div class="error-box">' + esc(err.message) + '</div>';
          });
        });
      }
    }).catch(function (err) {
      app.innerHTML = '<div class="error-box">' + esc(err.message) + '</div><p><a href="#/">Back to shop</a></p>';
    });
  }

  // Cart page.
  function viewCart() {
    app.innerHTML = '<p class="empty">Loading cart...</p>';
    api('/api/cart').then(function (cart) {
      state.cart = cart;
      cartCountEl.textContent = cart.count;
      if (!cart.items.length) {
        app.innerHTML = '<h1 class="page-title">Your cart</h1><p class="empty">Your cart is empty. <a href="#/">Start shopping</a></p>';
        return;
      }
      var rows = cart.items.map(function (i) {
        return '<tr>' +
          '<td><div class="cart-line"><span class="cart-thumb ' + tileClass(i.category) + '">' + esc(i.name.charAt(0).toUpperCase()) + '</span>' +
          '<div><strong>' + esc(i.name) + '</strong><br><small>' + esc(i.category) + '</small></div></div></td>' +
          '<td>' + money(i.price) + '</td>' +
          '<td><input class="qty-input" type="number" min="0" max="' + i.stock + '" value="' + i.qty + '" data-id="' + i.productId + '"></td>' +
          '<td>' + money(i.subtotal) + '</td>' +
          '<td><button class="btn btn-danger btn-sm" type="button" data-remove="' + i.productId + '">Remove</button></td>' +
          '</tr>';
      }).join('');
      app.innerHTML =
        '<h1 class="page-title">Your cart</h1>' +
        '<table class="cart-table"><thead><tr><th>Item</th><th>Price</th><th>Qty</th><th>Subtotal</th><th></th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table>' +
        '<div class="cart-summary">' +
        '<button id="clearCart" class="btn btn-ghost" type="button">Clear cart</button>' +
        '<div><span class="cart-total">Total: ' + money(cart.total) + '</span> ' +
        '<a href="#/checkout" class="btn btn-primary" style="margin-left:1rem">Checkout</a></div>' +
        '</div><div id="msg"></div>';

      app.querySelectorAll('.qty-input').forEach(function (input) {
        input.addEventListener('change', function () {
          var pid = input.getAttribute('data-id');
          var qty = Math.max(0, parseInt(input.value, 10) || 0);
          api('/api/cart/items/' + pid, { method: 'PUT', body: { qty: qty } })
            .then(function () { viewCart(); })
            .catch(function (err) { document.getElementById('msg').innerHTML = '<div class="error-box">' + esc(err.message) + '</div>'; viewCart(); });
        });
      });
      app.querySelectorAll('[data-remove]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          api('/api/cart/items/' + btn.getAttribute('data-remove'), { method: 'DELETE' })
            .then(function () { viewCart(); });
        });
      });
      document.getElementById('clearCart').addEventListener('click', function () {
        api('/api/cart', { method: 'DELETE' }).then(function () { viewCart(); });
      });
    }).catch(function (err) {
      app.innerHTML = '<div class="error-box">' + esc(err.message) + '</div>';
    });
  }

  // Checkout: requires login, collects delivery details, places the order.
  function viewCheckout() {
    if (!state.user) {
      location.hash = '#/login';
      return;
    }
    app.innerHTML = '<p class="empty">Loading cart...</p>';
    api('/api/cart').then(function (cart) {
      if (!cart.items.length) {
        app.innerHTML = '<h1 class="page-title">Checkout</h1><p class="empty">Your cart is empty. <a href="#/">Start shopping</a></p>';
        return;
      }
      var lines = cart.items.map(function (i) {
        return '<li>' + esc(i.name) + ' &times; ' + i.qty + ' &mdash; ' + money(i.subtotal) + '</li>';
      }).join('');
      app.innerHTML =
        '<h1 class="page-title">Checkout</h1>' +
        '<div class="notice">Order summary: ' + cart.count + ' item(s), total <strong>' + money(cart.total) + '</strong></div>' +
        '<div class="form-card"><div id="msg"></div>' +
        '<form id="checkoutForm">' +
        '<div class="form-row"><label for="name">Full name</label><input id="name" required></div>' +
        '<div class="form-row"><label for="address">Delivery address</label><textarea id="address" required></textarea></div>' +
        '<div class="form-row"><label for="phone">Phone number</label><input id="phone" type="tel" required></div>' +
        '<button class="btn btn-primary" type="submit">Place order</button>' +
        '</form></div>';
      document.getElementById('checkoutForm').addEventListener('submit', function (e) {
        e.preventDefault();
        api('/api/orders', {
          method: 'POST',
          body: {
            name: document.getElementById('name').value,
            address: document.getElementById('address').value,
            phone: document.getElementById('phone').value,
          },
        }).then(function (data) {
          cartCountEl.textContent = '0';
          app.innerHTML =
            '<h1 class="page-title">Order placed</h1>' +
            '<div class="notice">Thank you, ' + esc(data.order.name) + '. Your order <strong>#' + data.order.id + '</strong> ' +
            'for <strong>' + money(data.order.total) + '</strong> is confirmed. ' +
            'We will call ' + esc(data.order.phone) + ' before delivery.</div>' +
            '<p><a class="btn btn-primary" href="#/orders">View my orders</a> ' +
            '<a class="btn btn-ghost" href="#/">Continue shopping</a></p>';
        }).catch(function (err) {
          document.getElementById('msg').innerHTML = '<div class="error-box">' + esc(err.message) + '</div>';
        });
      });
    }).catch(function (err) {
      app.innerHTML = '<div class="error-box">' + esc(err.message) + '</div>';
    });
  }

  // Order history.
  function viewOrders() {
    if (!state.user) { location.hash = '#/login'; return; }
    app.innerHTML = '<p class="empty">Loading orders...</p>';
    api('/api/orders').then(function (data) {
      if (!data.orders.length) {
        app.innerHTML = '<h1 class="page-title">My orders</h1><p class="empty">No orders yet. <a href="#/">Start shopping</a></p>';
        return;
      }
      app.innerHTML = '<h1 class="page-title">My orders</h1>' + data.orders.map(function (o) {
        var items = o.items.map(function (i) {
          return '<li>' + esc(i.name) + ' &times; ' + i.qty + ' &mdash; ' + money(i.price * i.qty) + '</li>';
        }).join('');
        return '<div class="order-card">' +
          '<div class="order-head"><span class="order-id">Order #' + o.id + '</span>' +
          '<span class="order-date">' + esc(new Date(o.created_at).toLocaleString()) + '</span></div>' +
          '<ul class="order-items">' + items + '</ul>' +
          '<p>Deliver to: ' + esc(o.name) + ', ' + esc(o.address) + ' (' + esc(o.phone) + ')</p>' +
          '<p class="order-total">Total: ' + money(o.total) + '</p></div>';
      }).join('');
    }).catch(function (err) {
      app.innerHTML = '<div class="error-box">' + esc(err.message) + '</div>';
    });
  }

  // Login / register.
  function viewLogin() {
    if (state.user) { location.hash = '#/'; return; }
    app.innerHTML =
      '<h1 class="page-title">Log in</h1>' +
      '<div class="form-card"><div id="msg"></div>' +
      '<form id="loginForm">' +
      '<div class="form-row"><label for="email">Email</label><input id="email" type="email" required></div>' +
      '<div class="form-row"><label for="password">Password</label><input id="password" type="password" required></div>' +
      '<button class="btn btn-primary" type="submit">Log in</button>' +
      '<p class="form-hint">No account yet? <a href="#/register">Create one</a>. ' +
      'Demo login: demo@example.com / demo123. Admin: admin@example.com / admin123.</p>' +
      '</form></div>';
    document.getElementById('loginForm').addEventListener('submit', function (e) {
      e.preventDefault();
      api('/api/auth/login', {
        method: 'POST',
        body: {
          email: document.getElementById('email').value,
          password: document.getElementById('password').value,
          cartId: localStorage.getItem(CART_KEY),
        },
      }).then(function (data) {
        localStorage.setItem(TOKEN_KEY, data.token);
        setUser(data.user);
        refreshCartBadge();
        location.hash = '#/';
      }).catch(function (err) {
        document.getElementById('msg').innerHTML = '<div class="error-box">' + esc(err.message) + '</div>';
      });
    });
  }

  function viewRegister() {
    if (state.user) { location.hash = '#/'; return; }
    app.innerHTML =
      '<h1 class="page-title">Create an account</h1>' +
      '<div class="form-card"><div id="msg"></div>' +
      '<form id="regForm">' +
      '<div class="form-row"><label for="rname">Full name</label><input id="rname" required></div>' +
      '<div class="form-row"><label for="remail">Email</label><input id="remail" type="email" required></div>' +
      '<div class="form-row"><label for="rpass">Password (6+ characters)</label><input id="rpass" type="password" minlength="6" required></div>' +
      '<button class="btn btn-primary" type="submit">Register</button>' +
      '<p class="form-hint">Already registered? <a href="#/login">Log in</a>.</p>' +
      '</form></div>';
    document.getElementById('regForm').addEventListener('submit', function (e) {
      e.preventDefault();
      api('/api/auth/register', {
        method: 'POST',
        body: {
          name: document.getElementById('rname').value,
          email: document.getElementById('remail').value,
          password: document.getElementById('rpass').value,
          cartId: localStorage.getItem(CART_KEY),
        },
      }).then(function (data) {
        localStorage.setItem(TOKEN_KEY, data.token);
        setUser(data.user);
        refreshCartBadge();
        location.hash = '#/';
      }).catch(function (err) {
        document.getElementById('msg').innerHTML = '<div class="error-box">' + esc(err.message) + '</div>';
      });
    });
  }

  // Admin panel: product management.
  function viewAdmin() {
    if (!state.user) { location.hash = '#/login'; return; }
    if (state.user.role !== 'admin') {
      app.innerHTML = '<div class="error-box">Admin access required.</div><p><a href="#/">Back to shop</a></p>';
      return;
    }
    app.innerHTML = '<h1 class="page-title">Admin: products</h1><p class="empty">Loading products...</p>';
    api('/api/products').then(function (data) {
      var rows = data.products.map(function (p) {
        return '<tr><td>' + p.id + '</td><td><strong>' + esc(p.name) + '</strong></td>' +
          '<td>' + esc(p.category) + '</td><td>' + money(p.price) + '</td><td>' + p.stock + '</td>' +
          '<td class="admin-actions">' +
          '<button class="btn btn-ghost btn-sm" type="button" data-edit="' + p.id + '">Edit</button>' +
          '<button class="btn btn-danger btn-sm" type="button" data-del="' + p.id + '">Delete</button>' +
          '</td></tr>';
      }).join('');
      app.innerHTML =
        '<h1 class="page-title">Admin: products</h1>' +
        '<div class="admin-layout"><div>' +
        '<table class="admin-table"><thead><tr><th>ID</th><th>Name</th><th>Category</th><th>Price</th><th>Stock</th><th></th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table></div>' +
        '<div class="form-card"><h3 id="formTitle">Add product</h3><div id="msg"></div>' +
        '<form id="productForm">' +
        '<div class="form-row"><label for="pname">Name</label><input id="pname" required></div>' +
        '<div class="form-row"><label for="pdesc">Description</label><textarea id="pdesc"></textarea></div>' +
        '<div class="form-row"><label for="pcat">Category</label><input id="pcat" list="catList" required><datalist id="catList">' +
        state.categories.map(function (c) { return '<option value="' + esc(c) + '">'; }).join('') + '</datalist></div>' +
        '<div class="form-row"><label for="pprice">Price (Rs)</label><input id="pprice" type="number" min="0" required></div>' +
        '<div class="form-row"><label for="pstock">Stock</label><input id="pstock" type="number" min="0" value="10" required></div>' +
        '<button class="btn btn-primary" type="submit" id="saveBtn">Add product</button> ' +
        '<button class="btn btn-ghost" type="button" id="cancelEdit" hidden>Cancel</button>' +
        '</form></div></div>';

      var editingId = null;

      function fillForm(p) {
        editingId = p ? p.id : null;
        document.getElementById('formTitle').textContent = p ? 'Edit product #' + p.id : 'Add product';
        document.getElementById('pname').value = p ? p.name : '';
        document.getElementById('pdesc').value = p ? p.description : '';
        document.getElementById('pcat').value = p ? p.category : '';
        document.getElementById('pprice').value = p ? p.price : '';
        document.getElementById('pstock').value = p ? p.stock : 10;
        document.getElementById('saveBtn').textContent = p ? 'Save changes' : 'Add product';
        document.getElementById('cancelEdit').hidden = !p;
      }

      document.getElementById('productForm').addEventListener('submit', function (e) {
        e.preventDefault();
        var body = {
          name: document.getElementById('pname').value,
          description: document.getElementById('pdesc').value,
          category: document.getElementById('pcat').value,
          price: Number(document.getElementById('pprice').value),
          stock: Number(document.getElementById('pstock').value),
        };
        var req = editingId
          ? api('/api/products/' + editingId, { method: 'PUT', body: body })
          : api('/api/products', { method: 'POST', body: body });
        req.then(function () { viewAdmin(); })
          .catch(function (err) {
            document.getElementById('msg').innerHTML = '<div class="error-box">' + esc(err.message) + '</div>';
          });
      });

      document.getElementById('cancelEdit').addEventListener('click', function () { fillForm(null); });

      app.querySelectorAll('[data-edit]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var p = data.products.find(function (x) { return x.id === Number(btn.getAttribute('data-edit')); });
          if (p) fillForm(p);
          document.getElementById('productForm').scrollIntoView({ behavior: 'smooth' });
        });
      });
      app.querySelectorAll('[data-del]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          if (!confirm('Delete this product?')) return;
          api('/api/products/' + btn.getAttribute('data-del'), { method: 'DELETE' })
            .then(function () { viewAdmin(); })
            .catch(function (err) { alert(err.message); });
        });
      });
    }).catch(function (err) {
      app.innerHTML = '<div class="error-box">' + esc(err.message) + '</div>';
    });
  }

  // ---------------------------------------------------------------- router
  function route() {
    var hash = location.hash || '#/';
    var parts = hash.replace(/^#\//, '').split('/');
    window.scrollTo(0, 0);
    if (parts[0] === '') viewShop();
    else if (parts[0] === 'product' && parts[1]) viewProduct(parts[1]);
    else if (parts[0] === 'cart') viewCart();
    else if (parts[0] === 'checkout') viewCheckout();
    else if (parts[0] === 'orders') viewOrders();
    else if (parts[0] === 'login') viewLogin();
    else if (parts[0] === 'register') viewRegister();
    else if (parts[0] === 'admin') viewAdmin();
    else app.innerHTML = '<div class="error-box">Page not found.</div><p><a href="#/">Back to shop</a></p>';
  }

  // ---------------------------------------------------------------- init
  document.getElementById('searchBtn').addEventListener('click', doSearch);
  document.getElementById('searchInput').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') doSearch();
  });
  function doSearch() {
    state.filter.search = document.getElementById('searchInput').value.trim();
    if ((location.hash || '#/') !== '#/') location.hash = '#/';
    else viewShop();
  }

  document.getElementById('logoutBtn').addEventListener('click', function () {
    api('/api/auth/logout', { method: 'POST' }).catch(function () {});
    localStorage.removeItem(TOKEN_KEY);
    setUser(null);
    refreshCartBadge();
    location.hash = '#/';
  });

  window.addEventListener('hashchange', route);
  renderNav();
  refreshCartBadge();
  route();
})();
