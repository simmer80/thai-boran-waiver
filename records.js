// Sales & history — the shared area both roles reach after signing in.
//
// One home for the three things that are about LOOKING at what happened
// rather than doing today's work:
//
//   Approved documents  the signed copies, straight from the immutable
//                       snapshots (this is their only home in the app —
//                       neither role's own tab carries a second copy of it)
//   Sales               takings for a period, from the SERVER records, so
//                       every device and both parlors agree
//   History             the individual sales behind those numbers
//
// Everything here is behind the login and behind the idle auto-lock: this
// screen must never be sitting open on a counter for a client to read.

'use strict';

(function () {
  const $ = (sel, root) => (root || document).querySelector(sel);
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const money0 = (n) => (Number(n) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const TYPE_LABELS = {
    'daily-commission': 'Therapist Daily Commission Report',
    'weekly-payroll': 'Therapist Weekly Commission Report',
    'weekly-sales': 'Sales Weekly Report',
    'main-office-daily-sales': 'Main Office Daily Sales Report',
  };
  const PDF_DOC = {
    'daily-commission': 'Therapist-Daily-Commission-Report',
    'weekly-payroll': 'Therapist-Weekly-Commission-Report',
    'weekly-sales': 'Sales-Weekly-Report',
    'main-office-daily-sales': 'Main-Office-Daily-Sales-Report',
  };
  const SITE_LABELS = { panacan: 'Panacan', 'airport-road': 'Airport Road' };
  const PDF_SITE = { panacan: 'Panacan', 'airport-road': 'AirportRoad' };
  const PAY_LABELS = { cash: 'Cash', 'bpi-qr': 'BPI (QR)', gcash: 'GCash', bpi: 'BPI (QR)' };

  const state = {
    user: null, site: '', tab: 'approved',
    sigUrl: '', subSigUrl: '',
  };

  const siteQ = () => 'site=' + encodeURIComponent(state.site);
  const siteBadge = (site, big) =>
    `<span class="site-badge${big ? ' big' : ''}">Thai Boran — ${esc(SITE_LABELS[site] || site || '?')}</span>`;

  function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function monthStart() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  }

  async function busy(btn, label, fn) {
    if (!btn || btn.disabled) return;
    const old = btn.textContent;
    btn.disabled = true;
    if (label) btn.textContent = label;
    try { return await fn(); } finally { btn.disabled = false; btn.textContent = old; }
  }

  // --------------------------------------------------------------- shell
  const TABS = [
    { id: 'approved', label: 'Approved documents', sub: 'The signed copies' },
    { id: 'sales', label: 'Sales', sub: 'Takings for a period' },
    { id: 'history', label: 'History', sub: 'The sales behind the numbers' },
    { id: 'device', label: 'This device', sub: 'Waivers captured here' },
  ];

  function render() {
    const mount = $('#records');
    if (!state.user) {
      mount.innerHTML = `
        <div class="panel" style="max-width:460px;margin:30px auto;text-align:center;">
          <h2 style="margin-top:0">Sign in to see sales &amp; history</h2>
          <p class="muted">This area holds takings and client records, so it is
             behind the same login as the rest of the back office.</p>
          <div class="row" style="justify-content:center;">
            <a class="btn primary" href="../reception/">Front desk</a>
            <a class="btn" href="../manager/">Manager</a>
          </div>
        </div>`;
      return;
    }
    mount.innerHTML = `
      <div class="boBar noprint">
        <div class="boWho">
          <div class="boWhoName">${esc(state.user.name)}</div>
          <div class="boWhoRole">${esc(state.user.role === 'manager' || state.user.role === 'admin' ? 'Manager' : 'Front desk')}</div>
        </div>
        <div class="boSite">
          <label for="rcSite">Parlor</label>
          <select id="rcSite">
            ${Object.entries(SITE_LABELS).map(([id, l]) =>
              `<option value="${id}" ${state.site === id ? 'selected' : ''}>${esc(l)}</option>`).join('')}
          </select>
        </div>
        <div class="boBarActions">
          <a class="btn" href="${state.user.role === 'manager' || state.user.role === 'admin' ? '../manager/' : '../reception/'}">Back to work</a>
          <button id="rcLock" class="btn">Lock now</button>
        </div>
      </div>
      <nav class="boNav noprint" role="tablist">
        ${TABS.map((t) => `
          <button role="tab" class="boNavItem${t.id === state.tab ? ' active' : ''}" data-tab="${t.id}"
            aria-selected="${t.id === state.tab}">
            <span class="l">${esc(t.label)}</span><span class="s">${esc(t.sub)}</span>
          </button>`).join('')}
      </nav>
      <div id="rcBody"></div>`;

    mount.querySelectorAll('.boNavItem').forEach((b) =>
      b.addEventListener('click', () => { state.tab = b.dataset.tab; render(); }));
    $('#rcSite').addEventListener('change', () => { state.site = $('#rcSite').value; render(); });
    $('#rcLock').addEventListener('click', () => TBIdleLock.lockNow());

    // The device tools are real markup on the page (they own a detail modal
    // and the export/ZIP machinery); the tabs just show or hide them.
    const dev = document.getElementById('deviceTools');
    if (dev) dev.classList.toggle('hidden', state.tab !== 'device');
    $('#rcBody').innerHTML = '';
    if (state.tab === 'approved') renderApproved();
    else if (state.tab === 'sales') renderSales();
    else if (state.tab === 'history') renderHistory();
  }

  // --------------------------------------------------- approved documents
  function renderApproved() {
    $('#rcBody').innerHTML = `
      <div class="panel">
        <div class="secHead">
          <h2>Approved documents</h2>
          <div class="muted">Every document the manager has signed off, for this
            parlor. Opening one shows the permanent copy exactly as it was
            approved — it can never change.</div>
        </div>
        <div class="row">
          <div><label for="arType">Document</label><select id="arType">
            <option value="">All documents</option>
            ${Object.entries(TYPE_LABELS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}
          </select></div>
          <div><label for="arFrom">Period from</label><input type="date" id="arFrom" /></div>
          <div><label for="arTo">Period to</label><input type="date" id="arTo" /></div>
          <button id="arApply" class="btn primary">Show</button>
          <span id="arMsg" class="muted" role="status"></span>
        </div>
        <div id="arList" style="margin-top:10px;"></div>
      </div>
      <div id="arView"></div>`;
    $('#arApply').addEventListener('click', () => busy($('#arApply'), 'Loading…', loadArchive));
    loadArchive();
  }

  const pdfName = (type, period, version) =>
    `ThaiBoran-${PDF_SITE[state.site] || state.site}_${PDF_DOC[type]}_${period}_approved_v${version}.pdf`;

  async function downloadBlob(getBlob, filename) {
    const blob = await getBlob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  async function loadArchive() {
    const msg = $('#arMsg');
    msg.className = 'muted'; msg.textContent = 'Loading…';
    const q = new URLSearchParams({ site: state.site });
    if ($('#arType').value) q.set('type', $('#arType').value);
    if ($('#arFrom').value) q.set('from', $('#arFrom').value);
    if ($('#arTo').value) q.set('to', $('#arTo').value);
    try {
      const out = await TB.api('/api/approved?' + q.toString());
      msg.textContent = out.total
        ? `${out.total} approved document(s)${out.truncated ? ` — showing the ${out.documents.length} most recent` : ''}`
        : '';
      $('#arList').innerHTML = out.documents.length
        ? `<div class="tableWrap"><table>
            <thead><tr><th>Document</th><th>Period</th><th>Ver.</th><th>Approved</th>
              <th>Approved by</th><th>Raw data input by</th><th></th></tr></thead>
            <tbody>${out.documents.map((d) => `<tr>
              <td>${esc(TYPE_LABELS[d.type] || d.type)}</td>
              <td>${esc(d.period)}</td><td>${esc(String(d.version))}</td>
              <td>${esc((d.approvedAt || '').slice(0, 10))}</td>
              <td>${esc(d.approvedByName)}${d.hasSignature ? ' <span title="Signed copy">✍</span>' : ''}</td>
              <td>${esc(d.rawDataInputBy)}</td>
              <td class="row" style="gap:6px;">
                <button class="btn primary arOpen" data-t="${esc(d.type)}" data-p="${esc(d.period)}" data-v="${d.version}">Open</button>
                <button class="btn arPdf" data-t="${esc(d.type)}" data-p="${esc(d.period)}" data-v="${d.version}">PDF</button>
              </td></tr>`).join('')}</tbody></table></div>`
        : '<span class="muted">Nothing approved for this parlor with these filters yet.</span>';

      $('#arList').querySelectorAll('.arOpen').forEach((b) =>
        b.addEventListener('click', () => busy(b, 'Opening…', () => openApproved(b.dataset.t, b.dataset.p, b.dataset.v))));
      $('#arList').querySelectorAll('.arPdf').forEach((b) =>
        b.addEventListener('click', () => busy(b, '…', async () => {
          try {
            await downloadBlob(
              () => TB.api(`/api/approved/${b.dataset.t}/${b.dataset.p}/${b.dataset.v}/pdf?` + siteQ()),
              pdfName(b.dataset.t, b.dataset.p, b.dataset.v)
            );
          } catch (e) { alert('PDF failed: ' + e.message); }
        })));
    } catch (e) {
      msg.className = 'err';
      msg.textContent = e.unauthorized ? 'Session expired — sign in again' : e.message;
      if (e.unauthorized) { state.user = null; render(); }
    }
  }

  function releaseSignatures() {
    for (const k of ['sigUrl', 'subSigUrl']) {
      if (state[k]) { URL.revokeObjectURL(state[k]); state[k] = ''; }
    }
  }

  async function openApproved(type, period, version) {
    const host = $('#arView');
    host.innerHTML = '<div class="panel muted">Opening the signed copy…</div>';
    try {
      const rep = (await TB.api(`/api/approved/${type}/${period}/${version}?` + siteQ())).report;
      releaseSignatures();
      const sigUrl = async (who) => {
        try {
          const path = `/api/approved/${type}/${period}/${version}/signature${who ? '/' + who : ''}?`;
          return URL.createObjectURL(await TB.api(path + siteQ()));
        } catch (_) { return ''; }
      };
      if (rep.approverSignaturePath) state.sigUrl = await sigUrl('');
      if (rep.submitterSignaturePath) state.subSigUrl = await sigUrl('submitter');

      host.innerHTML = `
        <div class="panel">
          <div class="row noprint" style="justify-content:space-between;align-items:center;">
            <div>${siteBadge(state.site, true)} <b>${esc(TYPE_LABELS[type] || type)}</b> — ${esc(period)} —
              version ${esc(String(version))} <span class="status-approved">APPROVED</span></div>
            <div class="row">
              <button id="arDocPdf" class="btn">Export PDF</button>
              <button id="arDocPrint" class="btn">Print</button>
              <button id="arDocClose" class="btn">Close</button>
            </div>
          </div>
          <div class="muted noprint" style="margin:6px 0;">The permanent copy saved at
            approval. A later correction becomes a new version and leaves this one untouched.</div>
          <div id="arDoc" style="margin-top:8px;"></div>
        </div>`;
      $('#arDoc').innerHTML = TBDoc.render(type, rep, rep.branchConfigSnapshot || {}, '../assets/thai_boran_logo.png',
        { signatureUrl: state.sigUrl, submitterSignatureUrl: state.subSigUrl });
      TBFit.attach($('#arDoc'), { refit: true });

      $('#arDocPdf').addEventListener('click', () => busy($('#arDocPdf'), 'Preparing…', async () => {
        try {
          await downloadBlob(() => TB.api(`/api/approved/${type}/${period}/${version}/pdf?` + siteQ()),
            pdfName(type, period, version));
        } catch (e) { alert('PDF failed: ' + e.message); }
      }));
      $('#arDocPrint').addEventListener('click', () => {
        document.body.classList.add('print-archive');
        const done = () => document.body.classList.remove('print-archive');
        window.addEventListener('afterprint', done, { once: true });
        window.print();
        setTimeout(done, 1000);
      });
      $('#arDocClose').addEventListener('click', () => { releaseSignatures(); host.innerHTML = ''; });
      host.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
      host.innerHTML = `<div class="panel err">${esc(e.message)}</div>`;
    }
  }

  // ---------------------------------------------------------------- sales
  // Straight from the server records — the same numbers the documents are
  // built from, for every device and both parlors. The old view read only
  // what THIS iPad happened to have captured, which is why a month could
  // show a single sale.
  function renderSales() {
    $('#rcBody').innerHTML = `
      <div class="panel">
        <div class="secHead">
          <h2>Sales</h2>
          <div class="muted">Takings for a period, from the records themselves.
            One filter: the dates. Everything in range is counted.</div>
        </div>
        <div class="row">
          <div><label for="sFrom">From</label><input type="date" id="sFrom" value="${monthStart()}" /></div>
          <div><label for="sTo">To</label><input type="date" id="sTo" value="${todayISO()}" /></div>
          <button id="sApply" class="btn primary">Show</button>
          <button id="sMonth" class="btn">This month</button>
          <button id="sToday" class="btn">Today</button>
          <span id="sMsg" class="muted" role="status"></span>
        </div>
        <div id="sTotals" class="statRow" style="margin-top:12px;"></div>
        <div class="tableWrap" style="margin-top:12px;"><table>
          <thead><tr><th>Date</th><th class="num">Sales</th><th class="num">Commission</th>
            <th class="num">Cash</th><th class="num">BPI (QR)</th><th class="num">GCash</th><th class="num">Sessions</th></tr></thead>
          <tbody id="sRows"></tbody></table></div>
      </div>`;
    $('#sApply').addEventListener('click', () => busy($('#sApply'), 'Loading…', loadSales));
    $('#sMonth').addEventListener('click', () => {
      $('#sFrom').value = monthStart(); $('#sTo').value = todayISO(); loadSales();
    });
    $('#sToday').addEventListener('click', () => {
      $('#sFrom').value = todayISO(); $('#sTo').value = todayISO(); loadSales();
    });
    loadSales();
  }

  const payOf = (r) => {
    const m = String(r.paymentMethod || 'cash');
    return m === 'bpi' ? 'bpi-qr' : m;
  };

  async function loadSales() {
    const msg = $('#sMsg');
    msg.className = 'muted'; msg.textContent = 'Loading…';
    try {
      const q = new URLSearchParams({ site: state.site, from: $('#sFrom').value, to: $('#sTo').value });
      const out = await TB.api('/api/sessions?' + q.toString());
      const recs = out.records;
      const byDate = new Map();
      for (const r of recs) {
        if (!byDate.has(r.date)) {
          byDate.set(r.date, { date: r.date, sales: 0, commission: 0, cash: 0, 'bpi-qr': 0, gcash: 0, n: 0 });
        }
        const d = byDate.get(r.date);
        d.sales += Number(r.net) || 0;
        d.commission += Number(r.commission) || 0;
        d[payOf(r)] = (d[payOf(r)] || 0) + (Number(r.net) || 0);
        d.n++;
      }
      const days = [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date));
      const sum = (k) => days.reduce((s, d) => s + (d[k] || 0), 0);

      msg.textContent = `${recs.length} sale(s) over ${days.length} day(s)`;
      $('#sTotals').innerHTML = [
        ['Total sales', money0(sum('sales'))],
        ['Cash', money0(sum('cash'))],
        ['BPI (QR)', money0(sum('bpi-qr'))],
        ['GCash', money0(sum('gcash'))],
        ['Commission', money0(sum('commission'))],
        ['Sessions', String(recs.length)],
      ].map(([l, v]) => `<div class="stat"><div class="statLabel">${esc(l)}</div><div class="statValue">${esc(v)}</div></div>`).join('');

      $('#sRows').innerHTML = days.length
        ? days.map((d) => `<tr>
            <td>${esc(d.date)}</td>
            <td class="num">${money0(d.sales)}</td><td class="num">${money0(d.commission)}</td>
            <td class="num">${money0(d.cash)}</td><td class="num">${money0(d['bpi-qr'])}</td>
            <td class="num">${money0(d.gcash)}</td><td class="num">${d.n}</td></tr>`).join('')
        : '<tr><td colspan="7" class="muted">No sales in this range.</td></tr>';
    } catch (e) {
      msg.className = 'err';
      msg.textContent = e.unauthorized ? 'Session expired — sign in again' : e.message;
      if (e.unauthorized) { state.user = null; render(); }
    }
  }

  // -------------------------------------------------------------- history
  function renderHistory() {
    $('#rcBody').innerHTML = `
      <div class="panel">
        <div class="secHead">
          <h2>History</h2>
          <div class="muted">The individual sales behind the totals, newest first.</div>
        </div>
        <div class="row">
          <div><label for="hFrom">From</label><input type="date" id="hFrom" value="${monthStart()}" /></div>
          <div><label for="hTo">To</label><input type="date" id="hTo" value="${todayISO()}" /></div>
          <button id="hApply" class="btn primary">Show</button>
          <span id="hMsg" class="muted" role="status"></span>
        </div>
        <div class="tableWrap" style="margin-top:12px;"><table>
          <thead><tr><th>Date</th><th>Time</th><th>Customer</th><th>Therapist</th>
            <th>Service</th><th>Add-ons</th><th>Paid by</th><th class="num">Net</th></tr></thead>
          <tbody id="hRows"></tbody></table></div>
      </div>`;
    $('#hApply').addEventListener('click', () => busy($('#hApply'), 'Loading…', loadHistory));
    loadHistory();
  }

  async function loadHistory() {
    const msg = $('#hMsg');
    msg.className = 'muted'; msg.textContent = 'Loading…';
    try {
      const q = new URLSearchParams({ site: state.site, from: $('#hFrom').value, to: $('#hTo').value });
      const out = await TB.api('/api/sessions?' + q.toString());
      const rows = out.records.slice().sort((a, b) =>
        b.date.localeCompare(a.date) || String(b.timestart).localeCompare(String(a.timestart)));
      msg.textContent = `${rows.length} sale(s)`;
      $('#hRows').innerHTML = rows.length
        ? rows.map((r) => `<tr>
            <td>${esc(r.date)}</td><td>${esc(r.timestart)}</td><td>${esc(r.customer)}</td>
            <td>${esc(r.therapistName)}</td><td>${esc(r.service)}</td><td>${esc(r.addons)}</td>
            <td>${esc(PAY_LABELS[payOf(r)] || payOf(r))}</td>
            <td class="num">${money0(r.net)}</td></tr>`).join('')
        : '<tr><td colspan="8" class="muted">No sales in this range.</td></tr>';
    } catch (e) {
      msg.className = 'err';
      msg.textContent = e.unauthorized ? 'Session expired — sign in again' : e.message;
      if (e.unauthorized) { state.user = null; render(); }
    }
  }

  // ----------------------------------------------------------------- init
  async function init() {
    state.user = await TB.me();
    if (state.user) {
      state.site = TB.deviceSite() || 'panacan';
      // Sales and client records are on this screen: lock it when idle.
      TBIdleLock.start({ waiverUrl: '../index.html' });
    }
    render();
  }

  window.TBRecords = { init };
})();
