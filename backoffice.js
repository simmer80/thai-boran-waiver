// Back-office UI shared by the Receptionist and Manager tabs.
// Online-first: everything here talks to the server live. When offline it
// shows an explicit "offline" state instead of half-working (the Waiver
// Form tab keeps capturing offline; this screen does not pretend to).
//
// managerMode adds: Tasks (documents awaiting approval), the Approve
// button, therapist administration and the Drive retry control.

'use strict';

(function () {
  const $ = (sel, root) => (root || document).querySelector(sel);
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const money0 = (n) => (Number(n) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const DED_KEYS = ['latesAndAbsences', 'sss', 'phic', 'pagibig', 'ca', 'cb'];
  const DED_LABELS = { latesAndAbsences: 'Lates/Abs', sss: 'SSS', phic: 'PHIC', pagibig: 'Pag-ibig', ca: 'C.A.', cb: 'C.B.' };
  const TYPE_LABELS = {
    'daily-commission': 'Daily Therapist Commission',
    'weekly-payroll': 'Weekly Therapist Payroll',
    'weekly-sales': 'Weekly Sales',
  };

  const state = {
    managerMode: false, mount: null, logoSrc: '../assets/thai_boran_logo.png',
    user: null, therapists: [], users: [], branchCfg: {},
    report: null, reportType: 'daily-commission', reportPeriod: '',
    sessions: [], editingId: null,
  };

  function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function mondayOf(dateStr) {
    const d = new Date(dateStr + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  }

  // ------------------------------------------------------------- rendering
  function render() {
    const m = state.mount;
    if (!navigator.onLine) {
      m.innerHTML = `<div class="offlineBlock">You are offline.<br/>
        Sessions, reports, submission and approval need a connection and will
        come back automatically when WiFi returns.<br/>
        The <b>Waiver Form</b> tab keeps working offline.</div>`;
      return;
    }
    if (!state.user) { renderLogin(); return; }
    renderMain();
  }

  function renderLogin() {
    state.mount.innerHTML = `
      <div class="panel" style="max-width:420px;margin:30px auto;">
        <h2 style="margin-top:0">Sign in</h2>
        <p class="muted">Use the account your administrator created for you.</p>
        <div class="row" style="flex-direction:column;align-items:stretch;">
          <div><label for="boUser">Username</label>
            <input id="boUser" autocomplete="username" style="width:100%" /></div>
          <div><label for="boPass">Password</label>
            <input id="boPass" type="password" autocomplete="current-password" style="width:100%" /></div>
          <button id="boLogin" class="btn primary">Sign in</button>
          <div id="boLoginMsg" class="err" role="alert"></div>
        </div>
      </div>`;
    const go = async () => {
      $('#boLoginMsg').textContent = '';
      try {
        state.user = await TB.login($('#boUser').value.trim(), $('#boPass').value);
        await loadBasics();
        render();
      } catch (e) {
        $('#boLoginMsg').textContent = e.offline ? 'Cannot reach the server (offline?)' : (e.message || 'Login failed');
      }
    };
    $('#boLogin').addEventListener('click', go);
    $('#boPass').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    $('#boUser').focus();
  }

  async function loadBasics() {
    const [t, u, c] = await Promise.all([
      TB.api('/api/therapists'), TB.api('/api/users'), TB.api('/api/branch-config'),
    ]);
    state.therapists = t.therapists;
    state.users = u.users;
    state.branchCfg = c.config || {};
  }

  function renderMain() {
    const mgr = state.managerMode;
    state.mount.innerHTML = `
      <div class="row noprint" style="justify-content:space-between;align-items:center;">
        <div>Signed in as <b>${esc(state.user.name)}</b> <span class="muted">(${esc(state.user.role)}, ${esc(state.user.branch)})</span></div>
        <button id="boLogout" class="btn">Sign out</button>
      </div>
      ${mgr ? '<div id="boTasks" class="panel noprint"><h2 style="margin-top:0">Tasks — awaiting approval</h2><div id="boTasksBody" class="muted">Loading…</div></div>' : ''}
      <div class="panel noprint">
        <h2 style="margin-top:0">Sessions &amp; sales</h2>
        <div class="row">
          <div><label>From</label><input type="date" id="fFrom" value="${todayISO()}" /></div>
          <div><label>To</label><input type="date" id="fTo" value="${todayISO()}" /></div>
          <div><label>Receptionist</label><select id="fRec"><option value="">All</option>
            ${state.users.map((u) => `<option value="${esc(u.id)}">${esc(u.name)}</option>`).join('')}</select></div>
          <div><label>Therapist</label><select id="fTher"><option value="">All</option>
            ${state.therapists.map((t) => `<option value="${esc(t.id)}">${esc(t.fullName)}</option>`).join('')}</select></div>
          <button id="fApply" class="btn primary">Apply</button>
          <span id="fMsg" class="muted"></span>
        </div>
        <div class="tableWrap" style="margin-top:10px;">
          <table><thead><tr>
            <th>Date</th><th>Time</th><th>Customer</th><th>Therapist</th><th>Service</th>
            <th>Add-Ons</th><th>Stub #</th><th>Hrs</th><th>Pay</th>
            <th class="num">Net</th><th class="num">Comm.</th><th>By</th><th></th>
          </tr></thead><tbody id="sessRows"></tbody>
          <tfoot><tr id="sessTotals"></tr></tfoot></table>
        </div>
        <div id="sessEdit"></div>
      </div>
      <div class="panel">
        <h2 style="margin-top:0" class="noprint">Documents</h2>
        <div class="row noprint">
          <div><label>Document</label><select id="rType">
            ${Object.entries(TYPE_LABELS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}
          </select></div>
          <div><label>Date (any day of the period)</label><input type="date" id="rPeriod" value="${todayISO()}" /></div>
          <button id="rGen" class="btn primary">Generate / Refresh</button>
          <button id="rLoad" class="btn">Open existing</button>
          <span id="rMsg" class="muted" role="status"></span>
        </div>
        <div id="rStatus" class="noprint" style="margin-top:8px;"></div>
        <div id="rActions" class="row noprint" style="margin-top:8px;"></div>
        <div id="rManual" class="noprint" style="margin-top:10px;"></div>
        <div id="rDoc" style="margin-top:12px;"></div>
      </div>
      ${mgr ? `
      <div class="panel noprint"><h2 style="margin-top:0">Therapists</h2>
        <div id="thBody"></div></div>
      <div class="panel noprint"><h2 style="margin-top:0">Google Drive mirror</h2>
        <div id="driveBody" class="muted">Loading…</div></div>` : ''}
    `;

    $('#boLogout').addEventListener('click', async () => { await TB.logout(); state.user = null; render(); });
    $('#fApply').addEventListener('click', loadSessions);
    $('#rGen').addEventListener('click', () => loadReport(true));
    $('#rLoad').addEventListener('click', () => loadReport(false));
    loadSessions();
    if (mgr) { loadTasks(); renderTherapists(); loadDrive(); }
  }

  // -------------------------------------------------------------- sessions
  async function loadSessions() {
    $('#fMsg').textContent = 'Loading…';
    try {
      const q = new URLSearchParams({
        from: $('#fFrom').value, to: $('#fTo').value || $('#fFrom').value,
      });
      if ($('#fRec').value) q.set('receptionistId', $('#fRec').value);
      if ($('#fTher').value) q.set('therapistId', $('#fTher').value);
      const out = await TB.api('/api/sessions?' + q.toString());
      state.sessions = out.records;
      $('#fMsg').textContent = `${out.records.length} record(s)`;
      const rows = out.records.map((r) => `<tr data-id="${esc(r.id)}">
        <td>${esc(r.date)}</td><td>${esc(r.timestart)}</td><td>${esc(r.customer)}</td>
        <td>${esc(r.therapistName || therapistName(r.therapistId))}</td>
        <td>${esc(r.service)}</td><td>${esc(r.addons)}</td>
        <td>${esc(r.stubNumber)}</td><td>${esc(r.hours)}</td>
        <td>${r.paymentMethod === 'bpi' ? 'BPI' : 'Cash'}</td>
        <td class="num">${money0(r.net)}</td><td class="num">${money0(r.commission)}</td>
        <td>${esc(r.receptionistName)}</td>
        <td><button class="btn boEdit" data-id="${esc(r.id)}">Edit</button></td>
      </tr>`).join('');
      $('#sessRows').innerHTML = rows || '<tr><td colspan="13" class="muted">No records in this range.</td></tr>';
      const net = out.records.reduce((s, r) => s + (Number(r.net) || 0), 0);
      const comm = out.records.reduce((s, r) => s + (Number(r.commission) || 0), 0);
      const bpi = out.records.reduce((s, r) => s + (r.paymentMethod === 'bpi' ? Number(r.net) || 0 : 0), 0);
      $('#sessTotals').innerHTML = `<td colspan="9"><b>Totals</b> <span class="muted">(BPI ${money0(bpi)})</span></td>
        <td class="num"><b>${money0(net)}</b></td><td class="num"><b>${money0(comm)}</b></td><td colspan="2"></td>`;
      $('#sessRows').querySelectorAll('.boEdit').forEach((b) =>
        b.addEventListener('click', () => editSession(b.dataset.id)));
    } catch (e) {
      $('#fMsg').textContent = '';
      $('#fMsg').className = 'err';
      $('#fMsg').textContent = e.unauthorized ? 'Session expired — sign in again' : e.message;
      if (e.unauthorized) { state.user = null; render(); }
    }
  }

  function therapistName(id) {
    const t = state.therapists.find((x) => x.id === id);
    return t ? t.fullName : '';
  }

  function editSession(id) {
    const r = state.sessions.find((x) => x.id === id);
    if (!r) return;
    state.editingId = id;
    const opts = state.therapists.map((t) =>
      `<option value="${esc(t.id)}" ${t.id === r.therapistId ? 'selected' : ''}>${esc(t.fullName)}</option>`).join('');
    $('#sessEdit').innerHTML = `<div class="panel" style="background:#f8fafc;margin-top:10px;">
      <b>Edit: ${esc(r.customer)} — ${esc(r.date)} ${esc(r.timestart)}</b>
      <div class="row" style="margin-top:8px;">
        <div><label>Therapist</label><select id="eTher"><option value="">(unassigned)</option>${opts}</select></div>
        <div><label>Stub # (waiver number)</label><input id="eStub" value="${esc(r.stubNumber)}" style="width:110px" /></div>
        <div><label>Hours</label><input id="eHours" type="number" step="0.5" min="0" value="${esc(r.hours)}" style="width:90px" /></div>
        <div><label>Payment</label><select id="ePay">
          <option value="cash" ${r.paymentMethod !== 'bpi' ? 'selected' : ''}>Cash</option>
          <option value="bpi" ${r.paymentMethod === 'bpi' ? 'selected' : ''}>BPI (card)</option></select></div>
        <div><label>Commission</label><input id="eComm" type="number" step="0.01" min="0" value="${esc(r.commission)}" style="width:110px" /></div>
        <button id="eAuto" class="btn" title="rate × net price">Auto</button>
        <button id="eSave" class="btn primary">Save</button>
        <button id="eCancel" class="btn">Cancel</button>
        <span id="eMsg"></span>
      </div></div>`;
    $('#eAuto').addEventListener('click', () => {
      const t = state.therapists.find((x) => x.id === $('#eTher').value);
      if (t) $('#eComm').value = Math.round((t.commissionRate || 0) * (Number(r.net) || 0) * 100) / 100;
    });
    $('#eCancel').addEventListener('click', () => { $('#sessEdit').innerHTML = ''; });
    $('#eSave').addEventListener('click', async () => {
      $('#eMsg').textContent = 'Saving…';
      try {
        const upd = {
          ...r,
          therapistId: $('#eTher').value,
          therapistName: therapistName($('#eTher').value) || r.therapistName,
          stubNumber: $('#eStub').value.trim(),
          hours: Number($('#eHours').value) || 0,
          paymentMethod: $('#ePay').value,
          commission: Number($('#eComm').value) || 0,
          commissionManual: true,
          updatedAt: Date.now(),
        };
        await TB.api('/api/sessions/sync', { method: 'POST', body: { records: [upd] } });
        $('#sessEdit').innerHTML = '';
        loadSessions();
      } catch (e) {
        $('#eMsg').className = 'err'; $('#eMsg').textContent = e.message;
      }
    });
  }

  // --------------------------------------------------------------- reports
  function periodFor(type, anyDate) {
    return type === 'daily-commission' ? anyDate : mondayOf(anyDate);
  }

  async function loadReport(generate) {
    const type = $('#rType').value;
    const period = periodFor(type, $('#rPeriod').value || todayISO());
    state.reportType = type; state.reportPeriod = period;
    $('#rMsg').textContent = generate ? 'Generating…' : 'Loading…';
    try {
      let report;
      if (generate) {
        report = (await TB.api(`/api/reports/${type}/${period}/generate`, { method: 'POST' })).report;
      } else {
        report = (await TB.api(`/api/reports/${type}/${period}`)).report;
      }
      state.report = report;
      $('#rMsg').textContent = '';
      renderReport();
    } catch (e) {
      $('#rMsg').className = 'err';
      $('#rMsg').textContent = e.message;
      setTimeout(() => { $('#rMsg').className = 'muted'; }, 4000);
    }
  }

  function renderReport() {
    const r = state.report;
    if (!r) return;
    $('#rStatus').innerHTML = `<b>${esc(TYPE_LABELS[r.type])}</b> — ${esc(r.period)} — version ${r.version} —
      <span class="status-${esc(r.status)}">${esc(r.status.toUpperCase())}</span>
      ${r.submittedByName ? ` · submitted by ${esc(r.submittedByName)}` : ''}
      ${r.approvedByName ? ` · approved by ${esc(r.approvedByName)} at ${esc(r.approvedAt)}` : ''}`;

    const acts = [];
    acts.push('<button id="aPdf" class="btn">Export PDF</button>');
    acts.push('<button id="aPrint" class="btn">Print</button>');
    if (r.status === 'draft') acts.push('<button id="aSubmit" class="btn primary">Submit for approval</button>');
    if (state.managerMode && r.status === 'submitted') acts.push('<button id="aApprove" class="btn approve">Approve ✓</button>');
    $('#rActions').innerHTML = acts.join('');

    $('#rDoc').innerHTML = TBDoc.render(r.type, r, state.branchCfg, state.logoSrc);
    renderManualEditor();

    $('#aPdf').addEventListener('click', async () => {
      try {
        const blob = await TB.api(`/api/reports/${r.type}/${r.period}/pdf`);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `${r.type}_${r.period}_v${r.version}.pdf`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      } catch (e) { alert('PDF failed: ' + e.message); }
    });
    $('#aPrint').addEventListener('click', () => window.print());
    if ($('#aSubmit')) $('#aSubmit').addEventListener('click', async () => {
      if (!confirm('Submit this document for manager approval?')) return;
      state.report = (await TB.api(`/api/reports/${r.type}/${r.period}/submit`, { method: 'POST' })).report;
      renderReport();
    });
    if ($('#aApprove')) $('#aApprove').addEventListener('click', async () => {
      if (!confirm('Approve this document? Your stored signature will be stamped on it and an immutable copy saved.')) return;
      state.report = (await TB.api(`/api/reports/${r.type}/${r.period}/approve`, { method: 'POST' })).report;
      renderReport();
      loadTasks();
    });
  }

  // Manual value editors. Only controls the user actually changes are sent
  // (dirty tracking), so untouched values keep following the generated data.
  function renderManualEditor() {
    const r = state.report;
    const host = $('#rManual');
    if (r.status === 'approved') {
      host.innerHTML = '<div class="muted">Approved documents are locked. Generate to start a new version if a correction is needed.</div>';
      return;
    }
    if (r.type === 'weekly-payroll') return payrollEditor(host, r);
    if (r.type === 'weekly-sales') return salesEditor(host, r);
    return commissionEditor(host, r);
  }

  function markDirty(e) { e.target.dataset.dirty = '1'; }

  function payrollEditor(host, r) {
    const rows = r.data.rows.map((row) => {
      const dayCells = DAY_KEYS.map((k) => {
        const c = row.days[k];
        const mode = c.type === 'value' ? (c.auto ? 'auto' : 'auto') : c.type; // RD/A shown, amounts default to auto
        return `<td>
          <select data-t="${esc(row.therapistId)}" data-day="${k}" class="pDay">
            <option value="auto" ${c.type === 'value' || c.auto ? 'selected' : ''}>auto</option>
            <option value="RD" ${c.type === 'RD' && !c.auto ? 'selected' : ''}>RD</option>
            <option value="A" ${c.type === 'A' ? 'selected' : ''}>A</option>
          </select></td>`;
      }).join('');
      const dedCells = DED_KEYS.map((k) => `<td>
        <input type="checkbox" class="pDedOn" data-t="${esc(row.therapistId)}" data-ded="${k}" ${row.deductions[k].enabled ? 'checked' : ''} aria-label="${DED_LABELS[k]} enabled" />
        <input type="number" step="0.01" min="0" class="pDedAmt" style="width:74px" data-t="${esc(row.therapistId)}" data-ded="${k}" value="${row.deductions[k].amount || ''}" aria-label="${DED_LABELS[k]} amount" />
      </td>`).join('');
      return `<tr><td>${esc(row.therapistName)}</td>${dayCells}${dedCells}
        <td><input type="checkbox" class="pNhOn" data-t="${esc(row.therapistId)}" ${row.nh.enabled ? 'checked' : ''} aria-label="NH enabled" />
            <input type="number" step="0.01" min="0" class="pNhAmt" style="width:74px" data-t="${esc(row.therapistId)}" value="${row.nh.amount || ''}" aria-label="NH amount" /></td>
        <td><input type="number" step="0.01" class="pAllow" style="width:80px" data-t="${esc(row.therapistId)}" value="${row.allowance || ''}" aria-label="Allowance" /></td></tr>`;
    }).join('');

    host.innerHTML = `<details><summary class="btn" style="display:inline-block">Manual values (absences, lates, SSS, PHIC, Pag-ibig, C.A., C.B., NH, allowance)</summary>
      <div class="tableWrap" style="margin-top:8px;"><table>
        <thead><tr><th>Therapist</th>${DAY_KEYS.map((k) => `<th>${k}</th>`).join('')}
        ${DED_KEYS.map((k) => `<th>${DED_LABELS[k]}</th>`).join('')}<th>NH</th><th>Allow.</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
      <div class="row" style="margin-top:8px;">
        <button id="pSave" class="btn primary">Save manual values</button>
        <span class="muted">Days: auto = commissions from records / RD = rest day / A = absent. Tick a deduction to enable it, amounts persist and survive regeneration.</span>
        <span id="pMsg"></span>
      </div></details>`;

    host.querySelectorAll('input,select').forEach((el) => el.addEventListener('change', markDirty));
    $('#pSave').addEventListener('click', async () => {
      const patch = { therapists: {} };
      const T = (tid) => (patch.therapists[tid] = patch.therapists[tid] || {});
      host.querySelectorAll('.pDay[data-dirty]').forEach((el) => {
        const t = T(el.dataset.t); t.days = t.days || {};
        t.days[el.dataset.day] = el.value === 'auto' ? null : { type: el.value };
      });
      const dedTouched = new Set();
      host.querySelectorAll('.pDedOn[data-dirty],.pDedAmt[data-dirty]').forEach((el) =>
        dedTouched.add(el.dataset.t + '|' + el.dataset.ded));
      dedTouched.forEach((key) => {
        const [tid, ded] = key.split('|');
        const on = host.querySelector(`.pDedOn[data-t="${tid}"][data-ded="${ded}"]`).checked;
        const amt = Number(host.querySelector(`.pDedAmt[data-t="${tid}"][data-ded="${ded}"]`).value) || 0;
        const t = T(tid); t.deductions = t.deductions || {};
        t.deductions[ded] = { enabled: on, amount: amt };
      });
      const nhTouched = new Set();
      host.querySelectorAll('.pNhOn[data-dirty],.pNhAmt[data-dirty]').forEach((el) => nhTouched.add(el.dataset.t));
      nhTouched.forEach((tid) => {
        const t = T(tid);
        t.nh = {
          enabled: host.querySelector(`.pNhOn[data-t="${tid}"]`).checked,
          amount: Number(host.querySelector(`.pNhAmt[data-t="${tid}"]`).value) || 0,
        };
      });
      host.querySelectorAll('.pAllow[data-dirty]').forEach((el) => {
        T(el.dataset.t).allowance = Number(el.value) || 0;
      });
      await saveManual(patch, '#pMsg');
    });
  }

  function salesEditor(host, r) {
    const rows = r.data.rows.map((row) => `<tr><td>${esc(row.date)} ${esc(row.day)}</td>
      <td><input type="number" step="0.01" class="sIn" data-date="${esc(row.date)}" data-f="grossSales" value="${row.manual ? row.grossSales : ''}" placeholder="${row.grossSales}" /></td>
      <td><input type="number" step="0.01" class="sIn" data-date="${esc(row.date)}" data-f="commission" value="" placeholder="${row.commission}" /></td>
      <td><input type="number" step="0.01" class="sIn" data-date="${esc(row.date)}" data-f="bpi" value="" placeholder="${row.bpi}" /></td></tr>`).join('');
    host.innerHTML = `<details><summary class="btn" style="display:inline-block">Manual corrections</summary>
      <div class="tableWrap" style="margin-top:8px;"><table>
      <thead><tr><th>Day</th><th>Gross Sales</th><th>Commission</th><th>BPI</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
      <div class="row" style="margin-top:8px;">
        <div><label>"Raw data input by" (blank = automatic)</label>
          <input id="sInputBy" value="" placeholder="${esc(r.data.rawDataInputBy || '')}" style="width:260px" /></div>
        <button id="sSave" class="btn primary">Save manual values</button>
        <span class="muted">Leave a box empty to keep the automatic value (shown grey). Type a number to override it.</span>
        <span id="sMsg"></span>
      </div></details>`;
    host.querySelectorAll('input').forEach((el) => el.addEventListener('change', markDirty));
    $('#sSave').addEventListener('click', async () => {
      const patch = { days: {} };
      host.querySelectorAll('.sIn[data-dirty]').forEach((el) => {
        const d = (patch.days[el.dataset.date] = patch.days[el.dataset.date] || {});
        d[el.dataset.f] = el.value === '' ? null : Number(el.value);
      });
      const by = $('#sInputBy');
      if (by.dataset.dirty && by.value !== '') patch.rawDataInputBy = by.value;
      await saveManual(patch, '#sMsg');
    });
  }

  function commissionEditor(host, r) {
    const rows = r.data.rows.map((row) => {
      const key = row.therapistId || row.therapistName;
      const blocks = [];
      for (let i = 0; i < 6; i++) {
        const b = row.blocks[i] || { hours: '', stubNumber: '', commission: '' };
        blocks.push(`<td>
          <input class="cIn" style="width:44px" data-k="${esc(key)}" data-i="${i}" data-f="hours" value="${esc(b.hours)}" aria-label="hours" />
          <input class="cIn" style="width:60px" data-k="${esc(key)}" data-i="${i}" data-f="stubNumber" value="${esc(b.stubNumber)}" aria-label="stub" />
          <input class="cIn" style="width:70px" type="number" step="0.01" data-k="${esc(key)}" data-i="${i}" data-f="commission" value="${esc(b.commission)}" aria-label="commission" />
        </td>`);
      }
      return `<tr><td>${esc(row.therapistName)}</td>${blocks.join('')}</tr>`;
    }).join('');
    host.innerHTML = `<details><summary class="btn" style="display:inline-block">Manual corrections (hrs / stub # / commission per block)</summary>
      <div class="tableWrap" style="margin-top:8px;"><table>
      <thead><tr><th>Therapist</th>${[1, 2, 3, 4, 5, 6].map((i) => `<th>Block ${i}</th>`).join('')}</tr></thead>
      <tbody>${rows}</tbody></table></div>
      <div class="row" style="margin-top:8px;">
        <button id="cSave" class="btn primary">Save manual values</button><span id="cMsg"></span>
      </div></details>`;
    host.querySelectorAll('input').forEach((el) => el.addEventListener('change', markDirty));
    $('#cSave').addEventListener('click', async () => {
      const patch = { rows: {} };
      host.querySelectorAll('.cIn[data-dirty]').forEach((el) => {
        const k = el.dataset.k;
        const rp = (patch.rows[k] = patch.rows[k] || { blocks: {} });
        const bp = (rp.blocks[el.dataset.i] = rp.blocks[el.dataset.i] || {});
        bp[el.dataset.f] = el.dataset.f === 'stubNumber' ? el.value : Number(el.value) || 0;
      });
      await saveManual(patch, '#cMsg');
    });
  }

  async function saveManual(patch, msgSel) {
    const el = $(msgSel);
    el.className = 'muted'; el.textContent = 'Saving…';
    try {
      const r = state.report;
      state.report = (await TB.api(`/api/reports/${r.type}/${r.period}/manual-values`, {
        method: 'POST', body: patch,
      })).report;
      renderReport();
    } catch (e) {
      el.className = 'err'; el.textContent = e.message;
    }
  }

  // ------------------------------------------------------- manager extras
  async function loadTasks() {
    if (!state.managerMode) return;
    try {
      const out = await TB.api('/api/tasks');
      $('#boTasksBody').innerHTML = out.tasks.length
        ? `<table><thead><tr><th>Document</th><th>Period</th><th>Submitted by</th><th>When</th><th></th></tr></thead><tbody>
          ${out.tasks.map((t) => `<tr>
            <td>${esc(TYPE_LABELS[t.type])}</td><td>${esc(t.period)}</td>
            <td>${esc(t.submittedBy)}</td><td>${esc((t.submittedAt || '').slice(0, 16).replace('T', ' '))}</td>
            <td><button class="btn primary boOpenTask" data-type="${esc(t.type)}" data-period="${esc(t.period)}">Review</button></td>
          </tr>`).join('')}</tbody></table>`
        : '<span class="ok">Nothing waiting for approval.</span>';
      $('#boTasksBody').querySelectorAll('.boOpenTask').forEach((b) =>
        b.addEventListener('click', () => {
          $('#rType').value = b.dataset.type;
          $('#rPeriod').value = b.dataset.period;
          loadReport(false);
          $('#rDoc').scrollIntoView({ behavior: 'smooth' });
        }));
    } catch (e) {
      $('#boTasksBody').innerHTML = `<span class="err">${esc(e.message)}</span>`;
    }
  }

  function renderTherapists() {
    const host = $('#thBody');
    const days = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    host.innerHTML = `<div class="tableWrap"><table>
      <thead><tr><th>ID</th><th>Full name</th><th>Active</th><th>Rest day</th><th>Commission rate</th><th></th></tr></thead>
      <tbody>${state.therapists.map((t) => `<tr>
        <td>${esc(t.id)}</td>
        <td><input class="tN" data-id="${esc(t.id)}" value="${esc(t.fullName)}" /></td>
        <td><input type="checkbox" class="tA" data-id="${esc(t.id)}" ${t.active !== false ? 'checked' : ''} /></td>
        <td><select class="tR" data-id="${esc(t.id)}">${days.map((d) => `<option ${d === (t.restDay || '') ? 'selected' : ''}>${d}</option>`).join('')}</select></td>
        <td><input class="tC" type="number" step="0.01" min="0" max="1" data-id="${esc(t.id)}" value="${t.commissionRate || 0}" style="width:80px" /></td>
        <td><button class="btn tSave" data-id="${esc(t.id)}">Save</button></td>
      </tr>`).join('')}</tbody></table></div>
      <div class="row" style="margin-top:8px;">
        <div><label>New id</label><input id="tNewId" style="width:100px" placeholder="t-ana" /></div>
        <div><label>Full name</label><input id="tNewName" /></div>
        <button id="tAdd" class="btn primary">Add therapist</button><span id="tMsg"></span>
      </div>`;
    host.querySelectorAll('.tSave').forEach((b) => b.addEventListener('click', async () => {
      const id = b.dataset.id;
      try {
        const out = await TB.api('/api/therapists/' + encodeURIComponent(id), {
          method: 'PATCH',
          body: {
            fullName: host.querySelector(`.tN[data-id="${id}"]`).value,
            active: host.querySelector(`.tA[data-id="${id}"]`).checked,
            restDay: host.querySelector(`.tR[data-id="${id}"]`).value,
            commissionRate: Number(host.querySelector(`.tC[data-id="${id}"]`).value) || 0,
          },
        });
        state.therapists = out.therapists;
        renderTherapists();
      } catch (e) { $('#tMsg').className = 'err'; $('#tMsg').textContent = e.message; }
    }));
    $('#tAdd').addEventListener('click', async () => {
      try {
        const out = await TB.api('/api/therapists', {
          method: 'POST',
          body: { id: $('#tNewId').value.trim(), fullName: $('#tNewName').value.trim() },
        });
        state.therapists = out.therapists;
        renderTherapists();
      } catch (e) { $('#tMsg').className = 'err'; $('#tMsg').textContent = e.message; }
    });
  }

  async function loadDrive() {
    try {
      const s = await TB.api('/api/drive/status');
      $('#driveBody').innerHTML = s.enabled
        ? `Mirror is ON. Pending uploads: <b>${s.pending}</b>
           ${s.pending ? '<button id="driveRetry" class="btn" style="margin-left:8px">Retry now</button>' : ''}`
        : 'Mirror is switched off (DRIVE_ENABLED=false on the server).';
      const b = $('#driveRetry');
      if (b) b.addEventListener('click', async () => {
        b.disabled = true;
        const out = await TB.api('/api/drive/retry', { method: 'POST' });
        $('#driveBody').innerHTML = `Retried: ${out.retried} uploaded, ${out.remaining} still pending.`;
      });
    } catch (e) {
      $('#driveBody').innerHTML = `<span class="err">${esc(e.message)}</span>`;
    }
  }

  // ------------------------------------------------------------------ init
  async function init({ managerMode, mount, logoSrc }) {
    state.managerMode = !!managerMode;
    state.mount = mount;
    if (logoSrc) state.logoSrc = logoSrc;
    window.addEventListener('online', () => { render(); if (state.user) loadBasics().then(render); });
    window.addEventListener('offline', render);

    if (navigator.onLine) {
      state.user = await TB.me();
      if (state.user) { try { await loadBasics(); } catch (_) {} }
    }
    render();
  }

  window.TBBackoffice = { init };
})();
