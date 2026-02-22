const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { initiatePush } = require('../services/paynow.service');

router.post('/:reference', async (req, res) => {
  const client = await pool.connect();

  try {
    const { reference } = req.params;

    if (!reference) {
      return res.status(400).json({ error: 'Reference is required' });
    }

    await client.query('BEGIN');

    // 🔒 Lock row to prevent duplicate push attempts
    const result = await client.query(
      `
      SELECT
        o.id AS order_id,
        o.merchant_id,
        o.amount,
        o.currency,
        p.id AS payment_id,
        p.phone,
        p.status,
        p.poll_url
      FROM orders o
      JOIN payments p ON p.order_id = o.id
      WHERE o.reference = $1
      FOR UPDATE
      `,
      [reference]
    );

    if (result.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Order not found' });
    }

    const payment = result.rows[0];

     //Server Protection//

    if (payment.push_attempt_count >= 3) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Maximum push attempts reached'
      });
    }
    

    // ===== VALIDATION =====

if (!payment.phone) {
  await client.query('ROLLBACK');
  return res.status(400).json({ error: 'No phone number provided' });
}

// Only allow push from valid states
const allowedStates = ['pending', 'failed', 'cancelled'];

if (!allowedStates.includes(payment.status)) {
  await client.query('ROLLBACK');
  return res.status(400).json({
    error: `Push not allowed in current state: ${payment.status}`
  });
}

console.log('🚀 Initiating push payment');
console.log(`Reference: ${reference}`);
console.log(`Merchant: ${payment.merchant_id}`);
console.log(`Phone: ${payment.phone}`);
console.log(`Amount: ${payment.amount}`);


    // ===== INITIATE PUSH =====
    const gatewayResponse = await initiatePush({
      reference,
      amount: payment.amount,
      phone: payment.phone,
      merchant_id: payment.merchant_id
    });

    if (!gatewayResponse || !gatewayResponse.success) {
      await client.query('ROLLBACK');

      console.error('Gateway rejection:', gatewayResponse);

      return res.status(502).json({
        error: gatewayResponse?.error || 'Payment gateway rejected request'
      });
    }

    // ===== UPDATE PAYMENT STATUS =====
    await client.query(
      `
      UPDATE payments
      SET status = 'processing',
          poll_url = $1,
          push_attempted_at = NOW(),
          push_attempt_count = push_attempt_count + 1,
          updated_at = NOW()
      WHERE id = $2
      `,
      [gatewayResponse.pollUrl || null, payment.payment_id]
    );
    
    await client.query('COMMIT');

    res.json({
      success: true,
      message: gatewayResponse.instructions || 'Push prompt sent',
      phone: payment.phone,
      amount: payment.amount,
      reference
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Push initiation error:', err);

    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

module.exports = router;
