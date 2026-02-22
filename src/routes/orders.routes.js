const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');

router.post('/', async (req, res) => {
  const client = await pool.connect();

  try {
    let { merchant_id, amount, description, phone, currency } = req.body;

    // ===== VALIDATION =====
    if (!merchant_id || !amount) {
      return res.status(400).json({
        error: 'merchant_id and amount are required'
      });
    }

    if (isNaN(amount) || Number(amount) <= 0) {
      return res.status(400).json({
        error: 'amount must be a valid number'
      });
    }

    // normalize phone (remove spaces)
    if (phone) {
      phone = phone.replace(/\s+/g, '');
    }

    currency = currency || 'USD';

    // unique reference
    const reference = `ORD-${Date.now()}`;

    // ===== TRANSACTION START =====
    await client.query('BEGIN');

    // create order
    const orderResult = await client.query(
      `
      INSERT INTO orders
      (merchant_id, amount, currency, reference, description)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, reference, amount, currency, status
      `,
      [merchant_id, amount, currency, reference, description || null]
    );

    const order = orderResult.rows[0];

    // create payment record automatically
    await client.query(
      `
      INSERT INTO payments
      (order_id, method, status, phone)
      VALUES ($1, 'ecocash', 'pending', $2)
      `,
      [order.id, phone || null]
    );

    // ===== TRANSACTION COMMIT =====
    await client.query('COMMIT');

    res.status(201).json({
      success: true,
      order
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Order creation failed:', err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

module.exports = router;
