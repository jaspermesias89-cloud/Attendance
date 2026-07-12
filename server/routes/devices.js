import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { db } from '../db.js';
import { requireAdmin, ah } from '../middleware.js';
import { signToken } from '../auth.js';

const router = Router();

router.get('/devices', requireAdmin, ah(async (req, res) => {
  res.json(await db.all('SELECT id, name, last_seen FROM devices ORDER BY name'));
}));

// Register a kiosk device and return a long-lived kiosk token (shown once).
router.post('/devices', requireAdmin, ah(async (req, res) => {
  const name = String(req.body?.name || 'Kiosk').slice(0, 60);
  const id = 'dev_' + randomBytes(6).toString('hex');
  const token = signToken({ kind: 'kiosk', device_id: id, name }, null); // non-expiring; revoke by deleting the device
  await db.run('INSERT INTO devices (id, name, token) VALUES (?, ?, ?)', id, name, token);
  res.status(201).json({ id, name, token });
}));

router.delete('/devices/:id', requireAdmin, ah(async (req, res) => {
  const info = await db.run('DELETE FROM devices WHERE id = ?', req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
}));

export default router;
