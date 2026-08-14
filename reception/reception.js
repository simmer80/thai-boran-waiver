// Receptionist tab — LOCAL device controls (photo capture toggles, price
// list, quick add-on corrections). These moved here from the Waiver Form
// page. They read/write the same localStorage keys and IndexedDB the waiver
// form uses, so they keep working with no connection; PIN-gated like before.

'use strict';

(function () {
  const RECEPTION_PIN = '2512';
  const PHOTO_ONE_KEY = 'tb_photo_capture_enabled';
  const PHOTO_PERM_KEY = 'tb_photo_capture_permanent_disabled';
  const DB_NAME = 'thai_boran_waiver_db';
  const STORE = 'submissions';

  const ADD_ONS = ['Unscented Oil', 'Scented Oil', 'Herbal Hotpads', 'Ventosa', 'Hot Stone', 'Half Hour', '1 hr extra massage'];

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // ------------------------------------------------------------ photo flags
  const oneOn = () => localStorage.getItem(PHOTO_ONE_KEY) !== '0';
  const permOff = () => localStorage.getItem(PHOTO_PERM_KEY) === '1';

  function photoModeText() {
    if (permOff()) return 'Photo capture is OFF for ALL clients (permanent)';
    if (!oneOn()) return 'Photo capture is OFF for this client only (reverts after next submit)';
    return 'Photo capture is ON';
  }

  function refreshButtons() {
    const one = $('btnTogglePhotoCapture');
    const perm = $('btnTogglePhotoPermanent');
    one.textContent = oneOn() ? 'This client photo: Enabled' : 'This client photo: Disabled (one-off)';
    one.classList.toggle('toggle-on', oneOn());
    one.classList.toggle('toggle-off', !oneOn());
    perm.textContent = permOff() ? 'Disable photo permanently: ON' : 'Disable photo permanently: OFF';
    perm.classList.toggle('toggle-off', permOff());
    perm.classList.toggle('toggle-on', !permOff());
    const st = $('photoModeStatus');
    st.textContent = photoModeText();
    st.style.color = (!permOff() && oneOn()) ? '#0a7a2a' : '#b00020';
    st.style.fontWeight = '700';
  }

  // -------------------------------------------- local records (add add-ons)
  function dbAll() {
    return new Promise((resolve, reject) => {
      const q = indexedDB.open(DB_NAME, 1);
      q.onupgradeneeded = () => { const d = q.result; if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: 'id' }); };
      q.onsuccess = () => { const d = q.result; const t = d.transaction(STORE, 'readonly'); const g = t.objectStore(STORE).getAll();
        g.onsuccess = () => { d.close(); resolve(g.result || []); }; g.onerror = () => { d.close(); reject(g.error); }; };
      q.onerror = () => reject(q.error);
    });
  }
  function dbPut(rec) {
    return new Promise((resolve, reject) => {
      const q = indexedDB.open(DB_NAME, 1);
      q.onsuccess = () => { const d = q.result; const t = d.transaction(STORE, 'readwrite'); t.objectStore(STORE).put(rec);
        t.oncomplete = () => { d.close(); resolve(); }; t.onerror = () => { d.close(); reject(t.error); }; };
      q.onerror = () => reject(q.error);
    });
  }

  async function renderRecords() {
    const rows = (await dbAll()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 60);
    $('localPanels').innerHTML = `<div class="panel" style="background:#f8fafc;">
      <b>Local records — add extra add-ons</b>
      <div class="muted">Existing add-ons are locked; you can only add new ones (e.g. the client asked for "1 hr extra massage" mid-session). The change syncs to the server automatically.</div>
      <div class="tableWrap" style="max-height:320px;overflow:auto;margin-top:8px;"><table>
        <thead><tr><th>Date</th><th>Name</th><th>Service</th><th>Add-Ons</th><th></th></tr></thead>
        <tbody>${rows.map((r) => `<tr><td>${esc(r.date)}</td><td>${esc(r.name)}</td>
          <td>${esc(r.services)}</td><td>${esc(r.addons)}</td>
          <td><button class="btn rEdit" data-id="${esc(r.id)}">Add add-ons</button></td></tr>`).join('') ||
          '<tr><td colspan="5" class="muted">No local records.</td></tr>'}
        </tbody></table></div>
      <div id="rDetail"></div></div>`;
    $('localPanels').querySelectorAll('.rEdit').forEach((b) =>
      b.addEventListener('click', async () => {
        const rec = (await dbAll()).find((x) => x.id === b.dataset.id);
        if (!rec) return;
        const existing = new Set(String(rec.addons || '').split(';').map((s) => s.trim()).filter((x) => x && x.toLowerCase() !== 'none'));
        $('rDetail').innerHTML = `<div style="margin-top:10px;"><b>${esc(rec.name)} — ${esc(rec.date)}</b>
          <div class="checks" style="margin-top:6px;">${ADD_ONS.map((a) => `<label class="check">
            <input type="checkbox" data-a="${esc(a)}" ${existing.has(a) ? 'checked disabled' : ''} /> ${esc(a)}</label>`).join('')}</div>
          <div class="row" style="margin-top:8px;"><button id="rSave" class="btn primary">Save</button><span id="rMsg2"></span></div></div>`;
        $('rSave').addEventListener('click', async () => {
          const picked = new Set(existing);
          let added = 0;
          $('rDetail').querySelectorAll('input[data-a]:not(:disabled)').forEach((cb) => {
            if (cb.checked && !picked.has(cb.dataset.a)) { picked.add(cb.dataset.a); added++; }
          });
          if (!added) { $('rMsg2').textContent = 'No new add-ons selected.'; return; }
          const upd = { ...rec, addons: [...picked].join('; ') || 'None', updatedAt: Date.now(), synced: false };
          await dbPut(upd);
          if (window.TBSync) { try { TBSync.syncNow(); } catch (_) {} }
          renderRecords();
        });
      }));
  }

  // ------------------------------------------------------------------ init
  function unlockLocal() {
    $('rcPin').value = '';
    $('rcPinMsg').textContent = '';
    $('localLocked').classList.add('hidden');
    $('localBody').classList.remove('hidden');
    refreshButtons();
  }

  function init() {
    // Primary unlock: a server-verified login (any role) — no PIN needed.
    document.addEventListener('tb:authed', unlockLocal);

    // Offline fallback only: the device PIN, for when the server cannot
    // verify the login (no WiFi).
    $('rcUnlock').addEventListener('click', () => {
      if ($('rcPin').value.trim() !== RECEPTION_PIN) {
        $('rcPinMsg').textContent = 'Wrong PIN.';
        $('rcPin').value = '';
        return;
      }
      unlockLocal();
    });
    $('rcPin').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('rcUnlock').click(); });
    $('rcLock').addEventListener('click', () => {
      $('localBody').classList.add('hidden');
      $('localLocked').classList.remove('hidden');
      $('localPanels').innerHTML = '';
    });
    $('btnTogglePhotoCapture').addEventListener('click', () => {
      localStorage.setItem(PHOTO_ONE_KEY, oneOn() ? '0' : '1');
      refreshButtons();
    });
    $('btnTogglePhotoPermanent').addEventListener('click', () => {
      localStorage.setItem(PHOTO_PERM_KEY, permOff() ? '0' : '1');
      refreshButtons();
    });
    $('btnEditRecords').addEventListener('click', renderRecords);
  }

  window.TBReception = { init };
})();
