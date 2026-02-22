const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// Debug once at startup (safe, no full secrets)
console.log("SMTP USER:", process.env.SMTP_USER);
console.log(
  "SMTP PASS length:",
  process.env.SMTP_PASS ? process.env.SMTP_PASS.length : "Missing"
);

async function sendVerificationEmail(to, token) {
  const verifyUrl = `${process.env.BASE_URL}/verify-email?token=${token}`;

  console.log("Attempting to send email to:", to);

  try {
    const info = await transporter.sendMail({
      from: `"FlowCore" <${process.env.SENDER_EMAIL}>`,
      to,
      subject: 'Verify your FlowCore account',
      html: `
        <p>Welcome to FlowCore.</p>
        <p>Please verify your email:</p>
        <a href="${verifyUrl}">${verifyUrl}</a>
        <p>This link expires in 24 hours.</p>
      `,
    });

    console.log("Email sent successfully:", info.response);
  } catch (err) {
    console.error("Send error:", err.response || err.message || err);
    throw err; // important so register route knows it failed
  }
}

module.exports = { sendVerificationEmail };