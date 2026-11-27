import { orderNorthToSouth } from './scheduler.js';

export function withGeographicStopOrders(routes) {
  const routesByDate = new Map();
  for (const route of routes) {
    if (route.deliveryStatus === 'SKIPPED') continue;
    const date = String(route.scheduledDate).slice(0, 10);
    const dayRoutes = routesByDate.get(date) || [];
    dayRoutes.push(route);
    routesByDate.set(date, dayRoutes);
  }

  const stopOrders = new Map();
  for (const dayRoutes of routesByDate.values()) {
    for (const [index, route] of orderNorthToSouth(dayRoutes).entries()) {
      stopOrders.set(Number(route.routeId), index + 1);
    }
  }

  return routes
    .map((route) => ({
      ...route,
      stopOrder: stopOrders.get(Number(route.routeId)) ?? route.stopOrder,
    }))
    .sort((a, b) => String(a.scheduledDate).localeCompare(String(b.scheduledDate))
      || Number(a.stopOrder) - Number(b.stopOrder)
      || Number(a.routeId) - Number(b.routeId));
}

export async function reorderScheduledStops(connection, scheduledDate) {
  const [stops] = await connection.execute(`
    SELECT r.route_id AS routeId,
      ST_Latitude(o.location) AS latitude, ST_Longitude(o.location) AS longitude
    FROM delivery_routes r
    JOIN outlets o ON o.outlet_id = r.target_outlet_id
    WHERE r.scheduled_date = ? AND r.delivery_status <> 'SKIPPED'`,
  [scheduledDate]);
  const ordered = orderNorthToSouth(stops);
  for (const [index, stop] of ordered.entries()) {
    await connection.execute(
      'UPDATE delivery_routes SET stop_order = ? WHERE route_id = ?',
      [index + 1, stop.routeId],
    );
  }
  return ordered;
}
