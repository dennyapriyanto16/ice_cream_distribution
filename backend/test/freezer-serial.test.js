import test from 'node:test';
import assert from 'node:assert/strict';
import { formatFreezerSerial, getNextFreezerSerial } from '../src/services/freezer-serial.js';

test('nomor seri freezer mengikuti urutan terbesar yang sudah tersimpan', async () => {
  const connection = {
    async execute(sql) {
      assert.match(sql, /MAX\(CAST\(SUBSTRING\(serial_number, 9\) AS UNSIGNED\)\)/);
      return [[{ lastSequence: '14' }]];
    },
  };

  assert.equal(await getNextFreezerSerial(connection), 'AICE-BK-015');
});

test('nomor seri freezer memakai tiga digit minimum dan tetap bertambah setelah 999', () => {
  assert.equal(formatFreezerSerial(1), 'AICE-BK-001');
  assert.equal(formatFreezerSerial(1000), 'AICE-BK-1000');
});
