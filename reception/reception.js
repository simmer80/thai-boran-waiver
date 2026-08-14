// Receptionist tab — LOCAL device controls (photo capture toggles, price
// list, quick add-on corrections). These moved here from the Waiver Form
// page. They read/write the same localStorage keys and IndexedDB the waiver
// form uses, so they keep working with no connection; PIN-gated like before.

'use strict';

(function () {
  const RECEPTION_PIN = '2512';
  const PHOTO_ONE_KEY = 'tb_photo_capture_enabled';
  const PHOTO_PERM_KEY = 'tb_photo_capture_permanent_disabled';
  const PRICE_SETS_KEY = 'tb_price_sets_v1';
  const PRICE_LOCKED_KEY = 'tb_price_locked_v1';
  const DB_NAME = 'thai_boran_waiver_db';
  const STORE = 'submissions';

  const SERVICES = [
    '1hr Thai Back Massage', '1hr Thai Body Massage', '1hr Thai Foot Massage', '1hr Thai Swedish Massage',
    '1hr Swedish Massage', '1hr Thai Aromatherapy Massage',
    'Combo 1', 'Combo 2', 'Combo 3', 'Combo 4', 'Combo 5', 'Combo 6', 'Combo 7', 'Combo 8',
  ];
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

  // ---------------------------------------------------------------- prices
  function loadPriceSets() {
    try { const a = JSON.parse(localStorage.getItem(PRICE_SETS_KEY) || '[]'); return Array.isArray(a) ? a : []; }
    catch { return []; }
  }
  function ensureInitialPriceSet() {
    const sets = loadPriceSets();
    if (sets.length) return sets;
    const services = {}, addons = {};
    SERVICES.forEach((n) => (services[n] = 0));
    ADD_ONS.forEach((n) => (addons[n] = 0));
    const initial = [{ effectiveFrom: '1970-01-01', services, addons }];
    localStorage.setItem(PRICE_SETS_KEY, JSON.stringify(initial));
    return initial;
  }
  const pricesLocked = () => localStorage.getItem(PRICE_LOCKED_KEY) !== '0';

  function renderPrices() {
    const sets = ensureInitialPriceSet();
    const cur = sets.slice().sort((a, b) => String(a.effectiveFrom).localeCompare(String(b.effectiveFrom))).at(-1);
    const locked = pricesLocked();
    const row = (type, name, val) => `<tr><td>${esc(name)}</td><td>${type === 's' ? 'Service' : 'Add-On'}</td>
      <td><input data-pt="${type}" data-pn="${esc(name)}" type="number" step="1" min="0" value="${val}" style="width:110px" ${locked ? 'disabled' : ''} /></td></tr>`;
    $('localPanels').innerHTML = `<div class="panel" style="background:#f8fafc;">
      <b>Price list</b> — ${locked ? `locked (effective from ${esc(cur.effectiveFrom)})` : 'editing — change prices then Save and Lock'}
      <div class="tableWrap" style="max-height:280px;overflow:auto;margin-top:8px;"><table>
        <thead><tr><th>Item</th><th>Type</th><th>Price</th></tr></thead><tbody>
        ${SERVICES.map((n) => row('s', n, cur.services[n] ?? 0)).join('')}
        ${ADD_ONS.map((n) => row('a', n, cur.addons[n] ?? 0)).join('')}
        </tbody></table></div>
      <div class="row" style="margin-top:8px;">
        <button id="pEdit" class="btn" ${locked ? '' : 'disabled'}>Edit Prices</button>
        <button id="pSaveLock" class="btn primary" ${locked ? 'disabled' : ''}>Save and Lock</button>
        <span class="muted">New prices apply from today onward; older waivers keep their dated prices.</span>
      </div></div>`;
    $('pEdit').addEventListener('click', () => {
      if (!confirm('Unlock prices for editing?')) return;
      localStorage.setItem(PRICE_LOCKED_KEY, '0');
      renderPrices();
    });
    $('pSaveLock').addEventListener('click', () => {
      if (!confirm('Save prices and lock? New prices apply starting today.')) return;
      const services = { ...cur.services }, addons = { ...cur.addons };
      $('localPanels').querySelectorAll('input[data-pt]').forEach((inp) => {
        const v = Number(inp.value) || 0;
        if (inp.dataset.pt === 's') services[inp.dataset.pn] = v;
        else addons[inp.dataset.pn] = v;
      });
      const d = new Date();
      const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      sets.push({ effectiveFrom: today, services, addons });
      localStorage.setItem(PRICE_SETS_KEY, JSON.stringify(sets));
      localStorage.setItem(PRICE_LOCKED_KEY, '1');
      renderPrices();
    });
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
    $('btnPrices').addEventListener('click', renderPrices);
    $('btnEditRecords').addEventListener('click', renderRecords);
  }

  window.TBReception = { init };
})();
