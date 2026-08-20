// Thai Boran Waiver PWA (offline, local storage)

const SERVICES = [
  '1hr Thai Back Massage', '1hr Thai Body Massage', '1hr Thai Foot Massage', '1hr Thai Swedish Massage',
  '1hr Swedish Massage', '1hr Thai Aromatherapy Massage',
  'Combo 1', 'Combo 2', 'Combo 3', 'Combo 4', 'Combo 5', 'Combo 6', 'Combo 7', 'Combo 8'
];

const ADD_ONS = ['Unscented Oil', 'Scented Oil', 'Herbal Hotpads', 'Ventosa', 'Hot Stone', 'Half Hour', '1 hr extra massage'];

// Matches Android strings.xml (waiver_text). Item 1 is the medical conditions block above.
const WAIVER_HTML = `
<b>2. The massage therapist does not diagnose illnesses or injuries, or prescribe medications, and that therapeutic massage is not a substitute for medical treatment or medications.</b><br/><br/>
<b>3. It is my responsibility to inform my massage therapist of any discomfort I may feel during the massage session so he/she may adjust accordingly:</b><br/><br/>
<b>4. I understand the risks associated with massage therapy, particularly in VENTOSA or cupping therapy, hot stone massage, and other massage services which include hot pads, as it may result to the following:</b><br/>
<b>&nbsp;&nbsp;&nbsp;&nbsp;&bull; Superficial bruising</b><br/>
<b>&nbsp;&nbsp;&nbsp;&nbsp;&bull; Short-term muscle soreness</b><br/>
<b>&nbsp;&nbsp;&nbsp;&nbsp;&bull; Exacerbation of undiscovered injury</b><br/>
<b>&nbsp;&nbsp;&nbsp;&nbsp;&bull; Mild discomfort</b><br/><br/>
<b>5. Any illicit or sexually suggestive remarks or advances made by me or towards me will result to the immediate termination of the session.</b><br/><br/>
<b>6. I shall exercise reasonable diligence in taking care of my personal belongings or things and its loss or damage.</b><br/><br/>
<b>7. Should I have any complaints regarding the services I received from Thai Boran, I shall inform its management immediately, or within 24 hours from the times that the complained service was provided; and</b><br/><br/>
<b>8. Failure on my part to disclose any material information that may affect the massage service that Thai Boran or its therapists may provide, shall render it free from any liability that may arise out of its provided service.</b>
`;

const DB_NAME = 'thai_boran_waiver_db';
const DB_VERSION = 1;
const STORE = 'submissions';

const PHOTO_CAPTURE_ENABLED_KEY = 'tb_photo_capture_enabled';               // one-off (this client)
const PHOTO_PERMANENT_DISABLED_KEY = 'tb_photo_capture_permanent_disabled'; // persists across submits + restarts

// One-off (per-client) toggle. Auto-reverts to enabled after each submission.
function isPhotoOneOffEnabled() {
  const v = localStorage.getItem(PHOTO_CAPTURE_ENABLED_KEY);
  if (v === null) return true; // default: enabled
  return v === '1';
}
function setPhotoCaptureEnabled(enabled) {
  localStorage.setItem(PHOTO_CAPTURE_ENABLED_KEY, enabled ? '1' : '0');
}

// Permanent toggle. Persists until explicitly turned off (survives app restart).
function isPhotoPermanentlyDisabled() {
  return localStorage.getItem(PHOTO_PERMANENT_DISABLED_KEY) === '1';
}
function setPhotoPermanentlyDisabled(on) {
  localStorage.setItem(PHOTO_PERMANENT_DISABLED_KEY, on ? '1' : '0');
}

// Effective state: photo is required only when it is NOT permanently disabled
// AND the one-off toggle is enabled. The two flags are independent and never
// conflict — permanent simply wins.
function isPhotoCaptureEnabled() {
  if (isPhotoPermanentlyDisabled()) return false;
  return isPhotoOneOffEnabled();
}

// Human-readable description of the effective photo mode.
function photoModeText() {
  if (isPhotoPermanentlyDisabled()) return 'Photo capture is OFF for ALL clients (permanent)';
  if (!isPhotoOneOffEnabled()) return 'Photo capture is OFF for this client only (reverts after next submit)';
  return 'Photo capture is ON';
}

// The old on-page photo toggles were removed when the switch moved beside
// the photo step; this now just keeps the banner and the switch in step.
function updateSettingsUi() {
  updatePhotoModeBanner();
  if (typeof renderPhotoSwitch === 'function') renderPhotoSwitch();
}


// ---------------------------------------------------------- photo switch
// The same three states as the Front desk panel, on the waiver screen where
// the photo is actually taken. A client says "no photo" while standing at
// the counter; getting to a settings tab and signing in to answer that is
// not workable, so it is two taps here: open, choose.
//
// It writes the same two localStorage keys the Front desk panel reads, so
// the two are always showing the same thing.
const PHOTO_CHOICES = [
  { id: 'on', label: 'Photograph every client', sub: 'The normal setting' },
  { id: 'skipNext', label: 'Skip the photo for THIS client only', sub: 'Back to normal by itself afterwards' },
  { id: 'off', label: 'Stop until I turn it back on', sub: 'Stays off after a restart' },
];

function photoSwitchState() {
  if (isPhotoPermanentlyDisabled()) return 'off';
  if (!isPhotoOneOffEnabled()) return 'skipNext';
  return 'on';
}

function photoSwitchLabel(state) {
  if (state === 'off') return 'Photos OFF';
  if (state === 'skipNext') return 'Skipping the photo for this client';
  return 'Photos ON';
}

function setPhotoSwitch(next) {
  if (next === 'on') {
    setPhotoCaptureEnabled(true);
    setPhotoPermanentlyDisabled(false);
  } else if (next === 'skipNext') {
    setPhotoCaptureEnabled(false);
    setPhotoPermanentlyDisabled(false);
  } else {
    // Turning photos off for everyone is the one choice worth confirming —
    // the iPad is often in a client's hands on this screen.
    if (!confirm('Stop photographing every client until you turn it back on?')) return;
    setPhotoPermanentlyDisabled(true);
  }
  renderPhotoSwitch(false);      // applied — put the menu away
  applyPhotoGate();
  updateSettingsUi();
  flashPhotoSwitch();
}

// A short "that worked" on the bar itself, so the tap is never ambiguous.
let photoFlashTimer = 0;
function flashPhotoSwitch() {
  const wrap = el('photoSwitch');
  const hint = el('photoSwitchHint');
  if (!wrap || !hint) return;
  wrap.classList.add('justSet');
  hint.textContent = 'saved';
  clearTimeout(photoFlashTimer);
  photoFlashTimer = setTimeout(() => {
    wrap.classList.remove('justSet');
    hint.textContent = 'tap to change';
  }, 1800);
}

function renderPhotoSwitch(open) {
  const wrap = el('photoSwitch');
  const toggle = el('photoSwitchToggle');
  const body = el('photoSwitchBody');
  const label = el('photoSwitchState');
  if (!wrap || !toggle || !body || !label) return;
  // (the hint text beside it is flashed on save; see flashPhotoSwitch)

  const state = photoSwitchState();
  label.textContent = photoSwitchLabel(state);
  wrap.classList.toggle('warn', state === 'skipNext');
  wrap.classList.toggle('off', state === 'off');

  const isOpen = open === undefined ? !body.classList.contains('hidden') : open;
  body.classList.toggle('hidden', !isOpen);
  toggle.setAttribute('aria-expanded', String(isOpen));
  if (!isOpen) return;

  body.innerHTML = PHOTO_CHOICES.map((c) =>
    '<button type="button" class="photoSwitchChoice' + (c.id === state ? ' on' : '') + '" data-choice="' + c.id + '">' +
      '<span class="pcl">' + c.label + '</span>' +
      '<span class="pcs">' + c.sub + '</span>' +
    '</button>').join('');
  body.querySelectorAll('[data-choice]').forEach((b) => {
    b.addEventListener('click', () => setPhotoSwitch(b.dataset.choice));
  });
}

function setupPhotoSwitch() {
  const toggle = el('photoSwitchToggle');
  if (!toggle) return;
  toggle.addEventListener('click', () => {
    const body = el('photoSwitchBody');
    renderPhotoSwitch(body.classList.contains('hidden'));
  });
  renderPhotoSwitch(false);
}

// Banner on the main form so the receptionist always sees the active mode.
function updatePhotoModeBanner() {
  const banner = el('photoModeBanner');
  if (!banner) return;
  if (isPhotoCaptureEnabled()) {
    banner.classList.add('hidden');
    banner.textContent = '';
  } else {
    banner.classList.remove('hidden');
    banner.textContent = '⚠ ' + photoModeText();
  }
}

function applyPhotoGate() {
  const consent = el('consentPrivacy');
  const takeBtn = el('btnTakePhoto');
  const sigHelp = el('sigHelp');

  if (!consent || !takeBtn) return;

  if (isPhotoCaptureEnabled()) {
    takeBtn.disabled = !consent.checked;
    if (sigHelp) sigHelp.textContent = 'Signature is enabled only after a photo is taken';
    setSignatureEnabled(state.photoTaken);
  } else {
    // still require privacy consent, but bypass photo capture
    consent.disabled = false; // ensure receptionist can re-enable later without being stuck disabled
    takeBtn.disabled = true;
    if (sigHelp) sigHelp.textContent = 'Signature is enabled after accepting the Privacy Notice';
    setSignatureEnabled(!!consent.checked);
  }

  updatePhotoModeBanner();
  validate();
}
// Cross-page refresh (waiver page notifies manager page)
const UPDATE_CHANNEL = 'tb_updates';
const bc = ('BroadcastChannel' in window) ? new BroadcastChannel(UPDATE_CHANNEL) : null;
function notifyUpdate() {
  try { if (bc) bc.postMessage({ type: 'updated', at: Date.now() }); } catch (_) {}
}

const el = (id) => document.getElementById(id);

const state = {
  photoBlob: null,
  photoTaken: false,
  sigDirty: false,
  addonsChecked: new Array(ADD_ONS.length).fill(false),
  camFacing: 'user',
  stream: null
};

// An update must never throw away a waiver that is part-way through. The
// update prompt asks this before it reloads; anything it returns is shown to
// the receptionist as "finish this first".
function waiverInProgress() {
  const filled = (id) => {
    const n = el(id);
    return !!(n && String(n.value || '').trim());
  };
  if (state.photoTaken || state.sigDirty) return "this client’s waiver is part-filled";
  if (filled('name') || filled('contact') || filled('address')) return "this client’s waiver is part-filled";
  if (state.addonsChecked.some(Boolean)) return "this client’s waiver is part-filled";
  // Read the boxes themselves too, so this does not depend on when the form
  // happens to copy them into state.
  const boxes = document.querySelectorAll('.checks input[type="checkbox"], #addonsBox input[type="checkbox"]');
  for (const b of boxes) if (b.checked && b.id !== 'consentPrivacy') return "this client’s waiver is part-filled";
  const svc = el('services');
  if (svc && svc.selectedIndex > 0) return "this client’s waiver is part-filled";
  return null;
}
if (window.TBUpdate) TBUpdate.guard('waiver', waiverInProgress);

function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function nowTimestamp() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

// A valid name is any-script letters (incl. accents/combining marks) plus
// spaces, hyphens and apostrophes, with at least one actual letter. Digits and
// other symbols are rejected. Covers Filipino names with ñ / Spanish forms and
// non-Latin scripts (e.g. ไทย, 日本語, العربية).
function isValidName(name) {
  const s = (name || '').trim();
  if (!s) return false;
  if (!/\p{L}/u.test(s)) return false;                 // must contain a letter
  return /^[\p{L}\p{M} '’\-]+$/u.test(s);          // letters/marks/space/'/’/-
}

// Build a filesystem-safe base from a (valid) name: keep letters and combining
// marks from any script, drop spaces/hyphens/apostrophes. Never empty for a
// valid name.
function sanitizeNameForFile(name) {
  return (name || '').trim().normalize('NFC').replace(/[^\p{L}\p{M}]/gu, '');
}

function escapeCSV(value) {
  const s = (value ?? '').toString();
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function contactAsText(value) {
  const s = (value ?? '').toString();
  return `="${escapeCSV(s)}"`;
}

// ===== Pricing / Senior-PWD discount =====
// A straight 20% discount off the gross (service + add-ons). The business is
// NOT VAT-registered, so there is no VAT step. Rounding: discount is rounded to
// the nearest whole peso with Math.round (half up); net = gross - discount. The
// identical rule lives in manager.js calcSalesForRecord so the total shown at
// submission and the manager-side figures always agree.
const SENIOR_PWD_DISCOUNT_RATE = 0.20;
const PRICE_SETS_KEY = 'tb_price_sets_v1'; // the manager page writes this

function loadPriceSets() {
  try {
    const raw = localStorage.getItem(PRICE_SETS_KEY);
    const a = raw ? JSON.parse(raw) : [];
    return Array.isArray(a) ? a : [];
  } catch { return []; }
}

function pickPriceSetForDate(ymd) {
  const sets = loadPriceSets().slice().sort((a, b) => String(a.effectiveFrom).localeCompare(String(b.effectiveFrom)));
  if (sets.length === 0) return null;
  const d = String(ymd || '').trim();
  if (!d) return sets[sets.length - 1];
  let chosen = sets[0];
  for (const s of sets) if (String(s.effectiveFrom) <= d) chosen = s;
  return chosen;
}

function parseAddonsList(text) {
  const t = String(text || '').trim();
  if (!t || t.toLowerCase() === 'none') return [];
  return t.split(/[;,]/).map(s => s.trim()).filter(Boolean);
}

function computePricing(dateStr, serviceName, addonsText, isSenior) {
  const set = pickPriceSetForDate(dateStr);
  const servicePrice = Number(set?.services?.[String(serviceName || '').trim()] ?? 0) || 0;
  let addonsPrice = 0;
  for (const a of parseAddonsList(addonsText)) addonsPrice += (Number(set?.addons?.[a] ?? 0) || 0);
  const gross = servicePrice + addonsPrice;
  const discount = isSenior ? Math.round(gross * SENIOR_PWD_DISCOUNT_RATE) : 0;
  const net = gross - discount;
  return { servicePrice, addonsPrice, gross, discount, net };
}

function isSeniorSelected() {
  const s = el('senior');
  return !!s && s.value === 'Yes';
}

function pesos(n) { return '₱' + (Number(n) || 0); }

function updateTotalPreview() {
  const box = el('totalPreview');
  if (!box) return;
  const p = computePricing(el('date').value, el('services').value, selectedAddonsText(), isSeniorSelected());
  box.textContent = isSeniorSelected()
    ? `Total: gross ${pesos(p.gross)} − 20% Senior/PWD (${pesos(p.discount)}) = ${pesos(p.net)}`
    : `Total: ${pesos(p.net)}`;
}

function conditionsText() {
  const out = [];
  if (el('c_pregnant').checked) out.push('Pregnant');
  if (el('c_thinners').checked) out.push('Taking blood thinning medication(s)');
  if (el('c_skin').checked) out.push('Suffering from broken, irritated, or inflamed skin condition');
  if (el('c_bp').checked) out.push('Suffering from high blood or low blood pressure');
  if (el('c_pre').checked) out.push('Prior or existing medical conditions that may be aggravated by having massage therapy');

  const other = (el('other_text').value || '').trim();
  const otherChecked = el('c_other').checked;

  if (otherChecked && !other) {
    throw new Error("If 'Other medical conditions' is checked, please specify it.");
  }
  if (other && !otherChecked) {
    throw new Error("You specified a condition but did not check 'Other medical conditions'");
  }
  if (otherChecked) out.push(`Other: ${other}`);

  return out.length ? out.map(x => x + ';').join(' ') + ' ' : '';
}

function selectedAddonsText() {
  const picked = [];
  for (let i = 0; i < ADD_ONS.length; i++) if (state.addonsChecked[i]) picked.push(ADD_ONS[i]);
  return picked.length ? picked.join('; ') : 'None';
}

function validate() {
  const nameOk = isValidName(el('name').value);
  const dateOk = el('date').value.trim().length > 0;

  const contactOk = el('contact').value.trim().length > 0;

  const servicesOk = String(el('services').value || '').trim().length > 0;
  const therapistOk = el('therapist').value.trim().length > 0;

  // Add-Ons are optional
const addonsOk = true;

  const timestartOk = el('timestart').value.trim().length > 0;

  const otherChecked = el('c_other').checked;
  const otherOk = !otherChecked || el('other_text').value.trim().length > 0;

  const consentOk = el('consentPrivacy') ? el('consentPrivacy').checked : true;
const photoOk = isPhotoCaptureEnabled() ? state.photoTaken : true;
const sigOk = state.sigDirty;

  const ok =
    nameOk &&
    dateOk &&
    contactOk &&
    servicesOk &&
    therapistOk &&
    addonsOk &&
    timestartOk &&
    otherOk &&
consentOk &&
photoOk &&
sigOk;

  el('btnSubmit').disabled = !ok;

const msg = el('submitMsg');
if (!msg) return;

if (ok) {
  msg.textContent = '';
  return;
}

const missing = [];

if (!nameOk) missing.push(el('name').value.trim() ? 'Valid name (letters, spaces, - and ’ only)' : 'Name');
if (!dateOk) missing.push('Date');
if (!contactOk) missing.push('Contact phone');
if (!servicesOk) missing.push('Services');
if (!therapistOk) missing.push('Therapist');
if (!timestartOk) missing.push('Time Start');

if (otherChecked && !el('other_text').value.trim()) {
  missing.push('Specify other medical condition');
}

if (!consentOk) missing.push('Privacy Notice consent');
if (isPhotoCaptureEnabled() && !photoOk) missing.push('Photo');
if (!sigOk) missing.push('Signature');

msg.style.color = '#b00020';
msg.style.fontWeight = '600';
msg.textContent = 'Missing: ' + missing.join(', ');

}

function setSignatureEnabled(enabled) {
  const canvas = el('sig');
  canvas.style.opacity = enabled ? '1' : '0.45';
  canvas.dataset.enabled = enabled ? '1' : '0';
}

// IndexedDB
function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbPut(record) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(record);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

async function dbGetAll() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => { db.close(); resolve(req.result || []); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

async function dbClear() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

// Signature pad (canvas)
function setupSignature() {
  const canvas = el('sig');
  const ctx = canvas.getContext('2d');

  // The signature is kept as vector strokes in NORMALISED (0..1) coordinates,
  // not as pixels. That lets us re-render it crisply at any size / DPR after a
  // rotation or resize, with no cumulative blur and no drift. state.sigDirty is
  // never reset here, so "signature present" survives a rotation.
  state.sigStrokes = [];
  let current = null;
  let drawing = false;

  function applyStrokeStyle() {
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }

  // Re-render every stored stroke into the current canvas box.
  function paintAll() {
    const rect = canvas.getBoundingClientRect();
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, rect.width, rect.height);
    applyStrokeStyle();
    for (const stroke of state.sigStrokes) {
      if (!stroke.length) continue;
      ctx.beginPath();
      if (stroke.length === 1) {
        const x = stroke[0].x * rect.width, y = stroke[0].y * rect.height;
        ctx.moveTo(x, y);
        ctx.lineTo(x + 0.1, y + 0.1); // a lone tap -> a dot
      } else {
        for (let i = 0; i < stroke.length; i++) {
          const x = stroke[i].x * rect.width, y = stroke[i].y * rect.height;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    }
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    // Setting width/height resets the transform; re-apply a clean DPR scale.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    paintAll();
    validate();
  }

  // Read layout AFTER it settles (orientationchange fires before relayout on iOS).
  let raf = 0;
  function scheduleResize() {
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => { raf = 0; resize(); });
  }

  function getPoint(e) {
    const rect = canvas.getBoundingClientRect();
    const touch = e.touches && e.touches[0];
    const clientX = touch ? touch.clientX : e.clientX;
    const clientY = touch ? touch.clientY : e.clientY;
    return {
      x: Math.min(1, Math.max(0, (clientX - rect.left) / (rect.width || 1))),
      y: Math.min(1, Math.max(0, (clientY - rect.top) / (rect.height || 1)))
    };
  }

  function pointerDown(e) {
    if (canvas.dataset.enabled !== '1') return;
    drawing = true;
    current = [getPoint(e)];
    state.sigStrokes.push(current);
  }

  function pointerMove(e) {
    if (!drawing) return;
    const rect = canvas.getBoundingClientRect();
    const p = getPoint(e);
    const n = current.length;
    applyStrokeStyle();
    ctx.beginPath();
    ctx.moveTo(current[n - 1].x * rect.width, current[n - 1].y * rect.height);
    ctx.lineTo(p.x * rect.width, p.y * rect.height);
    ctx.stroke();
    current.push(p);
    state.sigDirty = true;
    validate();
    e.preventDefault();
  }

  function pointerUp() {
    drawing = false;
    current = null;
  }

  canvas.addEventListener('pointerdown', pointerDown);
  canvas.addEventListener('pointermove', pointerMove);
  canvas.addEventListener('pointerup', pointerUp);
  canvas.addEventListener('pointercancel', pointerUp);

  window.addEventListener('resize', scheduleResize);
  window.addEventListener('orientationchange', scheduleResize);
  resize();

  el('btnClearSig').addEventListener('click', () => {
    state.sigStrokes = [];
    const rect = canvas.getBoundingClientRect();
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, rect.width, rect.height);
    state.sigDirty = false;
    validate();
  });
}

function canvasToPngBlob(canvas) {
  return new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), 'image/png', 1.0);
  });
}

// Downscale a captured image to a JPEG Blob (max long edge / quality).
// An ID face photo needs no more than ~1024px. Never throws: on any failure
// it returns the original blob so a photo is never lost.
async function downscaleToJpegBlob(srcBlob, maxEdge = 1024, quality = 0.8) {
  const url = URL.createObjectURL(srcBlob);
  try {
    const img = await new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error('image decode failed'));
      im.src = url;
    });
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!w || !h) return srcBlob;
    const scale = Math.min(1, maxEdge / Math.max(w, h));
    const cw = Math.max(1, Math.round(w * scale));
    const ch = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    canvas.getContext('2d').drawImage(img, 0, 0, cw, ch);
    const out = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    return out || srcBlob;
  } catch (_) {
    return srcBlob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Photo bytes for a record, tolerant of both storage formats:
//   new records store record.photoBlob (a Blob);
//   old records stored record.photoBytes (Array<number>).
async function recordPhotoBytes(r) {
  if (r.photoBlob instanceof Blob) return new Uint8Array(await r.photoBlob.arrayBuffer());
  return new Uint8Array(Array.isArray(r.photoBytes) ? r.photoBytes : []);
}

// Camera capture
async function stopStream() {
  if (state.stream) {
    for (const t of state.stream.getTracks()) t.stop();
    state.stream = null;
  }
}

async function startStream() {
  await stopStream();
  const constraints = {
    audio: false,
    video: { facingMode: state.camFacing }
  };
  state.stream = await navigator.mediaDevices.getUserMedia(constraints);
  el('video').srcObject = state.stream;
}

function showModal(id, show) {
  const m = el(id);
  if (show) m.classList.add('show');
  else m.classList.remove('show');
}

async function openCameraModal() {
  showModal('modalCam', true);
  try {
    await startStream();
  } catch (e) {
    showModal('modalCam', false);
    alert([
      'The iPad did not let the app use the camera.',
      '',
      'Open Settings on the iPad, find this app, and turn Camera on.',
      'Then come back and press "Take photo" again.',
    ].join(String.fromCharCode(10)));
  }
}

async function closeCameraModal() {
  await stopStream();
  showModal('modalCam', false);
}

async function snapPhoto() {
  const video = el('video');
  const canvas = el('snapCanvas');
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return;

  canvas.width = vw;
  canvas.height = vh;
  const ctx = canvas.getContext('2d');

  ctx.drawImage(video, 0, 0, vw, vh);

  const blob0 = await new Promise((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', 0.92)
  );
  const blob = await downscaleToJpegBlob(blob0, 1024, 0.8);

    state.photoBlob = blob;
  state.photoTaken = true;

  const consent = el('consentPrivacy');
  if (consent) {
    consent.checked = true;
    consent.disabled = true;
  }

  const url = URL.createObjectURL(blob);
  el('photoPreview').src = url;
  el('photoPreviewBox').classList.remove('hidden');
  el('photoStatus').textContent = 'Photo taken';

  setSignatureEnabled(true);
  validate();

  await closeCameraModal();
}

// Minimal ZIP builder (store, no compression)
function u16(n) { return new Uint8Array([n & 255, (n >>> 8) & 255]); }
function u32(n) { return new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]); }

async function crc32(buf) {
  // buf: Uint8Array
  let crc = 0 ^ (-1);
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ (-1)) >>> 0;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c >>> 0;
  }
  return table;
})();

async function buildZip(files) {
  // files: [{name, data: Uint8Array}]
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  // General-purpose bit 11 set => entry filenames are UTF-8, so non-Latin
  // names (e.g. Thai, accented Spanish) render correctly in all unzip tools.
  const gpFlag = u16(0x0800);

  for (const f of files) {
    const nameBytes = encoder.encode(f.name);
    const dataBytes = f.data;
    const crc = await crc32(dataBytes);

    // Local file header
    const localHeader = [
      u32(0x04034b50),
      u16(20),
      gpFlag,
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(dataBytes.length),
      u32(dataBytes.length),
      u16(nameBytes.length),
      u16(0),
      nameBytes
    ];

    const localSize = localHeader.reduce((s, p) => s + p.length, 0) + dataBytes.length;
    localParts.push(...localHeader, dataBytes);

    // Central directory header
    const centralHeader = [
      u32(0x02014b50),
      u16(20),
      u16(20),
      gpFlag,
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(dataBytes.length),
      u32(dataBytes.length),
      u16(nameBytes.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      nameBytes
    ];
    centralParts.push(...centralHeader);

    offset += localSize;
  }

  const centralStart = offset;
  const centralSize = centralParts.reduce((s, p) => s + p.length, 0);

  const endRecord = [
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(centralSize),
    u32(centralStart),
    u16(0)
  ];

  const all = [...localParts, ...centralParts, ...endRecord];
  const total = all.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const part of all) {
    out.set(part, pos);
    pos += part.length;
  }
  return out;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadBytes(bytes, filename, mime) {
  downloadBlob(new Blob([bytes], { type: mime }), filename);
}

async function renderHistory() {
  const rows = await dbGetAll();
  rows.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const tb = el('history');
  if (!tb) return; // history UI removed from customer waiver page
  tb.innerHTML = '';
  for (const r of rows) {
    const tr = document.createElement('tr');
    const d = new Date(r.createdAt);
    const ds = isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);

    const tdFiles = document.createElement('td');
    const btn1 = document.createElement('button');
    btn1.className = 'btn';
    btn1.type = 'button';
    btn1.textContent = 'Photo';
    btn1.onclick = () => downloadBytes(new Uint8Array(r.photoBytes), r.photoFile, 'image/jpeg');

    const btn2 = document.createElement('button');
    btn2.className = 'btn';
    btn2.type = 'button';
    btn2.textContent = 'Signature';
    btn2.onclick = () => downloadBytes(new Uint8Array(r.sigBytes), r.sigFile, 'image/png');

    const wrap = document.createElement('div');
    wrap.className = 'row';
    wrap.appendChild(btn1);
    wrap.appendChild(btn2);
    tdFiles.appendChild(wrap);

    tr.innerHTML = `
      <td>${escapeCSV(ds)}</td>
      <td>${escapeCSV(r.name)}</td>
      <td>${escapeCSV(r.services)}</td>
    `;
    tr.appendChild(tdFiles);
    tb.appendChild(tr);
  }
}

async function exportAll() {
  const rows = await dbGetAll();
  rows.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

  const header = 'Name,Date,Address,Contact,Services,AddOns,Therapist,TimeStart,Conditions,SignaturePath,PhotoPath,Timestamp\n';
  let csv = header;

  const files = [];

  for (const r of rows) {
    csv += [
      escapeCSV(r.name),
      escapeCSV(r.date),
      escapeCSV(r.address),
      contactAsText(r.contact),
      escapeCSV(r.services),
      escapeCSV(r.addons),
      escapeCSV(r.therapist),
      escapeCSV(r.timestart),
      escapeCSV(r.conditions),
      escapeCSV(r.sigFile),
      escapeCSV(r.photoFile),
      escapeCSV(r.timestamp)
    ].join(',') + '\n';

    files.push({ name: `signatures/${r.sigFile}`, data: new Uint8Array(r.sigBytes) });
    const _pb = await recordPhotoBytes(r);
    if (_pb.length) files.push({ name: `photos/${r.photoFile}`, data: _pb });
  }

  files.unshift({ name: 'ThaiBoran_Waivers.csv', data: new TextEncoder().encode(csv) });

  const zipBytes = await buildZip(files);
  const stamp = new Date().toISOString().replace(/[:]/g, '-').slice(0, 19);
  downloadBytes(zipBytes, `ThaiBoran_Export_${stamp}.zip`, 'application/zip');
}

async function submit() {
  try {
    const name = el('name').value.trim();
    const date = el('date').value.trim();
    const address = el('address').value.trim();
    const contact = el('contact').value.trim();
    const services = el('services').value;
    const therapistPick = selectedTherapist();
    const therapist = therapistPick.name;   // display-name snapshot
    const addons = selectedAddonsText();
    const timestart = el('timestart').value.trim();

        if (!name) return alert('Please type the client’s name before saving.');
    if (!isValidName(name)) return alert('Please enter a valid name: letters, spaces, hyphens and apostrophes only.');
    if (!date) return alert('Please choose the date before saving.');
    if (!contact) return alert('Please type the client’s contact number before saving.');

    if (!services) return alert('Please choose which massage the client is having.');
    if (!therapist) return alert('Please choose the therapist before saving.');

    if (!timestart) return alert('Please set the time the massage starts.');

    if (el('c_other').checked && !el('other_text').value.trim()) {
      return alert("If 'Other medical conditions' is checked, please specify it.");
    }

    if (isPhotoCaptureEnabled() && !state.photoTaken) return alert([
      'This client still needs a photo.',
      '',
      'Press "Take photo", then ask the client to sign.',
      '',
      'If the client does not want a photo, it can be skipped:',
      'Front desk tab, This device, Client photo.',
    ].join(String.fromCharCode(10)));
    if (!state.sigDirty) return alert([
      'The client still needs to sign.',
      '',
      'Ask them to sign in the white box with a finger, then press Save again.',
    ].join(String.fromCharCode(10)));

    const cond = conditionsText();

    const safeName = sanitizeNameForFile(name);
    if (!safeName) return alert('That name cannot be used for the photo file. Please type the client’s name in normal letters.');

    // Signature file
    const sigBlob = await canvasToPngBlob(el('sig'));
    const sigBytes = new Uint8Array(await sigBlob.arrayBuffer());

    // Photo (already downscaled at capture time). Stored as a Blob, not a
    // per-byte array, to keep IndexedDB small and avoid iOS quota/eviction.
    let photoBlob = null;
    let photoFile = '';

    if (isPhotoCaptureEnabled()) {
      if (!state.photoBlob) return alert('The photo did not save. Press "Take photo" and try once more.');
      photoBlob = state.photoBlob;
      photoFile = `${safeName}.jpg`;
    }

    const sigFile = `${safeName}.png`;

    // Senior/PWD discount snapshot, stored in full so the calculation can be
    // reconstructed later (gross, flag, discount, id, net) — not just the total.
    const senior = isSeniorSelected();
    const seniorId = senior ? (el('seniorId') ? el('seniorId').value.trim() : '') : '';
    const pricing = computePricing(date, services, addons, senior);

    // Who is keying this waiver. The waiver page has no login of its own, so
    // the truth available at CAPTURE time is the receptionist last signed in
    // on this device — the person on shift. Stamping it here (rather than
    // when the record eventually syncs) keeps the attribution tied to the
    // shift that took the waiver, and it is what fills "Raw data input by"
    // on the documents. sync.js and the server re-stamp only if it is blank.
    const onShift = (window.TB && TB.cachedUser()) || null;

    const record = {
      id: (crypto.randomUUID ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).slice(2))),
      siteId: (window.TB && TB.deviceSite()) || 'panacan', // which parlor captured this
      receptionistId: onShift ? onShift.uid : '',
      receptionistName: onShift ? onShift.name : '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      synced: false, // pushed to the server by sync.js when online
      timestamp: nowTimestamp(),
      name, date, address, contact, services, therapist, addons, timestart,
      therapistId: therapistPick.id,        // linkage key for commission + filters
      conditions: cond,
      sigFile,
      photoFile,
      sigBytes: Array.from(sigBytes),
      photoBlob: photoBlob,
      senior: senior,
      seniorId: seniorId,
      priceGross: pricing.gross,
      discountAmount: pricing.discount,
      priceNet: pricing.net
    };

        await dbPut(record);
    notifyUpdate();

    // Online-first: push to the server straight away; offline it stays
    // queued locally and flushes on reconnect (sync.js).
    if (window.TBSync) { try { TBSync.syncNow(); } catch (_) {} }

    // If photo capture was disabled for this submission, restore default immediately after success
    if (!isPhotoCaptureEnabled()) {
      setPhotoCaptureEnabled(true);
      updateSettingsUi();
    }

    resetForm(false);
    applyPhotoGate();

const msg = el('submitMsg');
msg.textContent = 'Submission successful — Total ' + pesos(pricing.net) + (senior ? ' (20% Senior/PWD discount applied)' : '');
msg.style.color = '#0a7a2a';
msg.style.fontWeight = '700';
msg.style.fontSize = '16px';

// auto-clear after 4 seconds
setTimeout(() => {
  if (el('submitMsg')) el('submitMsg').textContent = '';
}, 4000);

await renderHistory();

  } catch (e) {
    alert([
      'The waiver could not be saved.',
      '',
      (e.message || String(e)),
      '',
      'Nothing has been lost — check the form and try Save again.',
    ].join(String.fromCharCode(10)));
  }
}

function resetForm(clearPhotoAndSig) {
  el('name').value = '';
  el('date').value = todayISO();
  el('address').value = '';
  el('contact').value = '';
  el('therapist').value = '';
  el('timestart').value = '';
  el('services').selectedIndex = 0;

  state.addonsChecked.fill(false);

// Restore the <select> to a single visible option: "None"
const a = el('addons');
a.innerHTML = '';
const opt = document.createElement('option');
opt.value = 'None';
opt.textContent = 'None';
a.appendChild(opt);
a.value = 'None';

  if (el('senior')) el('senior').value = 'No';
  if (el('seniorId')) el('seniorId').value = '';
  if (el('seniorIdWrap')) el('seniorIdWrap').classList.add('hidden');
  updateTotalPreview();

  el('c_pregnant').checked = false;
  el('c_thinners').checked = false;
  el('c_skin').checked = false;
  el('c_bp').checked = false;
  el('c_pre').checked = false;
  el('c_other').checked = false;
  el('other_text').value = '';

    el('submitMsg').textContent = '';

  const consent = el('consentPrivacy');
  if (consent) {
    consent.checked = false;
    consent.disabled = false;
  }
  if (el('btnTakePhoto')) el('btnTakePhoto').disabled = true;

  // reset signature canvas
  el('btnClearSig').click();

  if (clearPhotoAndSig) {
    state.photoBlob = null;
    state.photoTaken = false;
    el('photoPreviewBox').classList.add('hidden');
    el('photoPreview').src = '';
    el('photoStatus').textContent = 'No photo taken yet';
    setSignatureEnabled(false);
    validate();
  } else {
    // after submit, require new photo and signature
    state.photoBlob = null;
    state.photoTaken = false;
    el('photoPreviewBox').classList.add('hidden');
    el('photoPreview').src = '';
    el('photoStatus').textContent = 'No photo taken yet';
    setSignatureEnabled(false);
    state.sigDirty = false;
    validate();
  }
}

function setupAddons() {
  const input = el('addons');
  const modal = el('modalAddons');
  const list = el('addonsList');

  list.innerHTML = '';
  for (let i = 0; i < ADD_ONS.length; i++) {
    const lab = document.createElement('label');
    lab.className = 'check';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = state.addonsChecked[i];
    cb.onchange = () => { state.addonsChecked[i] = cb.checked; };
    lab.appendChild(cb);
    lab.appendChild(document.createTextNode(' ' + ADD_ONS[i]));
    list.appendChild(lab);
  }

  function open() {
    // refresh
    const cbs = list.querySelectorAll('input[type=checkbox]');
    cbs.forEach((cb, idx) => cb.checked = state.addonsChecked[idx]);
    modal.classList.add('show');
  }

  input.addEventListener('click', open);
  el('btnCloseAddons').addEventListener('click', () => modal.classList.remove('show'));
  el('btnOkAddons').addEventListener('click', () => {
  const txt = selectedAddonsText();

  // The add-ons field is a <select> with only "None" by default.
  // If we set a value that doesn't exist as an <option>, iPad won't show it.
  input.innerHTML = '';
  const opt = document.createElement('option');
  opt.value = txt;
  opt.textContent = txt;
  input.appendChild(opt);
  input.value = txt;

  updateTotalPreview();
  modal.classList.remove('show');
});
}

function setupServices() {
  const s = el('services');
  for (const item of SERVICES) {
    const opt = document.createElement('option');
    opt.value = item;
    opt.textContent = item;
    s.appendChild(opt);
  }
}

// Therapist picker: ACTIVE therapists from the shared org list (cached
// locally like prices, so it works offline). Option value = therapistId,
// text = full name — no more free-text mismatches like "Novim" vs "novim".
function setupTherapistPicker() {
  const sel = el('therapist');
  if (!sel || sel.tagName !== 'SELECT') return;

  function rebuild() {
    const keep = sel.value; // preserve the current choice across refreshes
    const list = (window.TB && TB.cachedTherapists()) || [];
    sel.innerHTML = '';
    const ph = document.createElement('option');
    ph.value = '';
    ph.textContent = list.length ? '— choose therapist —' : '— no therapist list yet (connect once) —';
    sel.appendChild(ph);
    for (const t of list) {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.fullName;
      sel.appendChild(opt);
    }
    if (keep && list.some((t) => t.id === keep)) sel.value = keep;
  }

  rebuild();
  document.addEventListener('tb:therapists', rebuild);
  sel.addEventListener('change', validate); // selects fire change, not input
}

function selectedTherapist() {
  const sel = el('therapist');
  const opt = sel && sel.selectedOptions && sel.selectedOptions[0];
  return {
    id: (sel && sel.value) || '',
    name: opt && sel.value ? opt.textContent : '',
  };
}

function setupEvents() {
  // Form watchers
    ['name','contact','therapist'].forEach((id) => el(id).addEventListener('input', validate));

  // iPad Safari date/time pickers often fire change (not input)
  el('date').addEventListener('change', validate);
  el('date').addEventListener('input', validate);

  el('timestart').addEventListener('change', validate);
  el('timestart').addEventListener('input', validate);

  // selects update on change
  el('services').addEventListener('change', validate);
  if (el('addons')) el('addons').addEventListener('change', validate);

  // Senior/PWD field: reveal the ID input only when Yes, keep the total live.
  const seniorSel = el('senior');
  if (seniorSel) {
    const syncSenior = () => {
      const wrap = el('seniorIdWrap');
      if (wrap) wrap.classList.toggle('hidden', !isSeniorSelected());
      updateTotalPreview();
      validate();
    };
    seniorSel.addEventListener('change', syncSenior);
    syncSenior();
  }
  // Keep the submission total preview current when price-affecting fields change.
  ['date', 'services'].forEach((id) => {
    const e = el(id);
    if (e) { e.addEventListener('change', updateTotalPreview); e.addEventListener('input', updateTotalPreview); }
  });
    ['c_pregnant','c_thinners','c_skin','c_bp','c_pre'].forEach((id) => el(id).addEventListener('input', () => {}));

  const otherBox = el('c_other');
  const otherText = el('other_text');

  const syncOtherRequiredVisual = () => {
    if (otherBox.checked) otherText.classList.add('required-field');
    else otherText.classList.remove('required-field');
    validate();
  };

  otherBox.addEventListener('change', syncOtherRequiredVisual);
  otherText.addEventListener('input', validate);

  // apply on load in case record is prefilled or user returns
  syncOtherRequiredVisual();

      // Privacy consent gate (photo required by default, but can be disabled in Settings)
const consent = el('consentPrivacy');
if (consent) {
  consent.addEventListener('change', () => {
    if (consent.disabled) return;
    applyPhotoGate();
  });
}
applyPhotoGate();

  el('btnTakePhoto').addEventListener('click', async () => {
    const consent = el('consentPrivacy');
    if (consent && !consent.checked) return;

    const name = el('name').value.trim();
    if (!name) return alert('Please type the client’s name first — the photo is filed under it.');

    // Option A: native camera picker (works on iPad over http)
    const inp = el('photoInput');
    if (!inp) return alert('Photo input missing');
    inp.value = ''; // allow retake
    inp.click();
  });

  el('btnCloseCam').addEventListener('click', closeCameraModal);
  el('btnSnap').addEventListener('click', snapPhoto);

  // Option A: native camera/file picker
el('photoInput').addEventListener('change', async (e) => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;

  // Downscale before storing (max 1024px long edge, JPEG ~0.8).
  const shrunk = await downscaleToJpegBlob(f, 1024, 0.8);

  state.photoBlob = shrunk;
  state.photoTaken = true;

  const consent = el('consentPrivacy');
  if (consent) {
    consent.checked = true;
    consent.disabled = true;
  }

  const url = URL.createObjectURL(shrunk);
  el('photoPreview').src = url;
  el('photoPreviewBox').classList.remove('hidden');
  el('photoStatus').textContent = 'Photo taken';

  setSignatureEnabled(true);
  validate();
});

  el('btnSwitchCam').addEventListener('click', async () => {
    state.camFacing = (state.camFacing === 'user') ? 'environment' : 'user';
    try { await startStream(); } catch (_) {}
  });

    el('btnSubmit').addEventListener('click', submit);

  // Manager Access (opens the manager page from inside the waiver PWA)
  if (el('btnManagerAccess')) {
    el('btnManagerAccess').addEventListener('click', () => {
      window.location.href = './manager/';
    });
  }

  el('btnReset').addEventListener('click', () => resetForm(true));
el('btnPrintWaiver').addEventListener('click', () => {
  window.print();
});

  // btnExport / btnClearAll live on the manager page, not the customer form.
  // Guard so a missing element never throws and aborts the rest of init().
  if (el('btnExport')) {
    el('btnExport').addEventListener('click', exportAll);
  }

  if (el('btnClearAll')) {
    el('btnClearAll').addEventListener('click', async () => {
      if (!confirm('Clear all saved submissions on this iPad?')) return;
      await dbClear();
      await renderHistory();
      alert('Saved data cleared');
    });
  }
}

function setupOfflineHint() {
  const hint = el('offlineHint');
  function refresh() {
    const online = navigator.onLine;
    hint.classList.toggle('hidden', online);
    if (!online) hint.textContent = 'You are offline. This app still works. Data is saved locally.';
  }
  window.addEventListener('online', refresh);
  window.addEventListener('offline', refresh);
  refresh();
}

async function init() {
  if (el('waiverBlock')) {
    el('waiverBlock').innerHTML = WAIVER_HTML;
  }

  setupServices();
  setupTherapistPicker();
  setupAddons();
  setupSignature();
  setupPhotoSwitch();
  setupEvents();
  // Prevent iPad edge-swipe navigation (back/forward) while keeping vertical scroll
let touchStartX = 0;
let touchStartY = 0;
let edgeSwipe = false;

document.addEventListener('touchstart', e => {
  if (!e.touches || e.touches.length !== 1) return;

  touchStartX = e.touches[0].clientX;
  touchStartY = e.touches[0].clientY;

  const w = window.innerWidth || 0;
  const EDGE = 28; // px from the edge where iPad back/forward swipes start

  edgeSwipe = (touchStartX <= EDGE) || (touchStartX >= (w - EDGE));
}, { passive: true });

document.addEventListener('touchmove', e => {
  if (!e.touches || e.touches.length !== 1) return;

  const dx = Math.abs(e.touches[0].clientX - touchStartX);
  const dy = Math.abs(e.touches[0].clientY - touchStartY);

  // Only intervene when a gesture starts at the screen edge and is horizontal-dominant
  if (edgeSwipe && dx > dy && dx > 6) {
    e.preventDefault();
  }
}, { passive: false });

document.addEventListener('touchend', () => {
  edgeSwipe = false;
}, { passive: true });
  
  setupOfflineHint();

  el('date').value = todayISO();
  el('addons').value = 'None';

  setSignatureEnabled(false);
  validate();
  updateTotalPreview();

  await renderHistory();
}

init();
