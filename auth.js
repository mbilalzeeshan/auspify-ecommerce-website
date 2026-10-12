// auth.js - password hashing and session tokens for Bazaarly.
//
// Everything here uses only node:crypto, so there are no extra
// dependencies and nothing sensitive ever leaves the server.

const crypto = require('node:crypto');

const SCRYPT_KEYLEN = 64; // bytes

// Hash a password with a random 16-byte salt using scrypt.
// Stored format: "salt:derivedKey", both hex encoded.
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const key = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  return salt + ':' + key;
}

// Verify a candidate password against a stored "salt:key" hash.
function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const parts = stored.split(':');
  if (parts.length !== 2) return false;
  const [salt, expected] = parts;
  let actual;
  try {
    actual = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  } catch (err) {
    return false;
  }
  // timingSafeEqual avoids leaking info through comparison timing.
  const a = Buffer.from(actual, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Generate a random opaque bearer token for a session.
function newToken() {
  return crypto.randomBytes(32).toString('hex');
}

module.exports = { hashPassword, verifyPassword, newToken };
