const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');

// GET PAYMENT DETAILS BY REFERENCE
router.get('/:reference', async (req, res) => {
  try {
    const { reference } = req.params;

    const result = await pool.query(
      `
      SELECT
        o.reference,
        o.amount,
        o.currency,
        o.status,
        m.business_name
      FROM orders o
      JOIN merchants m ON m.id = o.merchant_id
      WHERE o.reference = $1
      `,
      [reference]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    res.json(result.rows[0]);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
