import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from './db.js';
import { requireAuth, requireRole } from './middleware.js';
import { addDays, distributeEvenly, listWorkdays, orderNorthToSouth } from './services/scheduler.js';
import { reorderScheduledStops, withGeographicStopOrders } from './services/route-planning.js';
import { getNextFreezerSerial } from './services/freezer-serial.js';
import { markRestockCompleted, saveStockCondition, updatePartnerStock } from './services/stock-workflow.js';

for (const name of ['DB_HOST', 'DB_USER', 'DB_NAME', 'JWT_SECRET']) {
  if (!process.env[name]) throw new Error(`Konfigurasi ${name} wajib diisi.`);
}
if (process.env.JWT_SECRET.length < 32 || process.env.JWT_SECRET.startsWith('ganti-dengan-')) {
  throw new Error('JWT_SECRET harus berupa rahasia acak minimal 32 karakter; ubah nilai contoh pada berkas .env.');
}

const app = express();
app.use(cors({ origin: process.env.FRONTEND_ORIGIN || 'http://localhost:5173' }));
app.use(express.json({ limit: '1mb' }));

const ADMIN = 'ADMIN';
const PARTNER = 'PARTNER_OWNER';
const FREEZER_SERIAL_LOCK = 'icedistribution:freezer-serial';
const stockLabels = { SAFE: 'Aman', LOW: 'Stok Menipis', EMPTY: 'Stok Habis' };
const validStock = new Set(Object.keys(stockLabels));
const validRouteStates = new Set(['SCHEDULED', 'IN_TRANSIT', 'COMPLETED', 'SKIPPED']);
const dayNames = new Set(['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']);
const usernamePattern = /^[a-zA-Z0-9._-]{3,80}$/;

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function isCoordinate(value, minimum, maximum) {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) return false;
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum && number <= maximum;
}

function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

async function getOutletCoordinates(connection, outletIds) {
  const placeholders = outletIds.map(() => '?').join(',');
  const [rows] = await connection.query(
    `SELECT outlet_id, outlet_name, ST_Latitude(location) AS latitude,
      ST_Longitude(location) AS longitude
     FROM outlets WHERE outlet_id IN (${placeholders})`,
    outletIds,
  );
  return rows;
}

app.get('/api/health', asyncRoute(async (_req, res) => {
  await pool.query('SELECT 1');
  res.json({ status: 'ok' });
}));

app.post('/api/auth/login', asyncRoute(async (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    return res.status(400).json({ message: 'Nama pengguna dan kata sandi wajib diisi.' });
  }
  const [users] = await pool.execute(
    `SELECT user_id, full_name, username, password_hash, role
     FROM users WHERE username = ? LIMIT 1`,
    [username.trim()],
  );
  const user = users[0];
  if (!user?.password_hash || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ message: 'Nama pengguna atau kata sandi tidak sesuai.' });
  }
  const token = jwt.sign(
    { userId: user.user_id, role: user.role, name: user.full_name },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' },
  );
  res.json({
    token,
    user: { userId: user.user_id, name: user.full_name, role: user.role },
  });
}));

app.get('/api/auth/me', requireAuth, asyncRoute(async (req, res) => {
  const [rows] = await pool.execute(
    'SELECT user_id, full_name, role FROM users WHERE user_id = ?',
    [req.user.userId],
  );
  if (!rows[0]) return res.status(401).json({ message: 'Akun tidak ditemukan.' });
  res.json({ user: { userId: rows[0].user_id, name: rows[0].full_name, role: rows[0].role } });
}));

app.get('/api/dashboard', requireAuth, requireRole(ADMIN), asyncRoute(async (_req, res) => {
  const [[summary]] = await pool.query(`
    SELECT
      COUNT(DISTINCT o.outlet_id) AS total_outlets,
      SUM(o.partnership_status = 'PARTNER') AS partner_count,
      SUM(o.partnership_status = 'PROSPECT') AS prospect_count,
      SUM(s.stock_condition = 'LOW') AS low_stock_count,
      SUM(s.stock_condition = 'EMPTY') AS empty_stock_count
    FROM outlets o
    LEFT JOIN stock_status s ON s.outlet_id = o.outlet_id
    WHERE o.partnership_status <> 'INACTIVE'`);
  res.json({ summary });
}));

app.get('/api/outlets', requireAuth, requireRole(ADMIN), asyncRoute(async (_req, res) => {
  const [rows] = await pool.query(`
    SELECT o.outlet_id AS outletId, o.outlet_name AS outletName, o.owner_name AS ownerName,
      o.phone_number AS phoneNumber, o.address, o.partnership_status AS partnershipStatus,
      ST_Latitude(o.location) AS latitude, ST_Longitude(o.location) AS longitude,
      s.stock_condition AS stockCondition, s.updated_at AS stockUpdatedAt,
      f.installation_status AS freezerStatus, f.next_maintenance_date AS nextMaintenanceDate
    FROM outlets o
    LEFT JOIN stock_status s ON s.outlet_id = o.outlet_id
    LEFT JOIN freezers f ON f.outlet_id = o.outlet_id
    WHERE o.partnership_status <> 'INACTIVE'
    ORDER BY o.outlet_name`);
  res.json({ outlets: rows });
}));

app.post('/api/outlets/:id/offer', requireAuth, requireRole(ADMIN), asyncRoute(async (req, res) => {
  const outletId = Number(req.params.id);
  const { scheduledDate } = req.body || {};
  if (!Number.isInteger(outletId) || !isValidDate(scheduledDate)) {
    return res.status(400).json({ message: 'Toko atau tanggal kunjungan tidak valid.' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [outlets] = await connection.execute(
      'SELECT outlet_id, partnership_status FROM outlets WHERE outlet_id = ? FOR UPDATE',
      [outletId],
    );
    if (!outlets[0]) throw httpError(404, 'Toko calon mitra tidak ditemukan.');
    if (outlets[0].partnership_status !== 'PROSPECT') {
      throw httpError(409, 'Penawaran hanya dapat dijadwalkan untuk calon mitra.');
    }

    const [[dateCheck]] = await connection.execute('SELECT ? >= CURDATE() AS isFuture', [scheduledDate]);
    if (!dateCheck.isFuture) throw httpError(400, 'Tanggal kunjungan tidak boleh sebelum hari ini.');

    const [existing] = await connection.execute(
      `SELECT route_id FROM delivery_routes
       WHERE target_outlet_id = ? AND task_type = 'OFFER'
         AND delivery_status IN ('SCHEDULED', 'IN_TRANSIT')
       LIMIT 1 FOR UPDATE`,
      [outletId],
    );
    if (existing.length > 0) throw httpError(409, 'Toko ini sudah memiliki jadwal penawaran yang aktif.');

    const [[order]] = await connection.execute(
      'SELECT COALESCE(MAX(stop_order), 0) + 1 AS nextStopOrder FROM delivery_routes WHERE scheduled_date = ?',
      [scheduledDate],
    );
    const [result] = await connection.execute(
      `INSERT INTO delivery_routes (task_type, target_outlet_id, delivery_status, scheduled_date, stop_order)
       VALUES ('OFFER', ?, 'SCHEDULED', ?, ?)`,
      [outletId, scheduledDate, Number(order.nextStopOrder)],
    );
    const ordered = await reorderScheduledStops(connection, scheduledDate);
    const stopOrder = ordered.findIndex((stop) => Number(stop.routeId) === Number(result.insertId)) + 1;
    await connection.commit();
    res.status(201).json({
      message: 'Jadwal penawaran berhasil dibuat.',
      route: { routeId: result.insertId, outletId, scheduledDate, stopOrder },
    });
  } catch (error) {
    await connection.rollback();
    if (error.status) return res.status(error.status).json({ message: error.message });
    throw error;
  } finally {
    connection.release();
  }
}));

app.get('/api/partners/next-freezer-serial', requireAuth, requireRole(ADMIN), asyncRoute(async (_req, res) => {
  const serialNumber = await getNextFreezerSerial(pool);
  res.json({ serialNumber });
}));

app.post('/api/partners', requireAuth, requireRole(ADMIN), asyncRoute(async (req, res) => {
  const {
    ownerName, phoneNumber, outletName, address,
    username, password, latitude, longitude, prospectOutletId,
  } = req.body || {};
  const fields = { ownerName, phoneNumber, outletName, address, username, password };
  if (Object.entries(fields).some(([field, value]) => typeof value !== 'string' || value.trim() === '')) {
    return res.status(400).json({ message: 'Semua data pemilik, toko, dan akun wajib diisi.' });
  }
  if (ownerName.trim().length > 100 || outletName.trim().length > 100
    || phoneNumber.trim().length > 20 || Buffer.byteLength(address.trim(), 'utf8') > 65535
    || !usernamePattern.test(username.trim())
    || password.length < 8 || Buffer.byteLength(password, 'utf8') > 72
    || !isCoordinate(latitude, -90, 90) || !isCoordinate(longitude, -180, 180)) {
    return res.status(400).json({
      message: 'Periksa kembali nama, nomor HP, alamat, akun, kata sandi minimal 8 karakter, dan koordinat.',
    });
  }
  if (prospectOutletId !== undefined && (!Number.isInteger(Number(prospectOutletId)) || Number(prospectOutletId) < 1)) {
    return res.status(400).json({ message: 'Data calon mitra tidak valid.' });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const connection = await pool.getConnection();
  let serialLockAcquired = false;
  let transactionStarted = false;
  try {
    const [[serialLock]] = await connection.execute('SELECT GET_LOCK(?, 10) AS acquired', [FREEZER_SERIAL_LOCK]);
    if (Number(serialLock.acquired) !== 1) {
      throw httpError(503, 'Nomor seri freezer sedang diproses. Silakan coba kembali.');
    }
    serialLockAcquired = true;
    await connection.beginTransaction();
    transactionStarted = true;
    const serialNumber = await getNextFreezerSerial(connection);
    if (prospectOutletId !== undefined) {
      const [prospects] = await connection.execute(
        'SELECT outlet_id, partnership_status FROM outlets WHERE outlet_id = ? FOR UPDATE',
        [Number(prospectOutletId)],
      );
      if (!prospects[0]) throw httpError(404, 'Data calon mitra tidak ditemukan.');
      if (prospects[0].partnership_status !== 'PROSPECT') {
        throw httpError(409, 'Toko ini sudah bukan calon mitra.');
      }
    }

    const [users] = await connection.execute(
      `INSERT INTO users (full_name, phone_number, role, username, password_hash)
       VALUES (?, ?, 'PARTNER_OWNER', ?, ?)`,
      [ownerName.trim(), phoneNumber.trim(), username.trim(), passwordHash],
    );
    let outletId;
    if (prospectOutletId !== undefined) {
      outletId = Number(prospectOutletId);
      await connection.execute(
        `UPDATE outlets SET owner_user_id = ?, outlet_name = ?, owner_name = ?,
          phone_number = ?, address = ?, partnership_status = 'PARTNER',
          location = ST_SRID(POINT(?, ?), 4326)
         WHERE outlet_id = ?`,
        [
          users.insertId, outletName.trim(), ownerName.trim(), phoneNumber.trim(),
          address.trim(), Number(longitude), Number(latitude), outletId,
        ],
      );
    } else {
      const [outlets] = await connection.execute(
        `INSERT INTO outlets
          (owner_user_id, outlet_name, owner_name, phone_number, address, partnership_status, location)
         VALUES (?, ?, ?, ?, ?, 'PARTNER', ST_SRID(POINT(?, ?), 4326))`,
        [
          users.insertId, outletName.trim(), ownerName.trim(), phoneNumber.trim(),
          address.trim(), Number(longitude), Number(latitude),
        ],
      );
      outletId = outlets.insertId;
    }

    const [freezers] = await connection.execute(
      `INSERT INTO freezers
        (outlet_id, serial_number, installation_status, installed_at, next_maintenance_date)
       VALUES (?, ?, 'INSTALLED', CURRENT_TIMESTAMP, DATE_ADD(CURDATE(), INTERVAL 14 DAY))`,
      [outletId, serialNumber],
    );
    await connection.execute(
      `INSERT INTO stock_status (outlet_id, stock_condition)
       VALUES (?, 'SAFE')
       ON DUPLICATE KEY UPDATE stock_condition = 'SAFE', updated_at = CURRENT_TIMESTAMP`,
      [outletId],
    );
    const [[maintenance]] = await connection.execute(
      'SELECT DATE_ADD(CURDATE(), INTERVAL 14 DAY) AS scheduledDate',
    );
    const [[order]] = await connection.execute(
      'SELECT COALESCE(MAX(stop_order), 0) + 1 AS nextStopOrder FROM delivery_routes WHERE scheduled_date = ?',
      [maintenance.scheduledDate],
    );
    const [route] = await connection.execute(
      `INSERT INTO delivery_routes
        (task_type, target_outlet_id, freezer_id, delivery_status, scheduled_date, stop_order)
       VALUES ('MAINTENANCE', ?, ?, 'SCHEDULED', ?, ?)`,
      [outletId, freezers.insertId, maintenance.scheduledDate, Number(order.nextStopOrder)],
    );
    await reorderScheduledStops(connection, maintenance.scheduledDate);
    await connection.commit();
    transactionStarted = false;
    res.status(201).json({
      message: prospectOutletId === undefined
        ? 'Mitra baru berhasil didaftarkan.'
        : 'Calon mitra berhasil diaktifkan sebagai mitra.',
      partner: {
        userId: users.insertId, outletId, freezerId: freezers.insertId,
        serialNumber, maintenanceRouteId: route.insertId,
      },
    });
  } catch (error) {
    if (transactionStarted) await connection.rollback();
    if (error.status) return res.status(error.status).json({ message: error.message });
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'Username atau nomor seri freezer sudah digunakan.' });
    }
    throw error;
  } finally {
    if (serialLockAcquired) {
      await connection.execute('SELECT RELEASE_LOCK(?)', [FREEZER_SERIAL_LOCK]);
    }
    connection.release();
  }
}));

app.patch('/api/outlets/:id/stock', requireAuth, asyncRoute(async (req, res) => {
  const outletId = Number(req.params.id);
  const { stockCondition } = req.body || {};
  if (!Number.isInteger(outletId) || !validStock.has(stockCondition)) {
    return res.status(400).json({ message: 'Toko atau status stok tidak valid.' });
  }
  if (req.user.role !== PARTNER && req.user.role !== ADMIN) {
    return res.status(403).json({ message: 'Anda tidak memiliki akses ke fitur ini.' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [outlets] = await connection.execute(
      'SELECT owner_user_id FROM outlets WHERE outlet_id = ? FOR UPDATE',
      [outletId],
    );
    if (!outlets[0]) {
      await connection.rollback();
      return res.status(404).json({ message: 'Toko tidak ditemukan.' });
    }
    if (req.user.role === PARTNER && Number(outlets[0].owner_user_id) !== Number(req.user.userId)) {
      await connection.rollback();
      return res.status(403).json({ message: 'Anda hanya dapat memperbarui stok toko milik Anda.' });
    }

    let restock = { scheduled: false, cancelled: false };
    if (req.user.role === PARTNER) {
      restock = await updatePartnerStock(connection, outletId, stockCondition);
    } else {
      await saveStockCondition(connection, outletId, stockCondition);
    }
    await connection.commit();
    res.json({
      message: 'Status stok berhasil diperbarui.',
      stockCondition,
      label: stockLabels[stockCondition],
      restockScheduled: restock.scheduled,
      restockCancelled: restock.cancelled,
    });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}));

app.get('/api/partner/dashboard', requireAuth, requireRole(PARTNER), asyncRoute(async (req, res) => {
  const [outlets] = await pool.execute(`
    SELECT o.outlet_id AS outletId, o.outlet_name AS outletName,
      s.stock_condition AS stockCondition, s.updated_at AS stockUpdatedAt,
      f.installation_status AS freezerStatus, f.next_maintenance_date AS nextMaintenanceDate
    FROM outlets o
    LEFT JOIN stock_status s ON s.outlet_id = o.outlet_id
    LEFT JOIN freezers f ON f.outlet_id = o.outlet_id
    WHERE o.owner_user_id = ?`,
  [req.user.userId]);
  if (!outlets.length) return res.status(404).json({ message: 'Toko untuk akun ini belum terdaftar.' });
  const outletIds = outlets.map((outlet) => outlet.outletId);
  const placeholders = outletIds.map(() => '?').join(',');
  const [routes] = await pool.execute(`
    SELECT route_id AS routeId, task_type AS taskType, delivery_status AS deliveryStatus,
      scheduled_date AS scheduledDate, stop_order AS stopOrder
    FROM delivery_routes
    WHERE target_outlet_id IN (${placeholders}) AND delivery_status <> 'SKIPPED'
    ORDER BY scheduled_date, route_id`,
  outletIds);
  res.json({ outlets, routes });
}));

app.get('/api/recommendations', requireAuth, requireRole(ADMIN), asyncRoute(async (req, res) => {
  const { lat, lng, radius = '10000', type = 'RESTOCK' } = req.query;
  const radiusMeters = Number(radius);
  if (!isCoordinate(lat, -90, 90) || !isCoordinate(lng, -180, 180)
    || !Number.isFinite(radiusMeters) || radiusMeters < 100 || radiusMeters > 100000
    || !['RESTOCK', 'PROSPECT'].includes(type)) {
    return res.status(400).json({ message: 'Titik, radius (100–100.000 m), atau jenis rekomendasi tidak valid.' });
  }
  const partnership = type === 'RESTOCK' ? 'PARTNER' : 'PROSPECT';
  const stockFilter = type === 'RESTOCK' ? "AND s.stock_condition IN ('LOW', 'EMPTY')" : '';
  const [rows] = await pool.execute(`
    SELECT o.outlet_id AS outletId, o.outlet_name AS outletName, o.address,
      o.partnership_status AS partnershipStatus, s.stock_condition AS stockCondition,
      ST_Latitude(o.location) AS latitude, ST_Longitude(o.location) AS longitude,
      ST_Distance_Sphere(o.location, ST_SRID(POINT(?, ?), 4326)) AS distanceMeters
    FROM outlets o
    LEFT JOIN stock_status s ON s.outlet_id = o.outlet_id
    WHERE o.partnership_status = ? ${stockFilter}
      AND ST_Distance_Sphere(o.location, ST_SRID(POINT(?, ?), 4326)) <= ?
    ORDER BY distanceMeters, o.outlet_name
    LIMIT 200`,
  [Number(lng), Number(lat), partnership, Number(lng), Number(lat), radiusMeters]);
  res.json({ recommendations: rows });
}));

app.post('/api/routes', requireAuth, requireRole(ADMIN), asyncRoute(async (req, res) => {
  const { outletIds, scheduledDate } = req.body || {};
  if (!Array.isArray(outletIds) || outletIds.length === 0 || outletIds.some((id) => !Number.isInteger(Number(id)))
    || !isValidDate(scheduledDate)) {
    return res.status(400).json({ message: 'Pilih minimal satu toko dan tanggal pengiriman yang valid.' });
  }
  const uniqueIds = [...new Set(outletIds.map(Number))];
  if (uniqueIds.length !== outletIds.length) {
    return res.status(400).json({ message: 'Toko yang sama tidak boleh dipilih lebih dari sekali.' });
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const outlets = await getOutletCoordinates(connection, uniqueIds);
    if (outlets.length !== uniqueIds.length) throw httpError(404, 'Satu atau beberapa toko tidak ditemukan.');
    const [partners] = await connection.query(
      `SELECT outlet_id FROM outlets
       WHERE outlet_id IN (${uniqueIds.map(() => '?').join(',')}) AND partnership_status = 'PARTNER'`,
      uniqueIds,
    );
    if (partners.length !== uniqueIds.length) throw httpError(400, 'RESTOCK hanya dapat dijadwalkan untuk toko mitra.');

    const ordered = orderNorthToSouth(outlets);
    const [existing] = await connection.execute(
      `SELECT COUNT(*) AS count FROM delivery_routes
       WHERE task_type = 'RESTOCK' AND scheduled_date = ?
         AND target_outlet_id IN (${uniqueIds.map(() => '?').join(',')})
         AND delivery_status <> 'SKIPPED'`,
      [scheduledDate, ...uniqueIds],
    );
    if (Number(existing[0].count) > 0) {
      throw httpError(409, 'Satu atau beberapa toko sudah memiliki jadwal RESTOCK pada tanggal tersebut.');
    }
    const created = [];
    for (const [index, outlet] of ordered.entries()) {
      const [result] = await connection.execute(
        `INSERT INTO delivery_routes (task_type, target_outlet_id, delivery_status, scheduled_date, stop_order)
         VALUES ('RESTOCK', ?, 'SCHEDULED', ?, ?)`,
        [outlet.outlet_id, scheduledDate, index + 1],
      );
      created.push({ routeId: result.insertId, outletId: outlet.outlet_id, outletName: outlet.outlet_name, stopOrder: index + 1 });
    }
    const reordered = await reorderScheduledStops(connection, scheduledDate);
    const orderByRouteId = new Map(reordered.map((stop, index) => [Number(stop.routeId), index + 1]));
    for (const route of created) route.stopOrder = orderByRouteId.get(Number(route.routeId));
    await connection.commit();
    res.status(201).json({ message: 'Rute RESTOCK berhasil dijadwalkan.', routes: created });
  } catch (error) {
    await connection.rollback();
    if (error.status) return res.status(error.status).json({ message: error.message });
    throw error;
  } finally {
    connection.release();
  }
}));

app.get('/api/routes', requireAuth, requireRole(ADMIN), asyncRoute(async (_req, res) => {
  const [routes] = await pool.query(`
    SELECT r.route_id AS routeId, r.task_type AS taskType,
      r.delivery_status AS deliveryStatus, r.scheduled_date AS scheduledDate,
      r.completed_at AS completedAt, r.stop_order AS stopOrder,
      o.outlet_id AS outletId, o.outlet_name AS outletName, o.address,
      o.partnership_status AS partnershipStatus,
      ST_Latitude(o.location) AS latitude, ST_Longitude(o.location) AS longitude
    FROM delivery_routes r
    JOIN outlets o ON o.outlet_id = r.target_outlet_id
    ORDER BY r.scheduled_date, r.route_id`);
  res.json({ routes: withGeographicStopOrders(routes) });
}));

app.post('/api/routes/reorder', requireAuth, requireRole(ADMIN), asyncRoute(async (req, res) => {
  const { scheduledDate } = req.body || {};
  if (!isValidDate(scheduledDate)) {
    return res.status(400).json({ message: 'Tanggal rute tidak valid.' });
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const ordered = await reorderScheduledStops(connection, scheduledDate);
    await connection.commit();
    res.json({
      message: `Urutan ${ordered.length} pemberhentian disusun dari utara ke selatan.`,
      routes: ordered.map((stop, index) => ({ routeId: stop.routeId, stopOrder: index + 1 })),
    });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}));

app.patch('/api/routes/:id/date', requireAuth, requireRole(ADMIN), asyncRoute(async (req, res) => {
  const routeId = Number(req.params.id);
  const { scheduledDate } = req.body || {};
  if (!Number.isInteger(routeId) || !isValidDate(scheduledDate)) {
    return res.status(400).json({ message: 'Tugas atau tanggal pengiriman tidak valid.' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [routes] = await connection.execute(
      `SELECT route_id, task_type, target_outlet_id, freezer_id,
        scheduled_date, delivery_status
       FROM delivery_routes WHERE route_id = ? FOR UPDATE`,
      [routeId],
    );
    const route = routes[0];
    if (!route) throw httpError(404, 'Jadwal tidak ditemukan.');
    if (route.delivery_status !== 'SCHEDULED') {
      throw httpError(409, 'Tanggal hanya dapat diubah untuk tugas yang masih terjadwal.');
    }

    const [[dateCheck]] = await connection.execute(
      'SELECT ? >= CURDATE() AS isFuture',
      [scheduledDate],
    );
    if (!dateCheck.isFuture) throw httpError(400, 'Tanggal pengiriman tidak boleh sebelum hari ini.');

    const oldDate = String(route.scheduled_date).slice(0, 10);
    if (oldDate === scheduledDate) {
      await connection.commit();
      return res.json({ message: 'Tanggal pengiriman tidak berubah.', scheduledDate });
    }

    const duplicateCondition = route.task_type === 'RESTOCK'
      ? 'task_type = \'RESTOCK\' AND target_outlet_id = ?'
      : route.freezer_id
        ? 'task_type = \'MAINTENANCE\' AND freezer_id = ?'
        : 'task_type = \'MAINTENANCE\' AND target_outlet_id = ?';
    const duplicateTarget = route.task_type === 'RESTOCK' || !route.freezer_id
      ? route.target_outlet_id
      : route.freezer_id;
    const [duplicates] = await connection.execute(
      `SELECT route_id FROM delivery_routes
       WHERE ${duplicateCondition} AND scheduled_date = ? AND route_id <> ?
         AND delivery_status IN ('SCHEDULED', 'IN_TRANSIT')
       LIMIT 1 FOR UPDATE`,
      [duplicateTarget, scheduledDate, routeId],
    );
    if (duplicates.length > 0) {
      throw httpError(409, 'Toko tersebut sudah memiliki tugas aktif pada tanggal yang dipilih.');
    }

    await connection.execute(
      'UPDATE delivery_routes SET scheduled_date = ? WHERE route_id = ?',
      [scheduledDate, routeId],
    );
    if (route.task_type === 'MAINTENANCE' && route.freezer_id) {
      await connection.execute(
        'UPDATE freezers SET next_maintenance_date = ? WHERE freezer_id = ?',
        [scheduledDate, route.freezer_id],
      );
    }
    await reorderScheduledStops(connection, oldDate);
    await reorderScheduledStops(connection, scheduledDate);
    await connection.commit();
    res.json({ message: 'Tanggal pengiriman berhasil diubah.', scheduledDate });
  } catch (error) {
    await connection.rollback();
    if (error.status) return res.status(error.status).json({ message: error.message });
    throw error;
  } finally {
    connection.release();
  }
}));

app.patch('/api/routes/start-all', requireAuth, requireRole(ADMIN), asyncRoute(async (req, res) => {
  const { scheduledDate } = req.body || {};
  if (!isValidDate(scheduledDate)) {
    return res.status(400).json({ message: 'Tanggal rute tidak valid.' });
  }
  const [result] = await pool.execute(
    `UPDATE delivery_routes SET delivery_status = 'IN_TRANSIT'
     WHERE scheduled_date = ? AND delivery_status = 'SCHEDULED'`,
    [scheduledDate],
  );
  res.json({
    message: `${result.affectedRows} pengiriman dimulai.`,
    startedCount: Number(result.affectedRows),
  });
}));

app.patch('/api/routes/:id/status', requireAuth, requireRole(ADMIN), asyncRoute(async (req, res) => {
  const routeId = Number(req.params.id);
  const { deliveryStatus } = req.body || {};
  if (!Number.isInteger(routeId) || !validRouteStates.has(deliveryStatus)) {
    return res.status(400).json({ message: 'Tugas atau status pengiriman tidak valid.' });
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      'SELECT route_id, task_type, target_outlet_id, freezer_id, delivery_status FROM delivery_routes WHERE route_id = ? FOR UPDATE',
      [routeId],
    );
    const route = rows[0];
    if (!route) {
      await connection.rollback();
      return res.status(404).json({ message: 'Jadwal tidak ditemukan.' });
    }
    if (route.delivery_status === deliveryStatus) {
      await connection.rollback();
      return res.json({ message: 'Status tugas tidak berubah.' });
    }
    const allowedTransitions = {
      SCHEDULED: ['IN_TRANSIT', 'COMPLETED', 'SKIPPED'],
      IN_TRANSIT: ['SCHEDULED', 'COMPLETED', 'SKIPPED'],
      COMPLETED: [],
      SKIPPED: ['SCHEDULED'],
    };
    if (!allowedTransitions[route.delivery_status]?.includes(deliveryStatus)) {
      await connection.rollback();
      return res.status(409).json({ message: 'Status tugas yang sudah selesai tidak dapat diubah.' });
    }
    await connection.execute(
      `UPDATE delivery_routes SET delivery_status = ?,
       completed_at = IF(? = 'COMPLETED', CURRENT_TIMESTAMP, NULL) WHERE route_id = ?`,
      [deliveryStatus, deliveryStatus, routeId],
    );
    if (deliveryStatus === 'COMPLETED' && route.task_type === 'RESTOCK') {
      await markRestockCompleted(connection, route.target_outlet_id);
    }
    if (deliveryStatus === 'COMPLETED' && route.task_type === 'MAINTENANCE') {
      await connection.execute(
        `UPDATE freezers SET last_maintenance_date = CURDATE(),
          next_maintenance_date = DATE_ADD(CURDATE(), INTERVAL 14 DAY)
         WHERE (freezer_id = ? OR (? IS NULL AND outlet_id = ?))
           AND installation_status = 'INSTALLED'`,
        [route.freezer_id, route.freezer_id, route.target_outlet_id],
      );
    }
    await connection.commit();
    res.json({ message: 'Status tugas berhasil diperbarui.' });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}));

app.get('/api/maintenance/settings', requireAuth, requireRole(ADMIN), asyncRoute(async (_req, res) => {
  const [rows] = await pool.query('SELECT workdays, daily_capacity AS dailyCapacity FROM maintenance_settings WHERE setting_id = 1');
  res.json({ settings: rows[0] || null });
}));

app.put('/api/maintenance/settings', requireAuth, requireRole(ADMIN), asyncRoute(async (req, res) => {
  const { workdays, dailyCapacity } = req.body || {};
  if (!Array.isArray(workdays) || workdays.length === 0
    || workdays.some((day) => !dayNames.has(day)) || new Set(workdays).size !== workdays.length
    || !Number.isInteger(dailyCapacity) || dailyCapacity < 1 || dailyCapacity > 30) {
    return res.status(400).json({ message: 'Hari kerja atau kapasitas harian tidak valid.' });
  }
  await pool.execute(
    `INSERT INTO maintenance_settings (setting_id, workdays, daily_capacity)
     VALUES (1, ?, ?) ON DUPLICATE KEY UPDATE workdays = VALUES(workdays), daily_capacity = VALUES(daily_capacity)`,
    [JSON.stringify(workdays), dailyCapacity],
  );
  res.json({ message: 'Pengaturan maintenance berhasil disimpan.' });
}));

app.get('/api/maintenance', requireAuth, requireRole(ADMIN), asyncRoute(async (_req, res) => {
  const [routes] = await pool.query(`
    SELECT r.route_id AS routeId, r.delivery_status AS deliveryStatus,
      r.scheduled_date AS scheduledDate, r.stop_order AS stopOrder,
      o.outlet_id AS outletId, o.outlet_name AS outletName, o.address,
      f.freezer_id AS freezerId, f.serial_number AS serialNumber,
      f.next_maintenance_date AS nextMaintenanceDate,
      ST_Latitude(o.location) AS latitude, ST_Longitude(o.location) AS longitude
    FROM delivery_routes r
    JOIN outlets o ON o.outlet_id = r.target_outlet_id
    LEFT JOIN freezers f ON f.freezer_id = r.freezer_id
    WHERE r.task_type = 'MAINTENANCE'
    ORDER BY r.scheduled_date, r.stop_order`);
  res.json({ routes });
}));

app.post('/api/maintenance/schedule', requireAuth, requireRole(ADMIN), asyncRoute(async (req, res) => {
  const cycleStart = req.body?.cycleStart;
  if (!isValidDate(cycleStart)) {
    return res.status(400).json({ message: 'Tanggal awal siklus harus diisi dengan format yang valid.' });
  }
  const cycleEnd = addDays(cycleStart, 13);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [settingsRows] = await connection.query(
      'SELECT workdays, daily_capacity AS dailyCapacity FROM maintenance_settings WHERE setting_id = 1 FOR UPDATE',
    );
    const settings = settingsRows[0];
    if (!settings) throw httpError(409, 'Pengaturan maintenance belum tersedia.');
    const workdays = typeof settings.workdays === 'string' ? JSON.parse(settings.workdays) : settings.workdays;
    const dates = listWorkdays(cycleStart, 14, workdays);
    const [freezers] = await connection.execute(`
      SELECT f.freezer_id AS freezerId, f.outlet_id AS outletId,
        COALESCE(f.next_maintenance_date, DATE_ADD(f.last_maintenance_date, INTERVAL 14 DAY), CURDATE()) AS dueDate,
        o.outlet_name AS outletName, ST_Latitude(o.location) AS latitude,
        ST_Longitude(o.location) AS longitude
      FROM freezers f JOIN outlets o ON o.outlet_id = f.outlet_id
      WHERE f.installation_status = 'INSTALLED'
        AND COALESCE(f.next_maintenance_date, DATE_ADD(f.last_maintenance_date, INTERVAL 14 DAY), CURDATE()) <= ?
      ORDER BY dueDate`,
    [cycleEnd]);
    const [existing] = await connection.execute(`
      SELECT DISTINCT freezer_id AS freezerId FROM delivery_routes
      WHERE task_type = 'MAINTENANCE' AND scheduled_date BETWEEN ? AND ?
        AND delivery_status IN ('SCHEDULED', 'IN_TRANSIT')`,
    [cycleStart, cycleEnd]);
    const scheduledFreezers = new Set(existing.map((row) => Number(row.freezerId)));
    const pending = freezers.filter((freezer) => !scheduledFreezers.has(Number(freezer.freezerId)));
    const ordered = orderNorthToSouth(pending);
    const assignments = distributeEvenly(ordered, dates, Number(settings.dailyCapacity));
    const dayOrders = new Map();
    const created = [];
    const scheduledDates = new Set();
    for (const assignment of assignments) {
      scheduledDates.add(assignment.scheduledDate);
      const stopOrder = (dayOrders.get(assignment.scheduledDate) || 0) + 1;
      dayOrders.set(assignment.scheduledDate, stopOrder);
      const [result] = await connection.execute(
        `INSERT INTO delivery_routes (task_type, target_outlet_id, freezer_id, delivery_status, scheduled_date, stop_order)
         VALUES ('MAINTENANCE', ?, ?, 'SCHEDULED', ?, ?)`,
        [assignment.outletId, assignment.freezerId, assignment.scheduledDate, stopOrder],
      );
      created.push({
        routeId: result.insertId,
        outletId: assignment.outletId,
        freezerId: assignment.freezerId,
        outletName: assignment.outletName,
        scheduledDate: assignment.scheduledDate,
        stopOrder,
      });
    }
    for (const scheduledDate of scheduledDates) {
      await reorderScheduledStops(connection, scheduledDate);
    }
    await connection.commit();
    res.status(201).json({ message: `${created.length} kunjungan maintenance dijadwalkan untuk siklus ${cycleStart}–${cycleEnd}.`, routes: created });
  } catch (error) {
    await connection.rollback();
    if (error.message.startsWith('Kapasitas') || error.message.startsWith('Tidak ada hari kerja')) {
      return res.status(409).json({ message: error.message });
    }
    if (error.status) return res.status(error.status).json({ message: error.message });
    throw error;
  } finally {
    connection.release();
  }
}));

app.use((error, _req, res, _next) => {
  if (res.headersSent) return;
  if (error.status) return res.status(error.status).json({ message: error.message });
  console.error(error);
  res.status(500).json({ message: 'Terjadi kesalahan pada server. Silakan coba kembali.' });
});

const port = Number(process.env.PORT || 3001);
app.listen(port, () => console.log(`API IceDistribution berjalan pada port ${port}.`));
