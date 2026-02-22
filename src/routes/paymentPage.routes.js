const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');


// =====================================
// STATUS ENDPOINT (JSON)
// =====================================
router.get('/status/:reference', async (req, res) => {
  try {
    const { reference } = req.params;

    const result = await pool.query(
      'SELECT reference, status FROM orders WHERE reference = $1',
      [reference]
    );

    if (!result.rowCount) {
      return res.status(404).json({ error: 'Not found' });
    }

    res.json(result.rows[0]);

  } catch (err) {
    console.error('Status fetch error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});


// =====================================
// PAYMENT PAGE
// =====================================
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
        m.business_name,
        p.phone
      FROM orders o
      JOIN merchants m ON m.id = o.merchant_id
      JOIN payments p ON p.order_id = o.id
      WHERE o.reference = $1
      `,
      [reference]
    );

    if (!result.rowCount) {
      return res.status(404).send('Payment not found');
    }

    const order = result.rows[0];

    res.send(`
<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${order.business_name} Payment</title>

<style>
  body {
    font-family: system-ui, -apple-system, Segoe UI, Roboto;
    background: #f6f7fb;
    display:flex;
    justify-content:center;
    align-items:center;
    height:100vh;
    margin:0;
  }
  .card {
    background:white;
    padding:28px;
    border-radius:14px;
    width:100%;
    max-width:420px;
    text-align:center;
    box-shadow:0 8px 28px rgba(0,0,0,0.08);
  }
  h2 {
    margin:0 0 8px;
  }
  .amount {
    font-size:30px;
    font-weight:700;
    margin:18px 0;
  }
  .reference {
    font-size:13px;
    color:#666;
  }
  .status {
    margin-top:12px;
    font-size:14px;
    color:#555;
  }
  button {
    width:100%;
    padding:14px;
    border:none;
    border-radius:10px;
    background:#111827;
    color:white;
    font-size:16px;
    margin-top:18px;
    cursor:pointer;
    transition:.2s;
  }
  button:hover { opacity:.92; }
  button:disabled {
    background:#999;
    cursor:not-allowed;
  }
  .success { color:#059669; font-weight:600; }
  .failed { color:#dc2626; font-weight:600; }
</style>
</head>

<body>
<div class="card" id="card">
  <h2>${order.business_name}</h2>
  <div>Payment Request</div>

  <div class="amount">${order.currency} ${order.amount}</div>
  <div class="reference">Ref: ${order.reference}</div>

  ${
    order.status === 'paid'
      ? '<p class="success">Payment Completed</p>'
      : '<button id="payBtn">Pay with EcoCash</button>'
  }

  <div class="status" id="statusText">Status: ${order.status}</div>
</div>

<script>
const btn = document.getElementById("payBtn");
const statusText = document.getElementById("statusText");
const card = document.getElementById("card");
let polling;


// =======================
// PUSH REQUEST
// =======================
if (btn) {
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.innerText = "Sending prompt...";

    try {
      const res = await fetch("/push/${order.reference}", {
        method: "POST"
      });

      if (!res.ok) throw new Error();

      btn.innerText = "Waiting for approval…";
      statusText.innerText = "Status: awaiting mobile confirmation";

      startPolling();

    } catch {
      btn.innerText = "Error. Try again";
      btn.disabled = false;
    }
  });
}


// =======================
// POLL PAYMENT STATUS
// =======================
async function checkStatus() {
  try {
    const res = await fetch("/pay/status/${order.reference}");
    if (!res.ok) return;

    const data = await res.json();

    statusText.innerText = "Status: " + data.status;

    if (data.status === "paid") {
      showSuccess();
      clearInterval(polling);
    }

    if (data.status === "failed" || data.status === "cancelled") {
      showFailure();
      clearInterval(polling);
    }

  } catch {}
}

function startPolling() {
  if (polling) return;
  polling = setInterval(checkStatus, 3000);
}


// =======================
// SUCCESS SCREEN
// =======================
function showSuccess() {
  card.innerHTML = \`
    <h2>Payment Successful</h2>
    <p class="success">Thank you. Payment received.</p>
    <p>Reference: ${order.reference}</p>
  \`;
}


// =======================
// FAILURE SCREEN
// =======================
function showFailure() {
  card.innerHTML = \`
    <h2>Payment Failed</h2>
    <p class="failed">Please try again.</p>
    <button onclick="location.reload()">Retry Payment</button>
  \`;
}
</script>
</body>
</html>
    `);

  } catch (err) {
    console.error('Payment page error:', err);
    res.status(500).send('Server error');
  }
});

module.exports = router;
