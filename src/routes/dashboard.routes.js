const { getRevenueTrend } = require('../services/analytics.service');
const express = require('express');
const { pool } = require('../config/database');
const { requireAuth } = require('../middleware/requireAuth');
const { initiatePush } = require('../services/paynow.service');
const csv = require('fast-csv');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();

/* ===============================
   HELPERS
=============================== */

async function getMerchantName(merchantId) {
  const result = await pool.query(
    `SELECT business_name FROM merchants WHERE id=$1`,
    [merchantId]
  );

  return result.rows[0]?.business_name || 'Merchant';
}

function normalizeZWPhone(input) {
  if (!input) return null;

  let phone = input.replace(/\s+/g, '');

  if (phone.startsWith('07')) {
    phone = '+263' + phone.slice(1);
  }

  if (!phone.startsWith('+263')) return null;

  return phone.length === 13 ? phone : null;
}

async function getMerchant(merchantId) {
  const result = await pool.query(
    `SELECT id, business_name FROM merchants WHERE id=$1`,
    [merchantId]
  );

  return result.rows[0] || null;
}


/* ===============================
   DASHBOARD HOME
=============================== */

router.get('/', requireAuth, async (req, res) => {
  try {
    const merchantId = req.session.merchantId;
    const merchant = await getMerchant(merchantId);
    if (!merchant) return res.redirect('/login');

    /* ===============================
       TODAY STATS
    =============================== */
    const stats = await pool.query(`
      SELECT
        COALESCE(SUM(amount) FILTER (
          WHERE status='paid'
          AND DATE(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Harare')
              = DATE(NOW() AT TIME ZONE 'Africa/Harare')
        ),0) AS today_revenue,
    
        COUNT(*) FILTER (
          WHERE DATE(created_at AT TIME ZONE 'Africa/Harare')
              = DATE(NOW() AT TIME ZONE 'Africa/Harare')
        ) AS total_today,
    
        COUNT(*) FILTER (
          WHERE status='paid'
          AND DATE(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Harare')
              = DATE(NOW() AT TIME ZONE 'Africa/Harare')
        ) AS success_today
      FROM orders
      WHERE merchant_id=$1
    `, [merchantId]);
    

    const s = stats.rows[0];
    const totalToday = Number(s.total_today || 0);
    const successToday = Number(s.success_today || 0);

    const successRate =
      totalToday > 0
        ? ((successToday / totalToday) * 100).toFixed(1) + '%'
        : '0%';
   

        /* ===============================
   7 DAY REVENUE TREND
=============================== */
const revenueTrend = await getRevenueTrend(merchantId);


    /* ===============================
       RECENT TRANSACTIONS
    =============================== */
    const recent = await pool.query(
      `
      SELECT reference, amount, status, created_at
      FROM orders
      WHERE merchant_id=$1
      ORDER BY created_at DESC
      LIMIT 5
      `,
      [merchantId]
    );

    res.render('dashboard/dashboard', {
      title: 'Overview',
      active: 'dashboard',
      showCreate: true,
      merchantName: merchant.business_name,
      merchantId: merchantId, 
      todayRevenue: Number(s.today_revenue).toFixed(2),
      totalTransactionsToday: totalToday,
      successRate,
      transactions: recent.rows,
      revenueTrend
    });

  } catch (err) {
    console.error('Dashboard error:', err);
    res.redirect('/login');
  }
});


/* ===============================
   TRANSACTIONS LIST
=============================== */

router.get('/transactions', requireAuth, async (req, res) => {
  try {
    const merchantId = req.session.merchantId;
    const merchant = await getMerchant(merchantId);
    if (!merchant) return res.redirect('/login');

    const result = await pool.query(
      `
      SELECT id, reference, amount, status, created_at
      FROM orders
      WHERE merchant_id = $1
      ORDER BY created_at DESC
      LIMIT 50
      `,
      [merchantId]
    );

    res.render('dashboard/transactions', {
      title: 'Transactions',
      active: 'transactions',
      merchantName: merchant.business_name,
      transactions: result.rows
    });

  } catch (err) {
    console.error(err);
    res.redirect('/dashboard');
  }
});


/* ===============================
   TRANSACTION DETAIL
=============================== */

/* ===============================
   TRANSACTION DETAIL
=============================== */

router.get('/transactions/:id', requireAuth, async (req, res) => {
  try {
    const merchantId = req.session.merchantId;
    const merchant = await getMerchant(merchantId);
    if (!merchant) return res.redirect('/login');

    const { id } = req.params;

    const result = await pool.query(
      `
      SELECT
        o.id,
        o.reference,
        o.amount,
        o.status,
        o.description,
        o.created_at,
        p.phone,
        p.gateway_reference
      FROM orders o
      LEFT JOIN payments p ON p.order_id = o.id
      WHERE o.id=$1 AND o.merchant_id=$2
      `,
      [id, merchantId]
    );

    if (!result.rowCount) {
      return res.status(404).send('Transaction not found');
    }

    // ✅ FIX: use correct variable name
    const tx = result.rows[0];

    // ✅ Fetch events after tx exists
    const eventsResult = await pool.query(
      `
      SELECT previous_state,
             new_state,
             source,
             reason,
             metadata,
             created_at
      FROM order_events
      WHERE order_id = $1
      ORDER BY created_at ASC
      `,
      [tx.id]
    );

    const events = eventsResult.rows;

    res.render('dashboard/transaction-detail', {
      title: 'Transaction Details',
      active: 'transactions',
      merchantName: merchant.business_name,
      tx,
      events
    });

  } catch (err) {
    console.error(err);
    res.redirect('/dashboard');
  }
});

/* ===============================
   NEW PAYMENT PAGE
=============================== */

router.get('/new-payment', requireAuth, async (req, res) => {
  try {
    const merchantId = req.session.merchantId;
    const merchant = await getMerchant(merchantId);
    if (!merchant) return res.redirect('/login');

    res.render('dashboard/new-payment', {
      title: 'Create Payment',
      active: 'create',
      merchantName: merchant.business_name,
      reference: null,
      amount: null,
      paymentLink: null
    });

  } catch (err) {
    console.error(err);
    res.redirect('/dashboard');
  }
});


/* ===============================
   CREATE PAYMENT
=============================== */

router.post('/new-payment', requireAuth, async (req, res) => {
  const client = await pool.connect();

  try {
    const merchantId = req.session.merchantId;
    const merchant = await getMerchant(merchantId);
    if (!merchant) return res.redirect('/login');

    let { phone, amount, description, action } = req.body;

    phone = normalizeZWPhone(phone);
    amount = parseFloat(amount);

    if (!phone || isNaN(amount) || amount <= 0) {
      return res.redirect('/dashboard/new-payment');
    }

    const reference = `ORD-${uuidv4()}`;

    await client.query('BEGIN');

    const order = await client.query(
      `
      INSERT INTO orders
      (merchant_id, reference, amount, currency, description, status)
      VALUES ($1,$2,$3,'USD',$4,'pending')
      RETURNING id
      `,
      [merchantId, reference, amount, description || null]
    );

    await client.query(
      `INSERT INTO payments (order_id, phone, status)
       VALUES ($1,$2,'pending')`,
      [order.rows[0].id, phone]
    );

    await client.query('COMMIT');

    if (action === 'push') {
      return res.redirect(`/dashboard/push-status/${reference}`);
    }

    return res.redirect(`/dashboard/payment-link/${reference}`);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.redirect('/dashboard');
  } finally {
    client.release();
  }
});

/* ===============================
   PAYMENT LINK PAGE
=============================== */
router.get('/payment-link/:reference', requireAuth, async (req, res) => {
  const merchantId = req.session.merchantId;
  const { reference } = req.params;

  const paymentLink = `${req.protocol}://${req.get('host')}/pay/${reference}`;

  res.render('dashboard/payment-link', {
    title: 'Payment Link',
    active: 'create',
    merchantName: await getMerchantName(merchantId),
    reference,
    paymentLink
  });
});


/* ===============================
   PUSH STATUS PAGE
=============================== */
router.get('/push-status/:reference', requireAuth, async (req, res) => {
  const merchantId = req.session.merchantId;
  const { reference } = req.params;

  res.render('dashboard/push-status', {
    title: 'Waiting for Payment',
    active: 'create',
    merchantName: await getMerchantName(merchantId),
    reference
  });
});

console.log("Server now:", new Date());

module.exports = router;
