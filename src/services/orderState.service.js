const { insertOrderEvent } = require('./orderEvents.service');

async function transitionOrderState({
  dbClient,          // <-- pass existing transaction client
  order,
  newState,
  source,
  reason = null,
  metadata = null
}) {

  if (order.status === newState) {
    return order; // idempotent
  }

  const previousState = order.status;

  // Update order
  const updateResult = await dbClient.query(
    `
    UPDATE orders
    SET status = $1,
        paid_at = CASE WHEN $1='paid' THEN NOW() ELSE NULL END
    WHERE id = $2
    RETURNING *
    `,
    [newState, order.id]
  );

  const updatedOrder = updateResult.rows[0];

  // Insert event
  await dbClient.query(
    `
    INSERT INTO order_events
    (order_id, previous_state, new_state, source, reason, metadata)
    VALUES ($1, $2, $3, $4, $5, $6)
    `,
    [
      order.id,
      previousState,
      newState,
      source,
      reason,
      metadata
    ]
  );

  return updatedOrder;
}

module.exports = {
  transitionOrderState
};