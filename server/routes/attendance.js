import { Router } from 'express';
import { db } from '../db.js';
import { requireAdmin, requireKiosk, ah } from '../middleware.js';

const router = Router();

const DEDUPE_MINUTES = 5;

// Derive the wall-clock date/time in a given IANA timezone (independent of the
// server's own timezone — important on UTC cloud hosts).
function localParts(d = new Date(), tz = 'UTC') {
  let local_date, local_time;
  try {
    local_date = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(d); // YYYY-MM-DD
    local_time = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(d); // HH:MM
    if (local_time.startsWith('24')) local_time = '00' + local_time.slice(2); // midnight guard
  } catch {
    // invalid tz → fall back to UTC
    return localParts(d, 'UTC');
  }
  return { local_date, local_time, ts: d.toISOString() };
}

async function getSettings() {
  return db.get('SELECT late_cutoff, timezone FROM settings WHERE id = 1');
}

// Kiosk posts an attendance event. Server owns time, status and dedupe.
router.post('/attendance', requireKiosk, ah(async (req, res) => {
  const { employee_id } = req.body || {};
  const kind = req.body?.kind === 'out' ? 'out' : 'in';
  const confidence = Math.max(0, Math.min(100, Math.round(Number(req.body?.confidence) || 0)));
  const device_id = req.device?.device_id || null;

  const emp = await db.get('SELECT id, name FROM employees WHERE id = ? AND active = 1', employee_id);
  if (!emp) return res.status(404).json({ error: 'Unknown employee' });

  const settings = await getSettings();
  const now = new Date();
  const { local_date, local_time, ts } = localParts(now, settings?.timezone || 'UTC');

  // Dedupe: ignore a same-kind event for the same employee within the window.
  const cutoffIso = new Date(now.getTime() - DEDUPE_MINUTES * 60 * 1000).toISOString();
  const recent = await db.get(
    `SELECT * FROM attendance
     WHERE employee_id = ? AND kind = ? AND ts >= ?
     ORDER BY ts DESC LIMIT 1`,
    employee_id, kind, cutoffIso
  );
  if (recent) return res.json({ duplicate: true, record: recent });

  const status = kind === 'in' && local_time > (settings?.late_cutoff || '09:30') ? 'late' : 'present';

  const info = await db.run(
    `INSERT INTO attendance (employee_id, ts, local_date, local_time, kind, status, confidence, device_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    employee_id, ts, local_date, local_time, kind, status, confidence, device_id
  );

  const record = await db.get('SELECT * FROM attendance WHERE id = ?', info.lastInsertRowid);
  res.status(201).json({ duplicate: false, record, employee: { name: emp.name }, status });
}));

// Records list with filters (admin).
router.get('/attendance', requireAdmin, ah(async (req, res) => {
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
  res.json(await db.all(sql, params));
}));

// Dashboard summary for a given date (defaults to today).
router.get('/attendance/summary', requireAdmin, ah(async (req, res) => {
  const settings = await getSettings();
  const { local_date } = localParts(new Date(), settings?.timezone || 'UTC');
  const date = req.query.date || local_date;
  const totalRow = await db.get('SELECT COUNT(*) AS c FROM employees WHERE active = 1');
  const total = totalRow.c;
  const todays = await db.all(
    `SELECT DISTINCT employee_id, status FROM attendance WHERE local_date = ? AND kind = 'in'`,
    date
  );
  const present = todays.filter((r) => r.status === 'present').length;
  const late = todays.filter((r) => r.status === 'late').length;
  const checkedIn = new Set(todays.map((r) => r.employee_id)).size;
  res.json({ total, present, late, absent: Math.max(0, total - checkedIn), date });
}));

// ---- Timesheet: hours worked per employee per day ----
// Pairs each 'in' with the following 'out' and sums the durations (so lunch
// breaks etc. are excluded). A dangling 'in' means the person is still clocked in.
function computeTimesheet(rows) {
  const groups = new Map();
  for (const r of rows) {
    const key = r.employee_id + '|' + r.local_date;
    if (!groups.has(key)) {
      groups.set(key, {
        employee_id: r.employee_id, name: r.name, emp_code: r.emp_code,
        department: r.department, date: r.local_date, events: [],
      });
    }
    groups.get(key).events.push(r);
  }
  const out = [];
  for (const g of groups.values()) {
    let firstIn = null, lastOut = null, openIn = null, totalMs = 0;
    for (const e of g.events) {
      if (e.kind === 'in') {
        openIn = e;
        if (!firstIn) firstIn = e;
      } else {
        if (openIn) { totalMs += new Date(e.ts) - new Date(openIn.ts); openIn = null; }
        lastOut = e;
      }
    }
    const worked_minutes = Math.max(0, Math.round(totalMs / 60000));
    out.push({
      employee_id: g.employee_id, name: g.name, emp_code: g.emp_code,
      department: g.department, date: g.date,
      first_in: firstIn ? firstIn.local_time : null,
      last_out: lastOut ? lastOut.local_time : null,
      worked_minutes,
      worked_hours: +(worked_minutes / 60).toFixed(2),
      open: openIn !== null, // still clocked in (no closing 'out')
    });
  }
  out.sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name));
  return out;
}

async function timesheetRows(query) {
  const { date, q } = query;
  const where = [];
  const params = [];
  if (date) { where.push('a.local_date = ?'); params.push(date); }
  if (q) { where.push('(e.name LIKE ? OR e.emp_code LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }
  const rows = await db.all(`
    SELECT a.employee_id, a.ts, a.local_date, a.local_time, a.kind,
           e.name, e.emp_code, e.department
    FROM attendance a JOIN employees e ON e.id = a.employee_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY a.employee_id, a.local_date, a.ts ASC
  `, params);
  return computeTimesheet(rows);
}

router.get('/timesheet', requireAdmin, ah(async (req, res) => {
  res.json(await timesheetRows(req.query));
}));

function csvEscape(v) {
  return `"${String(v ?? '').replace(/"/g, '""')}"`;
}

function fmtHM(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

router.get('/timesheet/export.csv', requireAdmin, ah(async (req, res) => {
  const rows = await timesheetRows(req.query);
  const header = ['Name', 'Employee ID', 'Department', 'Date', 'Clock In', 'Clock Out', 'Hours Worked', 'Hours (decimal)'];
  const lines = [header.map(csvEscape).join(',')];
  for (const r of rows) {
    lines.push([
      r.name, r.emp_code, r.department, r.date,
      r.first_in || '', r.last_out || (r.open ? 'still in' : ''),
      fmtHM(r.worked_minutes), r.worked_hours,
    ].map(csvEscape).join(','));
  }
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="timesheet.csv"');
  res.send(lines.join('\n'));
}));

router.get('/attendance/export.csv', requireAdmin, ah(async (req, res) => {
  const rows = await db.all(`
    SELECT e.name, e.emp_code, e.department, a.local_date, a.local_time, a.kind, a.status, a.confidence
    FROM attendance a JOIN employees e ON e.id = a.employee_id
    ORDER BY a.ts DESC
  `);
  const header = ['Name', 'Employee ID', 'Department', 'Date', 'Time', 'Kind', 'Status', 'Confidence'];
  const lines = [header.map(csvEscape).join(',')];
  for (const r of rows) {
    lines.push([r.name, r.emp_code, r.department, r.local_date, r.local_time, r.kind, r.status, r.confidence + '%']
      .map(csvEscape).join(','));
  }
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="attendance-records.csv"');
  res.send(lines.join('\n'));
}));

export default router;
