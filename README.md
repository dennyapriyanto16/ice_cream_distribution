# IceDistribution

Aplikasi pengelolaan distribusi es krim berbasis lokasi. Frontend React berjalan terpisah dari API Express dan database MySQL 8.4.3.

## Prasyarat

- Node.js 20 atau lebih baru
- MySQL 8.4.3
- Database `ice_distribution` yang sudah diimpor dari dump terlampir

## Menyiapkan backend

Buka terminal pertama:

```powershell
cd backend
npm install
Copy-Item .env.example .env
```

Isi konfigurasi database dan rahasia token di `backend\.env`. Jalankan migrasi SQL satu kali setelah mengimpor dump:

```powershell
mysql -u root -p ice_distribution < migrations\001_app_requirements.sql
mysql -u root -p ice_distribution < migrations\002_partner_acquisition.sql
```

Jika `mysql` tidak tersedia pada `PATH` Laragon, jalankan dari terminal PowerShell di folder `backend`:

```powershell
$mysql = "C:\laragon\bin\mysql\mysql-8.4.3-winx64\bin\mysql.exe"
foreach ($migration in @("migrations\001_app_requirements.sql", "migrations\002_partner_acquisition.sql")) {
  $command = '"' + $mysql + '" -u root -p ice_distribution < "' + $migration + '"'
  & $env:ComSpec /d /s /c $command
  if ($LASTEXITCODE -ne 0) { throw "Migrasi gagal: $migration" }
}
```

Buat kredensial pengembangan untuk admin dan satu pemilik toko contoh. Atur kata sandi melalui environment, bukan di source code:

```powershell
$env:ADMIN_PASSWORD = "kata-sandi-admin"
$env:PARTNER_PASSWORD = "kata-sandi-mitra"
npm run seed:demo
```

Mulai API:

```powershell
npm run dev
```

API tersedia di `http://localhost:3001`. Untuk menghubungkan pemilik toko lain, jalankan `seed:demo` lagi dengan `PARTNER_USER_ID`, `PARTNER_USERNAME`, dan `PARTNER_PASSWORD` milik pengguna yang sesuai.

## Menyiapkan frontend

Buka terminal kedua:

```powershell
cd frontend
npm install
Copy-Item .env.example .env
npm run dev
```

Buka URL yang ditampilkan Vite (umumnya `http://localhost:5173`). Perintah frontend dan backend memang dijalankan di terminal terpisah.

## Catatan data dan fitur

- Migrasi menambah kolom akun, memastikan satu status stok per toko, menambah urutan pemberhentian, dan membuat pengaturan maintenance. Migrasi ditujukan untuk dump awal yang disertakan dan dijalankan satu kali.
- Akun contoh tidak dibuat otomatis oleh aplikasi. Jalankan skrip seed secara eksplisit dengan kata sandi pilihan Anda.
- RESTOCK menggunakan urutan jarak antartitik dan garis perkiraan pada peta, bukan petunjuk jalan atau estimasi waktu tempuh.
- Saat pemilik toko melaporkan stok `LOW`/`EMPTY`, backend otomatis menjadwalkan RESTOCK untuk besok jika belum ada tugas aktif; perubahan ke `SAFE` membatalkan tugas RESTOCK yang masih terjadwal.
- Penyelesaian RESTOCK menyetel stok menjadi `SAFE` dan mengisi `last_restocked_at`; tugas terjadwal yang tersisa untuk toko tersebut dibatalkan.
- Jadwal RESTOCK dan maintenance disusun mulai dari lokasi paling utara, lalu memilih pemberhentian terdekat berikutnya dengan jarak Haversine. Admin dapat melihat ringkasan rute per tanggal, menyusun ulang urutan, atau memulai semua tugas yang masih terjadwal pada tanggal tersebut.
- Halaman RESTOCK menampilkan ringkasan rute otomatis per tanggal, pratinjau peta, dan tabel seluruh tugas; rekomendasi toko sekitar tetap tersedia di menu tersendiri.
- Admin dapat mengubah tanggal RESTOCK yang masih berstatus terjadwal langsung dari tabel; urutan rute tanggal asal dan tanggal tujuan akan disesuaikan kembali.
- Menu Calon Mitra menampilkan semua toko berstatus `PROSPECT`, memungkinkan penjadwalan kunjungan `OFFER`, dan menyediakan pintasan pendaftaran mitra.
- Menu Kelola Mitra dapat mengubah calon menjadi mitra atau mendaftarkan mitra baru, membuat akun pemilik dengan kata sandi bcrypt, menghasilkan nomor seri freezer otomatis mengikuti urutan `AICE-BK`, menginisialisasi stok `SAFE`, serta menjadwalkan maintenance pertama 14 hari kemudian. Admin dapat menampilkan atau menyembunyikan kata sandi sebelum menyimpan.
- Migrasi `002_partner_acquisition.sql` menambahkan `OFFER` ke jenis tugas pada `delivery_routes`; jalankan setelah migrasi `001_app_requirements.sql`.
- Maintenance memakai siklus 14 hari, hari kerja Senin–Jumat, dan kapasitas awal 4 kunjungan per hari yang dapat diubah admin.
- Tile peta menggunakan OpenStreetMap. Pastikan mengikuti kebijakan penggunaan tile OpenStreetMap.

## Pemeriksaan

```powershell
cd backend
npm test
npm run check
```

```powershell
cd frontend
npm run build
```
