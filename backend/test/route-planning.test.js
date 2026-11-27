import test from 'node:test';
import assert from 'node:assert/strict';
import { reorderScheduledStops, withGeographicStopOrders } from '../src/services/route-planning.js';

test('menghasilkan urutan geografis konsisten untuk setiap tanggal meski stop_order tersimpan sama', () => {
  const routes = withGeographicStopOrders([
    { routeId: 31, scheduledDate: '2026-11-28', deliveryStatus: 'SCHEDULED', stopOrder: 1, latitude: -1.9, longitude: 106.1 },
    { routeId: 32, scheduledDate: '2026-11-28', deliveryStatus: 'SCHEDULED', stopOrder: 1, latitude: -1.81, longitude: 106.1 },
    { routeId: 33, scheduledDate: '2026-11-28', deliveryStatus: 'SCHEDULED', stopOrder: 1, latitude: -1.8, longitude: 106.1 },
    { routeId: 34, scheduledDate: '2026-11-29', deliveryStatus: 'SCHEDULED', stopOrder: 1, latitude: -1.85, longitude: 106.1 },
  ]);

  assert.deepEqual(
    routes.filter((route) => route.scheduledDate === '2026-11-28').map((route) => [route.routeId, route.stopOrder]),
    [[33, 1], [32, 2], [31, 3]],
  );
  assert.equal(routes.find((route) => route.routeId === 34).stopOrder, 1);
});

test('menulis ulang stop_order dari titik paling utara dengan urutan tetangga terdekat', async () => {
  const calls = [];
  const connection = {
    async execute(sql, params = []) {
      calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
      if (sql.includes('JOIN outlets')) {
        return [[
          { routeId: 31, latitude: -1.9, longitude: 106.1 },
          { routeId: 32, latitude: -1.81, longitude: 106.1 },
          { routeId: 33, latitude: -1.8, longitude: 106.1 },
        ]];
      }
      return [{ affectedRows: 1 }];
    },
  };

  const ordered = await reorderScheduledStops(connection, '2026-11-28');

  assert.deepEqual(ordered.map((stop) => stop.routeId), [33, 32, 31]);
  assert.deepEqual(calls.filter(({ sql }) => sql.startsWith('UPDATE')).map(({ params }) => params), [
    [1, 33], [2, 32], [3, 31],
  ]);
  assert.equal(calls[0].params[0], '2026-11-28');
});
