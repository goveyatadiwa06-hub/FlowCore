const { transitionOrderState } = require('../services/orderState.service');
const crypto = require('crypto');
const express = require('express');
const router = express.Router();
const axios = require('axios');
const { pool } = require('../config/database');
const qs = require('querystring');

router.post('/callback', async (req, res) => {
  const client = await pool.connect();

  try {
    console.log("📩 Paynow callback received");

    // SAFETY: handle raw buffer if parser fails
    let body = req.body;

    if (Buffer.isBuffer(body)) {
      body = qs.parse(body.toString());
    }

    console.log(body);

    const reference = body.reference;
    const paynowRef = body.paynowreference || null;
    const pollUrl = body.pollurl || body.pollUrl || null;

    if (!reference) {
      console.log("❌ Reference missing from payload");
      return res.sendStatus(200);
    }

    // =========================
// LOG RAW WEBHOOK EVENT
// =========================
const webhookLog = await client.query(
  `
  INSERT INTO webhook_events
  (provider, reference, paynow_reference, event_status, raw_payload)
  VALUES ($1, $2, $3, $4, $5)
  RETURNING id
  `,
  [
    'paynow',
    body.reference || null,
    body.paynowreference || null,
    body.status || null,
    body
  ]
);

const webhookEventId = webhookLog.rows[0].id;


    // =========================
// FETCH MERCHANT INTEGRATION KEY
// =========================
const merchantResult = await client.query(
  `
  SELECT m.paynow_integration_key
  FROM merchants m
  JOIN orders o ON o.merchant_id = m.id
  WHERE o.reference = $1
  `,
  [reference]
);

if (merchantResult.rowCount === 0) {
  console.log("❌ Merchant not found for reference");
  return res.sendStatus(200);
}

const encryptedKey = merchantResult.rows[0].paynow_integration_key;

const { decrypt } = require('../utils/encryption');
const integrationKey = decrypt(encryptedKey).trim();

// =========================
// 🔐 VERIFY PAYNOW HASH (CORRECT)
// =========================

if (!body.hash) {
  console.log("❌ Missing hash in webhook");

  await client.query(
    `
    UPDATE webhook_events
    SET hash_valid = false,
        processed = true,
        processed_at = NOW()
    WHERE id = $1
    `,
    [webhookEventId]
  );

  return res.sendStatus(200);
}

const receivedHash = body.hash.toUpperCase();

// Remove hash field
delete body.hash;

// Build string in exact Paynow field order
const pollUrlValue = body.pollurl || body.pollUrl || '';

const signingString =
  body.reference +
  body.paynowreference +
  body.amount +
  body.status +
  pollUrlValue +
  integrationKey;


const generatedHash = crypto
  .createHash("sha512")
  .update(signingString)
  .digest("hex")
  .toUpperCase();

if (generatedHash !== receivedHash) {
  console.log("❌ Hash verification failed");

  await client.query(
    `
    UPDATE webhook_events
    SET hash_valid = false,
        processed = true,
        processed_at = NOW()
    WHERE id = $1
    `,
    [webhookEventId]
  );

  return res.sendStatus(200);
}

console.log("🔐 Hash verified successfully");

await client.query(
  `
  UPDATE webhook_events
  SET hash_valid = true
  WHERE id = $1
  `,
  [webhookEventId]
);

    // =========================
    // 🔐 VERIFY PAYMENT WITH PAYNOW
    // =========================
    let verifiedStatus = 'failed';

    if (pollUrl) {
      try {
        const verification = await axios.get(pollUrl);

        const parsed =
          typeof verification.data === 'string'
            ? qs.parse(verification.data)
            : verification.data;

        if (parsed && parsed.status) {
          verifiedStatus = parsed.status.toLowerCase();
        }

      } catch (verifyError) {
        console.error("⚠️ Poll verification failed:", verifyError.message);
        return res.sendStatus(200);
      }
    } else {
      console.log("⚠️ No poll URL provided, using payload status");
      verifiedStatus = (body.status || 'failed').toLowerCase();
    }

    const allowedStatuses = ['paid', 'failed', 'cancelled'];

    if (!allowedStatuses.includes(verifiedStatus)) {
      console.log("⚠️ Unknown status:", verifiedStatus);
      return res.sendStatus(200);
    }

    console.log("✅ Verified status:", verifiedStatus);

    await client.query('BEGIN');

    //Gaurd against duplicate webhook records//

    const existing = await client.query(
      `SELECT status FROM payments
       WHERE order_id = (
         SELECT id FROM orders WHERE reference = $1
       )`,
      [reference]
    );
    
    if (existing.rowCount === 0) return res.sendStatus(200);
    
    if (existing.rows[0].status === verifiedStatus) {
      console.log("⚠️ Duplicate webhook ignored");
    
      await client.query(
        `UPDATE webhook_events
         SET processed = true,
             processed_at = NOW()
         WHERE id = $1`,
        [webhookEventId]
      );
    
      return res.sendStatus(200);
    }

    //Events Timeline Code//

    const orderResult = await client.query(
      `SELECT * FROM orders WHERE reference = $1 FOR UPDATE`,
      [reference]
    );
    
    if (orderResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.sendStatus(200);
    }
    
    const order = orderResult.rows[0];

    // =========================
    // UPDATE PAYMENT
    // =========================
    const paymentResult = await client.query(
      `
      UPDATE payments
      SET status = $1,
          gateway_reference = $2,
          paid_at = CASE WHEN $1='paid' THEN NOW() ELSE NULL END
      WHERE order_id = (
        SELECT id FROM orders WHERE reference = $3
      )
      RETURNING id, order_id
      `,
      [verifiedStatus, paynowRef, reference]
    );

    if (paymentResult.rowCount === 0) {
      await client.query('ROLLBACK');
      console.log("⚠️ Payment not found");
      return res.sendStatus(200);
    }

    const payment = paymentResult.rows[0];

    //Another events timeline code//
    await transitionOrderState({
      dbClient: client,
      order,
      newState: verifiedStatus,
      source: 'webhook',
      reason: 'Paynow callback verified',
      metadata: body
    });


    // =========================
    // LEDGER ENTRY
    // =========================
    if (verifiedStatus === 'paid') {
      await client.query(
        `
        INSERT INTO transactions
        (merchant_id, payment_id, type, amount, currency, status)
        SELECT
          o.merchant_id,
          $1,
          'payment',
          o.amount,
          o.currency,
          'completed'
        FROM orders o
        WHERE o.id = $2
        AND NOT EXISTS (
          SELECT 1 FROM transactions WHERE payment_id = $1
        )
        `,
        [payment.id, payment.order_id]
      );

      console.log("💰 Payment recorded & ledger updated");
    }

    await client.query('COMMIT');

    res.sendStatus(200); // REQUIRED by Paynow

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Webhook error:', err);
    res.sendStatus(200);
  } finally {
    client.release();
  }
});

module.exports = router;
