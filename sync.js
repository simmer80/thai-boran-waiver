// Online-first sync for waiver records.
//
// The server is the source of truth; the iPad writes to IndexedDB FIRST so
// waiver capture keeps working with no WiFi, then pushes immediately when
// online. Lost connection => records queue locally (synced:false) and are
// flushed automatically on reconnect. Idempotent by record id; a failed
// upload NEVER discards a local record — it just stays queued.
//
// Migration: records saved before this feature have no `synced` flag; they
// are treated as unsynced and uploaded on the first successful sync.
//
// Photos and signatures deliberately stay on the iPad (IndexedDB / manual
// export) — only the session/sales fields go to the server.

'use strict';

(function () {
  const DB_NAME = 'thai_boran_waiver_db';
  const DB_VERSION = 1;
  const STORE = 'submissions';
  let syncing = false;
  let lastResult = '';

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  function getAll() {
    return openDb().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const rq = tx.objectStore(STORE).getAll();
      rq.onsuccess = () => { db.close(); resolve(rq.result || []); };
      rq.onerror = () => { db.close(); reject(rq.error); };
    }));
  }
  function putAll(records) {
    return openDb().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const os = tx.objectStore(STORE);
      records.forEach((r) => os.put(r));
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    }));
  }

  // Waiver record -> server session record. Binary photo/signature stay local.
  function toServerRecord(r) {
    const user = window.TB && TB.cachedUser();
    return {
      id: r.id,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt || r.createdAt,
      date: r.date,
      timestamp: r.timestamp || '',
      timestart: r.timestart || '',
      customer: r.name || '',
      therapistName: r.therapist || '',
      therapistId: r.therapistId || '',
      receptionistId: r.receptionistId || (user ? user.uid : ''),
      receptionistName: r.receptionistName || (user ? user.name : ''),
      stubNumber: r.stubNumber || '',
      service: r.services || '',
      addons: r.addons || 'None',
      senior: !!r.senior,
      seniorId: r.seniorId || '',
      gross: r.priceGross ?? 0,
      discount: r.discountAmount ?? 0,
      net: r.priceNet ?? 0,
      paymentMethod: r.paymentMethod || 'cash',
      commission: r.commission ?? 0,
    };
  }

  function setChip(text, cls) {
    const chip = document.getElementById('tbSyncChip');
    if (!chip) return;
    chip.textContent = text;
    chip.className = 'tb-chip syncchip ' + (cls || '');
  }

  async function pendingCount() {
    const all = await getAll();
    return all.filter((r) => !r.synced).length;
  }

  async function refreshChip() {
    const n = await pendingCount().catch(() => 0);
    if (!navigator.onLine) return setChip(`Offline — ${n} waiting`, 'off');
    if (syncing) return setChip('Syncing…', '');
    if (n > 0) return setChip(`${n} to sync`, 'warn');
    setChip('All synced', 'ok');
  }

  // Push every unsynced record. Never removes local data.
  async function syncNow() {
    if (syncing) return;
    syncing = true;
    await refreshChip();
    try {
      if (!navigator.onLine) throw Object.assign(new Error('offline'), { offline: true });
      const all = await getAll();
      const unsynced = all.filter((r) => !r.synced);
      if (!unsynced.length) { lastResult = 'nothing to sync'; return; }

      // batch in chunks of 100
      for (let i = 0; i < unsynced.length; i += 100) {
        const chunk = unsynced.slice(i, i + 100);
        const out = await TB.api('/api/sessions/sync', {
          method: 'POST',
          body: { records: chunk.map(toServerRecord) },
        });
        const okIds = new Set(out.results.filter((x) => x.ok).map((x) => x.id));
        const now = Date.now();
        const updated = chunk
          .filter((r) => okIds.has(r.id))
          .map((r) => ({ ...r, synced: true, syncedAt: now }));
        if (updated.length) await putAll(updated);
      }
      lastResult = 'synced';
    } catch (e) {
      // offline / asleep / not logged in — records stay queued, nothing lost
      lastResult = e.unauthorized ? 'not logged in' : e.offline ? 'offline' : e.message;
      if (e.unauthorized) setChip('Sign in to sync', 'warn');
    } finally {
      syncing = false;
      await refreshChip();
      if (lastResult === 'not logged in') setChip('Sign in (Receptionist tab) to sync', 'warn');
    }
  }

  function init() {
    // status chip lives in the nav bar
    const nav = document.querySelector('.tb-nav');
    if (nav && !document.getElementById('tbSyncChip')) {
      const chip = document.createElement('span');
      chip.id = 'tbSyncChip';
      chip.className = 'tb-chip syncchip';
      chip.textContent = '…';
      nav.appendChild(chip);
      const btn = document.createElement('button');
      btn.id = 'tbSyncNow';
      btn.type = 'button';
      btn.className = 'tb-syncbtn';
      btn.textContent = 'Sync now';
      btn.addEventListener('click', () => syncNow());
      nav.appendChild(btn);
    }
    window.addEventListener('online', () => syncNow());
    window.addEventListener('offline', () => refreshChip());
    refreshChip();
    // push shortly after load (covers the first-sync migration of old records)
    if (navigator.onLine) setTimeout(() => syncNow(), 1500);
  }

  window.TBSync = { init, syncNow, refreshChip, pendingCount, toServerRecord };
})();
