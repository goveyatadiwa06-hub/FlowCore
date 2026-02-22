process.env.TZ = 'Africa/Harare';

require('dotenv').config();

const app = require('./app');
const { connectDB } = require('./src/config/database');
const { markTimedOutPayments } = require('./src/services/paymentRecovery.service');

const PORT = process.env.PORT || 3000;

let server;

const startServer = async () => {
  try {
    // 1️⃣ Connect DB
    await connectDB();

    // 2️⃣ Run recovery once at boot
    await markTimedOutPayments();

    // 3️⃣ Schedule recovery every 5 minutes
    setInterval(markTimedOutPayments, 5 * 60 * 1000);

    // 4️⃣ Start HTTP server
    server = app.listen(PORT, () => {
      console.log(`🚀 FlowCore running on port ${PORT}`);
    });

  } catch (err) {
    console.error('❌ Failed to start server');
    console.error(err);
    process.exit(1);
  }
};

const shutdown = () => {
  console.log('Shutting down server...');

  if (server) {
    server.close(() => {
      console.log('HTTP server closed');
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);


startServer();
