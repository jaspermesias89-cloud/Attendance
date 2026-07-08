import { Router } from 'express';
import { db } from '../db.js';
import { requireAdmin, requireAdminOrKiosk } from '../middleware.js';

const router = Router();

// List employees with a sample count (admin only).
router.get('/employees', requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT e.id, e.emp_code, e.name, e.department, e.active, e.photo, e.enrolled_at,
           (SELECT COUNT(*) FROM face_descriptors d WHERE d.employee_id = e.id) AS sample_count
    FROM employees e
    ORDER BY e.name COLLATE NOCASE
  `).all();
  res.json(rows);
});

// Create an employee together with their face descriptors.
router.post('/employees', requireAdmin, (req, res) => {
  const { emp_code, name, department, descriptors, photo } = req.body || {};
  if (!emp_code || !name) return res.status(400).json({ error: 'emp_code and name are required' });
  if (!Array.isArray(descriptors) || descriptors.length === 0) {
    return res.status(400).json({ error: 'At least one face sample is required' });
  }
  // Validate each descriptor is an array of 128 numbers.
  for (const d of descriptors) {
    if (!Array.isArray(d) || d.length !== 128 || d.some((n) => typeof n !== 'number')) {
      return res.status(400).json({ error: 'Each descriptor must be 128 numbers' });
    }
  }
  const exists = db.prepare('SELECT id FROM employees WHERE emp_code = ?').get(emp_code);
  if (exists) return res.status(409).json({ error: 'An employee with this code already exists' });

  const insertEmp = db.prepare(
    'INSERT INTO employees (emp_code, name, department, photo) VALUES (?, ?, ?, ?)'
  );
  const insertDesc = db.prepare(
    'INSERT INTO face_descriptors (employee_id, vector) VALUES (?, ?)'
  );

  db.exec('BEGIN');
  try {
    const info = insertEmp.run(emp_code, name, department || '', photo || null);
    const empId = info.lastInsertRowid;
    for (const d of descriptors) insertDesc.run(empId, JSON.stringify(d));
    db.exec('COMMIT');
    res.status(201).json({ id: Number(empId) });
  } catch (e) {
    db.exec('ROLLBACK');
    res.status(500).json({ error: 'Failed to save employee' });
  }
});

router.delete('/employees/:id', requireAdmin, (req, res) => {
  const info = db.prepare('DELETE FROM employees WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

// All enrolled descriptors, grouped per employee — consumed by the kiosk matcher.
// Available to admins (dashboard) or valid kiosks.
router.get('/descriptors', requireAdminOrKiosk, (req, res) => {
  const employees = db.prepare(
    'SELECT id, emp_code, name, department FROM employees WHERE active = 1'
  ).all();
  const descRows = db.prepare('SELECT employee_id, vector FROM face_descriptors').all();
  const byEmp = new Map();
  for (const r of descRows) {
    if (!byEmp.has(r.employee_id)) byEmp.set(r.employee_id, []);
    byEmp.get(r.employee_id).push(JSON.parse(r.vector));
  }
  const out = employees
    .map((e) => ({
      id: e.id,
      emp_code: e.emp_code,
      name: e.name,
      department: e.department,
      descriptors: byEmp.get(e.id) || [],
    }))
    .filter((e) => e.descriptors.length > 0);
  res.json(out);
});

export default router;
