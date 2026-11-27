import { reorderScheduledStops } from './route-planning.js';

export async function saveStockCondition(connection, outletId, stockCondition) {
  await connection.execute(
    `INSERT INTO stock_status (outlet_id, stock_condition)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE stock_condition = VALUES(stock_condition), updated_at = CURRENT_TIMESTAMP`,
    [outletId, stockCondition],
  );
}

async function cancelScheduledRestocks(connection, outletId) {
  const [result] = await connection.execute(
    `UPDATE delivery_routes SET delivery_status = 'SKIPPED'
     WHERE target_outlet_id = ? AND task_type = 'RESTOCK' AND delivery_status = 'SCHEDULED'`,
    [outletId],
  );
  return Number(result.affectedRows || 0);
}

export async function updatePartnerStock(connection, outletId, stockCondition) {
  await saveStockCondition(connection, outletId, stockCondition);

  if (stockCondition === 'SAFE') {
    const cancelled = await cancelScheduledRestocks(connection, outletId);
    return { scheduled: false, cancelled: cancelled > 0 };
  }

  const [activeRoutes] = await connection.execute(
    `SELECT route_id FROM delivery_routes
     WHERE target_outlet_id = ? AND task_type = 'RESTOCK'
       AND delivery_status IN ('SCHEDULED', 'IN_TRANSIT')
     LIMIT 1`,
    [outletId],
  );
  if (activeRoutes.length > 0) return { scheduled: false, cancelled: false };

  const [rows] = await connection.execute(
    `SELECT COALESCE(MAX(stop_order), 0) + 1 AS nextStopOrder
     FROM delivery_routes
     WHERE scheduled_date = DATE_ADD(CURDATE(), INTERVAL 1 DAY)`,
  );
  await connection.execute(
    `INSERT INTO delivery_routes (task_type, target_outlet_id, delivery_status, scheduled_date, stop_order)
     VALUES ('RESTOCK', ?, 'SCHEDULED', DATE_ADD(CURDATE(), INTERVAL 1 DAY), ?)`,
    [outletId, Number(rows[0].nextStopOrder)],
  );
  const [dates] = await connection.execute(
    'SELECT DATE_ADD(CURDATE(), INTERVAL 1 DAY) AS scheduledDate',
  );
  await reorderScheduledStops(connection, dates[0].scheduledDate);
  return { scheduled: true, cancelled: false };
}

export async function markRestockCompleted(connection, outletId) {
  await connection.execute(
    `INSERT INTO stock_status (outlet_id, stock_condition, last_restocked_at)
     VALUES (?, 'SAFE', CURRENT_TIMESTAMP)
     ON DUPLICATE KEY UPDATE stock_condition = 'SAFE',
      last_restocked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP`,
    [outletId],
  );
  await cancelScheduledRestocks(connection, outletId);
}
