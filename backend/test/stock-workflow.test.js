import test from 'node:test';
import assert from 'node:assert/strict';
import { markRestockCompleted, updatePartnerStock } from '../src/services/stock-workflow.js';

function createConnection({ activeRoutes = [], nextStopOrder = 1, affectedRows = 0 } = {}) {
  const calls = [];
  return {
    calls,
    async execute(sql, params = []) {
      calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
      if (sql.includes('SELECT route_id FROM delivery_routes')) return [activeRoutes];
      if (sql.includes('MAX(stop_order)')) return [[{ nextStopOrder }]];
      if (sql.includes('AS scheduledDate')) return [[{ scheduledDate: '2026-11-28' }]];
      if (sql.includes('SELECT r.route_id AS routeId')) return [[]];
      return [{ affectedRows }];
    },
  };
}

test('LOW dan EMPTY membuat RESTOCK besok dengan urutan pemberhentian berikutnya', async (t) => {
  for (const stockCondition of ['LOW', 'EMPTY']) {
    await t.test(stockCondition, async () => {
      const connection = createConnection({ nextStopOrder: 6 });
      const result = await updatePartnerStock(connection, 12, stockCondition);

      assert.deepEqual(result, { scheduled: true, cancelled: false });
      const insert = connection.calls.find(({ sql }) => sql.startsWith('INSERT INTO delivery_routes'));
      assert.ok(insert);
      assert.match(insert.sql, /'RESTOCK', \?, 'SCHEDULED', DATE_ADD\(CURDATE\(\), INTERVAL 1 DAY\), \?/);
      assert.deepEqual(insert.params, [12, 6]);
    });
  }
});

test('rute RESTOCK SCHEDULED atau IN_TRANSIT yang sudah ada tidak digandakan', async () => {
  const connection = createConnection({ activeRoutes: [{ route_id: 8 }] });
  const result = await updatePartnerStock(connection, 12, 'LOW');

  assert.deepEqual(result, { scheduled: false, cancelled: false });
  assert.equal(connection.calls.some(({ sql }) => sql.startsWith('INSERT INTO delivery_routes')), false);
});

test('SAFE membatalkan hanya rute RESTOCK yang masih SCHEDULED', async () => {
  const connection = createConnection({ affectedRows: 1 });
  const result = await updatePartnerStock(connection, 12, 'SAFE');
  const cancellation = connection.calls.find(({ sql }) => sql.startsWith('UPDATE delivery_routes'));

  assert.deepEqual(result, { scheduled: false, cancelled: true });
  assert.match(cancellation.sql, /task_type = 'RESTOCK'/);
  assert.match(cancellation.sql, /delivery_status = 'SCHEDULED'/);
  assert.equal(connection.calls.some(({ sql }) => sql.includes('SELECT route_id FROM delivery_routes')), false);
});

test('penyelesaian RESTOCK mengubah stok menjadi SAFE, mencatat waktu, dan membatalkan jadwal tersisa', async () => {
  const connection = createConnection();
  await markRestockCompleted(connection, 12);
  const stockUpdate = connection.calls.find(({ sql }) => sql.startsWith('INSERT INTO stock_status'));
  const cancellation = connection.calls.find(({ sql }) => sql.startsWith('UPDATE delivery_routes'));

  assert.match(stockUpdate.sql, /stock_condition = 'SAFE'/);
  assert.match(stockUpdate.sql, /last_restocked_at = CURRENT_TIMESTAMP/);
  assert.match(cancellation.sql, /task_type = 'RESTOCK'/);
  assert.match(cancellation.sql, /delivery_status = 'SCHEDULED'/);
});
