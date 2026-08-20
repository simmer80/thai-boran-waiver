// Front desk — the two device-local things, kept clearly apart:
//
//   Client photo    what the Waiver Form tab does on THIS iPad. Three states,
//                   one tap each, and the current one is always on screen.
//   Local records   the waivers this iPad captured, where add-ons a client
//                   asked for mid-session are added afterwards.
//
// Both used to sit in one PIN-gated box called "This device (works offline)",
// which is why nobody could find the photo switch.
//
// Add-ons edited here go STRAIGHT TO THE SERVER (PATCH /api/sessions/:id),
// which re-prices the sale and re-derives its hours. They used to be written
// only to this iPad's database and pushed by a background sync that this page
// never even loaded, so the correction sat here invisibly and Sessions &
// sales never learned about it.

'use strict';

(function () {
  const RECEPTION_PIN = '2512';
  const PHOTO_ONE_KEY = 'tb_photo_capture_enabled';
  const PHOTO_PERM_KEY = 'tb_photo_capture_permanent_disabled';
  const DB_NAME = 'thai_boran_waiver_db';
  const STORE = 'submissions';

  const ADD_ONS = ['Unscented Oil', 'Scented Oil', 'Herbal Hotpads', 'Ventosa', 'Hot Stone', 'Half Hour', '1 hr extra massage'];

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // ------------------------------------------------------------ photo flags
  const oneOn = () => localStorage.getItem(PHOTO_ONE_KEY) !== '0';
  const permOff = () => localStorage.getItem(PHOTO_PERM_KEY) === '1';

  // Exactly one of three states is true at any moment.
  function photoState() {
    if (permOff()) return 'off';
    if (!oneOn()) return 'skipNext';
    return 'on';
  }

  const PHOTO_TEXT = {
    on: {
      badge: 'Photos ON', cls: 'ok',
      says: 'Every client is photographed on the Waiver Form tab.',
    },
    skipNext: {
      badge: 'Skipping the next client', cls: 'warn',
      says: 'The next client will not be photographed. It goes back to ON by itself straight after.',
    },
    off: {
      badge: 'Photos OFF', cls: 'err',
      says: 'No client is being photographed, and it stays that way — even after the iPad restarts — until you turn it back on.',
    },
  };

  function renderPhotoBox() {
    const host = $('photoBox');
    if (!host) return;
    const st = photoState();
    const t = PHOTO_TEXT[st];
    host.innerHTML = `
      <div class="photoState ${t.cls}">
        <div class="photoBadge">${esc(t.badge)}</div>
        <div class="photoSays">${esc(t.says)}</div>
      </div>
      <div class="photoChoices">
        <button type="button" class="choice${st === 'on' ? ' on' : ''}" data-photo="on">
          <span class="ct">Photograph every client</span>
          <span class="cs">The normal setting</span>
        </button>
        <button type="button" class="choice${st === 'skipNext' ? ' on' : ''}" data-photo="skipNext">
          <span class="ct">Skip the next client only</span>
          <span class="cs">One client, then back to normal by itself</span>
        </button>
        <button type="button" class="choice${st === 'off' ? ' on' : ''}" data-photo="off">
          <span class="ct">Stop photographing until I say so</span>
          <span class="cs">Stays off across restarts</span>
        </button>
      </div>`;
    host.querySelectorAll('[data-photo]').forEach((b) =>
      b.addEventListener('click', () => setPhotoState(b.dataset.photo)));
  }

  function setPhotoState(next) {
    if (next === 'on') {
      localStorage.setItem(PHOTO_ONE_KEY, '1');
      localStorage.setItem(PHOTO_PERM_KEY, '0');
    } else if (next === 'skipNext') {
      localStorage.setItem(PHOTO_ONE_KEY, '0');
      localStorage.setItem(PHOTO_PERM_KEY, '0');
    } else {
      localStorage.setItem(PHOTO_PERM_KEY, '1');
    }
    renderPhotoBox();
    // The Waiver Form tab reads these keys when it renders its own banner.
    document.dispatchEvent(new CustomEvent('tb:photo-mode', { detail: { state: next } }));
  }

  // -------------------------------------------- local records (add add-ons)
  function dbAll() {
    return new Promise((resolve, reject) => {
      const q = indexedDB.open(DB_NAME, 1);
      q.onupgradeneeded = () => {
        const d = q.result;
        if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: 'id' });
      };
      q.onsuccess = () => {
        const d = q.result;
        const t = d.transaction(STORE, 'readonly');
        const g = t.objectStore(STORE).getAll();
        g.onsuccess = () => { d.close(); resolve(g.result || []); };
        g.onerror = () => { d.close(); reject(g.error); };
      };
      q.onerror = () => reject(q.error);
    });
  }
  function dbPut(rec) {
    return new Promise((resolve, reject) => {
      const q = indexedDB.open(DB_NAME, 1);
      q.onsuccess = () => {
        const d = q.result;
        const t = d.transaction(STORE, 'readwrite');
        t.objectStore(STORE).put(rec);
        t.oncomplete = () => { d.close(); resolve(); };
        t.onerror = () => { d.close(); reject(t.error); };
      };
      q.onerror = () => reject(q.error);
    });
  }

  async function renderRecords() {
    const host = $('localPanels');
    if (!host) return;
    const rows = (await dbAll()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 60);
    host.innerHTML = `
      <div class="tableWrap" style="max-height:340px;overflow:auto;">
        <table>
          <thead><tr><th>Date</th><th>Name</th><th>Service</th><th>Add-Ons</th><th></th></tr></thead>
          <tbody>${rows.map((r) => `<tr><td>${esc(r.date)}</td><td>${esc(r.name)}</td>
            <td>${esc(r.services)}</td><td>${esc(r.addons)}</td>
            <td><button class="btn rEdit" data-id="${esc(r.id)}">Add add-ons</button></td></tr>`).join('') ||
            '<tr><td colspan="5" class="muted">No waivers captured on this iPad yet.</td></tr>'}
          </tbody>
        </table>
      </div>
      <div id="rDetail"></div>`;

    host.querySelectorAll('.rEdit').forEach((b) =>
      b.addEventListener('click', async () => {
        const rec = (await dbAll()).find((x) => x.id === b.dataset.id);
        if (!rec) return;
        const existing = new Set(String(rec.addons || '')
          .split(';').map((s) => s.trim()).filter((x) => x && x.toLowerCase() !== 'none'));
        $('rDetail').innerHTML = `
          <div class="panel" style="background:#f8fafc;margin-top:10px;">
            <b>${esc(rec.name)} — ${esc(rec.date)}</b>
            <div class="muted">Add what the client asked for during the session.
              The price, the booked hours and the day's totals follow automatically.
              Existing add-ons cannot be removed here.</div>
            <div class="checks" style="margin-top:8px;">
              ${ADD_ONS.map((a) => `<label class="check">
                <input type="checkbox" data-a="${esc(a)}" ${existing.has(a) ? 'checked disabled' : ''} /> ${esc(a)}
              </label>`).join('')}
            </div>
            <div class="row" style="margin-top:10px;">
              <button id="rSave" class="btn primary">Save add-ons</button>
              <span id="rMsg2" role="status"></span>
            </div>
          </div>`;

        $('rSave').addEventListener('click', async () => {
          const btn = $('rSave');
          const msg = $('rMsg2');
          const picked = new Set(existing);
          let added = 0;
          $('rDetail').querySelectorAll('input[data-a]:not(:disabled)').forEach((cb) => {
            if (cb.checked && !picked.has(cb.dataset.a)) { picked.add(cb.dataset.a); added++; }
          });
          if (!added) { msg.className = 'err'; msg.textContent = 'Nothing new selected.'; return; }

          const addons = [...picked].join('; ') || 'None';
          btn.disabled = true;
          msg.className = 'muted';
          msg.textContent = 'Saving…';
          try {
            // The server is the authority: it re-prices the sale, re-derives
            // the hours, and stamps the audit trail. Doing this first means
            // Sessions & sales is right the moment this returns.
            await TB.api(`/api/sessions/${encodeURIComponent(rec.id)}?site=` +
              encodeURIComponent(rec.siteId || TB.deviceSite() || 'panacan'), {
              method: 'PATCH',
              body: { date: rec.date, fields: { addons }, via: 'add-ons, front desk' },
            });
            // Keep this iPad's own copy in step for the offline views.
            await dbPut({ ...rec, addons, updatedAt: Date.now(), synced: true });
            msg.className = 'ok';
            msg.textContent = 'Saved ✓ — the sale and its total are updated everywhere.';
            renderRecords();
          } catch (e) {
            // Offline or the server refused: keep it locally and let the sync
            // queue carry it, but say so instead of pretending it worked.
            await dbPut({ ...rec, addons, updatedAt: Date.now(), synced: false });
            msg.className = 'err';
            msg.textContent = e.offline
              ? 'Saved on this iPad. It will reach the records when the WiFi is back.'
              : 'Saved on this iPad, but the server said: ' + e.message;
            if (window.TBSync) TBSync.syncNow();
            renderRecords();
          } finally {
            btn.disabled = false;
          }
        });
      }));
  }

  // ------------------------------------------------------------------ init
  function init() {
    // The back office renders the device section; fill it when it appears.
    document.addEventListener('tb:device-section', () => {
      renderPhotoBox();
      const b = $('btnEditRecords');
      if (b) {
        b.addEventListener('click', () => {
          b.disabled = true;
          renderRecords().finally(() => { b.disabled = false; });
        });
      }
    });
  }

  window.TBReception = { init, photoState };
})();
