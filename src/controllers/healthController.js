const { pool } = require('../config/database');

/**
 * Health check handler - verifies API and database connectivity.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function getHealth(req, res) {
  try {
    const result = await pool.query('SELECT NOW() as db_time');
    const dbTimestamp = result.rows[0].db_time;

    res.status(200).json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      database: {
        connected: true,
        timestamp: dbTimestamp,
      },
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      database: {
        connected: false,
        error: error.message,
      },
    });
  }
}

module.exports = {
  getHealth,
};
