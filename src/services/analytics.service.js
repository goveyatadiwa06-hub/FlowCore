const { pool } = require('../config/database');

const getRevenueTrend = async (merchantId) => {
  const result = await pool.query(
    `
    WITH days AS (
      SELECT generate_series(
        CURRENT_DATE - INTERVAL '6 days',
        CURRENT_DATE,
        INTERVAL '1 day'
      )::date AS date
    )
    SELECT
      days.date,
      COALESCE(SUM(o.amount), 0) AS total
    FROM days
    LEFT JOIN orders o
      ON DATE(o.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Harare') = days.date
      AND o.merchant_id = $1
      AND o.status = 'paid'
    GROUP BY days.date
    ORDER BY days.date ASC
    `,
    [merchantId]
  );

  return result.rows;
};

module.exports = { getRevenueTrend };
