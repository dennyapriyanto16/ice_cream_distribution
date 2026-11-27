import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays, distributeEvenly, listWorkdays, orderNorthToSouth } from '../src/services/scheduler.js';

test('membentuk rentang hari kerja Senin sampai Jumat', () => {
  assert.deepEqual(
    listWorkdays('2026-11-23', 14, ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY']),
    ['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04'],
  );
  assert.equal(addDays('2026-11-30', 14), '2026-12-14');
});

test('membagi tugas merata dan menolak kapasitas tidak cukup', () => {
  const assignments = distributeEvenly(
    [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }],
    ['2026-11-23', '2026-11-24', '2026-11-25'],
    2,
  );
  assert.deepEqual(assignments.map((item) => item.scheduledDate), [
    '2026-11-23', '2026-11-23', '2026-11-24', '2026-11-24', '2026-11-25',
  ]);
  assert.throws(() => distributeEvenly([1, 2, 3], ['2026-11-23'], 2), /Kapasitas tidak cukup/);
});

test('memulai rute dari titik paling utara lalu memilih tetangga terdekat', () => {
  const ordered = orderNorthToSouth([
    { id: 1, latitude: -1.8, longitude: 106.1 },
    { id: 2, latitude: -1.81, longitude: 106.1 },
    { id: 3, latitude: -1.9, longitude: 106.1 },
  ]);
  assert.deepEqual(ordered.map((item) => item.id), [1, 2, 3]);
});
