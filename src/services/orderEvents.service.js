async function insertOrderEvent({
    dbClient,
    order_id,
    previous_state,
    new_state,
    source,
    reason = null,
    metadata = null
  }) {
  
    await dbClient.query(
      `
      INSERT INTO order_events
      (order_id, previous_state, new_state, source, reason, metadata)
      VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [
        order_id,
        previous_state,
        new_state,
        source,
        reason,
        metadata
      ]
    );
  }
  
  module.exports = {
    insertOrderEvent
  };