require('dotenv').config();

const express = require('express');
const expressLayouts = require('express-ejs-layouts');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const session = require('express-session');

const healthRoutes = require('./src/routes/healthRoutes');
const paynowWebhook = require('./src/routes/paynow.webhook');
const orderRoutes = require('./src/routes/orders.routes');
const pushRoutes = require('./src/routes/push.routes');
const paymentPageRoutes = require('./src/routes/paymentPage.routes');
const payStatusRoutes = require('./src/routes/pay.Status.routes');
const authRoutes = require('./src/routes/auth.routes');
const dashboardRoutes = require('./src/routes/dashboard.routes');
const settingsRoutes = require('./src/routes/settings.routes');

const app = express();


// =======================
// TRUST PROXY (needed for secure cookies & rate limit IPs)
// =======================
app.set('trust proxy', 1);


// =======================
// SECURITY HEADERS
// =======================
app.use(
  helmet({
    contentSecurityPolicy: false, // enable later after CSP tuning
    crossOriginEmbedderPolicy: false,
  })
);


// =======================
// STATIC FILES
// =======================
app.use(express.static(path.join(__dirname, 'public')));


// =======================
// VIEW ENGINE
// =======================
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(expressLayouts);
app.set('layout', 'layouts/main');


// =======================
// SESSION (must be before locals)
// =======================
if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET must be set in production');
}

const pgSession = require('connect-pg-simple')(session);
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

app.use(
  session({
    store: new pgSession({
      pool: pool,
      tableName: 'session',
    }),
    name: 'flowcore.sid',
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    proxy: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 8,
    },
  })
);


// =======================
// GLOBAL TEMPLATE VARIABLES
// =======================
app.use((req, res, next) => {
  res.locals.active = '';
  res.locals.merchantName = req.session?.merchantName || null;
  next();
});


// =======================
// RATE LIMITING
// =======================

// login brute force protection
app.use(
  '/login',
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// dashboard protection
app.use(
  '/dashboard',
  rateLimit({
    windowMs: 60 * 1000,
    max: 120,
  })
);

// prevent push spam
app.use(
  '/push',
  rateLimit({
    windowMs: 60 * 1000,
    max: 30,
  })
);


// =======================
// CORS
// =======================
app.use(
  cors({
    origin:
      process.env.NODE_ENV === 'production'
        ? process.env.CORS_ORIGIN
        : true,
    credentials: true,
  })
);


// =======================
// BODY PARSING
// =======================

// IMPORTANT: Paynow webhook MUST use RAW body
app.use('/webhooks/paynow', express.raw({ type: '*/*' }));

// normal parsers
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true }));


// =======================
// LOGGING
// =======================
app.use(
  morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev')
);

//Page Front//

app.get('/', (req, res) => {
  res.redirect('/login');
});

// =======================
// ROUTES
// =======================

app.use('/', authRoutes);
app.use('/dashboard', dashboardRoutes);
app.use('/settings', settingsRoutes);
app.use('/health', healthRoutes);
app.use('/webhooks/paynow', paynowWebhook);
app.use('/orders', orderRoutes);
app.use('/push', pushRoutes);
app.use('/pay', paymentPageRoutes);
app.use('/pay/status', payStatusRoutes);


// =======================
// 404 HANDLER
// =======================
app.use((req, res) => {
  if (req.accepts('html')) {
    return res.status(404).render('errors/404', {
      title: 'Not Found'
    });
  }

  res.status(404).json({
    error: 'Not Found',
    path: req.originalUrl,
  });
});


// =======================
// GLOBAL ERROR HANDLER
// =======================
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);

  const status = err.status || 500;

  if (req.accepts('html')) {
    return res.status(status).render('errors/500', {
      title: 'Error',
      message:
        process.env.NODE_ENV === 'production'
          ? 'Something went wrong.'
          : err.message,
    });
  }

  res.status(status).json({
    error:
      process.env.NODE_ENV === 'production'
        ? 'Internal Server Error'
        : err.message,
  });
});

module.exports = app;
