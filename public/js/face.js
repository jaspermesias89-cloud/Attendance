// face-api.js helpers shared by the register (admin) and kiosk flows.
// face-api.min.js is loaded as a global <script> before these modules run.
const MODEL_URL = '/models';

let loaded = false;

export async function loadModels(progressCb) {
  if (loaded) return;
  const say = (m) => progressCb && progressCb(m);
  say('LOADING FACE DETECTION MODEL…');
  await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
  say('LOADING LANDMARK MODEL…');
  await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
  say('LOADING RECOGNITION MODEL…');
  await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL);
  loaded = true;
}

export const detectorOptions = () => new faceapi.TinyFaceDetectorOptions();

// Detect a single face and return its 128-float descriptor (as a plain array), or null.
export async function detectDescriptor(video) {
  const det = await faceapi
    .detectSingleFace(video, detectorOptions())
    .withFaceLandmarks()
    .withFaceDescriptor();
  return det ? Array.from(det.descriptor) : null;
}

// Build a FaceMatcher from the /api/descriptors payload.
export function buildMatcher(employees, threshold) {
  const labeled = employees
    .filter((e) => e.descriptors && e.descriptors.length)
    .map((e) => new faceapi.LabeledFaceDescriptors(
      String(e.id),
      e.descriptors.map((d) => new Float32Array(d))
    ));
  return labeled.length ? new faceapi.FaceMatcher(labeled, threshold) : null;
}

// 120x120 mirrored jpeg thumbnail data-URL from a video element.
export function snapshotThumbnail(video) {
  const c = document.createElement('canvas');
  c.width = 120; c.height = 120;
  const ctx = c.getContext('2d');
  const size = Math.min(video.videoWidth, video.videoHeight);
  const sx = (video.videoWidth - size) / 2, sy = (video.videoHeight - size) / 2;
  ctx.translate(120, 0); ctx.scale(-1, 1);
  ctx.drawImage(video, sx, sy, size, size, 0, 0, 120, 120);
  return c.toDataURL('image/jpeg', 0.7);
}

// Corner-bracket detection box (matches the app's viewfinder aesthetic).
export function drawBox(ctx, box, label, color) {
  const { x, y, width, height } = box;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  const b = 14;
  ctx.beginPath();
  ctx.moveTo(x, y + b); ctx.lineTo(x, y); ctx.lineTo(x + b, y);
  ctx.moveTo(x + width - b, y); ctx.lineTo(x + width, y); ctx.lineTo(x + width, y + b);
  ctx.moveTo(x + width, y + height - b); ctx.lineTo(x + width, y + height); ctx.lineTo(x + width - b, y + height);
  ctx.moveTo(x + b, y + height); ctx.lineTo(x, y + height); ctx.lineTo(x, y + height - b);
  ctx.stroke();

  ctx.font = '600 13px JetBrains Mono, monospace';
  const textW = ctx.measureText(label).width;
  ctx.fillStyle = color;
  ctx.fillRect(x, y - 22, textW + 14, 20);
  ctx.fillStyle = '#0b0f14';
  ctx.save();
  ctx.translate(x + 7 + textW, y - 8);
  ctx.scale(-1, 1); // mirror text back (canvas is scaleX(-1))
  ctx.fillText(label, 0, 0);
  ctx.restore();
  ctx.restore();
}

// Convert a match distance into a friendly confidence %.
export function confidenceFrom(distance, threshold) {
  const raw = Math.round((1 - (distance / threshold) * 0.55) * 100);
  return Math.min(99, Math.max(60, Math.max(0, raw)));
}
