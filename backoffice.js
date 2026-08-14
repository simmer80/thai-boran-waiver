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
    if (state.user.mustChangePassword) { renderForcedChange(); return; }
    renderMain();
  }

  // Change-password form (shared markup). mode 'forced' locks the user here
  // until they set their own password (after a manager reset).
  function passwordFormHtml(mode) {
    return `
      <div class="row" style="flex-direction:column;align-items:stretch;">
        <div><label for="pwCur">${mode === 'forced' ? 'Temporary password (the one the manager gave you)' : 'Current password'}</label>
          <input id="pwCur" type="password" autocomplete="current-password" style="width:100%" /></div>
        <div><label for="pwNew">New password (at least 10 characters)</label>
          <input id="pwNew" type="password" autocomplete="new-password" style="width:100%" /></div>
        <div><label for="pwNew2">Repeat new password</label>
          <input id="pwNew2" type="password" autocomplete="new-password" style="width:100%" /></div>
        <button id="pwGo" class="btn primary">Change password</button>
        <div id="pwMsg" role="alert"></div>
      </div>`;
  }

  async function submitPasswordChange() {
    const msg = $('#pwMsg');
    msg.className = 'err'; msg.textContent = '';
    const cur = $('#pwCur').value, nw = $('#pwNew').value, nw2 = $('#pwNew2').value;
    if (nw.length < 10) { msg.textContent = 'The new password must be at least 10 characters.'; return false; }
    if (nw !== nw2) { msg.textContent = 'The two new passwords do not match.'; return false; }
    try {
      await TB.api('/api/auth/change-password', { method: 'POST', body: { currentPassword: cur, newPassword: nw } });
      state.user = await TB.me();  // refreshed flag + new cookie already set
      return true;
    } catch (e) {
      msg.textContent = e.message || 'Change failed';
      return false;
    }
  }

  function renderForcedChange() {
    state.mount.innerHTML = `
      <div class="panel" style="max-width:460px;margin:30px auto;">
        <h2 style="margin-top:0">Set your own password</h2>
        <p class="muted">Your password was reset by the manager. Before you can
        continue, choose your own password — you will use it from now on.</p>
        ${passwordFormHtml('forced')}
      </div>`;
    $('#pwGo').addEventListener('click', async () => {
      if (await submitPasswordChange()) { try { await loadBasics(); } catch (_) {} render(); }
    });
    $('#pwCur').focus();
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
          <a href="#" id="boForgot" style="font-size:13px;">Forgot password?</a>
          <div id="boForgotHelp" class="muted" style="display:none;">
            <b>Receptionists:</b> ask the manager to reset it — the Manager tab has a
            "Reset password" button for each receptionist and will show a temporary
            password to hand to you.<br/>
            <b>Manager:</b> contact the administrator (the password is reset from the
            server command line).
          </div>
        </div>
      </div>`;
    const go = async () => {
      $('#boLoginMsg').textContent = '';
      try {
        state.user = await TB.login($('#boUser').value.trim(), $('#boPass').value);
        if (!state.user.mustChangePassword) await loadBasics();
        render();
      } catch (e) {
        $('#boLoginMsg').textContent = e.offline ? 'Cannot reach the server (offline?)' : (e.message || 'Login failed');
      }
    };
    $('#boLogin').addEventListener('click', go);
    $('#boForgot').addEventListener('click', (e) => {
      e.preventDefault();
      const h = $('#boForgotHelp');
      h.style.display = h.style.display === 'none' ? 'block' : 'none';
    });
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
        <div class="row">
          <button id="boChangePw" class="btn">Change password</button>
          <button id="boLogout" class="btn">Sign out</button>
        </div>
      </div>
      <div id="boPwPanel" class="noprint"></div>
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
      <div class="panel noprint"><h2 style="margin-top:0">Users &amp; passwords</h2>
        <div id="usersBody"></div></div>
      <div class="panel noprint"><h2 style="margin-top:0">Google Drive mirror</h2>
        <div id="driveBody" class="muted">Loading…</div></div>` : ''}
    `;

    $('#boLogout').addEventListener('click', async () => { await TB.logout(); state.user = null; render(); });
    $('#boChangePw').addEventListener('click', () => {
      const p = $('#boPwPanel');
      if (p.innerHTML) { p.innerHTML = ''; return; }
      p.innerHTML = `<div class="panel" style="max-width:460px;">
        <h2 style="margin-top:0">Change password</h2>${passwordFormHtml('normal')}</div>`;
      $('#pwGo').addEventListener('click', async () => {
        if (await submitPasswordChange()) {
          p.innerHTML = '<div class="panel" style="max-width:460px;"><span class="ok">Password changed. Your other devices will need the new password.</span></div>';
          setTimeout(() => { if ($('#boPwPanel')) $('#boPwPanel').innerHTML = ''; }, 5000);
        }
      });
      $('#pwCur').focus();
    });
    $('#fApply').addEventListener('click', loadSessions);
    $('#rGen').addEventListener('click', () => loadReport(true));
    $('#rLoad').addEventListener('click', () => loadReport(false));
    loadSessions();
    if (mgr) { loadTasks(); renderTherapists(); renderUsersAdmin(); loadDrive(); }

    // Tell the page a server-verified user is present: the local device
    // sections (reception settings / manager device history) unlock off this
    // instead of asking for their legacy PINs.
    document.dispatchEvent(new CustomEvent('tb:authed', { detail: { ...state.user } }));
  }

  // Manager: reset a receptionist's password (forgot-password flow — the
  // temporary password is shown ONCE here for the manager to hand over).
  function renderUsersAdmin() {
    const host = $('#usersBody');
    const receptionists = state.users.filter((u) => u.role === 'receptionist');
    host.innerHTML = `
      <div class="muted" style="margin-bottom:8px;">
        If a receptionist forgets her password: reset it here, hand over the
        temporary password, and she will be forced to choose her own on next
        sign-in. Manager passwords cannot be reset here — that is done from
        the server command line by the administrator.
      </div>
      <div class="tableWrap"><table>
        <thead><tr><th>Username</th><th>Name</th><th>Role</th><th></th></tr></thead>
        <tbody>${state.users.map((u) => `<tr>
          <td>${esc(u.id)}</td><td>${esc(u.name)}</td><td>${esc(u.role)}</td>
          <td>${u.role === 'receptionist'
            ? `<button class="btn uReset" data-id="${esc(u.id)}" data-name="${esc(u.name)}">Reset password</button>`
            : '<span class="muted">CLI only</span>'}</td>
        </tr>`).join('')}</tbody></table></div>
      <div id="uResetOut"></div>`;
    host.querySelectorAll('.uReset').forEach((b) =>
      b.addEventListener('click', async () => {
        if (!confirm(`Reset the password for ${b.dataset.name}? Her current password stops working immediately.`)) return;
        b.disabled = true;
        try {
          const out = await TB.api(`/api/users/${encodeURIComponent(b.dataset.id)}/reset-password`, { method: 'POST' });
          $('#uResetOut').innerHTML = `<div class="panel" style="background:#fef3c7;border-color:#f59e0b;margin-top:10px;">
            <b>Temporary password for ${esc(b.dataset.name)}:</b>
            <div style="font:700 22px monospace; letter-spacing:1px; margin:8px 0;">${esc(out.tempPassword)}</div>
            Write it down and hand it over now — <b>it is shown only this once</b>.
            She must sign in with it and will be asked to choose her own password
            before she can do anything else.
            <div class="row" style="margin-top:8px;"><button class="btn" onclick="this.closest('#uResetOut, .panel').innerHTML=''">Done — hide it</button></div>
          </div>`;
        } catch (e) {
          $('#uResetOut').innerHTML = `<div class="err" style="margin-top:8px;">${esc(e.message)}</div>`;
        } finally {
          b.disabled = false;
        }
      }));
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
    // Pickers hide inactive therapists, but keep the record's current
    // assignment selectable (labelled) so old records stay editable.
    const pickable = state.therapists.filter((t) => t.active !== false || t.id === r.therapistId);
    const opts = pickable.map((t) =>
      `<option value="${esc(t.id)}" ${t.id === r.therapistId ? 'selected' : ''}>${esc(t.fullName)}${t.active === false ? ' (inactive)' : ''}</option>`).join('');
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

  const REST_DAYS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  function renderTherapists() {
    const host = $('#thBody');
    const active = state.therapists.filter((t) => t.active !== false);
    const inactive = state.therapists.filter((t) => t.active === false);

    const row = (t) => `<tr>
      <td>${esc(t.id)}</td><td>${esc(t.fullName)}</td>
      <td>${esc(t.restDay || '—')}</td><td>${(t.commissionRate ?? 0)}</td>
      <td class="row" style="gap:6px;">
        <button class="btn tEdit" data-id="${esc(t.id)}">Edit</button>
        ${t.active === false
          ? `<button class="btn tReact" data-id="${esc(t.id)}">Reactivate</button>`
          : ''}
        <button class="btn danger tRemove" data-id="${esc(t.id)}" data-name="${esc(t.fullName)}">Remove</button>
      </td></tr>`;

    host.innerHTML = `
      <div class="tableWrap"><table>
        <thead><tr><th>ID</th><th>Full name</th><th>Rest day</th><th>Rate</th><th></th></tr></thead>
        <tbody>${active.map(row).join('') || '<tr><td colspan="5" class="muted">No active therapists.</td></tr>'}</tbody>
      </table></div>
      ${inactive.length ? `
      <details style="margin-top:10px;"><summary class="btn" style="display:inline-block">Inactive (${inactive.length})</summary>
        <div class="tableWrap" style="margin-top:8px;"><table>
          <thead><tr><th>ID</th><th>Full name</th><th>Rest day</th><th>Rate</th><th></th></tr></thead>
          <tbody>${inactive.map(row).join('')}</tbody>
        </table></div>
        <div class="muted" style="margin-top:6px;">Inactive therapists are hidden from new reports and pickers; their rows in historical documents are unchanged.</div>
      </details>` : ''}
      <div class="row" style="margin-top:10px;">
        <div><label>New id</label><input id="tNewId" style="width:100px" placeholder="t-ana" /></div>
        <div><label>Full name</label><input id="tNewName" /></div>
        <button id="tAdd" class="btn primary">Add therapist</button><span id="tMsg" role="alert"></span>
      </div>
      <div id="tEditor"></div>`;

    const refresh = (out) => { state.therapists = out.therapists; renderTherapists(); };
    const fail = (e) => { $('#tMsg').className = 'err'; $('#tMsg').textContent = e.message; };

    // ---- full editor for every field
    host.querySelectorAll('.tEdit').forEach((b) => b.addEventListener('click', () => {
      const t = state.therapists.find((x) => x.id === b.dataset.id);
      if (!t) return;
      $('#tEditor').innerHTML = `<div class="panel" style="background:#f8fafc;margin-top:10px;">
        <b>Edit therapist — ${esc(t.id)}</b>
        <div class="row" style="margin-top:8px;">
          <div><label for="teName">Full name</label><input id="teName" value="${esc(t.fullName)}" /></div>
          <div><label for="teRest">Fixed rest day</label><select id="teRest">
            ${REST_DAYS.map((d) => `<option value="${d}" ${d === (t.restDay || '') ? 'selected' : ''}>${d || '(none)'}</option>`).join('')}
          </select></div>
          <div><label for="teRate">Commission rate (0–1, e.g. 0.4 = 40%)</label>
            <input id="teRate" type="number" step="0.01" min="0" max="1" value="${t.commissionRate ?? 0}" style="width:100px" /></div>
          <div><label for="teActive">Active</label><input id="teActive" type="checkbox" ${t.active !== false ? 'checked' : ''} /></div>
          <button id="teSave" class="btn primary">Save</button>
          <button id="teCancel" class="btn">Cancel</button>
          <span id="teMsg" class="err" role="alert"></span>
        </div></div>`;
      $('#teCancel').addEventListener('click', () => { $('#tEditor').innerHTML = ''; });
      $('#teSave').addEventListener('click', async () => {
        const msg = $('#teMsg'); msg.textContent = '';
        const fullName = $('#teName').value.trim();
        const rate = Number($('#teRate').value);
        if (!fullName) { msg.textContent = 'Full name cannot be empty.'; return; }
        if (!Number.isFinite(rate) || rate < 0 || rate > 1) { msg.textContent = 'Commission rate must be between 0 and 1 (e.g. 0.4).'; return; }
        try {
          refresh(await TB.api('/api/therapists/' + encodeURIComponent(t.id), {
            method: 'PATCH',
            body: { fullName, restDay: $('#teRest').value, commissionRate: rate, active: $('#teActive').checked },
          }));
        } catch (e) { msg.textContent = e.message; }
      });
    }));

    // ---- reactivate
    host.querySelectorAll('.tReact').forEach((b) => b.addEventListener('click', async () => {
      try {
        refresh(await TB.api('/api/therapists/' + encodeURIComponent(b.dataset.id), {
          method: 'PATCH', body: { active: true },
        }));
      } catch (e) { fail(e); }
    }));

    // ---- remove: deactivate when referenced, hard-delete only when clean
    host.querySelectorAll('.tRemove').forEach((b) => b.addEventListener('click', async () => {
      const id = b.dataset.id, name = b.dataset.name;
      b.disabled = true;
      try {
        const info = await TB.api('/api/therapists/' + encodeURIComponent(id) + '/references');
        if (info.referenced) {
          const n = info.references;
          const ok = confirm(
            `${name} appears in ${n.sessions} session record(s) and ${n.reports} report row(s), ` +
            `so the record cannot be deleted outright.\n\n` +
            `OK will DEACTIVATE her instead: she disappears from new reports and from pickers, ` +
            `but every historical document keeps her rows exactly as they are.`
          );
          if (ok) {
            refresh(await TB.api('/api/therapists/' + encodeURIComponent(id), {
              method: 'PATCH', body: { active: false },
            }));
          }
        } else {
          const typed = prompt(
            `${name} has no session records or report rows anywhere, so she can be permanently deleted.\n\n` +
            `Type the full name exactly (${name}) to confirm the permanent delete:`
          );
          if (typed === null) return;
          if (typed.trim() !== name) { fail(new Error('Name did not match — nothing was deleted.')); return; }
          refresh(await TB.api('/api/therapists/' + encodeURIComponent(id), { method: 'DELETE' }));
        }
      } catch (e) { fail(e); }
      finally { b.disabled = false; }
    }));

    $('#tAdd').addEventListener('click', async () => {
      try {
        refresh(await TB.api('/api/therapists', {
          method: 'POST',
          body: { id: $('#tNewId').value.trim(), fullName: $('#tNewName').value.trim() },
        }));
      } catch (e) { fail(e); }
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

  // ----------------------------------------------------- connecting state
  // Free Render servers sleep after ~15 min idle and take 30-60s to wake.
  // From the moment this tab starts contacting the server until /api/health
  // answers, show an animated connecting screen (progress bar + elapsed
  // seconds + rotating status text). Nothing else renders, so the login
  // form and all data entry are blocked until the server is really there.
  // The Waiver Form tab never runs this — capture never waits on the server.
  const CONNECT_BUDGET_MS = 90 * 1000;
  const CONNECT_MESSAGES = [
    'Contacting the server…',
    'Waking up the server… usually 30–60 seconds (free hosting sleeps when idle).',
    'Still waking up — nearly there…',
    'Almost ready — thanks for waiting.',
  ];

  async function healthOnce(timeoutMs) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch((TB.CFG.apiBase || '') + '/api/health', { signal: ctl.signal, cache: 'no-store' });
      return res.ok;
    } catch (_) {
      return false;
    } finally {
      clearTimeout(t);
    }
  }

  function renderConnecting() {
    state.mount.innerHTML = `
      <div class="tb-connect" role="status" aria-live="polite">
        <h2>Connecting to the server</h2>
        <div class="tb-progress" aria-hidden="true"></div>
        <div class="status" id="tbConnMsg">${CONNECT_MESSAGES[0]}</div>
        <div class="secs"><span id="tbConnSecs">0</span> seconds elapsed</div>
        <div class="muted" style="margin-top:14px;font-size:12px;color:#888;">
          The Waiver Form tab keeps working while this connects.
        </div>
      </div>`;
  }

  function renderConnectFailed() {
    state.mount.innerHTML = `
      <div class="tb-connect">
        <h2>Could not reach the server</h2>
        <div class="status">
          No answer after 90 seconds. Either the WiFi is down, or the server is
          having trouble starting. The <b>Waiver Form</b> tab keeps working
          offline — captured waivers sync automatically once the connection
          returns.
        </div>
        <div class="row" style="justify-content:center;margin-top:14px;">
          <button id="tbConnRetry" class="btn primary">Try again</button>
        </div>
      </div>`;
    $('#tbConnRetry').addEventListener('click', () => startup());
  }

  // Poll /api/health with backoff until it answers or the budget runs out.
  async function connectToServer() {
    renderConnecting();
    const started = Date.now();
    let msgIdx = 0;
    const secsTimer = setInterval(() => {
      const el = $('#tbConnSecs');
      if (el) el.textContent = Math.floor((Date.now() - started) / 1000);
    }, 500);
    const msgTimer = setInterval(() => {
      const el = $('#tbConnMsg');
      msgIdx = Math.min(msgIdx + 1, CONNECT_MESSAGES.length - 1);
      if (el) el.textContent = CONNECT_MESSAGES[msgIdx];
    }, 8000);

    try {
      let delay = 1000;
      while (Date.now() - started < CONNECT_BUDGET_MS) {
        // Long per-attempt timeout: the request that triggers the wake can
        // itself hang until the server is up.
        const remaining = CONNECT_BUDGET_MS - (Date.now() - started);
        if (await healthOnce(Math.min(15000, remaining))) return true;
        if (CONNECT_BUDGET_MS - (Date.now() - started) <= 0) break;
        await new Promise((r) => setTimeout(r, delay));
        delay = Math.min(delay * 1.5, 5000); // gentle backoff
      }
      return false;
    } finally {
      clearInterval(secsTimer);
      clearInterval(msgTimer);
    }
  }

  // Full entry sequence: connect -> restore session -> render. Runs on page
  // load, on Retry, and when the connection comes back.
  let startingUp = false;
  async function startup() {
    if (startingUp) return;
    startingUp = true;
    try {
      if (!navigator.onLine) { render(); return; }
      const ok = await connectToServer();
      if (!ok) { renderConnectFailed(); return; }
      state.user = await TB.me();
      if (state.user && !state.user.mustChangePassword) {
        try { await loadBasics(); } catch (_) {}
      }
      render(); // straight into login form or dashboard — no extra click
    } finally {
      startingUp = false;
    }
  }

  // ------------------------------------------------------------------ init
  async function init({ managerMode, mount, logoSrc }) {
    state.managerMode = !!managerMode;
    state.mount = mount;
    if (logoSrc) state.logoSrc = logoSrc;
    window.addEventListener('online', () => startup());
    window.addEventListener('offline', render);
    await startup();
  }

  window.TBBackoffice = { init };
})();
