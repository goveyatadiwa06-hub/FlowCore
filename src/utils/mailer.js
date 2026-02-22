const axios = require('axios');

async function sendEmail({ to, subject, html }) {
  if (!process.env.BREVO_API_KEY) {
    throw new Error('BREVO_API_KEY missing');
  }

  if (!process.env.SENDER_EMAIL) {
    throw new Error('SENDER_EMAIL missing');
  }

  await axios.post(
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
}

async function sendVerificationEmail(email, verificationLink) {
  const subject = 'Verify your FlowCore account';

  const html = `
    <h2>Welcome to FlowCore</h2>
    <p>Please verify your account by clicking the link below:</p>
    <a href="${verificationLink}">Verify Account</a>
  `;

  await sendEmail({
    to: email,
    subject,
    html,
  });
}

module.exports = {
  sendVerificationEmail,
};