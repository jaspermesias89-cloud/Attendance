import { Router } from 'express';
import { db } from '../db.js';
import { requireAdmin, requireAdminOrKiosk, ah } from '../middleware.js';

const router = Router();

// List employees with a sample count (admin only).
router.get('/employees', requireAdmin, ah(async (req, res) => {
  const rows = await db.all(`
    SELECT e.id, e.emp_code, e.name, e.department, e.active, e.photo, e.enrolled_at,
           (SELECT COUNT(*) FROM face_descriptors d WHERE d.employee_id = e.id) AS sample_count
    FROM employees e
    ORDER BY e.name COLLATE NOCASE
  `);
  res.json(rows);
}));

// Create an employee together with their face descriptors.
router.post('/employees', requireAdmin, ah(async (req, res) => {
  const { emp_code, name, department, descriptors, photo } = req.body || {};
  if (!emp_code || !name) return res.status(400).json({ error: 'emp_code and name are required' });
  if (!Array.isArray(descriptors) || descriptors.length === 0) {
    return res.status(400).json({ error: 'At least one face sample is required' });
  }
  for (const d of descriptors) {
    if (!Array.isArray(d) || d.length !== 128 || d.some((n) => typeof n !== 'number')) {
      return res.status(400).json({ error: 'Each descriptor must be 128 numbers' });
    }
  }
  const exists = await db.get('SELECT id FROM employees WHERE emp_code = ?', emp_code);
  if (exists) return res.status(409).json({ error: 'An employee with this code already exists' });

  const tx = await db.transaction('write');
  try {
    const info = await tx.execute({
      sql: 'INSERT INTO employees (emp_code, name, department, photo) VALUES (?, ?, ?, ?)',
      args: [emp_code, name, department || '', photo || null],
    });
    const empId = Number(info.lastInsertRowid);
    for (const d of descriptors) {
      await tx.execute({
        sql: 'INSERT INTO face_descriptors (employee_id, vector) VALUES (?, ?)',
        args: [empId, JSON.stringify(d)],
      });
    }
    await tx.commit();
    res.status(201).json({ id: empId });
  } catch (e) {
    await tx.rollback();
    throw e;
  }
}));

router.delete('/employees/:id', requireAdmin, ah(async (req, res) => {
  const id = req.params.id;
  // Explicit cascade (FK enforcement isn't relied upon across backends).
  const tx = await db.transaction('write');
  try {
    await tx.execute({ sql: 'DELETE FROM attendance WHERE employee_id = ?', args: [id] });
    await tx.execute({ sql: 'DELETE FROM face_descriptors WHERE employee_id = ?', args: [id] });
    const info = await tx.execute({ sql: 'DELETE FROM employees WHERE id = ?', args: [id] });
    await tx.commit();
    if (Number(info.rowsAffected) === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (e) {
    await tx.rollback();
    throw e;
  }
}));

// All enrolled descriptors, grouped per employee — consumed by the kiosk matcher.
router.get('/descriptors', requireAdminOrKiosk, ah(async (req, res) => {
  const employees = await db.all('SELECT id, emp_code, name, department FROM employees WHERE active = 1');
  const descRows = await db.all('SELECT employee_id, vector FROM face_descriptors');
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
}));

export default router;
