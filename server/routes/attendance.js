import { Router } from 'express';
import { db } from '../db.js';
import { requireAdmin, requireKiosk } from '../middleware.js';

const router = Router();

const DEDUPE_MINUTES = 5;

function localParts(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const local_date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const local_time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return { local_date, local_time, ts: d.toISOString() };
}

// Kiosk posts an attendance event. Server owns time, status and dedupe.
router.post('/attendance', requireKiosk, (req, res) => {
  const { employee_id } = req.body || {};
  const kind = req.body?.kind === 'out' ? 'out' : 'in';
  const confidence = Math.max(0, Math.min(100, Math.round(Number(req.body?.confidence) || 0)));
  const device_id = req.device?.device_id || null;

  const emp = db.prepare('SELECT id, name FROM employees WHERE id = ? AND active = 1').get(employee_id);
  if (!emp) return res.status(404).json({ error: 'Unknown employee' });

  const now = new Date();
  const { local_date, local_time, ts } = localParts(now);

  // Dedupe: ignore a same-kind event for the same employee within the window.
  const cutoffIso = new Date(now.getTime() - DEDUPE_MINUTES * 60 * 1000).toISOString();
  const recent = db.prepare(
    `SELECT * FROM attendance
     WHERE employee_id = ? AND kind = ? AND ts >= ?
     ORDER BY ts DESC LIMIT 1`
  ).get(employee_id, kind, cutoffIso);
  if (recent) {
    return res.json({ duplicate: true, record: recent });
  }

  const settings = db.prepare('SELECT late_cutoff FROM settings WHERE id = 1').get();
  const status = kind === 'in' && local_time > (settings?.late_cutoff || '09:30') ? 'late' : 'present';

  const info = db.prepare(
    `INSERT INTO attendance (employee_id, ts, local_date, local_time, kind, status, confidence, device_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(employee_id, ts, local_date, local_time, kind, status, confidence, device_id);

  const record = db.prepare('SELECT * FROM attendance WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ duplicate: false, record, employee: { name: emp.name }, status });
});

// Records list with filters (admin).
router.get('/attendance', requireAdmin, (req, res) => {
  const { date, status, q } = req.query;
  const where = [];
  const params = [];
  if (date) { where.push('a.local_date = ?'); params.push(date); }
  if (status) { where.push('a.status = ?'); params.push(status); }
  if (q) {
    where.push('(e.name LIKE ? OR e.emp_code LIKE ?)');
    params.push(`%${q}%`, `%${q}%`);
  }
  const sql = `
    SELECT a.id, a.ts, a.local_date, a.local_time, a.kind, a.status, a.confidence,
           e.id AS employee_id, e.name, e.emp_code, e.department, e.photo
    FROM attendance a
    JOIN employees e ON e.id = a.employee_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY a.ts DESC
    LIMIT 1000
  `;
  res.json(db.prepare(sql).all(...params));
});

// Dashboard summary for a given date (defaults to today).
router.get('/attendance/summary', requireAdmin, (req, res) => {
  const { local_date } = localParts();
  const date = req.query.date || local_date;
  const total = db.prepare('SELECT COUNT(*) AS c FROM employees WHERE active = 1').get().c;
  const todays = db.prepare(
    `SELECT DISTINCT employee_id, status FROM attendance WHERE local_date = ? AND kind = 'in'`
  ).all(date);
  const present = todays.filter((r) => r.status === 'present').length;
  const late = todays.filter((r) => r.status === 'late').length;
  const checkedIn = new Set(todays.map((r) => r.employee_id)).size;
  res.json({ total, present, late, absent: Math.max(0, total - checkedIn), date });
});

function csvEscape(v) {
  return `"${String(v ?? '').replace(/"/g, '""')}"`;
}

router.get('/attendance/export.csv', requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT e.name, e.emp_code, e.department, a.local_date, a.local_time, a.kind, a.status, a.confidence
    FROM attendance a JOIN employees e ON e.id = a.employee_id
    ORDER BY a.ts DESC
  `).all();
  const header = ['Name', 'Employee ID', 'Department', 'Date', 'Time', 'Kind', 'Status', 'Confidence'];
  const lines = [header.map(csvEscape).join(',')];
  for (const r of rows) {
    lines.push([r.name, r.emp_code, r.department, r.local_date, r.local_time, r.kind, r.status, r.confidence + '%']
      .map(csvEscape).join(','));
  }
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="attendance-records.csv"');
  res.send(lines.join('\n'));
});

export default router;
