const WEEKDAY_NAMES = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];

export function addDays(dateString, days) {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function listWorkdays(startDate, dayCount, workdays) {
  const allowed = new Set(workdays);
  const dates = [];
  for (let offset = 0; offset < dayCount; offset += 1) {
    const date = addDays(startDate, offset);
    const weekday = WEEKDAY_NAMES[new Date(`${date}T00:00:00.000Z`).getUTCDay()];
    if (allowed.has(weekday)) dates.push(date);
  }
  return dates;
}

export function distanceMeters(a, b) {
  const toRadians = (degrees) => degrees * Math.PI / 180;
  const lat1 = toRadians(Number(a.latitude));
  const lat2 = toRadians(Number(b.latitude));
  const deltaLat = lat2 - lat1;
  const deltaLng = toRadians(Number(b.longitude) - Number(a.longitude));
  const h = Math.sin(deltaLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
  const clampedH = Math.min(1, Math.max(0, h));
  return 6371000 * 2 * Math.atan2(Math.sqrt(clampedH), Math.sqrt(1 - clampedH));
}

export function orderNorthToSouth(stops) {
  const remaining = [...stops];
  if (remaining.length === 0) return [];

  remaining.sort((a, b) => Number(b.latitude) - Number(a.latitude));
  const ordered = [remaining.shift()];
  let current = ordered[0];
  while (remaining.length) {
    let nearestIndex = 0;
    for (let index = 1; index < remaining.length; index += 1) {
      if (distanceMeters(current, remaining[index]) < distanceMeters(current, remaining[nearestIndex])) {
        nearestIndex = index;
      }
    }
    current = remaining.splice(nearestIndex, 1)[0];
    ordered.push(current);
  }
  return ordered;
}

export function distributeEvenly(items, dates, dailyCapacity) {
  if (items.length === 0) return [];
  if (dates.length === 0) throw new Error('Tidak ada hari kerja dalam rentang jadwal.');

  const perDay = Math.ceil(items.length / dates.length);
  if (perDay > dailyCapacity) {
    throw new Error(`Kapasitas tidak cukup. Diperlukan minimal ${perDay} kunjungan per hari.`);
  }

  const assignments = [];
  let cursor = 0;
  const base = Math.floor(items.length / dates.length);
  const extra = items.length % dates.length;
  dates.forEach((date, index) => {
    const count = base + (index < extra ? 1 : 0);
    for (const item of items.slice(cursor, cursor + count)) {
      assignments.push({ ...item, scheduledDate: date });
    }
    cursor += count;
  });
  return assignments;
}
