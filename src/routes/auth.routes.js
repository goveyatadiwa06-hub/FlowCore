const express = require('express');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { pool } = require('../config/database');
const { sendVerificationEmail } = require('../utils/mailer');

const router = express.Router();

/* =======================================================
   HELPERS
======================================================= */

function issueCsrfToken(req) {
  const token = crypto.randomBytes(32).toString('hex');
  req.session.csrfToken = token;
  return token;
}

function consumeFlash(req, key) {
  if (!req.session) return null;
  const value = req.session[key];
  delete req.session[key];
  return value;
}

function setFlash(req, key, value) {
  if (req.session) req.session[key] = value;
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function isValidEmail(email) {
  const re = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+$/;
  return re.test(email);
}

/* =======================================================
   RATE LIMITER
======================================================= */

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false
});

/* =======================================================
   GET /login
======================================================= */

router.get('/login', (req, res) => {
  if (req.session?.merchantId) {
    return res.redirect(303, '/dashboard');
  }

  const error = consumeFlash(req, 'loginError');
  const email = consumeFlash(req, 'loginEmail');
  const csrfToken = issueCsrfToken(req);
  const showResend = consumeFlash(req, 'showResend');
  
  return res.render('auth/login', {
    layout: false,
    title: 'Merchant Login',
    error,
    email,
    csrfToken,
    showResend
  });
});

/* =======================================================
   POST /login
======================================================= */

router.post('/login', authLimiter, async (req, res) => {
  try {
    const csrf = String(req.body?._csrf || '');
    const expected = String(req.session?.csrfToken || '');

    if (req.session) delete req.session.csrfToken;

    if (!csrf || csrf !== expected) {
      setFlash(req, 'loginError', 'Session expired. Please try again.');
      return res.redirect(303, '/login');
    }

    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || '');

    if (!email || !password) {
      setFlash(req, 'loginError', 'Email and password are required.');
      setFlash(req, 'loginEmail', email);
      return res.redirect(303, '/login');
    }

    const result = await pool.query(
      `SELECT id,
              password_hash,
              business_name,
              email_verified
       FROM merchants
       WHERE LOWER(email) = $1`,
      [email]
    );

    const merchant = result.rows[0];

    console.log("Merchant found:", !!merchant);

if (merchant) {
  console.log("Email verified:", merchant.email_verified);
}

    const hash = merchant?.password_hash || '$2b$10$invalidhashplaceholder';
    let passwordOk = false;

    try {
      passwordOk = await bcrypt.compare(password, hash);
    } catch {
      passwordOk = false;
    }

    if (!merchant || !passwordOk) {
      setFlash(req, 'loginError', 'Invalid email or password.');
      setFlash(req, 'loginEmail', email);
      return res.redirect(303, '/login');
    }

    if (!merchant.email_verified) {
      setFlash(req, 'loginError', 'Email not verified.');
      setFlash(req, 'loginEmail', email);
      setFlash(req, 'showResend', true);
      return res.redirect(303, '/login');
    }

    await new Promise((resolve, reject) => {
      req.session.regenerate(err => (err ? reject(err) : resolve()));
    });

    req.session.merchantId = merchant.id;
    req.session.merchantName = merchant.business_name;

    return res.redirect(303, '/dashboard');

  } catch (err) {
    console.error('Login error:', err);
    setFlash(req, 'loginError', 'Something went wrong. Please try again.');
    return res.redirect(303, '/login');
  }
});

/* =======================================================
   GET /register
======================================================= */

router.get('/register', (req, res) => {
  if (req.session?.merchantId) {
    return res.redirect(303, '/dashboard');
  }

  const error = consumeFlash(req, 'registerError');
  const email = consumeFlash(req, 'registerEmail');
  const csrfToken = issueCsrfToken(req);

  return res.render('auth/register', {
    layout: false,
    title: 'Create Account',
    error,
    email,
    csrfToken
  });
});

/* =======================================================
   POST /register
======================================================= */

router.post('/register', authLimiter, async (req, res) => {
  try {
    const csrf = String(req.body?._csrf || '');
    const expected = String(req.session?.csrfToken || '');

    if (req.session) delete req.session.csrfToken;

    if (!csrf || csrf !== expected) {
      setFlash(req, 'registerError', 'Session expired. Please try again.');
      return res.redirect(303, '/register');
    }

    const businessName = String(req.body?.businessName || '').trim();
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || '');
    const confirmPassword = String(req.body?.confirmPassword || '');
    console.log("Register email received:", email);
console.log("Email valid?", isValidEmail(email));

    if (!businessName || !email || !password || password !== confirmPassword) {
      setFlash(req, 'registerError', 'Invalid input.');
      setFlash(req, 'registerEmail', email);
      return res.redirect(303, '/register');
    }

    if (!isValidEmail(email)) {
      setFlash(req, 'registerError', 'Invalid email format.');
      setFlash(req, 'registerEmail', email);
      return res.redirect(303, '/register');
    }

    if (password.length < 8) {
      setFlash(req, 'registerError', 'Password must be at least 8 characters.');
      return res.redirect(303, '/register');
    }

    const existing = await pool.query(
      `SELECT id FROM merchants WHERE LOWER(email) = $1`,
      [email]
    );

    if (existing.rowCount > 0) {
      setFlash(req, 'registerError', 'Email already registered.');
      return res.redirect(303, '/register');
    }

    const hash = await bcrypt.hash(password, 12);

    const verificationToken = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await pool.query(
      `
      INSERT INTO merchants 
      (business_name, email, password_hash, email_verification_token, email_verification_expires)
      VALUES ($1, $2, $3, $4, $5)
      `,
      [businessName, email, hash, verificationToken, expires]
    );

    const verificationLink = `${process.env.BASE_URL}/verify-email?token=${verificationToken}`;

await sendVerificationEmail(email, verificationLink);

    return res.redirect(303, `/check-email?email=${encodeURIComponent(email)}`);

    

  } catch (err) {
    console.error('Register error:', err);
    setFlash(req, 'registerError', 'Something went wrong. Please try again.');
    return res.redirect(303, '/register');
  }
});

/*Check Email Page Code*/

router.get('/check-email', (req, res) => {
  const email = normalizeEmail(req.query.email || '');

  if (!email) {
    return res.redirect('/register');
  }

  return res.render('auth/check-email', {
    layout: false,
    title: 'Verify Your Email',
    email
  });
});

/* =======================================================
   VERIFY EMAIL
======================================================= */

router.get('/verify-email', async (req, res) => {
  try {
    const token = String(req.query.token || '').trim();
    if (!token) return res.redirect('/login');

    const result = await pool.query(
      `SELECT id, email_verification_expires
       FROM merchants
       WHERE email_verification_token = $1`,
      [token]
    );

    if (result.rowCount === 0) return res.redirect('/login');

    const merchant = result.rows[0];

    if (!merchant.email_verification_expires ||
        new Date() > merchant.email_verification_expires) {
      return res.redirect('/login');
    }

    await pool.query(
      `UPDATE merchants
       SET email_verified = true,
           email_verification_token = NULL,
           email_verification_expires = NULL
       WHERE id = $1`,
      [merchant.id]
    );
    
    return res.redirect(303, '/email-verified');


  } catch (err) {
    console.error('Email verification error:', err);
    return res.redirect('/login');
  }
});

router.get('/email-verified', (req, res) => {
  return res.render('auth/email-verified', {
    layout: false,
    title: 'Email Verified'
  });
});

router.post('/resend-verification', authLimiter, async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);

    const result = await pool.query(
      `SELECT id FROM merchants 
       WHERE LOWER(email) = $1 
       AND email_verified = false`,
      [email]
    );

    if (result.rowCount === 0) {
      return res.redirect('/login');
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await pool.query(
      `UPDATE merchants
       SET email_verification_token = $1,
           email_verification_expires = $2
       WHERE LOWER(email) = $3`,
      [token, expires, email]
    );

    const verificationLink = `${process.env.BASE_URL}/verify-email?token=${token}`;
await sendVerificationEmail(email, verificationLink);

    return res.redirect(
      303,
      `/check-email?email=${encodeURIComponent(email)}`
    );

  } catch (err) {
    console.error('Resend verification error:', err);
    return res.redirect('/login');
  }
  
});

/* =======================================================
   LOGOUT
======================================================= */

router.post('/logout', (req, res) => {
  if (!req.session) return res.redirect(303, '/login');

  req.session.destroy(err => {
    if (err) console.error('Session destroy error:', err);

    res.clearCookie('flowcore.sid', {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production'
    });

    return res.redirect(303, '/login');
  });
});

router.get('/logout', (req, res) => {
  return res.redirect('/login');
});

module.exports = router;