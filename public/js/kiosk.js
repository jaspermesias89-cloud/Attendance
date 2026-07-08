import { api, escapeHtml } from './api.js';
import { loadModels, detectorOptions, buildMatcher, drawBox, confidenceFrom } from './face.js';

const $ = (id) => document.getElementById(id);
const TOKEN_KEY = 'aperture_kiosk_token';

let token = null;
let matcher = null;
let people = [];            // [{id,name,emp_code,department,descriptors}]
let settings = { threshold: 0.5 };
let scanning = false;
let scanInterval = null;
let liveStream = null;
const lastPosted = new Map(); // employeeId -> timestamp (client-side debounce)

// ---- token handling: read from #token=... once, then persist ----
function resolveToken() {
  const hash = location.hash || '';
  const m = hash.match(/token=([^&]+)/);
  if (m) {
    const t = decodeURIComponent(m[1]);
    localStorage.setItem(TOKEN_KEY, t);
    history.replaceState(null, '', location.pathname); // strip token from URL
    return t;
  }
  return localStorage.getItem(TOKEN_KEY);
}

async function boot() {
  token = resolveToken();
  if (!token) { $('boot-screen').style.display = 'none'; $('no-token').style.display = 'flex'; return; }
  try {
    $('boot-text').textContent = 'LOADING RECOGNITION ENGINE…';
    await loadModels((m) => ($('boot-text').textContent = m));
    await refreshPeople();
  } catch (e) {
    if (e.status === 401) { localStorage.removeItem(TOKEN_KEY); $('boot-screen').style.display = 'none'; $('no-token').style.display = 'flex'; return; }
    $('boot-text').textContent = 'FAILED TO START — ' + (e.message || 'error');
    return;
  }
  $('boot-screen').style.display = 'none';
  $('kiosk').style.display = 'flex';
  startClock();
  // refresh the enrolled set periodically so new hires appear without a reload
  setInterval(() => refreshPeople().catch(() => {}), 60000);
}

async function refreshPeople() {
  [people, settings] = await Promise.all([
    api('/descriptors', { token }),
    api('/settings', { token }),
  ]);
  matcher = buildMatcher(people, Number(settings.threshold) || 0.5);
}

function startClock() {
  const el = $('clock');
  const tick = () => (el.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
  tick(); setInterval(tick, 1000);
}

// ---- scanning ----
$('btn-start-scan').addEventListener('click', startScan);
$('btn-stop-scan').addEventListener('click', stopScan);

async function startScan() {
  const video = $('video');
  try {
    liveStream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' } });
    video.srcObject = liveStream;
    await new Promise((res) => (video.onloadedmetadata = res));
    await video.play();
  } catch (e) {
    toast('Camera error', e.message, 'error');
    return;
  }
  $('cam-msg').style.display = 'none';
  $('sweep').style.display = 'block';
  $('btn-start-scan').disabled = true;
  $('btn-stop-scan').disabled = false;
  scanning = true;
  const canvas = $('overlay');
  canvas.width = video.videoWidth; canvas.height = video.videoHeight;
  scanInterval = setInterval(runCycle, 450);
}

function stopScan() {
  scanning = false;
  if (scanInterval) { clearInterval(scanInterval); scanInterval = null; }
  if (liveStream) { liveStream.getTracks().forEach((t) => t.stop()); liveStream = null; }
  $('video').srcObject = null;
  $('cam-msg').style.display = 'flex';
  $('sweep').style.display = 'none';
  $('recog-banner').style.display = 'none';
  $('btn-start-scan').disabled = false;
  $('btn-stop-scan').disabled = true;
  const ctx = $('overlay').getContext('2d');
  ctx.clearRect(0, 0, 4000, 4000);
}

async function runCycle() {
  if (!scanning) return;
  const video = $('video');
  const canvas = $('overlay');
  if (video.videoWidth === 0) return;
  if (canvas.width !== video.videoWidth) { canvas.width = video.videoWidth; canvas.height = video.videoHeight; }

  const detections = await faceapi.detectAllFaces(video, detectorOptions()).withFaceLandmarks().withFaceDescriptors();
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (detections.length === 0) { $('recog-banner').style.display = 'none'; return; }

  const resized = faceapi.resizeResults(detections, { width: canvas.width, height: canvas.height });
  let top = null;

  resized.forEach((det) => {
    const box = det.detection.box;
    let label = 'Unknown', color = '#e8636b';
    if (matcher) {
      const match = matcher.findBestMatch(det.descriptor);
      if (match.label !== 'unknown') {
        const person = people.find((p) => String(p.id) === match.label);
        label = person ? person.name : 'Unknown';
        color = '#3ed9c4';
        if (!top || match.distance < top.distance) top = { id: match.label, distance: match.distance, box, person };
      }
    }
    drawBox(ctx, box, label, color);
  });

  if (top && top.person) {
    const conf = confidenceFrom(top.distance, Number(settings.threshold) || 0.5);
    showBanner(top.person, conf);
    postAttendance(top.person, conf);
  } else {
    $('recog-banner').style.display = 'none';
  }
}

function showBanner(person, conf) {
  $('recog-banner').style.display = 'flex';
  $('recog-name').textContent = person.name;
  $('recog-sub').textContent = person.emp_code + ' · ' + person.department;
  $('recog-conf').textContent = conf + '%';
}

async function postAttendance(person, conf) {
  // client-side debounce so one appearance doesn't spam the API (server dedupes too)
  const now = Date.now();
  if (lastPosted.has(person.id) && now - lastPosted.get(person.id) < 8000) return;
  lastPosted.set(person.id, now);
  const kind = $('kind-select').value === 'out' ? 'out' : 'in';
  try {
    const r = await api('/attendance', { method: 'POST', token, body: { employee_id: Number(person.id), kind, confidence: conf } });
    if (r.duplicate) return; // already recorded within the window
    const rec = r.record;
    toast(person.name, `${kind === 'out' ? 'Clocked out' : 'Checked in'} · ${rec.status === 'late' ? 'Late' : 'Present'} · ${conf}%`, rec.status === 'late' ? 'late' : '');
    addLog(person.name, rec.local_time, rec.status, conf, kind);
  } catch (e) {
    if (e.status === 401) { toast('Kiosk unlinked', 'Token expired — ask an admin to relink', 'error'); stopScan(); }
  }
}

function addLog(name, time, status, conf, kind) {
  const panel = $('session-log');
  const empty = panel.querySelector('.empty-note');
  if (empty) panel.innerHTML = '';
  const row = document.createElement('div');
  row.className = 'log-item';
  row.innerHTML = `<div class="log-time">${time}</div>
    <div class="activity-info">
      <div class="activity-name">${escapeHtml(name)}</div>
      <div class="activity-meta">${kind === 'out' ? 'out' : 'in'} · ${conf}% match</div>
    </div>
    <span class="badge ${status}">${status === 'late' ? 'Late' : 'Present'}</span>`;
  panel.prepend(row);
}

function toast(title, body, cls = '') {
  const stack = $('toast-stack');
  const t = document.createElement('div');
  t.className = 'toast ' + cls;
  t.innerHTML = `<strong>${escapeHtml(title)}</strong>${escapeHtml(body)}`;
  stack.appendChild(t);
  setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 3600);
}

boot();
