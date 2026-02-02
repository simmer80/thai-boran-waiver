// Thai Boran Manager (reads the same IndexedDB as the waiver form)
// Manager PIN: 3180

const MANAGER_PIN = "3180";

// Auto-refresh when waiver page updates a record (receptionist add-ons)
const UPDATE_CHANNEL = "tb_updates";
const bc = ("BroadcastChannel" in window) ? new BroadcastChannel(UPDATE_CHANNEL) : null;
if (bc) {
  bc.onmessage = () => {
    try { loadRows(); } catch (_) {}
  };
}

const DB_NAME = "thai_boran_waiver_db";
const DB_VERSION = 1;
const STORE = "submissions";

const el = (id) => document.getElementById(id);

// Sales pricing storage
const PRICE_SETS_KEY = "tb_price_sets_v1";
const PRICE_LOCKED_KEY = "tb_price_locked_v1";

// Master lists (always show these in price control)
const SERVICES = [
  "1hr Thai Back Massage",
  "1hr Thai Body Massage",
  "1hr Thai Foot Massage",
  "1hr Thai Swedish Massage",
  "1hr Swedish Massage",
  "1hr Thai Aromatherapy Massage",
  "Combo 1",
  "Combo 2",
  "Combo 3",
  "Combo 4",
  "Combo 5",
  "Combo 6",
  "Combo 7",
  "Combo 8"
];

const ADD_ONS = [
  "Unscented Oil",
  "Scented Oil",
  "Herbal Hotpads",
  "Ventosa",
  "Hot Stone",
  "Half Hour"
];

// Force show/hide even if CSS uses !important somewhere
function showBlock(id) {
  const n = el(id);
  if (n) n.style.setProperty("display", "block", "important");
}
function hideBlock(id) {
  const n = el(id);
  if (n) n.style.setProperty("display", "none", "important");
}

// IndexedDB
function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbGetAll() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => { db.close(); resolve(req.result || []); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

async function dbClear() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

// CSV helpers
function escapeCSV(value) {
  const s = (value ?? "").toString();
  if (s.includes(",") || s.includes("\"") || s.includes("\n")) {
    return `"${s.replace(/"/g, "\"\"")}"`;
  }
  return s;
}

function contactAsText(value) {
  const s = (value ?? "").toString();
  return `="${escapeCSV(s)}"`;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
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

// Minimal ZIP builder (store, no compression)
function u16(n) { return new Uint8Array([n & 255, (n >>> 8) & 255]); }
function u32(n) { return new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]); }

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c >>> 0;
  }
  return table;
})();

async function crc32(buf) {
  let crc = 0 ^ (-1);
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ (-1)) >>> 0;
}

async function buildZip(files) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const f of files) {
    const nameBytes = encoder.encode(f.name);
    const dataBytes = f.data;
    const crc = await crc32(dataBytes);

    const localHeader = [
      u32(0x04034b50),
      u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc),
      u32(dataBytes.length),
      u32(dataBytes.length),
      u16(nameBytes.length),
      u16(0),
      nameBytes
    ];

    const localSize = localHeader.reduce((s, p) => s + p.length, 0) + dataBytes.length;
    localParts.push(...localHeader, dataBytes);

    const centralHeader = [
      u32(0x02014b50),
      u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc),
      u32(dataBytes.length),
      u32(dataBytes.length),
      u16(nameBytes.length),
      u16(0), u16(0), u16(0), u16(0),
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
    u16(0), u16(0),
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

function stampForFile() {
  return new Date().toISOString().replace(/[:]/g, "-").slice(0, 19);
}

function toUint8(a) {
  return new Uint8Array(Array.isArray(a) ? a : []);
}

let cachedRows = [];
let selected = null;

function todayYmd() {
  return new Date().toISOString().slice(0, 10);
}

function parseAddonsList(addonsText) {
  const t = String(addonsText || "").trim();
  if (!t || t.toLowerCase() === "none") return [];
  return t.split(",").map(s => s.trim()).filter(Boolean);
}

function loadPriceSets() {
  try {
    const raw = localStorage.getItem(PRICE_SETS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function savePriceSets(arr) {
  localStorage.setItem(PRICE_SETS_KEY, JSON.stringify(arr || []));
}

function isPricesLocked() {
  return localStorage.getItem(PRICE_LOCKED_KEY) !== "0";
}

function setPricesLocked(on) {
  localStorage.setItem(PRICE_LOCKED_KEY, on ? "1" : "0");
}

function ensureInitialPriceSet() {
  const sets = loadPriceSets();
  if (sets.length > 0) return sets;

  const services = {};
  const addons = {};

  for (const name of SERVICES) services[name] = 0;
  for (const name of ADD_ONS) addons[name] = 0;

  const initial = [{
    effectiveFrom: "1970-01-01",
    services,
    addons
  }];

  savePriceSets(initial);
  return initial;
}

function pickPriceSetForDate(ymd) {
  const sets = loadPriceSets().slice().sort((a, b) => String(a.effectiveFrom).localeCompare(String(b.effectiveFrom)));
  if (sets.length === 0) return null;

  const d = String(ymd || "").trim();
  if (!d) return sets[sets.length - 1];

  let chosen = sets[0];
  for (const s of sets) {
    if (String(s.effectiveFrom) <= d) chosen = s;
  }
  return chosen;
}

function calcSalesForRecord(r) {
  const set = pickPriceSetForDate(r.date);
  const serviceName = String(r.services || "").trim();
  const servicePrice = Number(set?.services?.[serviceName] ?? 0) || 0;

  const addonsList = parseAddonsList(r.addons);
  let addonsPrice = 0;
  for (const a of addonsList) {
    addonsPrice += (Number(set?.addons?.[a] ?? 0) || 0);
  }

  return { servicePrice, addonsPrice, total: servicePrice + addonsPrice };
}

function collectDistinctItemsFromRows(rows) {
  const svc = new Set();
  const add = new Set();

  for (const r of rows) {
    const s = String(r.services || "").trim();
    if (s) svc.add(s);

    for (const a of parseAddonsList(r.addons)) add.add(a);
  }

  const items = [];
  [...svc].sort().forEach(name => items.push({ type: "service", name }));
  [...add].sort().forEach(name => items.push({ type: "addon", name }));
  return items;
}

function renderPriceEditor() {
  const sets = ensureInitialPriceSet();
  const currentSet = sets.slice().sort((a, b) => String(a.effectiveFrom).localeCompare(String(b.effectiveFrom))).at(-1);

  const locked = isPricesLocked();
  el("priceStatus").textContent = locked
    ? `Locked. Current set effective from: ${currentSet?.effectiveFrom || "n/a"}`
    : "Editing unlocked. Change prices then Save and Lock.";

  el("btnPricesSaveLock").disabled = locked;

  const tb = el("priceRows");
  tb.innerHTML = "";

    function addRow(type, name, priceVal) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeCSV(name)}</td>
      <td>${type === "service" ? "Service" : "Add-On"}</td>
      <td>
        <input
          data-price-type="${type}"
          data-price-name="${escapeCSV(name)}"
          type="number"
          step="1"
          min="0"
          value="${escapeCSV(String(priceVal))}"
          style="width: 140px;"
          ${locked ? "disabled" : ""}
        />
      </td>
    `;
    tb.appendChild(tr);
  }

  for (const name of SERVICES) {
    addRow("service", name, currentSet?.services?.[name] ?? 0);
  }
  for (const name of ADD_ONS) {
    addRow("addon", name, currentSet?.addons?.[name] ?? 0);
  }
}

function saveAndLockPrices() {
  const sets = ensureInitialPriceSet();

  const latest = sets.slice().sort((a, b) => String(a.effectiveFrom).localeCompare(String(b.effectiveFrom))).at(-1) || {
    effectiveFrom: "1970-01-01",
    services: {},
    addons: {}
  };

  const services = { ...(latest.services || {}) };
  const addons = { ...(latest.addons || {}) };

  const inputs = Array.from(document.querySelectorAll("#priceRows input[data-price-type]"));
  for (const inp of inputs) {
    const t = inp.getAttribute("data-price-type");
    const n = inp.getAttribute("data-price-name");
    const v = Number(inp.value || 0) || 0;
    if (t === "service") services[n] = v;
    if (t === "addon") addons[n] = v;
  }

  const newSet = {
    effectiveFrom: todayYmd(),
    services,
    addons
  };

  sets.push(newSet);
  savePriceSets(sets);
  setPricesLocked(true);

  renderPriceEditor();
  renderSales();
}

function setSalesTab(on) {
  const vH = el("viewHistory");
  const vS = el("viewSales");

  if (on) {
    vH.classList.add("hidden");
    vS.classList.remove("hidden");
    el("tabHistory").classList.remove("primary");
    el("tabSales").classList.add("primary");
    el("tabHint").textContent = "Sales view";
    renderPriceEditor();
    renderSales();
  } else {
    vS.classList.add("hidden");
    vH.classList.remove("hidden");
    el("tabSales").classList.remove("primary");
    el("tabHistory").classList.add("primary");
    el("tabHint").textContent = "History view";
  }
}

function renderSales() {
  const year = (el("salesYear")?.value || "").trim();
  const day = (el("salesDay")?.value || "").trim();
  const month = (el("salesMonth")?.value || "").trim();

  const from = (el("salesFrom")?.value || "").trim();
  const to = (el("salesTo")?.value || "").trim();

  let rows = cachedRows.slice();

  // Range filter (YYYY-MM-DD strings compare correctly)
  if (from || to) {
    let start = from || "0000-01-01";
    let end = to || "9999-12-31";

    // If user accidentally selects reversed range, swap it
    if (start && end && start > end) {
      const tmp = start;
      start = end;
      end = tmp;
    }

    rows = rows.filter(r => {
      const d = String(r.date || "").trim();
      if (!d) return false;
      return d >= start && d <= end;
    });
  }

  // Existing filters still work (they further narrow the result)
  if (year) rows = rows.filter(r => String(r.date || "").slice(0, 4) === year);
  if (day) rows = rows.filter(r => String(r.date || "") === day);
  if (!day && month) rows = rows.filter(r => String(r.date || "").slice(0, 7) === month);

  const tb = el("salesRows");
  tb.innerHTML = "";

  let total = 0;

  for (const r of rows) {
    const s = calcSalesForRecord(r);
    total += s.total;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeCSV(r.date || "")}</td>
      <td>${escapeCSV(r.name || "")}</td>
      <td>${escapeCSV(r.services || "")}</td>
      <td>${escapeCSV(r.addons || "")}</td>
      <td>${escapeCSV(String(s.servicePrice))}</td>
      <td>${escapeCSV(String(s.addonsPrice))}</td>
      <td>${escapeCSV(String(s.total))}</td>
    `;
    tb.appendChild(tr);
  }

    el("salesTotal").textContent = String(total);
  el("salesCount").textContent = String(rows.length);

        renderMonthlyChartFromAllRows(cachedRows, year);
}

function updateSalesYearList() {
  const sel = el("salesYear");
  if (!sel) return;

  const years = new Set();

  for (const r of cachedRows) {
    const y = String(r.date || "").slice(0, 4);
    if (/^\d{4}$/.test(y)) years.add(y);
  }

  const sortedYears = [...years].sort((a, b) => Number(b) - Number(a));

  sel.innerHTML = "";

  for (const y of sortedYears) {
    const opt = document.createElement("option");
    opt.value = y;
    opt.textContent = y;
    sel.appendChild(opt);
  }
}

function renderMonthlyChartFromAllRows(allRows, yearFilter) {
  const map = new Map(); // YYYY-MM -> total

    for (const r of allRows) {
    const d = String(r.date || "").trim();
    if (!d || d.length < 7) continue;
    if (yearFilter && d.slice(0, 4) !== yearFilter) continue;

    const m = d.slice(0, 7);
    const s = calcSalesForRecord(r);
    map.set(m, (map.get(m) || 0) + s.total);
  }

  const months = [...map.keys()].sort();
  const values = months.map(m => map.get(m) || 0);

  const c = el("salesChart");
  if (!c) return;
  const ctx = c.getContext("2d");
  if (!ctx) return;

  const W = c.width;
  const H = c.height;

  ctx.clearRect(0, 0, W, H);

  // background
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);

  if (months.length === 0) return;

  const maxV = Math.max(...values, 1);
  const padL = 50;
  const padR = 20;
  const padT = 20;
  const padB = 40;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  // axis
  ctx.strokeStyle = "#bbbbbb";
  ctx.beginPath();
  ctx.moveTo(padL, padT);
  ctx.lineTo(padL, padT + innerH);
  ctx.lineTo(padL + innerW, padT + innerH);
  ctx.stroke();

  const n = months.length;
  const barGap = 6;
  const barW = Math.max(6, Math.floor((innerW - barGap * (n - 1)) / n));

  ctx.fillStyle = "#3b82f6";

  for (let i = 0; i < n; i++) {
    const v = values[i];
    const h = Math.round((v / maxV) * innerH);
    const x = padL + i * (barW + barGap);
    const y = padT + innerH - h;

    ctx.fillRect(x, y, barW, h);

    // month label
    ctx.fillStyle = "#111111";
    ctx.font = "12px system-ui";
    ctx.fillText(months[i], x, padT + innerH + 18);
    ctx.fillStyle = "#3b82f6";
  }

  // max label
  ctx.fillStyle = "#111111";
  ctx.font = "12px system-ui";
  ctx.fillText(String(maxV), 8, padT + 12);
}

function renderTable(rows) {
  const tb = el("historyRows");
  tb.innerHTML = "";

  for (const r of rows) {
    const tr = document.createElement("tr");
    tr.style.cursor = "pointer";

    tr.innerHTML = `
      <td>${escapeCSV(r.timestamp || "")}</td>
      <td>${escapeCSV(r.name || "")}</td>
      <td>${escapeCSV(r.date || "")}</td>
      <td>${escapeCSV(r.address || "")}</td>
      <td>${escapeCSV(r.contact || "")}</td>
      <td>${escapeCSV(r.services || "")}</td>
      <td>${escapeCSV(r.addons || "")}</td>
      <td>${escapeCSV(r.therapist || "")}</td>
      <td>${escapeCSV(r.timestart || "")}</td>
      <td>${escapeCSV(r.conditions || "")}</td>
      <td>${escapeCSV(r.sigFile || "")}</td>
      <td>${escapeCSV(r.photoFile || "")}</td>
    `;

    tr.addEventListener("click", () => openDetails(r));
    tr.addEventListener("dblclick", () => openDetails(r));
    tb.appendChild(tr);
  }

  el("mgrMsg").textContent = `Total records: ${rows.length}`;
}

function showModal(id, on) {
  const m = el(id);
  if (!m) return;
  if (on) m.classList.add("show");
  else m.classList.remove("show");
}

function kvRow(k, v) {
  const tr = document.createElement("tr");
  const td1 = document.createElement("td");
  const td2 = document.createElement("td");
  td1.textContent = k;
  td2.textContent = v ?? "";
  tr.appendChild(td1);
  tr.appendChild(td2);
  return tr;
}

function openDetails(r) {
  selected = r;

  const kv = el("detailKv");
  kv.innerHTML = "";
  kv.appendChild(kvRow("Timestamp", r.timestamp || ""));
  kv.appendChild(kvRow("Name", r.name || ""));
  kv.appendChild(kvRow("Date", r.date || ""));
  kv.appendChild(kvRow("Address", r.address || ""));
  kv.appendChild(kvRow("Contact", r.contact || ""));
  kv.appendChild(kvRow("Services", r.services || ""));
  kv.appendChild(kvRow("Add-Ons", r.addons || ""));
  kv.appendChild(kvRow("Therapist", r.therapist || ""));
  kv.appendChild(kvRow("Time Start", r.timestart || ""));
  kv.appendChild(kvRow("Conditions", r.conditions || ""));
  kv.appendChild(kvRow("Signature File", r.sigFile || ""));
  kv.appendChild(kvRow("Photo File", r.photoFile || ""));

  const photoBytes = toUint8(r.photoBytes);
  const sigBytes = toUint8(r.sigBytes);

  const photoUrl = URL.createObjectURL(new Blob([photoBytes], { type: "image/jpeg" }));
  const sigUrl = URL.createObjectURL(new Blob([sigBytes], { type: "image/png" }));

  el("detailPhoto").src = photoUrl;
  el("detailSig").src = sigUrl;

  el("btnDownloadPhoto").onclick = () => downloadBytes(photoBytes, r.photoFile || "photo.jpg", "image/jpeg");
  el("btnDownloadSig").onclick = () => downloadBytes(sigBytes, r.sigFile || "signature.png", "image/png");

  el("btnExportZipOne").onclick = async () => {
    const header = "Name,Date,Address,Contact,Services,AddOns,Therapist,TimeStart,Conditions,SignaturePath,PhotoPath,Timestamp\n";
    const csv = header + [
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
    ].join(",") + "\n";

    const files = [
      { name: "ThaiBoran_Waiver_One.csv", data: new TextEncoder().encode(csv) },
      { name: `signatures/${r.sigFile || "signature.png"}`, data: sigBytes },
      { name: `photos/${r.photoFile || "photo.jpg"}`, data: photoBytes }
    ];

    const zipBytes = await buildZip(files);
    downloadBytes(zipBytes, `ThaiBoran_One_${stampForFile()}.zip`, "application/zip");
  };

  showModal("detailModal", true);
}

async function loadRows() {
  const rows = await dbGetAll();
  rows.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  cachedRows = rows;
  updateSalesYearList();
  renderTable(rows);
}

async function exportCsvOnly() {
  const rows = await dbGetAll();
  rows.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

  const header = "Name,Date,Address,Contact,Services,AddOns,Therapist,TimeStart,Conditions,SignaturePath,PhotoPath,Timestamp\n";
  let csv = header;

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
    ].join(",") + "\n";
  }

  downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), `ThaiBoran_Export_${stampForFile()}.csv`);
}

async function exportZipAll() {
  const rows = await dbGetAll();
  rows.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

  const header = "Name,Date,Address,Contact,Services,AddOns,Therapist,TimeStart,Conditions,SignaturePath,PhotoPath,Timestamp\n";
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
    ].join(",") + "\n";

    files.push({ name: `signatures/${r.sigFile}`, data: toUint8(r.sigBytes) });
    files.push({ name: `photos/${r.photoFile}`, data: toUint8(r.photoBytes) });
  }

  files.unshift({ name: "ThaiBoran_Waivers.csv", data: new TextEncoder().encode(csv) });

  const zipBytes = await buildZip(files);
  downloadBytes(zipBytes, `ThaiBoran_Export_${stampForFile()}.zip`, "application/zip");
}

function setupOfflineHint() {
  const hint = el("offlineHint");
  function refresh() {
    const online = navigator.onLine;
    hint.classList.toggle("hidden", online);
    if (!online) hint.textContent = "You are offline. This app still works. Data is saved locally.";
  }
  window.addEventListener("online", refresh);
  window.addEventListener("offline", refresh);
  refresh();
}

function unlockIfPinOk(pin) {
  if (pin === MANAGER_PIN) {
    hideBlock("pinCard");
    showBlock("mgrCard");
    loadRows();
    return true;
  }
  return false;
}

function init() {
  setupOfflineHint();

    // Always start locked, force PIN only (hard reset)
  el("pinCard").style.display = "block";
  el("mgrCard").style.display = "none";

  el("pinMsg").textContent = "";
  el("pin").value = "";
  el("pin").focus();

  el("btnUnlock").addEventListener("click", () => {
    const pin = (el("pin").value || "").trim();
    if (!unlockIfPinOk(pin)) {
      el("pinMsg").textContent = "Wrong PIN";
      el("pin").value = "";
      el("pin").focus();
    }
  });

  el("pin").addEventListener("keydown", (e) => {
    if (e.key === "Enter") el("btnUnlock").click();
  });

    el("btnExportCsv").addEventListener("click", exportCsvOnly);

  // Tabs
  el("tabHistory").addEventListener("click", () => setSalesTab(false));
  el("tabSales").addEventListener("click", () => setSalesTab(true));
  el("tabHint").textContent = "History view";

  // Sales filters
  el("btnSalesApply").addEventListener("click", renderSales);
      el("btnSalesClear").addEventListener("click", () => {
    el("salesYear").value = "";
    el("salesDay").value = "";
    el("salesMonth").value = "";
    if (el("salesFrom")) el("salesFrom").value = "";
    if (el("salesTo")) el("salesTo").value = "";
    renderSales();
  });

  // Price control
  if (localStorage.getItem(PRICE_LOCKED_KEY) === null) setPricesLocked(true);

  el("btnPricesEdit").addEventListener("click", () => {
    if (!confirm("Unlock prices for editing?")) return;
    setPricesLocked(false);
    renderPriceEditor();
  });

  el("btnPricesSaveLock").addEventListener("click", () => {
    if (!confirm("Save prices and lock? New prices apply starting today.")) return;
    saveAndLockPrices();
  });

  el("btnClearAll").addEventListener("click", async () => {
    if (!confirm("Clear all saved submissions on this iPad?")) return;
    await dbClear();
    await loadRows();
    alert("Saved data cleared");
  });

  el("btnCloseDetail").addEventListener("click", () => showModal("detailModal", false));
el("btnPrintDetail").addEventListener("click", () => {
  window.print();
});
el("btnBackToList").addEventListener("click", () => showModal("detailModal", false));
}

init();

