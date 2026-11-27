import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, getToken, setToken } from './api.js';
import MapView from './components/MapView.jsx';

const NAV_ITEMS = [
  { id: 'overview', label: 'Ringkasan', icon: '⌂' },
  { id: 'map', label: 'Peta toko', icon: '◎' },
  { id: 'manage-partners', label: 'Kelola Mitra', icon: '＋' },
  { id: 'prospects', label: 'Calon Mitra', icon: '⌕' },
  { id: 'restock', label: 'Jadwal RESTOCK', icon: '↗' },
  { id: 'maintenance', label: 'Maintenance freezer', icon: '◷' },
];
const STOCK_LABELS = { SAFE: 'Aman', LOW: 'Stok Menipis', EMPTY: 'Stok Habis' };
const ROUTE_LABELS = { SCHEDULED: 'Terjadwal', IN_TRANSIT: 'Dalam perjalanan', COMPLETED: 'Selesai', SKIPPED: 'Dilewati' };
const TASK_LABELS = { RESTOCK: 'RESTOCK', MAINTENANCE: 'Maintenance', OFFER: 'Penawaran' };
const PARTNERSHIP_LABELS = { PARTNER: 'Mitra', PROSPECT: 'Calon mitra' };
const WEEKDAYS = [
  ['MONDAY', 'Senin'], ['TUESDAY', 'Selasa'], ['WEDNESDAY', 'Rabu'],
  ['THURSDAY', 'Kamis'], ['FRIDAY', 'Jumat'], ['SATURDAY', 'Sabtu'], ['SUNDAY', 'Minggu'],
];

function todayString() {
  const date = new Date();
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function tomorrowString() {
  const date = new Date(`${todayString()}T00:00:00`);
  date.setDate(date.getDate() + 1);
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function routeDistanceKm(stops) {
  const toRadians = (degrees) => degrees * Math.PI / 180;
  return stops.slice(1).reduce((total, stop, index) => {
    const previous = stops[index];
    if (![previous.latitude, previous.longitude, stop.latitude, stop.longitude].every((value) => Number.isFinite(Number(value)))) {
      return total;
    }
    const lat1 = toRadians(Number(previous.latitude));
    const lat2 = toRadians(Number(stop.latitude));
    const deltaLat = lat2 - lat1;
    const deltaLng = toRadians(Number(stop.longitude) - Number(previous.longitude));
    const haversine = Math.sin(deltaLat / 2) ** 2
      + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
    return total + 6371 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
  }, 0);
}

function formatDate(value) {
  if (!value) return 'Belum dijadwalkan';
  return new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium' }).format(new Date(`${String(value).slice(0, 10)}T00:00:00`));
}

function statusClass(value) {
  if (value === 'SAFE' || value === 'COMPLETED' || value === 'PARTNER') return 'status status-good';
  if (value === 'LOW' || value === 'IN_TRANSIT') return 'status status-warm';
  if (value === 'EMPTY' || value === 'SKIPPED') return 'status status-danger';
  return 'status status-neutral';
}

function Icon({ children }) {
  return <span className="icon" aria-hidden="true">{children}</span>;
}

const LOGIN_SPARKLES = [
  { left: '8%', top: '18%', dx: '-13px', dy: '-23px', delay: '0s' },
  { left: '31%', top: '4%', dx: '6px', dy: '-29px', delay: '.08s' },
  { left: '66%', top: '13%', dx: '17px', dy: '-24px', delay: '.16s' },
  { left: '92%', top: '41%', dx: '23px', dy: '-5px', delay: '.04s' },
  { left: '15%', top: '84%', dx: '-20px', dy: '13px', delay: '.12s' },
  { left: '76%', top: '89%', dx: '16px', dy: '19px', delay: '.2s' },
];

function LoginField({ id, label, icon, value, onChange, placeholder, autoComplete, type = 'text', showPassword, onTogglePassword }) {
  const [focused, setFocused] = useState(false);
  const [sparkleBurst, setSparkleBurst] = useState(0);

  function triggerSparkles() {
    setSparkleBurst((current) => current + 1);
  }

  return (
    <div className={`login-field ${focused ? 'login-field-focused' : ''}`}>
      <label htmlFor={id}>{label}</label>
      <div className={`login-input-shell ${type === 'password' ? 'login-password-shell' : ''}`}>
        <span className="login-input-icon" aria-hidden="true">
          {icon === 'user' ? (
            <svg viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="8" r="3.5" />
              <path d="M5 20c.6-3.5 3.1-5.3 7-5.3s6.4 1.8 7 5.3" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none">
              <circle cx="8" cy="12" r="4" />
              <path d="M12 12h8m-3 0v3m-3-3v2" />
            </svg>
          )}
        </span>
        <input
          id={id}
          name={id}
          type={type === 'password' && showPassword ? 'text' : type}
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
            triggerSparkles();
          }}
          onFocus={() => {
            setFocused(true);
            triggerSparkles();
          }}
          onClick={triggerSparkles}
          onBlur={() => setFocused(false)}
          autoComplete={autoComplete}
          required
          placeholder={placeholder}
        />
        <span className="login-field-crystal" aria-hidden="true">✦</span>
        {type === 'password' && (
          <button
            className="login-password-toggle"
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={onTogglePassword}
            aria-label={showPassword ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'}
            aria-pressed={showPassword}
          >
            {showPassword ? 'Sembunyikan' : 'Tampilkan'}
          </button>
        )}
        {focused && <div className="login-input-sparkles" key={sparkleBurst} aria-hidden="true">
          {LOGIN_SPARKLES.map((sparkle, index) => (
            <span
              className="login-input-sparkle"
              key={`${sparkleBurst}-${index}`}
              style={{
                '--spark-left': sparkle.left,
                '--spark-top': sparkle.top,
                '--spark-dx': sparkle.dx,
                '--spark-dy': sparkle.dy,
                '--spark-delay': sparkle.delay,
              }}
            >✧</span>
          ))}
        </div>}
      </div>
    </div>
  );
}

function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const result = await api('/auth/login', { method: 'POST', body: { username, password } });
      setToken(result.token);
      onLogin(result.user);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-page">
      <div className="login-art">
        <div className="hero-snowfall" aria-hidden="true">
          {Array.from({ length: 20 }, (_, index) => (
            <span
              className="hero-snowflake"
              key={index}
              style={{
                left: `${(index * 47 + 9) % 100}%`,
                animationDelay: `-${(index * 1.37) % 11}s`,
                animationDuration: `${9 + (index % 5)}s`,
                '--snow-drift': `${((index % 5) - 2) * 24}px`,
                '--snow-size': `${8 + (index % 4) * 3}px`,
              }}
            />
          ))}
        </div>
        <svg className="hero-crystal hero-crystal-one" viewBox="0 0 120 140" aria-hidden="true">
          <path d="M60 4 112 34v72L60 136 8 106V34z" />
          <path d="M60 4v132M8 34l104 72M112 34 8 106M8 34h104M8 106h104" />
        </svg>
        <svg className="hero-crystal hero-crystal-two" viewBox="0 0 120 140" aria-hidden="true">
          <path d="M60 4 112 34v72L60 136 8 106V34z" />
          <path d="M60 4v132M8 34l104 72M112 34 8 106M8 34h104M8 106h104" />
        </svg>
        <div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" />
        <div className="ice-mark">❄</div>
        <div className="art-copy">
          <span className="eyebrow">RANTAI DINGIN YANG LEBIH CERDAS</span>
          <h1>Distribusi segar,<br />sampai ke setiap toko.</h1>
          <p>Kelola stok, pengantaran, dan perawatan freezer dalam satu peta.</p>
          <div className="hero-badges">
            <span className="hero-badge cold-chain-badge"><b>−18°C</b><span>Cold Chain System</span></span>
            <span className="hero-badge map-feature-badge"><span aria-hidden="true">◎</span><span>Peta distribusi terpantau</span></span>
          </div>
        </div>
        <div className="art-foot"><span>●</span> Terhubung dengan jaringan mitra Anda</div>
      </div>
      <div className="login-panel">
        <div className="login-panel-inner">
          <div className="brand brand-login"><span className="brand-symbol">❄</span><span>ice<span>distribution</span></span></div>
          <div className="login-card">
            <div className="login-form-wrap">
              <span className="eyebrow">SELAMAT DATANG</span>
              <h2>Masuk ke akun Anda</h2>
              <p className="muted">Gunakan akun admin atau pemilik toko yang telah disiapkan.</p>
              <form onSubmit={submit} className="form-stack">
                <LoginField id="username" label="Nama pengguna" icon="user" value={username} onChange={setUsername} autoComplete="username" placeholder="Masukkan nama pengguna" />
                <LoginField id="password" label="Kata sandi" icon="key" type="password" value={password} onChange={setPassword} autoComplete="current-password" placeholder="Masukkan kata sandi" showPassword={showPassword} onTogglePassword={() => setShowPassword((visible) => !visible)} />
                {error && <div className="error-box" role="alert">{error}</div>}
                <button className="button button-primary button-wide" disabled={busy}>{busy ? 'Sedang masuk…' : 'Masuk'}</button>
              </form>
              <div className="login-note"><span>i</span><p>Akun demo dapat disiapkan melalui skrip seed di backend.</p></div>
            </div>
          </div>
          <div className="login-bottom">IceDistribution · Pengelolaan distribusi es krim</div>
        </div>
      </div>
    </main>
  );
}

function Header({ user, onLogout }) {
  return (
    <header className="topbar">
      <div className="brand"><span className="brand-symbol">❄</span><span>ice<span>distribution</span></span></div>
      <div className="topbar-right">
        <span className="live-indicator"><i /> Sistem aktif</span>
        <div className="user-chip"><span className="avatar">{(user.name || 'I').slice(0, 1).toUpperCase()}</span><span><b>{user.name}</b><small>{user.role === 'ADMIN' ? 'Admin Es Krim' : 'Pemilik Toko'}</small></span></div>
        <button className="icon-button" onClick={onLogout} aria-label="Keluar" title="Keluar">↪</button>
      </div>
    </header>
  );
}

function Sidebar({ active, setActive, user }) {
  if (user.role !== 'ADMIN') return null;
  return (
    <aside className="sidebar">
      <div className="side-label">RUANG KERJA</div>
      <nav>
        {NAV_ITEMS.map((item) => (
          <button key={item.id} className={`nav-item ${active === item.id ? 'nav-active' : ''}`} onClick={() => setActive(item.id)}>
            <Icon>{item.icon}</Icon>{item.label}
          </button>
        ))}
      </nav>
      <div className="sidebar-card">
        <div className="sidebar-card-icon">✦</div><b>Rantai dingin terjaga</b>
        <p>Pastikan setiap freezer dirawat secara rutin.</p>
        <button onClick={() => setActive('maintenance')}>Lihat jadwal <span>→</span></button>
      </div>
      <div className="sidebar-footer"><span className="footer-snow">❄</span><span>IceDistribution<br /><small>Manajemen distribusi</small></span></div>
    </aside>
  );
}

function PageTitle({ eyebrow, title, description, action }) {
  return <div className="page-title"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>{action}</div>;
}

function StatCard({ icon, label, value, note, tone }) {
  return <div className="stat-card dashboard-snow-capped"><DashboardSnowCap /><div className={`stat-icon ${tone}`}><Icon>{icon}</Icon></div><div><span>{label}</span><strong>{value ?? '—'}</strong><small>{note}</small></div></div>;
}

function DashboardSnowCap() {
  return (
    <svg className="dashboard-snow-cap" viewBox="0 0 320 22" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <path d="M0 0H320V10c-17 0-19 7-35 7-12 0-14-5-26-5-15 0-17 8-34 8-15 0-18-7-32-7-17 0-19 6-34 6-17 0-19-7-34-7-16 0-19 8-35 8-13 0-17-7-29-7-16 0-19 5-34 5-12 0-16-5-27-5Z" fill="#f7fcff" />
      <path d="M0 10c11 0 15 5 27 5 15 0 18-5 34-5 12 0 16 7 29 7 16 0 19-8 35-8 15 0 17 7 34 7 15 0 17-6 34-6 14 0 17 7 32 7 17 0 19-8 34-8 12 0 14 5 26 5 16 0 18-7 35-7" fill="none" stroke="#c8e8f3" strokeWidth="1.2" />
    </svg>
  );
}

function DashboardSnowfall() {
  return (
    <div className="dashboard-snowfall" aria-hidden="true">
      {Array.from({ length: 22 }, (_, index) => (
        <span
          className="dashboard-snowflake"
          key={index}
          style={{
            left: `${(index * 43 + 11) % 100}%`,
            animationDelay: `-${(index * 1.53) % 17}s`,
            animationDuration: `${14 + (index % 7)}s`,
            '--dashboard-snow-drift': `${((index % 5) - 2) * 34}px`,
            '--dashboard-snow-size': `${6 + (index % 3) * 2}px`,
          }}
        />
      ))}
    </div>
  );
}

function Alert({ message, type = 'error', onClose }) {
  if (!message) return null;
  return <div className={`alert alert-${type}`} role="status"><span>{message}</span>{onClose && <button onClick={onClose} aria-label="Tutup">×</button>}</div>;
}

function OutletTable({ outlets, selected = [], onToggle, onStockChange, showStock = true }) {
  if (!outlets.length) return <div className="empty-state"><span>◎</span><b>Belum ada data toko</b><p>Data akan muncul setelah tersedia pada basis data.</p></div>;
  return (
    <div className="table-scroll"><table><thead><tr>{onToggle && <th /> }<th>Nama toko</th><th>Status kerja sama</th>{showStock && <th>Kondisi stok</th>}<th>Lokasi</th>{onStockChange && <th>Perbarui stok</th>}</tr></thead>
      <tbody>{outlets.map((outlet) => (
        <tr key={outlet.outletId}>
          {onToggle && <td><input type="checkbox" checked={selected.includes(outlet.outletId)} onChange={() => onToggle(outlet.outletId)} aria-label={`Pilih ${outlet.outletName}`} /></td>}
          <td><div className="table-name">{outlet.outletName}<small>{outlet.ownerName || outlet.phoneNumber || '—'}</small></div></td>
          <td><span className={statusClass(outlet.partnershipStatus)}>{PARTNERSHIP_LABELS[outlet.partnershipStatus] || outlet.partnershipStatus}</span></td>
          {showStock && <td>{outlet.stockCondition ? <span className={statusClass(outlet.stockCondition)}>{STOCK_LABELS[outlet.stockCondition]}</span> : <span className="muted">Belum dilaporkan</span>}</td>}
          <td className="address-cell">{outlet.address || '—'}</td>
          {onStockChange && <td><select value={outlet.stockCondition || ''} onChange={(event) => onStockChange(outlet.outletId, event.target.value)}><option value="" disabled>Pilih status</option><option value="SAFE">Aman</option><option value="LOW">Stok Menipis</option><option value="EMPTY">Stok Habis</option></select></td>}
        </tr>
      ))}</tbody></table></div>
  );
}

function DashboardPage({ summary, outlets, routes, setActive }) {
  const urgent = outlets.filter((outlet) => outlet.stockCondition === 'LOW' || outlet.stockCondition === 'EMPTY');
  const pendingRoutes = routes.filter((route) => route.deliveryStatus === 'SCHEDULED' || route.deliveryStatus === 'IN_TRANSIT').slice(0, 5);
  return (
    <div className="dashboard-page">
      <DashboardSnowfall />
      <div className="dashboard-content">
        <PageTitle eyebrow="RINGKASAN OPERASIONAL" title="Selamat pagi, Admin" description="Pantau distribusi dan kondisi toko mitra Anda hari ini." action={<button className="button button-primary dashboard-snow-capped dashboard-restock-button" onClick={() => setActive('restock')}><DashboardSnowCap /><span>＋</span> Buat jadwal RESTOCK</button>} />
        <div className="stats-grid">
          <StatCard icon="⌂" label="Total toko aktif" value={summary?.total_outlets} note="Mitra dan calon mitra" tone="blue" />
          <StatCard icon="◉" label="Toko mitra" value={summary?.partner_count} note="Jaringan aktif" tone="mint" />
          <StatCard icon="!" label="Stok perlu perhatian" value={Number(summary?.low_stock_count || 0) + Number(summary?.empty_stock_count || 0)} note={`${summary?.empty_stock_count || 0} toko kehabisan stok`} tone="peach" />
          <StatCard icon="◇" label="Calon mitra" value={summary?.prospect_count} note="Peluang kerja sama" tone="lavender" />
        </div>
        <div className="section-grid">
          <section className="panel map-panel dashboard-snow-capped">
            <DashboardSnowCap />
            <div className="panel-heading"><div><h2>Sebaran toko</h2><p>Lokasi toko mitra dan calon mitra di wilayah operasional.</p></div><button className="text-button" onClick={() => setActive('map')}>Lihat peta <span>→</span></button></div>
            <MapView outlets={outlets} className="dashboard-map" />
          </section>
          <section className="panel activity-panel dashboard-snow-capped">
            <DashboardSnowCap />
            <div className="panel-heading"><div><h2>Perlu ditindaklanjuti</h2><p>Toko dengan stok menipis atau habis.</p></div><span className="count-pill">{urgent.length}</span></div>
            <div className="urgent-list">{urgent.slice(0, 5).map((outlet) => <div className="urgent-item" key={outlet.outletId}><span className={`urgent-dot ${outlet.stockCondition === 'EMPTY' ? 'dot-red' : 'dot-orange'}`} /><div><b>{outlet.outletName}</b><small>{outlet.address || 'Alamat belum tersedia'}</small></div><span className={statusClass(outlet.stockCondition)}>{STOCK_LABELS[outlet.stockCondition]}</span></div>)}{urgent.length === 0 && <p className="muted empty-copy">Semua toko memiliki stok yang aman.</p>}</div>
            <button className="panel-footer-button" onClick={() => setActive('map')}>Lihat semua toko <span>→</span></button>
          </section>
        </div>
        <section className="panel schedule-panel">
          <div className="panel-heading"><div><h2>Jadwal berikutnya</h2><p>Tugas pengantaran dan perawatan freezer yang akan datang.</p></div><button className="text-button" onClick={() => setActive('restock')}>Kelola jadwal <span>→</span></button></div>
          <RouteList routes={pendingRoutes} />
        </section>
      </div>
    </div>
  );
}

function MapPage({ outlets }) {
  const [filter, setFilter] = useState('ALL');
  const filtered = outlets.filter((outlet) => filter === 'ALL' || outlet.partnershipStatus === filter);
  return <>
    <PageTitle eyebrow="PETA OPERASIONAL" title="Peta toko" description="Jelajahi lokasi toko, status kerja sama, dan kondisi stok." />
    <section className="panel full-map-panel">
      <div className="panel-heading"><div><h2>Lokasi jaringan toko</h2><p>{filtered.length} lokasi pada peta</p></div><div className="filter-tabs">{[['ALL', 'Semua'], ['PARTNER', 'Mitra'], ['PROSPECT', 'Calon mitra']].map(([value, label]) => <button key={value} className={filter === value ? 'filter-active' : ''} onClick={() => setFilter(value)}>{label}</button>)}</div></div>
      <MapView outlets={filtered} className="full-map" />
    </section>
    <section className="panel"><div className="panel-heading"><div><h2>Daftar lokasi</h2><p>Rincian toko pada wilayah operasional.</p></div></div><OutletTable outlets={filtered} /></section>
  </>;
}

function ProspectsPage({ outlets, routes, refreshRoutes, onConvert }) {
  const prospects = outlets.filter((outlet) => outlet.partnershipStatus === 'PROSPECT');
  const [selectedId, setSelectedId] = useState(null);
  const [offerDates, setOfferDates] = useState({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyOutletId, setBusyOutletId] = useState(null);

  async function scheduleOffer(outletId) {
    setBusyOutletId(outletId);
    setError('');
    setNotice('');
    try {
      const result = await api(`/outlets/${outletId}/offer`, {
        method: 'POST',
        body: { scheduledDate: offerDates[outletId] || tomorrowString() },
      });
      setNotice(result.message);
      await refreshRoutes();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusyOutletId(null);
    }
  }

  return <>
    <PageTitle eyebrow="AKUISISI MITRA" title="Calon Mitra" description="Jadwalkan kunjungan penawaran dan daftarkan calon mitra baru." />
    <Alert message={error} /><Alert message={notice} type="success" />
    <div className="recommendation-layout">
      <section className="panel prospects-panel">
        <div className="panel-heading"><div><h2>Daftar Toko Calon Mitra</h2><p>Pilih toko untuk melihat lokasinya dan mengatur kunjungan.</p></div><span className="count-pill">{prospects.length}</span></div>
        <div className="prospect-list">{prospects.map((outlet) => {
          const hasActiveOffer = routes.some((route) => Number(route.outletId) === Number(outlet.outletId)
            && route.taskType === 'OFFER' && ['SCHEDULED', 'IN_TRANSIT'].includes(route.deliveryStatus));
          const offerDate = offerDates[outlet.outletId] || tomorrowString();
          return (
            <article key={outlet.outletId} className={`prospect-card ${selectedId === outlet.outletId ? 'prospect-card-selected' : ''}`}>
              <button className="prospect-select" onClick={() => setSelectedId(outlet.outletId)}>
                <span className="recommendation-marker">◎</span>
                <span><b>{outlet.outletName}</b><small>{outlet.address || 'Alamat belum tersedia'}</small></span>
                <span className="prospect-focus">Lihat peta</span>
              </button>
              <label>Tanggal kunjungan<input type="date" min={todayString()} value={offerDate} onChange={(event) => setOfferDates((current) => ({ ...current, [outlet.outletId]: event.target.value }))} /></label>
              <div className="prospect-actions">
                <button className="button button-primary" disabled={busyOutletId === outlet.outletId || hasActiveOffer || !offerDate} onClick={() => scheduleOffer(outlet.outletId)}>
                  {busyOutletId === outlet.outletId ? 'Menjadwalkan…' : hasActiveOffer ? 'Penawaran Terjadwal' : 'Jadwalkan Penawaran'}
                </button>
                <button className="button button-quiet" onClick={() => onConvert(outlet)}>Jadikan Mitra</button>
              </div>
            </article>
          );
        })}{prospects.length === 0 && <div className="empty-state compact-empty"><span>◎</span><b>Semua toko sudah ditindaklanjuti</b><p>Calon mitra baru akan muncul di daftar ini.</p></div>}</div>
      </section>
      <section className="panel recommendation-map-panel"><div className="panel-heading"><div><h2>Peta calon mitra</h2><p>Klik toko pada daftar untuk memusatkan peta ke lokasinya.</p></div></div><MapView outlets={prospects} focusLocation={prospects.find((outlet) => outlet.outletId === selectedId)} className="recommendation-map" /></section>
    </div>
  </>;
}

function emptyPartnerForm(prospect) {
  return {
    ownerName: prospect?.ownerName || '',
    phoneNumber: prospect?.phoneNumber || '',
    outletName: prospect?.outletName || '',
    address: prospect?.address || '',
    username: '',
    password: '',
    latitude: prospect?.latitude === undefined ? '' : String(prospect.latitude),
    longitude: prospect?.longitude === undefined ? '' : String(prospect.longitude),
  };
}

function PartnerManagementPage({ prospect, refreshAll, onCreated }) {
  const [form, setForm] = useState(() => emptyPartnerForm(prospect));
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [serialNumber, setSerialNumber] = useState('');
  const [serialLoading, setSerialLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    setForm(emptyPartnerForm(prospect));
    setShowPassword(false);
  }, [prospect]);

  const loadNextFreezerSerial = useCallback(async () => {
    setSerialLoading(true);
    try {
      const result = await api('/partners/next-freezer-serial');
      setSerialNumber(result.serialNumber);
      setError('');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSerialLoading(false);
    }
  }, []);

  useEffect(() => {
    loadNextFreezerSerial();
  }, [loadNextFreezerSerial]);

  function updateField(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  }

  function chooseLocation(location) {
    setForm((current) => ({
      ...current,
      latitude: location.latitude.toFixed(6),
      longitude: location.longitude.toFixed(6),
    }));
  }

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const body = {
        ...form,
        latitude: Number(form.latitude),
        longitude: Number(form.longitude),
        ...(prospect ? { prospectOutletId: prospect.outletId } : {}),
      };
      const result = await api('/partners', { method: 'POST', body });
      setNotice(`${result.message} Nomor seri freezer: ${result.partner.serialNumber}.`);
      await refreshAll();
      onCreated();
      await loadNextFreezerSerial();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  const hasLocation = form.latitude !== '' && form.longitude !== ''
    && Number.isFinite(Number(form.latitude)) && Number.isFinite(Number(form.longitude));
  const selectedLocation = useMemo(
    () => hasLocation ? { latitude: Number(form.latitude), longitude: Number(form.longitude) } : undefined,
    [form.latitude, form.longitude, hasLocation],
  );
  return <>
    <PageTitle
      eyebrow="PENDAFTARAN DAN PERANGKAT"
      title={prospect ? 'Jadikan Mitra' : 'Kelola Mitra'}
      description={prospect ? 'Lengkapi data calon mitra dan siapkan akun serta freezernya.' : 'Daftarkan pemilik toko, akun login, dan unit freezer baru.'}
    />
    <Alert message={error} />
    <Alert message={notice} type="success" />
    <div className="partner-registration-layout">
      <section className="panel partner-registration-panel">
        <div className="panel-heading"><div><h2>Data pendaftaran mitra</h2><p>Akun, toko, dan freezer akan disimpan sekaligus.</p></div><span className="panel-icon">＋</span></div>
        <form className="partner-registration-form" onSubmit={submit}>
          <div className="partner-form-grid">
            <label>Nama Pemilik<input name="ownerName" value={form.ownerName} onChange={updateField} required maxLength={100} placeholder="Nama lengkap pemilik" /></label>
            <label>No. HP<input name="phoneNumber" type="tel" value={form.phoneNumber} onChange={updateField} required maxLength={20} placeholder="08xxxxxxxxxx" /></label>
            <label>Nama Toko<input name="outletName" value={form.outletName} onChange={updateField} required maxLength={100} placeholder="Nama toko mitra" /></label>
            <label>Nomor Seri Freezer (otomatis)<div className="serial-number-control"><input value={serialNumber} readOnly placeholder={serialLoading ? 'Menyiapkan nomor seri…' : 'Dibuat otomatis saat disimpan'} /><button className="button button-quiet" type="button" onClick={loadNextFreezerSerial} disabled={serialLoading} aria-label="Muat ulang perkiraan nomor seri">↻</button></div><small className="field-help">Nomor mengikuti urutan seri freezer yang sudah terdaftar.</small></label>
            <label>Username Login<input name="username" value={form.username} onChange={updateField} required minLength={3} maxLength={80} autoComplete="username" placeholder="Username untuk pemilik toko" /></label>
            <label>Kata Sandi Login<div className="password-input-wrap"><input name="password" type={showPassword ? 'text' : 'password'} value={form.password} onChange={updateField} required minLength={8} autoComplete="new-password" placeholder="Minimal 8 karakter" /><button className="password-toggle" type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'} aria-pressed={showPassword}>{showPassword ? 'Sembunyikan' : 'Tampilkan'}</button></div></label>
          </div>
          <label>Alamat<textarea name="address" value={form.address} onChange={updateField} required rows={3} placeholder="Alamat lengkap lokasi toko" /></label>
          <div className="partner-form-grid coordinate-grid">
            <label>Garis Lintang (latitude)<input name="latitude" type="number" step="any" min="-90" max="90" value={form.latitude} onChange={updateField} required placeholder="-1.850000" /></label>
            <label>Garis Bujur (longitude)<input name="longitude" type="number" step="any" min="-180" max="180" value={form.longitude} onChange={updateField} required placeholder="106.120000" /></label>
          </div>
          <button className="button button-primary button-wide" disabled={busy || serialLoading}>{busy ? 'Menyimpan pendaftaran…' : prospect ? 'Aktifkan sebagai Mitra' : 'Daftarkan Mitra'}</button>
        </form>
      </section>
      <section className="panel partner-location-panel">
        <div className="panel-heading"><div><h2>Tentukan lokasi toko</h2><p>Klik titik lokasi toko pada peta untuk mengisi koordinat.</p></div><span className="panel-icon">◎</span></div>
        <MapView
          selectedLocation={selectedLocation}
          onMapClick={chooseLocation}
          className="partner-location-map"
          showLegend={false}
        />
        <div className="map-pick-hint"><span>i</span>{hasLocation ? `Koordinat dipilih: ${form.latitude}, ${form.longitude}` : 'Pilih titik pada peta atau isi koordinat secara manual.'}</div>
      </section>
    </div>
  </>;
}

function RouteList({ routes, onStatusChange, onDateChange, updatingDateRouteId }) {
  if (!routes.length) return <div className="empty-state compact-empty"><span>◷</span><b>Belum ada jadwal</b><p>Jadwal yang dibuat akan tampil di sini.</p></div>;
  return <div className="table-scroll"><table><thead><tr><th>Tanggal</th><th>Tugas</th><th>Nama toko</th><th>Urutan</th><th>Status</th>{onStatusChange && <th>Perbarui</th>}</tr></thead><tbody>
    {routes.map((route) => <tr key={route.routeId}><td>{onDateChange && route.taskType === 'RESTOCK' ? <input className="route-date-input" type="date" aria-label={`Ubah tanggal RESTOCK ${route.outletName}`} value={String(route.scheduledDate).slice(0, 10)} disabled={route.deliveryStatus !== 'SCHEDULED' || updatingDateRouteId === route.routeId} onChange={(event) => onDateChange(route.routeId, event.target.value)} /> : formatDate(route.scheduledDate)}</td><td><span className={`task-type ${route.taskType === 'MAINTENANCE' ? 'task-maintenance' : route.taskType === 'OFFER' ? 'task-offer' : ''}`}>{TASK_LABELS[route.taskType] || route.taskType}</span></td><td><b>{route.outletName}</b></td><td>{route.stopOrder || '—'}</td><td><span className={statusClass(route.deliveryStatus)}>{ROUTE_LABELS[route.deliveryStatus] || route.deliveryStatus}</span></td>{onStatusChange && <td><select value={route.deliveryStatus} disabled={route.deliveryStatus === 'COMPLETED'} onChange={(event) => onStatusChange(route.routeId, event.target.value)}><option value="SCHEDULED">Terjadwal</option><option value="IN_TRANSIT">Dalam perjalanan</option><option value="COMPLETED">Selesai</option><option value="SKIPPED">Dilewati</option></select></td>}</tr>)}
  </tbody></table></div>;
}

function RestockPage({ routes, refreshRoutes }) {
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyAction, setBusyAction] = useState('');
  const [updatingDateRouteId, setUpdatingDateRouteId] = useState(null);
  const [routeDate, setRouteDate] = useState(tomorrowString);
  const visibleRoutes = routes.filter((route) => String(route.scheduledDate).slice(0, 10) === routeDate);
  const routeDay = visibleRoutes
    .filter((route) => route.deliveryStatus !== 'SKIPPED')
    .sort((a, b) => Number(a.stopOrder) - Number(b.stopOrder) || Number(a.routeId) - Number(b.routeId));
  const mapOutlets = [...new Map(routeDay.map((route) => [route.outletId, route])).values()];
  const destinationCount = new Set(routeDay.map((route) => route.outletId)).size;
  const scheduledCount = routeDay.filter((route) => route.deliveryStatus === 'SCHEDULED').length;

  async function reorderRoute() {
    setError('');
    setNotice('');
    setBusyAction('reorder');
    try {
      const result = await api('/routes/reorder', { method: 'POST', body: { scheduledDate: routeDate } });
      setNotice(result.message);
      await refreshRoutes();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusyAction('');
    }
  }

  async function startAllRoutes() {
    setError('');
    setNotice('');
    setBusyAction('start');
    try {
      const result = await api('/routes/start-all', { method: 'PATCH', body: { scheduledDate: routeDate } });
      setNotice(result.message);
      await refreshRoutes();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusyAction('');
    }
  }

  async function updateStatus(routeId, deliveryStatus) {
    try {
      await api(`/routes/${routeId}/status`, { method: 'PATCH', body: { deliveryStatus } });
      setNotice('Status tugas berhasil diperbarui.');
      await refreshRoutes();
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function updateDate(routeId, scheduledDate) {
    if (!scheduledDate) return;
    setError('');
    setNotice('');
    setUpdatingDateRouteId(routeId);
    try {
      const result = await api(`/routes/${routeId}/date`, { method: 'PATCH', body: { scheduledDate } });
      setNotice(result.message);
      setRouteDate(scheduledDate);
      await refreshRoutes();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setUpdatingDateRouteId(null);
    }
  }

  return <>
    <PageTitle eyebrow="PENGANTARAN STOK" title="Jadwal RESTOCK" description="Pantau dan kelola rute pengantaran yang terbentuk dari jadwal operasional." />
    <Alert message={error} /><Alert message={notice} type="success" />
    <div className="restock-layout">
      <section className="panel route-summary-panel"><div className="panel-heading"><div><h2>Ringkasan Rute Terjadwal</h2><p>Semua tugas pengiriman pada tanggal yang dipilih.</p></div><span className="count-pill">{destinationCount} toko</span></div>
        <div className="route-summary-stats">
          <div><span>Tujuan</span><b>{destinationCount} toko</b></div>
          <div><span>Estimasi jarak</span><b>{routeDistanceKm(routeDay).toFixed(1)} km</b><small>Jarak garis lurus antartoko</small></div>
        </div>
        <div className="route-summary-heading"><b>Urutan pemberhentian</b><span>{routeDay.length} tugas</span></div>
        <div className="route-summary-list">{routeDay.map((route) => <div className="route-summary-stop" key={route.routeId}>
          <span className="route-stop-number">{route.stopOrder}</span>
          <span className="route-stop-name"><b>{route.outletName}</b><small>{TASK_LABELS[route.taskType] || route.taskType}</small></span>
          <span className={statusClass(route.deliveryStatus)}>{ROUTE_LABELS[route.deliveryStatus]}</span>
        </div>)}{routeDay.length === 0 && <p className="muted empty-copy">Belum ada tugas pengiriman pada tanggal ini.</p>}</div>
        <div className="route-summary-actions">
          <button className="button button-secondary button-wide" onClick={reorderRoute} disabled={busyAction !== '' || routeDay.length < 2}>{busyAction === 'reorder' ? 'Menyusun ulang…' : 'Susun Ulang (Utara → Selatan)'}</button>
          <button className="button button-primary button-wide" onClick={startAllRoutes} disabled={busyAction !== '' || scheduledCount === 0}>{busyAction === 'start' ? 'Memulai pengiriman…' : `Mulai Semua Pengiriman${scheduledCount ? ` · ${scheduledCount}` : ''}`}</button>
        </div>
      </section>
      <section className="panel route-preview-panel"><div className="panel-heading"><div><h2>Pratinjau rute</h2><p>Pilih tanggal untuk melihat urutan titik pengantaran.</p></div></div>
        <label className="inline-date">Tanggal rute<input type="date" value={routeDate} onChange={(event) => setRouteDate(event.target.value)} /></label>
        <MapView outlets={mapOutlets} routeStops={routeDay} className="route-map" />
        <div className="route-order-list">{routeDay.map((route) => <div className="route-order-item" key={route.routeId}><span>{route.stopOrder}</span><b>{route.outletName}</b><small>{ROUTE_LABELS[route.deliveryStatus]}</small></div>)}{routeDay.length === 0 && <p className="muted empty-copy">Belum ada titik pengantaran pada tanggal ini.</p>}</div>
      </section>
    </div>
    <section className="panel"><div className="panel-heading"><div><h2>Semua tugas pengiriman</h2><p>Ubah tanggal RESTOCK yang masih terjadwal atau perbarui status tugas.</p></div><span className="count-pill">{visibleRoutes.length}</span></div><RouteList routes={visibleRoutes} onStatusChange={updateStatus} onDateChange={updateDate} updatingDateRouteId={updatingDateRouteId} /></section>
  </>;
}

function MaintenancePage({ routes, refreshRoutes }) {
  const [settings, setSettings] = useState({ workdays: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'], dailyCapacity: 4 });
  const [cycleStart, setCycleStart] = useState(todayString());
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const maintenanceRoutes = routes.filter((route) => route.taskType === 'MAINTENANCE');

  const refreshSettings = useCallback(async () => {
    try {
      const result = await api('/maintenance/settings');
      if (result.settings) setSettings({ ...result.settings, dailyCapacity: Number(result.settings.dailyCapacity) });
    } catch (requestError) {
      setError(requestError.message);
    }
  }, []);
  useEffect(() => { refreshSettings(); }, [refreshSettings]);

  function toggleDay(day) {
    setSettings((current) => ({
      ...current,
      workdays: current.workdays.includes(day)
        ? current.workdays.filter((item) => item !== day)
        : [...current.workdays, day],
    }));
  }
  async function saveSettings() {
    setError('');
    setNotice('');
    try {
      const result = await api('/maintenance/settings', { method: 'PUT', body: settings });
      setNotice(result.message);
    } catch (requestError) {
      setError(requestError.message);
    }
  }
  async function generateSchedule() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await api('/maintenance/schedule', { method: 'POST', body: { cycleStart } });
      setNotice(result.message);
      await refreshRoutes();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }
  async function updateStatus(routeId, deliveryStatus) {
    try {
      await api(`/routes/${routeId}/status`, { method: 'PATCH', body: { deliveryStatus } });
      setNotice('Status maintenance berhasil diperbarui.');
      await refreshRoutes();
    } catch (requestError) {
      setError(requestError.message);
    }
  }
  return <>
    <PageTitle eyebrow="PERAWATAN BERKALA" title="Maintenance freezer" description="Atur kunjungan rutin setiap 14 hari dan sebarkan beban kerja per zona." />
    <Alert message={error} /><Alert message={notice} type="success" />
    <div className="maintenance-grid">
      <section className="panel settings-panel"><div className="panel-heading"><div><h2>Pengaturan petugas</h2><p>Satu petugas lapangan menangani jadwal ini.</p></div><span className="settings-icon">◷</span></div>
        <div className="cycle-callout"><span>14</span><div><b>Siklus maintenance</b><small>Setiap 14 hari untuk freezer terpasang</small></div></div>
        <div className="field-label">Hari kerja</div><div className="weekday-grid">{WEEKDAYS.map(([day, label]) => <label key={day} className={`weekday-option ${settings.workdays.includes(day) ? 'weekday-selected' : ''}`}><input type="checkbox" checked={settings.workdays.includes(day)} onChange={() => toggleDay(day)} /><span>{label}</span></label>)}</div>
        <label>Kapasitas kunjungan per hari<input type="number" min="1" max="30" value={settings.dailyCapacity} onChange={(event) => setSettings({ ...settings, dailyCapacity: Number(event.target.value) })} /></label>
        <button className="button button-secondary button-wide" onClick={saveSettings}>Simpan pengaturan</button>
      </section>
      <section className="panel generate-panel"><div className="panel-heading"><div><h2>Jadwalkan siklus</h2><p>Sistem membagi tugas merata pada hari kerja dan mengelompokkan lokasi berdekatan.</p></div><span className="generate-sparkle">✦</span></div>
        <label>Tanggal awal siklus<input type="date" value={cycleStart} onChange={(event) => setCycleStart(event.target.value)} /></label>
        <div className="schedule-info"><span>i</span><p>Freezer terpasang dengan tanggal maintenance jatuh tempo dalam 14 hari ke depan akan dijadwalkan. Beban kunjungan dibagi merata sesuai kapasitas.</p></div>
        <button className="button button-primary button-wide" onClick={generateSchedule} disabled={busy || settings.workdays.length === 0}>{busy ? 'Menyusun jadwal…' : 'Susun jadwal 14 hari'}</button>
      </section>
    </div>
    <section className="panel"><div className="panel-heading"><div><h2>Jadwal maintenance</h2><p>Kunjungan yang sudah direncanakan untuk semua toko.</p></div><span className="count-pill">{maintenanceRoutes.length}</span></div><RouteList routes={maintenanceRoutes} onStatusChange={updateStatus} /></section>
  </>;
}

function PartnerDashboard({ user, onLogout }) {
  const [data, setData] = useState({ outlets: [], routes: [] });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(true);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const result = await api('/partner/dashboard');
      setData(result);
      setError('');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  async function updateStock(outletId, stockCondition) {
    try {
      const result = await api(`/outlets/${outletId}/stock`, { method: 'PATCH', body: { stockCondition } });
      setNotice(result.message);
      await refresh();
    } catch (requestError) {
      setError(requestError.message);
    }
  }
  const outlet = data.outlets[0];
  return (
    <div className="partner-app">
      <Header user={user} onLogout={onLogout} />
      <main className="partner-main">
        <PageTitle eyebrow="HALAMAN TOKO MITRA" title={`Halo, ${outlet?.outletName || user.name}`} description="Perbarui kondisi stok dan lihat jadwal layanan untuk toko Anda." action={<button className="button button-quiet" onClick={refresh}>↻ Perbarui data</button>} />
        <Alert message={error} /><Alert message={notice} type="success" />
        {busy && !outlet ? <div className="panel loading-panel">Memuat informasi toko…</div> : null}
        {outlet && <>
          <div className="partner-status-banner"><div className="status-banner-icon">❄</div><div><span className="eyebrow">KONDISI STOK SAAT INI</span><h2>{STOCK_LABELS[outlet.stockCondition] || 'Belum dilaporkan'}</h2><p>Pembaruan terakhir: {outlet.stockUpdatedAt ? formatDate(outlet.stockUpdatedAt) : 'Belum ada laporan'}</p></div><span className={statusClass(outlet.stockCondition)}>{STOCK_LABELS[outlet.stockCondition] || 'Belum dilaporkan'}</span></div>
          <div className="partner-grid">
            <section className="panel stock-update-panel"><div className="panel-heading"><div><h2>Perbarui status stok</h2><p>Pilih kondisi stok es krim di toko Anda.</p></div><span className="panel-icon">◉</span></div>
              <div className="stock-choice-list">{[['SAFE', 'Aman', 'Stok tersedia untuk memenuhi kebutuhan pelanggan.', '✓'], ['LOW', 'Stok Menipis', 'Persediaan mulai berkurang dan perlu diperhatikan.', '!'], ['EMPTY', 'Stok Habis', 'Persediaan es krim di toko sudah habis.', '×']].map(([value, title, copy, icon]) => <button key={value} className={`stock-choice ${outlet.stockCondition === value ? 'stock-choice-active' : ''}`} onClick={() => updateStock(outlet.outletId, value)}><span className={`choice-icon choice-${value.toLowerCase()}`}>{icon}</span><span><b>{title}</b><small>{copy}</small></span><span className="choice-arrow">{outlet.stockCondition === value ? '✓' : '→'}</span></button>)}</div>
            </section>
            <section className="panel next-service-panel"><div className="panel-heading"><div><h2>Layanan berikutnya</h2><p>Rencana kunjungan ke toko Anda.</p></div><span className="panel-icon">◷</span></div>
              <div className="service-summary"><span className="service-date">{formatDate(outlet.nextMaintenanceDate)}</span><b>Maintenance freezer</b><small>{outlet.freezerStatus === 'INSTALLED' ? 'Freezer terpasang' : `Status freezer: ${outlet.freezerStatus || 'Belum tersedia'}`}</small></div>
              <div className="service-divider" />
              <div className="mini-route-list">{data.routes.slice(0, 4).map((route) => <div className="mini-route" key={route.routeId}><span className={`mini-route-dot ${route.taskType === 'MAINTENANCE' ? 'mini-maintenance' : route.taskType === 'OFFER' ? 'mini-offer' : ''}`} /><span><b>{route.taskType === 'MAINTENANCE' ? 'Maintenance freezer' : route.taskType === 'OFFER' ? 'Kunjungan penawaran' : 'Pengiriman RESTOCK'}</b><small>{formatDate(route.scheduledDate)}</small></span><span className={statusClass(route.deliveryStatus)}>{ROUTE_LABELS[route.deliveryStatus]}</span></div>)}{data.routes.length === 0 && <p className="muted empty-copy">Belum ada jadwal pengiriman.</p>}</div>
            </section>
          </div>
        </>}
        <div className="partner-help"><span>✦</span><p>Terima kasih telah menjadi bagian dari jaringan IceDistribution. Perbarui status stok secara berkala agar pengantaran dapat direncanakan dengan baik.</p></div>
      </main>
    </div>
  );
}

function AdminDashboard({ user, onLogout }) {
  const [active, setActive] = useState('overview');
  const [prospectForPartner, setProspectForPartner] = useState(null);
  const [summary, setSummary] = useState(null);
  const [outlets, setOutlets] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refreshRoutes = useCallback(async () => {
    const result = await api('/routes');
    setRoutes(result.routes);
  }, []);
  const refreshAll = useCallback(async () => {
    try {
      const [dashboard, outletResult] = await Promise.all([api('/dashboard'), api('/outlets')]);
      setSummary(dashboard.summary);
      setOutlets(outletResult.outlets);
      await refreshRoutes();
      setError('');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, [refreshRoutes]);
  useEffect(() => { refreshAll(); }, [refreshAll]);

  async function changeStock(outletId, stockCondition) {
    try {
      await api(`/outlets/${outletId}/stock`, { method: 'PATCH', body: { stockCondition } });
      setOutlets((current) => current.map((outlet) => outlet.outletId === outletId ? { ...outlet, stockCondition } : outlet));
    } catch (requestError) {
      setError(requestError.message);
    }
  }
  function logout() {
    setToken(null);
    onLogout();
  }

  function convertProspect(outlet) {
    setProspectForPartner(outlet);
    setActive('manage-partners');
  }

  let page;
  if (active === 'overview') page = <DashboardPage summary={summary} outlets={outlets} routes={routes} setActive={setActive} />;
  else if (active === 'map') page = <MapPage outlets={outlets} />;
  else if (active === 'prospects') page = <ProspectsPage outlets={outlets} routes={routes} refreshRoutes={refreshRoutes} onConvert={convertProspect} />;
  else if (active === 'manage-partners') {
    page = <PartnerManagementPage
      prospect={prospectForPartner}
      refreshAll={refreshAll}
      onCreated={() => setProspectForPartner(null)}
    />;
  }
  else if (active === 'restock') page = <RestockPage routes={routes} refreshRoutes={refreshRoutes} />;
  else page = <MaintenancePage routes={routes} refreshRoutes={refreshRoutes} />;

  return (
    <div className="admin-app">
      <Header user={user} onLogout={logout} />
      <div className="app-shell"><Sidebar active={active} setActive={setActive} user={user} />
        <main className="main-content"><div className="main-inner">
          <div className="content-toolbar"><div className="breadcrumb">Operasional <span>/</span> {NAV_ITEMS.find((item) => item.id === active)?.label}</div><button className="refresh-button" onClick={refreshAll} title="Perbarui data">↻ <span>Perbarui</span></button></div>
          <Alert message={error} onClose={() => setError('')} />
          {loading ? <div className="panel loading-panel">Memuat data operasional…</div> : page}
        </div></main>
      </div>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(Boolean(getToken()));
  useEffect(() => {
    if (!getToken()) return;
    api('/auth/me').then((result) => setUser(result.user)).catch(() => setToken(null)).finally(() => setChecking(false));
  }, []);
  if (checking) return <div className="app-loading">Menyiapkan IceDistribution…</div>;
  if (!user) return <Login onLogin={setUser} />;
  const logout = () => setUser(null);
  return user.role === 'ADMIN'
    ? <AdminDashboard user={user} onLogout={logout} />
    : <PartnerDashboard user={user} onLogout={() => { setToken(null); logout(); }} />;
}
