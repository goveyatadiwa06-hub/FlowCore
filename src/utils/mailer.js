const axios = require('axios');

async function sendEmail({ to, subject, html }) {
  if (!process.env.BREVO_API_KEY) {
    throw new Error('BREVO_API_KEY missing');
  }

  const response = await axios.post(
    'https://api.brevo.com/v3/smtp/email',
    {
      sender: {
        name: 'FlowCore',
        email: process.env.SENDER_EMAIL,
      },
      to: [{ email: to }],
      subject: subject,
      htmlContent: html,
    },
    {
      headers: {
        'api-key': process.env.BREVO_API_KEY,
        'Content-Type': 'application/json',
      },
    }
  );

  return response.data;
}

module.exports = sendEmail;