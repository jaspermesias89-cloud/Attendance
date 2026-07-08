import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { db } from '../db.js';
import { requireAdmin } from '../middleware.js';
import { signToken } from '../auth.js';

const router = Router();

router.get('/devices', requireAdmin, (req, res) => {
  res.json(db.prepare('SELECT id, name, last_seen FROM devices ORDER BY name').all());
});

// Register a kiosk device and return a long-lived kiosk token (shown once).
router.post('/devices', requireAdmin, (req, res) => {
  const name = String(req.body?.name || 'Kiosk').slice(0, 60);
  const id = 'dev_' + randomBytes(6).toString('hex');
  const token = signToken({ kind: 'kiosk', device_id: id, name }, 60 * 60 * 24 * 365); // 1 year
  db.prepare('INSERT INTO devices (id, name, token) VALUES (?, ?, ?)').run(id, name, token);
  res.status(201).json({ id, name, token });
});

router.delete('/devices/:id', requireAdmin, (req, res) => {
  const info = db.prepare('DELETE FROM devices WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

export default router;
