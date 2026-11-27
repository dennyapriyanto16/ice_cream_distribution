import 'dotenv/config';
import bcrypt from 'bcryptjs';
import mysql from 'mysql2/promise';

const required = ['DB_HOST', 'DB_USER', 'DB_NAME', 'ADMIN_PASSWORD', 'PARTNER_PASSWORD'];
for (const name of required) {
  if (!process.env[name]) throw new Error(`Environment ${name} wajib diisi untuk membuat akun demo.`);
}

const connection = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

try {
  const adminUser = process.env.ADMIN_USERNAME || 'admin';
  const partnerUserId = Number(process.env.PARTNER_USER_ID || 4);
  const partnerUsername = process.env.PARTNER_USERNAME || 'toko-achan';
  if (!Number.isInteger(partnerUserId) || partnerUserId < 1) {
    throw new Error('PARTNER_USER_ID harus berupa ID pengguna yang valid.');
  }

  const [admin] = await connection.execute("SELECT user_id FROM users WHERE role = 'ADMIN' ORDER BY user_id LIMIT 1");
  if (!admin[0]) throw new Error('Pengguna admin tidak ditemukan di tabel users.');
  const [partner] = await connection.execute(
    "SELECT user_id FROM users WHERE user_id = ? AND role = 'PARTNER_OWNER'",
    [partnerUserId],
  );
  if (!partner[0]) throw new Error('Pemilik toko dengan PARTNER_USER_ID tersebut tidak ditemukan.');

  const adminHash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 12);
  const partnerHash = await bcrypt.hash(process.env.PARTNER_PASSWORD, 12);
  await connection.beginTransaction();
  await connection.execute(
    'UPDATE users SET username = ?, password_hash = ? WHERE user_id = ?',
    [adminUser, adminHash, admin[0].user_id],
  );
  await connection.execute(
    'UPDATE users SET username = ?, password_hash = ? WHERE user_id = ?',
    [partnerUsername, partnerHash, partnerUserId],
  );
  await connection.commit();
  console.log(`Akun admin "${adminUser}" dan pemilik toko "${partnerUsername}" berhasil disiapkan.`);
} catch (error) {
  await connection.rollback();
  throw error;
} finally {
  await connection.end();
}
