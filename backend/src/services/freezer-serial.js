export function formatFreezerSerial(sequence) {
  return `AICE-BK-${String(sequence).padStart(3, '0')}`;
}

export async function getNextFreezerSerial(connection) {
  const [[row]] = await connection.execute(`
    SELECT COALESCE(MAX(CAST(SUBSTRING(serial_number, 9) AS UNSIGNED)), 0) AS lastSequence
    FROM freezers
    WHERE serial_number REGEXP '^AICE-BK-[0-9]+$'
  `);
  return formatFreezerSerial(Number(row.lastSequence) + 1);
}
