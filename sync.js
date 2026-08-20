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
// Photos and signatures used to stay on the iPad, which meant a lost, wiped
// or replaced tablet destroyed them permanently and no other device could
// ever show them. They now ride up too, but as a SEPARATE, SECOND step:
//
//   1. the record syncs, exactly as before — this is what must never fail;
//   2. the images upload one waiver at a time, retrying on later passes.
//
// Splitting them that way means a big photo on a slow line can never hold up
// or fail a batch of records, and an image that will not upload today simply
// tries again tomorrow. Uploads are idempotent server-side, so a retry after
// an ambiguous failure costs nothing.

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
      siteId: r.siteId || (window.TB && TB.deviceSite()) || 'panacan',
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
      // The waiver's own content. These were captured and then dropped at
      // this line: the client's declared MEDICAL CONDITIONS never left the
      // tablet, which is the part of a waiver that actually matters.
      address: r.address || '',
      contact: r.contact || '',
      conditions: r.conditions || '',
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

      // Images LAST and in their own try: the records are already safely
      // on the server by this point, and nothing below may undo that.
      try { await syncMedia(); } catch (_) { /* retries on the next pass */ }
    } catch (e) {
      // offline / asleep / not logged in — records stay queued, nothing lost
      lastResult = e.unauthorized ? 'not logged in' : e.offline ? 'offline' : e.message;
      if (e.unauthorized) setChip('Sign in to sync', 'warn');
    } finally {
      syncing = false;
      await refreshChip();
      if (lastResult === 'not logged in') setChip('Sign in (Front desk tab) to sync', 'warn');
    }
  }

  // ------------------------------------------------------- images
  // How many waivers on this iPad still have images the server has never
  // seen. Shown to the receptionist so "everything is safe" is a fact she
  // can check, not a promise.
  async function pendingMediaCount() {
    const all = await getAll();
    return all.filter(needsMedia).length;
  }

  function needsMedia(r) {
    if (r.mediaSynced) return false;
    const hasPhoto = r.photoBlob instanceof Blob || (Array.isArray(r.photoBytes) && r.photoBytes.length);
    const hasSig = Array.isArray(r.sigBytes) && r.sigBytes.length;
    return !!(hasPhoto || hasSig);
  }

  function bytesToBase64(bytes) {
    // Chunked: String.fromCharCode.apply on a whole photo blows the stack.
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
  }

  async function photoBase64(r) {
    let blob = null;
    if (r.photoBlob instanceof Blob) blob = r.photoBlob;
    else if (Array.isArray(r.photoBytes) && r.photoBytes.length) {
      blob = new Blob([new Uint8Array(r.photoBytes)], { type: 'image/jpeg' });
    }
    if (!blob) return null;
    // Re-compress for the wire. The copy kept on this iPad is untouched;
    // this only decides what the data repo has to carry for ever.
    if (window.TBImage && TBImage.downscaleToJpegBlob) {
      try { blob = await TBImage.downscaleToJpegBlob(blob, 900, 0.72); } catch (_) { /* send as-is */ }
    }
    return bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
  }

  // One waiver at a time, deliberately: a single failure must cost one
  // upload, not a batch, and a slow line must not stall the queue.
  async function syncMedia() {
    const all = await getAll();
    const todo = all.filter(needsMedia);
    if (!todo.length) return 0;
    let done = 0;
    for (const r of todo) {
      try {
        const photo = await photoBase64(r);
        const signature = Array.isArray(r.sigBytes) && r.sigBytes.length
          ? bytesToBase64(new Uint8Array(r.sigBytes))
          : null;
        if (!photo && !signature) continue;
        await TB.api('/api/sessions/' + encodeURIComponent(r.id) + '/media', {
          method: 'PUT',
          body: { date: r.date, photo, signature },
        });
        await putAll([{ ...r, mediaSynced: true, mediaSyncedAt: Date.now() }]);
        done += 1;
      } catch (e) {
        // 4xx means this one will never succeed as-is (wrong format, too
        // big): stop re-sending it every pass, but keep the local copy.
        if (e.status >= 400 && e.status < 500 && !e.unauthorized) {
          await putAll([{ ...r, mediaSynced: true, mediaRejected: e.message || 'rejected' }]);
        } else {
          throw e;   // offline / asleep / auth — try the whole lot again later
        }
      }
    }
    return done;
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

  window.TBSync = { init, syncNow, refreshChip, pendingCount, pendingMediaCount, syncMedia, toServerRecord };
})();
