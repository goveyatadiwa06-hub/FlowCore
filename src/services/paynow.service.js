const { Paynow } = require('paynow');
const { pool } = require('../config/database');
const { decrypt } = require('../utils/encryption');

const initiatePush = async ({ reference, amount, phone, merchant_id }) => {
  try {
    if (!reference || !amount || !phone || !merchant_id) {
      throw new Error('Missing payment fields');
    }

    // 🔐 Load merchant credentials
    const { rows } = await pool.query(
      `SELECT paynow_integration_id,
              paynow_integration_key,
              email
       FROM merchants
       WHERE id = $1`,
      [merchant_id]
    );

    if (!rows.length) {
      throw new Error('Merchant not found');
    }

    const merchant = rows[0];

    if (!merchant.paynow_integration_id || !merchant.paynow_integration_key) {
      throw new Error('Merchant has not connected Paynow');
    }

    const integrationKey = decrypt(merchant.paynow_integration_key);

    const paynow = new Paynow(
      merchant.paynow_integration_id,
      integrationKey
    );

    paynow.resultUrl = process.env.PAYNOW_RESULT_URL;
    paynow.returnUrl = process.env.PAYNOW_RETURN_URL;

    const normalizedPhone = phone.startsWith('+')
      ? phone
      : `+${phone}`;

    console.log('📲 Sending Paynow push');
    console.log(`Merchant: ${merchant.email}`);
    console.log(`Reference: ${reference}`);
    console.log(`Phone: ${normalizedPhone}`);
    console.log(`Amount: ${amount}`);

    const payment = paynow.createPayment(
      reference,
      merchant.email // required by Paynow
    );

    payment.add('FlowCore Payment', amount);

    const response = await paynow.sendMobile(
      payment,
      normalizedPhone,
      'ecocash'
    );

    if (response.success) {
      console.log('✅ Paynow accepted request');

      return {
        success: true,
        pollUrl: response.pollUrl,
        instructions: response.instructions
      };
    }

    console.log('❌ Paynow rejected request');
    console.log(response);

    return { success: false, error: 'Push rejected' };

  } catch (error) {
    console.error('❌ Paynow error:', error.message);
    return { success: false, error: error.message };
  }
};

module.exports = { initiatePush };
