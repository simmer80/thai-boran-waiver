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
    waivers: [], waiverMedia: {},
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
    { id: 'waivers', label: 'Waiver forms', sub: 'The signed forms themselves' },
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
          <a class="btn" href="${state.user.role === 'manager' || state.user.role === 'admin' ? '../manager/' : '../reception/'}">I’m still here — keep me signed in</a>
          <button id="rcLock" class="btn">Sign out now</button>
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
    if (dev) dev.classList.toggle('hidden', state.tab !== 'waivers');
    $('#rcBody').innerHTML = '';
    if (state.tab === 'approved') renderApproved();
    else if (state.tab === 'sales') renderSales();
    else if (state.tab === 'history') renderHistory();
    else if (state.tab === 'waivers') renderWaivers();
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
          } catch (e) { TB.sorry(e, 'make the PDF'); }
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
        } catch (e) { TB.sorry(e, 'make the PDF'); }
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
        <div class="chartBox">
          <div class="chartTitle">Sales per day</div>
          <canvas id="sChart" role="img" aria-label="Sales per day"></canvas>
        </div>
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

  // A bar per day, drawn straight onto a canvas — no library, no CDN. The
  // colours are read from the design tokens so it matches everything else.
  function drawSalesChart(days) {
    const cv = document.getElementById('sChart');
    if (!cv) return;
    const css = getComputedStyle(document.documentElement);
    const tok = (n, fallback) => (css.getPropertyValue(n) || '').trim() || fallback;
    const brand = tok('--brand', '#1f6feb');
    const line = tok('--line', '#e3e7ec');
    const ink3 = tok('--ink-3', '#6b7480');

    const rect = cv.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(320, Math.round(rect.width));
    const h = 240;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    cv.style.height = h + 'px';
    const c = cv.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);

    const data = days.slice().sort((a, b) => a.date.localeCompare(b.date));
    if (!data.length) {
      c.fillStyle = ink3;
      c.font = '14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
      c.textAlign = 'center';
      c.fillText('No sales in this range', w / 2, h / 2);
      return;
    }

    const padL = 56, padR = 12, padT = 14, padB = 34;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;
    const max = Math.max(...data.map((d) => d.sales), 1);
    // A round number above the tallest bar, so the axis reads sensibly.
    const step = Math.pow(10, Math.floor(Math.log10(max)));
    const top = Math.ceil(max / step) * step;

    c.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
    c.textAlign = 'right';
    c.textBaseline = 'middle';
    for (let i = 0; i <= 4; i++) {
      const y = padT + plotH - (plotH * i) / 4;
      c.strokeStyle = line;
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(padL, Math.round(y) + 0.5);
      c.lineTo(w - padR, Math.round(y) + 0.5);
      c.stroke();
      c.fillStyle = ink3;
      c.fillText(Math.round((top * i) / 4).toLocaleString('en-PH'), padL - 8, y);
    }

    const slot = plotW / data.length;
    const barW = Math.max(6, Math.min(46, slot * 0.62));
    c.textAlign = 'center';
    c.textBaseline = 'top';
    data.forEach((d, i) => {
      const x = padL + slot * i + (slot - barW) / 2;
      const barH = Math.max(1, (d.sales / top) * plotH);
      const y = padT + plotH - barH;
      c.fillStyle = brand;
      const r = Math.min(4, barW / 2);
      c.beginPath();
      c.moveTo(x, y + barH);
      c.lineTo(x, y + r);
      c.quadraticCurveTo(x, y, x + r, y);
      c.lineTo(x + barW - r, y);
      c.quadraticCurveTo(x + barW, y, x + barW, y + r);
      c.lineTo(x + barW, y + barH);
      c.closePath();
      c.fill();

      // Only label what will fit, so a long month does not turn to mush.
      const every = Math.ceil(data.length / 12);
      if (i % every === 0) {
        c.fillStyle = ink3;
        c.fillText(d.date.slice(8), x + barW / 2, padT + plotH + 8);
      }
    });
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

      drawSalesChart(days);
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

  // ------------------------------------------------------- waiver forms
  // ONE list, and it is the SERVER's.
  //
  // This used to be two: a server list, plus a separate "This iPad" box for
  // the device's own copies. That split existed because photos and signatures
  // never left the tablet, so only the capturing device could show a complete
  // waiver. They now sync with the record, so there is nothing left for a
  // second list to mean — every device sees every waiver, images included.
  //
  // The images are fetched on demand when a waiver is opened, not with the
  // list: a month of face photos is many megabytes and nobody looks at most
  // of them.
  function renderWaivers() {
    $('#rcBody').innerHTML = `
      <div class="panel">
        <div class="secHead">
          <h2>Waiver forms</h2>
          <div class="muted">Every waiver taken at this parlor, with the client's own
            details, photo and signature. The same list on every device.</div>
        </div>
        <div class="row">
          <div><label for="wFrom">From</label><input type="date" id="wFrom" value="${monthStart()}" /></div>
          <div><label for="wTo">To</label><input type="date" id="wTo" value="${todayISO()}" /></div>
          <button id="wApply" class="btn primary">Show</button>
          <span id="wMsg" class="muted" role="status"></span>
        </div>
        <div id="wRows" style="margin-top:12px;"></div>
      </div>
      <div id="wDetail"></div>
      <div class="panel">
        <div class="secHead">
          <h2>Export and housekeeping</h2>
          <div class="muted">Take a copy off the tablet, or clear what this device has
            cached. Clearing here never touches the waivers on the server.</div>
        </div>
        <div id="deviceToolsSlot"></div>
      </div>`;
    $('#wApply').addEventListener('click', () => busy($('#wApply'), 'Loading…', loadWaivers));
    // The export / clear tools are real markup on the page; move them in.
    const dev = document.getElementById('deviceTools');
    const slot = document.getElementById('deviceToolsSlot');
    if (dev && slot) { dev.classList.remove('hidden'); slot.appendChild(dev); }
    loadWaivers();
  }

  async function loadWaivers() {
    const msg = $('#wMsg');
    msg.className = 'muted';
    msg.textContent = 'Loading…';
    try {
      const q = new URLSearchParams({ site: state.site, from: $('#wFrom').value, to: $('#wTo').value });
      const out = await TB.api('/api/sessions?' + q.toString());
      const rows = out.records.slice().sort((a, b) =>
        String(b.date).localeCompare(String(a.date)) ||
        String(b.timestart).localeCompare(String(a.timestart)));
      state.waivers = rows;

      // Which of these actually have an image on the server, asked one day at
      // a time so the answer shown on each row is a fact, not a guess.
      state.waiverMedia = await mediaIndexFor(rows);

      msg.textContent = rows.length ? `${rows.length} waiver(s)` : '';
      $('#wRows').innerHTML = rows.length
        ? `<div class="tableWrap"><table>
            <thead><tr>
              <th>Taken</th><th>Date</th><th>Time</th><th>Client</th><th>Contact</th>
              <th>Therapist</th><th>Service</th><th>Add-ons</th><th>Paid</th>
              <th>Photo</th><th></th>
            </tr></thead>
            <tbody>${rows.map((r) => `<tr>
              <td>${esc(r.timestamp || '')}</td>
              <td>${esc(r.date)}</td><td>${esc(r.timestart)}</td>
              <td>${esc(r.customer)}</td><td>${esc(r.contact || '')}</td>
              <td>${esc(r.therapistName)}</td>
              <td>${esc(r.service)}</td><td>${esc(r.addons)}</td>
              <td>${esc(money0(r.net))}</td>
              <td>${mediaCell(r)}</td>
              <td><button class="btn wOpen" data-id="${esc(r.id)}">Open</button></td>
            </tr>`).join('')}</tbody></table></div>`
        : '<span class="muted">No waivers in this range.</span>';

      $('#wRows').querySelectorAll('.wOpen').forEach((b) =>
        b.addEventListener('click', () => openWaiver(b.dataset.id)));
    } catch (e) {
      msg.className = 'err';
      msg.textContent = e.unauthorized
        ? 'Session expired — sign in again'
        : TB.explain(e, 'list the waivers').split(String.fromCharCode(10))[0];
      if (e.unauthorized) { state.user = null; render(); }
    }
  }

  // The media index is per day, so ask once per day in the range rather than
  // once per waiver. A failure here must never empty the list: the rows are
  // still correct, they just cannot promise an image.
  async function mediaIndexFor(rows) {
    const byDate = new Map();
    for (const r of rows) {
      if (!byDate.has(r.date)) byDate.set(r.date, []);
      byDate.get(r.date).push(r.id);
    }
    const out = {};
    await Promise.all([...byDate.entries()].map(async ([date, ids]) => {
      try {
        const q = new URLSearchParams({ site: state.site, date, ids: ids.join(',') });
        const res = await TB.api('/api/sessions/media-index?' + q.toString());
        Object.assign(out, res.media || {});
      } catch (_) { /* leave those rows unknown */ }
    }));
    return out;
  }

  function mediaCell(r) {
    const m = (state.waiverMedia || {})[r.id];
    if (!m) return '<span class="muted">—</span>';
    if (m.photo && m.signature) return '<span class="ok">photo + signature</span>';
    if (m.photo) return '<span class="ok">photo</span>';
    if (m.signature) return '<span class="ok">signature</span>';
    // Erased is a fact worth showing: someone made that decision.
    if (m.erasedPhoto || m.erasedSignature) return '<span class="muted">erased</span>';
    return '<span class="muted">none</span>';
  }

  function openWaiver(id) {
    const rec = (state.waivers || []).find((r) => r.id === id);
    if (!rec) return;
    // UNDEFINED means the media index could not be reached, which is NOT the
    // same as knowing there is no photo. Saying "none was stored" on a server
    // hiccup would be a confident lie about a client’s record.
    const known = (state.waiverMedia || {})[id];
    const m = known || {};
    const host = $('#wDetail');

    const line = (k, v) => v === '' || v == null
      ? ''
      : `<tr><td class="muted">${esc(k)}</td><td>${esc(v)}</td></tr>`;

    // Inline and immediate: the whole point is that the receptionist does not
    // have to go anywhere else to see who signed what.
    const figures = [];
    if (m.photo) figures.push('<figure><figcaption>Client photo</figcaption><img id="wPhoto" alt="Client photo" /></figure>');
    if (m.signature) figures.push('<figure><figcaption>Signature</figcaption><img id="wSig" alt="Client signature" /></figure>');
    const imgs = figures.length
      ? '<div class="waiverImages">' + figures.join('') + '</div>'
      : known
        ? (m.erasedPhoto || m.erasedSignature
          ? '<div class="muted">The photo and signature for this waiver were ' +
            '<b>erased by a manager</b>. The rest of the record is unchanged.</div>'
          : '<div class="muted">No photo or signature was stored for this waiver ' +
            '— either the photo was skipped, or it was taken before images were ' +
            'kept on the server.</div>')
        : '<div class="warn">Could not check whether this waiver has a photo or ' +
          'signature — the server did not answer. Try again in a moment.</div>';

    host.innerHTML = `
      <div class="panel">
        <div class="row" style="justify-content:space-between;align-items:center;">
          <h2 style="margin:0">${esc(rec.customer)} — ${esc(rec.date)} ${esc(rec.timestart)}</h2>
          <div class="row" style="gap:8px;">
            ${state.user && state.user.role === 'manager' && (m.photo || m.signature)
              ? '<button id="wErase" class="btn danger">Erase photo &amp; signature</button>'
              : ''}
            <button id="wClose" class="btn">Close</button>
          </div>
        </div>
        <div class="waiverDetail">
          <table class="kvTable">
            ${line('Captured', rec.timestamp)}
            ${line('Client', rec.customer)}
            ${line('Address', rec.address)}
            ${line('Contact', rec.contact)}
            ${line('Declared conditions', rec.conditions)}
            ${line('Date', rec.date)}
            ${line('Time', rec.timestart)}
            ${line('Therapist', rec.therapistName)}
            ${line('Service', rec.service)}
            ${line('Add-ons', rec.addons)}
            ${line('Hours', rec.hours)}
            ${line('Stub #', rec.stubNumber)}
            ${line('Paid by', PAY_LABELS[payOf(rec)] || payOf(rec))}
            ${line('Gross', money0(rec.gross))}
            ${line('Discount', money0(rec.discount))}
            ${line('Net', money0(rec.net))}
            ${line('Senior / PWD', rec.senior ? 'Yes' + (rec.seniorId ? ' (' + rec.seniorId + ')' : '') : 'No')}
            ${line('Taken by', rec.receptionistName)}
          </table>
          ${imgs}
        </div>
      </div>`;
    $('#wClose').addEventListener('click', () => { host.innerHTML = ''; });

    // Erasing a client’s photo is a manager decision and a real one, so the
    // button only exists for a manager and says exactly what will happen.
    const erase = $('#wErase');
    if (erase) {
      erase.addEventListener('click', () => busy(erase, 'Erasing…', async () => {
        if (!confirm(`Permanently erase the photo and signature for ${rec.customer}?\n\n`
          + 'This cannot be undone. The rest of the waiver record is kept.')) return;
        try {
          const q = new URLSearchParams({ site: state.site, date: rec.date, kinds: 'photo,signature' });
          const out = await TB.api(`/api/sessions/${encodeURIComponent(rec.id)}/media?` + q.toString(),
            { method: 'DELETE' });
          state.waiverMedia[rec.id] = {
            photo: false, signature: false, erasedPhoto: true, erasedSignature: true,
          };
          // loadWaivers() rebuilds the panel and would wipe the message with
          // it, so refresh FIRST and then say what happened.
          await loadWaivers();
          openWaiver(rec.id);
          const m2 = $('#wMsg');
          if (m2) {
            m2.className = out.irreversible ? 'ok' : 'warn';
            m2.textContent = out.irreversible
              ? 'Erased permanently — the images are gone from Google Drive.'
              : 'Erased from the app, but these images were still in the data repository, '
                + 'whose history keeps every version. Switch on the Drive mirror for a true erase.';
          }
        } catch (e) {
          alert(TB.explain(e, 'erase the images').split(String.fromCharCode(10))[0]);
        }
      }));
    }

    if (m.photo) loadWaiverImage('#wPhoto', rec, 'photo');
    if (m.signature) loadWaiverImage('#wSig', rec, 'signature');
    host.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // The image endpoints need the bearer token, so they cannot be a plain
  // <img src>. Fetch as a blob and hand the element an object URL.
  // The image endpoints need the bearer token, so they cannot be a plain
  // <img src>. Fetch as a blob and hand the element an object URL.
  //
  // If the server cannot be reached, fall back to THIS iPad’s own copy when
  // it has one — the tablet that took the waiver can still show it with no
  // WiFi, which is the whole point of capturing locally first.
  async function loadWaiverImage(sel, rec, kind) {
    const img = $(sel);
    if (!img) return;
    const show = (blob, note) => {
      const url = URL.createObjectURL(blob);
      img.src = url;
      img.addEventListener('load', () => setTimeout(() => URL.revokeObjectURL(url), 1000), { once: true });
      if (note) {
        const cap = img.closest('figure') && img.closest('figure').querySelector('figcaption');
        if (cap) cap.textContent += ' — ' + note;
      }
    };
    try {
      const q = new URLSearchParams({ site: state.site, date: rec.date });
      show(await TB.api(`/api/sessions/${encodeURIComponent(rec.id)}/${kind}?` + q.toString()));
    } catch (e) {
      const local = await localImage(rec.id, kind);
      if (local) return show(local, 'from this iPad');
      const fig = img.closest('figure');
      if (fig) {
        fig.innerHTML = e.offline
          ? '<figcaption class="muted">No WiFi, and this iPad does not hold a copy of this image.</figcaption>'
          : '<figcaption class="muted">This image could not be loaded.</figcaption>';
      }
    }
  }

  // This device’s own copy of a waiver image, if it captured that waiver.
  async function localImage(id, kind) {
    try {
      const rec = await new Promise((resolve, reject) => {
        const q = indexedDB.open('thai_boran_waiver_db', 1);
        q.onupgradeneeded = () => {
          const d = q.result;
          if (!d.objectStoreNames.contains('submissions')) d.createObjectStore('submissions', { keyPath: 'id' });
        };
        q.onsuccess = () => {
          const d = q.result;
          const g = d.transaction('submissions', 'readonly').objectStore('submissions').get(id);
          g.onsuccess = () => { d.close(); resolve(g.result || null); };
          g.onerror = () => { d.close(); reject(g.error); };
        };
        q.onerror = () => reject(q.error);
      });
      if (!rec) return null;
      if (kind === 'photo') {
        if (rec.photoBlob instanceof Blob) return rec.photoBlob;
        if (Array.isArray(rec.photoBytes) && rec.photoBytes.length) {
          return new Blob([new Uint8Array(rec.photoBytes)], { type: 'image/jpeg' });
        }
        return null;
      }
      return Array.isArray(rec.sigBytes) && rec.sigBytes.length
        ? new Blob([new Uint8Array(rec.sigBytes)], { type: 'image/png' })
        : null;
    } catch (_) {
      return null;
    }
  }


  // ----------------------------------------------------------------- init
  async function init() {
    state.user = await TB.me();
    if (state.user) {
      // The device tools on this page unlock off a verified login, exactly as
      // they do in the back office. Without this they sat behind a device PIN
      // that nobody at the front desk has ever been given.
      document.dispatchEvent(new CustomEvent('tb:authed', { detail: { ...state.user } }));
      state.site = TB.deviceSite() || 'panacan';
      // Sales and client records are on this screen: lock it when idle.
      TBIdleLock.start({ waiverUrl: '../index.html' });
    }
    render();
  }

  window.TBRecords = { init };
})();
