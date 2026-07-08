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
