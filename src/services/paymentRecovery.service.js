const axios = require('axios');
const qs = require('querystring');
const { pool } = require('../config/database');

const TIMEOUT_MINUTES = 10;
const MAX_RECOVERY_ATTEMPTS = 5;

const markTimedOutPayments = async () => {
  const client = await pool.connect();

  try {
    console.log('🔍 Running hardened recovery check...');

    await client.query('BEGIN');

    const stuckPayments = await client.query(
      `
      SELECT id, poll_url, recovery_attempts
      FROM payments
      WHERE status = 'processing'
      AND push_attempted_at IS NOT NULL
      AND push_attempted_at < NOW() - INTERVAL '${TIMEOUT_MINUTES} minutes'
      AND recovery_attempts < $1
      FOR UPDATE
      `,
      [MAX_RECOVERY_ATTEMPTS]
    );

    if (stuckPayments.rowCount === 0) {
      await client.query('COMMIT');
      console.log('✅ No stuck payments found');
      return;
    }

    for (const payment of stuckPayments.rows) {
      try {

        let finalStatus = 'failed';

        // Try re-verifying with Paynow first
        if (payment.poll_url) {
          const verification = await axios.get(payment.poll_url);
          const parsed =
            typeof verification.data === 'string'
              ? qs.parse(verification.data)
              : verification.data;

          const status = parsed.status?.toLowerCase();

          if (['paid', 'failed', 'cancelled'].includes(status)) {
            finalStatus = status;
          }
        }

        await client.query(
          `
          UPDATE payments
          SET status = $1,
              recovery_attempts = recovery_attempts + 1,
              last_recovery_at = NOW(),
              paid_at = CASE WHEN $1 = 'paid' THEN NOW() ELSE paid_at END,
              updated_at = NOW()
          WHERE id = $2
          `,
          [finalStatus, payment.id]
        );

        console.log(
          `⚙️ Recovery: Payment ${payment.id} set to ${finalStatus}`
        );

      } catch (err) {
        console.error(
          `⚠️ Recovery failed for payment ${payment.id}`,
          err.message
        );
      }
    }

    await client.query('COMMIT');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Hardened recovery error:', err.message);
  } finally {
    client.release();
  }
};

module.exports = { markTimedOutPayments };
