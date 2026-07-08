import { Router } from 'express';
import { db } from '../db.js';
import { requireAdmin, requireAdminOrKiosk, ah } from '../middleware.js';

const router = Router();

// Kiosk needs the threshold; admins need everything. Both allowed to read.
router.get('/settings', requireAdminOrKiosk, ah(async (req, res) => {
  const s = await db.get('SELECT threshold, late_cutoff, work_start, work_end FROM settings WHERE id = 1');
  res.json(s);
}));

router.put('/settings', requireAdmin, ah(async (req, res) => {
  const cur = await db.get('SELECT threshold, late_cutoff, work_start, work_end FROM settings WHERE id = 1');
  const threshold = clampNum(req.body?.threshold, 0.3, 0.8, cur.threshold);
  const late_cutoff = validTime(req.body?.late_cutoff, cur.late_cutoff);
  const work_start = validTime(req.body?.work_start, cur.work_start);
  const work_end = validTime(req.body?.work_end, cur.work_end);
  await db.run(
    'UPDATE settings SET threshold = ?, late_cutoff = ?, work_start = ?, work_end = ? WHERE id = 1',
    threshold, late_cutoff, work_start, work_end
  );
  res.json({ threshold, late_cutoff, work_start, work_end });
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

export default router;
