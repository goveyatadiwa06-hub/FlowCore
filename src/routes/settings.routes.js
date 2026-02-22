const express = require('express');
const { requireAuth } = require('../middleware/requireAuth');
const { pool } = require('../config/database');
const { encrypt, decrypt } = require('../utils/encryption');

const router = express.Router();


/**
 * ===============================
 * GET SETTINGS PAGE
 * ===============================
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const merchantId = req.session.merchantId;

    const result = await pool.query(
      `SELECT paynow_integration_id, paynow_integration_key
       FROM merchants
       WHERE id = $1`,
      [merchantId]
    );

    const merchant = result.rows[0] || {};

    let integrationKey = '';

    if (merchant.paynow_integration_key) {
      try {
        integrationKey = decrypt(merchant.paynow_integration_key);
      } catch (err) {
        console.error('Decrypt failed:', err);
      }
    }

    res.render('dashboard/settings', {
      title: 'Settings',
      active: 'settings',
      integrationId: merchant.paynow_integration_id || '',
      integrationKey,
      success: req.query.success,
      error: req.query.error
    });

  } catch (err) {
    console.error('Settings load error:', err);
    res.render('dashboard/settings', {
      title: 'Settings',
      active: 'settings',
      integrationId: '',
      integrationKey: '',
      error: 'Unable to load settings'
    });
  }
});


/**
 * ===============================
 * SAVE SETTINGS
 * ===============================
 */
router.post('/', requireAuth, async (req, res) => {
  try {
    const merchantId = req.session.merchantId;
    const { integrationId, integrationKey } = req.body;

    if (!integrationId || !integrationKey) {
      return res.redirect('/settings?error=All fields are required');
    }

    await pool.query(
      `UPDATE merchants
       SET paynow_integration_id = $1,
           paynow_integration_key = $2
       WHERE id = $3`,
      [integrationId.trim(), encrypt(integrationKey.trim()), merchantId]
    );

    return res.redirect('/settings?success=1');

  } catch (err) {
    console.error('Settings save error:', err);
    return res.redirect('/settings?error=Failed to save credentials');
  }
});

module.exports = router;
