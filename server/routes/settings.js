import { Router } from 'express';
import { db } from '../db.js';
import { requireAdmin, requireAdminOrKiosk, ah } from '../middleware.js';

const router = Router();

const COLS = 'threshold, late_cutoff, work_start, work_end, timezone, daily_rate, standard_hours';

// Kiosk needs the threshold; admins need everything. Both allowed to read.
router.get('/settings', requireAdminOrKiosk, ah(async (req, res) => {
  const s = await db.get(`SELECT ${COLS} FROM settings WHERE id = 1`);
  res.json(s);
}));

router.put('/settings', requireAdmin, ah(async (req, res) => {
  const cur = await db.get(`SELECT ${COLS} FROM settings WHERE id = 1`);
  const threshold = clampNum(req.body?.threshold, 0.3, 0.8, cur.threshold);
  const late_cutoff = validTime(req.body?.late_cutoff, cur.late_cutoff);
  const work_start = validTime(req.body?.work_start, cur.work_start);
  const work_end = validTime(req.body?.work_end, cur.work_end);
  const timezone = validTimezone(req.body?.timezone, cur.timezone);
  const daily_rate = clampNum(req.body?.daily_rate, 0, 1000000, cur.daily_rate);
  const standard_hours = clampNum(req.body?.standard_hours, 0.5, 24, cur.standard_hours);
  await db.run(
    'UPDATE settings SET threshold = ?, late_cutoff = ?, work_start = ?, work_end = ?, timezone = ?, daily_rate = ?, standard_hours = ? WHERE id = 1',
    threshold, late_cutoff, work_start, work_end, timezone, daily_rate, standard_hours
  );
  res.json({ threshold, late_cutoff, work_start, work_end, timezone, daily_rate, standard_hours });
}));

// ---- Per-department pay rates ----
// Lists every department currently in use (plus any with a configured override)
// alongside its override, or null where it falls back to the default rate.
router.get('/department-rates', requireAdmin, ah(async (req, res) => {
  const s = await db.get('SELECT daily_rate, standard_hours FROM settings WHERE id = 1');
  const rates = await db.all('SELECT department, daily_rate, standard_hours FROM department_rates');
  const rateMap = new Map(rates.map((r) => [r.department, r]));
  const inUse = await db.all(
    "SELECT DISTINCT department FROM employees WHERE department <> '' ORDER BY department COLLATE NOCASE"
  );
  const names = new Set(inUse.map((d) => d.department));
  for (const r of rates) names.add(r.department); // keep overrides even with no active staff
  const departments = [...names]
    .sort((a, b) => a.localeCompare(b))
    .map((name) => {
      const r = rateMap.get(name);
      return {
        department: name,
        daily_rate: r ? r.daily_rate : null,
        standard_hours: r ? r.standard_hours : null,
      };
    });
  res.json({ default_daily_rate: s.daily_rate, default_standard_hours: s.standard_hours, departments });
}));

// Set (or clear) a department's rate. An empty/null daily_rate removes the
// override so the department reverts to the default rate.
router.put('/department-rates', requireAdmin, ah(async (req, res) => {
  const department = String(req.body?.department || '').trim();
  if (!department) return res.status(400).json({ error: 'department is required' });
  const raw = req.body?.daily_rate;
  const clearing = raw === null || raw === undefined || raw === '';
  if (clearing) {
    await db.run('DELETE FROM department_rates WHERE department = ?', department);
    return res.json({ department, daily_rate: null, standard_hours: null });
  }
  const daily_rate = clampNum(raw, 0, 1000000, 0);
  const standard_hours = clampNum(req.body?.standard_hours, 0.5, 24, 8);
  await db.run(
    `INSERT INTO department_rates (department, daily_rate, standard_hours) VALUES (?, ?, ?)
     ON CONFLICT(department) DO UPDATE SET daily_rate = excluded.daily_rate, standard_hours = excluded.standard_hours`,
    department, daily_rate, standard_hours
  );
  res.json({ department, daily_rate, standard_hours });
}));

// Destructive: wipe employees, descriptors and attendance (keeps users/settings/devices).
router.post('/settings/clear-data', requireAdmin, ah(async (req, res) => {
  await db.exec('DELETE FROM attendance; DELETE FROM face_descriptors; DELETE FROM employees;');
  res.json({ ok: true });
}));

function clampNum(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
function validTime(v, fallback) {
  return /^\d{2}:\d{2}$/.test(String(v || '')) ? v : fallback;
}
function validTimezone(v, fallback) {
  if (!v || typeof v !== 'string') return fallback;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: v });
    return v;
  } catch {
    return fallback;
  }
}

export default router;
