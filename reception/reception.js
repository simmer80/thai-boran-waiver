// Front desk — the waivers this iPad captured, where add-ons a client asked
// for mid-session are added afterwards.
//
// The client-photo switch used to be here too. It moved to the Waiver Form
// screen, beside the photo step, because that is where a client says no —
// having it in a settings tab behind a login meant it was never used. There
// is exactly one copy of it now; this file no longer knows about photos.
//
// Add-ons edited here go STRAIGHT TO THE SERVER (PATCH /api/sessions/:id),
// which re-prices the sale and re-derives its hours. They used to be written
// only to this iPad's database and pushed by a background sync that this page
// never even loaded, so the correction sat here invisibly and Sessions &
// sales never learned about it.

'use strict';

(function () {
  const DB_NAME = 'thai_boran_waiver_db';
  const STORE = 'submissions';

  const ADD_ONS = ['Unscented Oil', 'Scented Oil', 'Herbal Hotpads', 'Ventosa', 'Hot Stone', 'Half Hour', '1 hr extra massage'];

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

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

  // The list is the SERVER’s, not this device’s.
  //
  // Update this device’s own copy of a waiver, if it has one. A record that
  // was captured on another iPad has nothing here to update, and must not be
  // given a hollow one.
  async function touchLocal(rec, addons, synced) {
    try {
      const mine = (await dbAll()).find((x) => x.id === rec.id);
      if (!mine) return;
      await dbPut({ ...mine, addons, updatedAt: Date.now(), synced });
    } catch (_) { /* the server already has the change */ }
  }

  // It used to read only this iPad’s IndexedDB, which meant a receptionist
  // on a second tablet — or on the same one after a reinstall — could not
  // add a mid-session add-on to a waiver she had just taken on the other
  // device: the sale simply was not in her list. The write path was already
  // server-first, so only the reading half was wrong.
  //
  // Offline it falls back to this device’s own copies and SAYS so, rather
  // than showing a short list that looks like the whole truth.
  async function renderRecords() {
    const host = $('localPanels');
    if (!host) return;
    const note = $('localMsg');

    const from = new Date(Date.now() - 13 * 86400000).toISOString().slice(0, 10);
    const to = new Date().toISOString().slice(0, 10);
    const site = (window.TB && TB.deviceSite()) || 'panacan';

    let rows = [];
    let source = 'server';
    try {
      const out = await TB.api('/api/sessions?' + new URLSearchParams({ site, from, to }).toString());
      rows = (out.records || []).map((r) => ({
        id: r.id, siteId: r.siteId, date: r.date,
        name: r.customer, services: r.service, addons: r.addons,
        createdAt: r.createdAt,
      }));
    } catch (e) {
      source = e.offline ? 'offline' : 'error';
      rows = (await dbAll()).map((r) => ({
        id: r.id, siteId: r.siteId, date: r.date,
        name: r.name, services: r.services, addons: r.addons, createdAt: r.createdAt,
      }));
    }
    rows.sort((x, y) => String(y.date).localeCompare(String(x.date)) || (y.createdAt || 0) - (x.createdAt || 0));
    rows = rows.slice(0, 60);

    if (note) {
      note.className = source === 'server' ? 'muted' : 'warn';
      note.textContent = source === 'server'
        ? 'Last 14 days, from the server.'
        : 'Cannot reach the server — showing only what this iPad has. Some waivers may be missing.';
    }

    host.innerHTML = `
      <div class="tableWrap" style="max-height:340px;overflow:auto;">
        <table>
          <thead><tr><th>Date</th><th>Name</th><th>Service</th><th>Add-Ons</th><th></th></tr></thead>
          <tbody>${rows.map((r) => `<tr><td>${esc(r.date)}</td><td>${esc(r.name)}</td>
            <td>${esc(r.services)}</td><td>${esc(r.addons)}</td>
            <td><button class="btn rEdit" data-id="${esc(r.id)}">Add add-ons</button></td></tr>`).join('') ||
            '<tr><td colspan="5" class="muted">No waivers in the last 14 days.</td></tr>'}
          </tbody>
        </table>
      </div>
      <div id="rDetail"></div>`;

    // The editor needs the row it is editing; keep them to hand.
    const byId = new Map(rows.map((r) => [r.id, r]));

    host.querySelectorAll('.rEdit').forEach((b) =>
      b.addEventListener('click', async () => {
        // From the LIST, which may hold rows this device never captured.
        // Looking it up in the local database again would silently do
        // nothing for any waiver taken on another iPad.
        const rec = byId.get(b.dataset.id);
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
            // Keep this iPad’s own copy in step for the offline views — but
            // only if it HAS one. Writing a stub for a waiver captured on
            // another device would invent a local record with no photo or
            // signature, which the export would then present as complete.
            await touchLocal(rec, addons, true);
            msg.className = 'ok';
            msg.textContent = 'Saved ✓ — the sale and its total are updated everywhere.';
            // renderRecords() rebuilds the list and destroys the message
            // element with it, so the receptionist saw the confirmation for
            // a few milliseconds. Say it somewhere that survives the refresh.
            const note = $('localMsg');
            await renderRecords();
            if (note) { note.className = 'ok'; note.textContent = 'Add-on saved — the price, the hours and the day’s totals are updated.'; }
          } catch (e) {
            // Offline or the server refused: keep it locally and let the sync
            // queue carry it, but say so instead of pretending it worked.
            await touchLocal(rec, addons, false);
            msg.className = 'err';
            msg.textContent = e.offline
              ? 'Saved on this iPad. It will reach the records when the WiFi is back.'
              : 'Saved on this iPad, but the server said: ' + e.message;
            if (window.TBSync) TBSync.syncNow();
            const note2 = $('localMsg');
            const said = msg.textContent;
            await renderRecords();
            if (note2) { note2.className = 'err'; note2.textContent = said; }
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
      const b = $('btnEditRecords');
      if (!b) return;
      // A reveal button that cannot un-reveal leaves no way back: it now
      // says what the next tap does, and does it.
      b.addEventListener('click', async () => {
        const host = $('localPanels');
        const showing = b.getAttribute('aria-expanded') === 'true';
        if (showing) {
          host.innerHTML = '';
          b.setAttribute('aria-expanded', 'false');
          b.textContent = 'Show the list';
          return;
        }
        b.disabled = true;
        try {
          await renderRecords();
          b.setAttribute('aria-expanded', 'true');
          b.textContent = 'Hide the list';
        } finally {
          b.disabled = false;
        }
      });
    });
  }

  window.TBReception = { init };
})();
