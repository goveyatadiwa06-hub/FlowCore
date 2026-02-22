const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');

router.get('/:reference', async (req, res) => {
  const { reference } = req.params;

  try {
    const result = await pool.query(
      `SELECT status FROM orders WHERE reference=$1`,
      [reference]
    );

    if (!result.rowCount) {
      return res.json({ status: 'unknown' });
    }

    // 🔴 CRITICAL: disable caching
    res.set('Cache-Control', 'no-store');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');

    res.json({ status: result.rows[0].status });

  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error' });
  }
});


module.exports = router;
