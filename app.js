// Thai Boran Waiver PWA (offline, local storage)

const SERVICES = [
  '1hr Thai Back Massage', '1hr Thai Body Massage', '1hr Thai Foot Massage', '1hr Thai Swedish Massage',
  '1hr Swedish Massage', '1hr Thai Aromatherapy Massage',
  'Combo 1', 'Combo 2', 'Combo 3', 'Combo 4', 'Combo 5', 'Combo 6', 'Combo 7', 'Combo 8'
];

const ADD_ONS = ['Unscented Oil', 'Scented Oil', 'Herbal Hotpads', 'Ventosa', 'Hot Stone', 'Half Hour'];

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

// Receptionist PIN (change this value if you want a different code)
const RECEPTION_PIN = '2512';

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

function sanitizeNameForFile(name) {
  return (name || '').trim().replace(/\s+/g, '').replace(/[^a-zA-Z0-9_-]/g, '');
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
  const nameOk = el('name').value.trim().length > 0;
  const dateOk = el('date').value.trim().length > 0;

  const contactOk = el('contact').value.trim().length > 0;

  const servicesOk = String(el('services').value || '').trim().length > 0;
  const therapistOk = el('therapist').value.trim().length > 0;

  // Add-Ons are optional
const addonsOk = true;

  const timestartOk = el('timestart').value.trim().length > 0;

  const otherChecked = el('c_other').checked;
  const otherOk = !otherChecked || el('other_text').value.trim().length > 0;

  const photoOk = state.photoTaken;
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

if (!nameOk) missing.push('Name');
if (!dateOk) missing.push('Date');
if (!contactOk) missing.push('Contact phone');
if (!servicesOk) missing.push('Services');
if (!therapistOk) missing.push('Therapist');
if (!timestartOk) missing.push('Time Start');

if (otherChecked && !el('other_text').value.trim()) {
  missing.push('Specify other medical condition');
}

if (!photoOk) missing.push('Photo');
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

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    ctx.scale(dpr, dpr);
    // clear
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, rect.width, rect.height);
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    state.sigDirty = false;
    validate();
  }

  let drawing = false;
  let last = null;

  function pointerDown(e) {
    if (canvas.dataset.enabled !== '1') return;
    drawing = true;
    last = getPoint(e);
  }

  function pointerMove(e) {
    if (!drawing) return;
    const p = getPoint(e);
    const rect = canvas.getBoundingClientRect();
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last = p;
    state.sigDirty = true;
    validate();
    e.preventDefault();
  }

  function pointerUp() {
    drawing = false;
    last = null;
  }

  function getPoint(e) {
    const rect = canvas.getBoundingClientRect();
    const touch = e.touches && e.touches[0];
    const clientX = touch ? touch.clientX : e.clientX;
    const clientY = touch ? touch.clientY : e.clientY;
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  canvas.addEventListener('pointerdown', pointerDown);
  canvas.addEventListener('pointermove', pointerMove);
  canvas.addEventListener('pointerup', pointerUp);
  canvas.addEventListener('pointercancel', pointerUp);

  window.addEventListener('resize', resize);
  resize();

  el('btnClearSig').addEventListener('click', () => {
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
    alert('Camera access failed. Please allow camera permission in Safari settings.');
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

  const blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', 0.92)
  );

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

  for (const f of files) {
    const nameBytes = encoder.encode(f.name);
    const dataBytes = f.data;
    const crc = await crc32(dataBytes);

    // Local file header
    const localHeader = [
      u32(0x04034b50),
      u16(20),
      u16(0),
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
      u16(0),
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

// Receptionist: Edit Records (add extra add-ons)
let editUnlocked = false;
let editRowsCache = [];
let editCurrent = null;

function parseAddonsSet(s) {
  const out = new Set();
  const v = String(s || '').trim();
  if (!v || v.toLowerCase() === 'none') return out;
  for (const part of v.split(';')) {
    const t = part.trim();
    if (t) out.add(t);
  }
  return out;
}

function addonsSetToText(set) {
  const arr = Array.from(set);
  return arr.length ? arr.join('; ') : 'None';
}

function showEditPinMsg(text, ok) {
  const n = el('editPinMsg');
  if (!n) return;
  n.textContent = text || '';
  n.style.color = ok ? '#0a7a2f' : '#b00020';
}

function showEditDetailMsg(text, ok) {
  const n = el('editDetailMsg');
  if (!n) return;
  n.textContent = text || '';
  n.style.color = ok ? '#0a7a2f' : '#b00020';
}

async function openEditRecordsList() {
  const rows = await dbGetAll();
  rows.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  editRowsCache = rows;

  const tb = el('editRows');
  tb.innerHTML = '';

  for (const r of rows) {
    const tr = document.createElement('tr');
    tr.style.cursor = 'pointer';

    const d = new Date(r.createdAt || 0);
    const ts = isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 19).replace('T', ' ');

    tr.innerHTML = `
      <td>${escapeCSV(ts)}</td>
      <td>${escapeCSV(r.name || '')}</td>
      <td>${escapeCSV(r.date || '')}</td>
      <td>${escapeCSV(r.services || '')}</td>
      <td>${escapeCSV(r.addons || '')}</td>
    `;

    tr.addEventListener('click', () => openEditDetail(r.id));
    tb.appendChild(tr);
  }

  el('editRecordsMsg').textContent = rows.length ? '' : 'No saved records yet.';
  showModal('modalEditRecords', true);
}

async function openEditDetail(recordId) {
  const rows = editRowsCache.length ? editRowsCache : await dbGetAll();
  const r = rows.find(x => x.id === recordId);
  if (!r) return;

  editCurrent = r;

  const title = `${r.name || ''} | ${r.date || ''} | ${r.services || ''}`;
  el('editDetailTitle').textContent = title;

  const existing = parseAddonsSet(r.addons);
  const wrap = el('editAddonsList');
  wrap.innerHTML = '';

  for (const a of ADD_ONS) {
    const row = document.createElement('label');
    row.className = 'check';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.dataset.addon = a;

    const isExisting = existing.has(a);
    cb.checked = isExisting;
    if (isExisting) cb.disabled = true;

    const txt = document.createElement('span');
    txt.textContent = a;

    row.appendChild(cb);
    row.appendChild(txt);
    wrap.appendChild(row);
  }

  showEditDetailMsg('', true);
  showModal('modalEditDetail', true);
}

async function saveEditDetail() {
  if (!editCurrent) return;

  const existing = parseAddonsSet(editCurrent.addons);

  const wrap = el('editAddonsList');
  const boxes = wrap.querySelectorAll('input[type="checkbox"]');

  let added = 0;
  for (const cbx of boxes) {
    const a = cbx.dataset.addon;
    if (!a) continue;
    if (cbx.disabled) continue; // existing locked
    if (cbx.checked && !existing.has(a)) {
      existing.add(a);
      added++;
    }
  }

  if (added === 0) {
    showEditDetailMsg('No new add-ons selected.', false);
    return;
  }

  const updated = { ...editCurrent };
  updated.addons = addonsSetToText(existing);
  updated.updatedAt = Date.now();

  await dbPut(updated);
  notifyUpdate();

  // Update local cache so the list shows the new addons immediately
  editCurrent = updated;
  editRowsCache = editRowsCache.map(x => x.id === updated.id ? updated : x);

  showEditDetailMsg('Saved.', true);

  // Refresh list view if it is open behind
  const tb = el('editRows');
  if (tb) {
    await openEditRecordsList();
    // Re-open detail after list refresh so user stays in flow
    showModal('modalEditRecords', false);
    showModal('modalEditDetail', true);
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
    files.push({ name: `photos/${r.photoFile}`, data: new Uint8Array(r.photoBytes) });
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
    const therapist = el('therapist').value.trim();
    const addons = selectedAddonsText();
    const timestart = el('timestart').value.trim();

        if (!name) return alert('Name is required');
    if (!date) return alert('Date is required');
    if (!contact) return alert('Contact is required');

    if (!services) return alert('Services is required');
    if (!therapist) return alert('Therapist is required');

    if (!timestart) return alert('Time Start is required');

    if (el('c_other').checked && !el('other_text').value.trim()) {
      return alert("If 'Other medical conditions' is checked, please specify it.");
    }

    if (!state.photoTaken) return alert('Please take a photo first');
    if (!state.sigDirty) return alert('Signature missing');

    const cond = conditionsText();

    const safeName = sanitizeNameForFile(name);
    if (!safeName) return alert('Name contains no valid characters for filenames');

    // Signature file
    const sigBlob = await canvasToPngBlob(el('sig'));
    const sigBytes = new Uint8Array(await sigBlob.arrayBuffer());

    // Photo file
    const photoBytes = new Uint8Array(await state.photoBlob.arrayBuffer());

    const sigFile = `${safeName}.png`;
    const photoFile = `${safeName}.jpg`;

    const record = {
      id: (crypto.randomUUID ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).slice(2))),
      createdAt: Date.now(),
      timestamp: nowTimestamp(),
      name, date, address, contact, services, therapist, addons, timestart,
      conditions: cond,
      sigFile,
      photoFile,
      sigBytes: Array.from(sigBytes),
      photoBytes: Array.from(photoBytes)
    };

    await dbPut(record);
notifyUpdate();

resetForm(false);

const msg = el('submitMsg');
msg.textContent = 'Submission successful';
msg.style.color = '#0a7a2a';
msg.style.fontWeight = '700';
msg.style.fontSize = '16px';

// auto-clear after 4 seconds
setTimeout(() => {
  if (el('submitMsg')) el('submitMsg').textContent = '';
}, 4000);

await renderHistory();

  } catch (e) {
    alert(e.message || String(e));
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
  el('addons').value = 'None';

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
    el('addons').value = selectedAddonsText();
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

      // Privacy consent gate for photo
  const consent = el('consentPrivacy');
  const takeBtn = el('btnTakePhoto');
  if (consent && takeBtn) {
    takeBtn.disabled = !consent.checked;
    consent.addEventListener('change', () => {
      if (consent.disabled) return;
      takeBtn.disabled = !consent.checked;
    });
  }

  el('btnTakePhoto').addEventListener('click', async () => {
    const consent = el('consentPrivacy');
    if (consent && !consent.checked) return;

    const name = el('name').value.trim();
    if (!name) return alert('Please enter your name first');

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

  state.photoBlob = f;
  state.photoTaken = true;

  const consent = el('consentPrivacy');
  if (consent) {
    consent.checked = true;
    consent.disabled = true;
  }

  const url = URL.createObjectURL(f);
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

// Receptionist: Edit Records
if (el('btnEditRecords')) {
  el('btnEditRecords').addEventListener('click', () => {
    el('editPin').value = '';
    showEditPinMsg('', true);
    showModal('modalEditPin', true);
  });
}

if (el('btnCloseEditPin')) {
  el('btnCloseEditPin').addEventListener('click', () => showModal('modalEditPin', false));
}

if (el('btnEditPinOk')) {
  el('btnEditPinOk').addEventListener('click', async () => {
    const pin = String(el('editPin').value || '').trim();
    if (pin !== RECEPTION_PIN) {
      editUnlocked = false;
      showEditPinMsg('Wrong PIN.', false);
      return;
    }

    editUnlocked = true;
    showModal('modalEditPin', false);
    await openEditRecordsList();
  });
}

if (el('btnCloseEditRecords')) {
  el('btnCloseEditRecords').addEventListener('click', () => showModal('modalEditRecords', false));
}

if (el('btnEditDetailClose')) {
  el('btnEditDetailClose').addEventListener('click', () => showModal('modalEditDetail', false));
}

if (el('btnEditDetailSave')) {
  el('btnEditDetailSave').addEventListener('click', saveEditDetail);
}

  el('btnReset').addEventListener('click', () => resetForm(true));
el('btnPrintWaiver').addEventListener('click', () => {
  window.print();
});

  el('btnExport').addEventListener('click', exportAll);

  el('btnClearAll').addEventListener('click', async () => {
    if (!confirm('Clear all saved submissions on this iPad?')) return;
    await dbClear();
    await renderHistory();
    alert('Saved data cleared');
  });
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
  setupAddons();
  setupSignature();
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

  await renderHistory();
}

init();
