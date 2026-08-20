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
  // Safe inside an attribute selector (therapist names can carry anything).
  const cssq = (s) => (window.CSS && CSS.escape ? CSS.escape(String(s ?? '')) : String(s ?? '').replace(/["\\]/g, '\\$&'));
  const money0 = (n) => (Number(n) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // The four documents, named exactly as the office names them. "Sales
  // Weekly Report" and "Main Office Daily Sales Report" are different sheets
  // going to different places, so nothing anywhere shortens them to "sales".
  const TYPE_LABELS = {
    'daily-commission': 'Therapist Daily Commission Report',
    'weekly-payroll': 'Therapist Weekly Commission Report',
    'weekly-sales': 'Sales Weekly Report',
    'main-office-daily-sales': 'Main Office Daily Sales Report',
  };
  // Daily documents take any date; weekly ones snap to their Monday.
  const DAILY_TYPES = ['daily-commission', 'main-office-daily-sales'];

  const state = {
    managerMode: false, mount: null, logoSrc: '../assets/thai_boran_logo.png',
    user: null, therapists: [], users: [], branchCfg: {},
    report: null, reportType: 'daily-commission', reportPeriod: '',
    editMode: false,     // editing the values IN the document template
    section: '',         // which step of the role's workflow is on screen
    tom: null,           // service -> TOM code, straight from the org config

    liveSubSigUrl: '', liveSubSigKey: undefined,
    sessions: [], editingId: null,
    site: '',            // which parlor's data this screen shows
    prices: [],          // org-shared price sets (server copy, manager panel)
  };

  const SITE_LABELS = { 'panacan': 'Panacan', 'airport-road': 'Airport Road' };
  const PDF_SITE = { 'panacan': 'Panacan', 'airport-road': 'AirportRoad' };
  const PDF_DOC = {
    'daily-commission': 'Therapist-Daily-Commission-Report',
    'weekly-payroll': 'Therapist-Weekly-Commission-Report',
    'weekly-sales': 'Sales-Weekly-Report',
    'main-office-daily-sales': 'Main-Office-Daily-Sales-Report',
  };
  const siteBadge = (site, big) =>
    `<span class="site-badge${big ? ' big' : ''}">Thai Boran — ${esc(SITE_LABELS[site] || site || '?')}</span>`;
  const siteQ = () => 'site=' + encodeURIComponent(state.site);

  // Wrap an async click action: the button disables (and can relabel) while
  // the work runs, so double-clicks can never fire it twice.
  async function busy(btn, label, fn) {
    if (!btn || btn.disabled) return;
    const old = btn.textContent;
    btn.disabled = true;
    if (label) btn.textContent = label;
    try {
      return await fn();
    } finally {
      btn.disabled = false;
      btn.textContent = old;
    }
  }

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
    // The Manager tab is manager-only, at the UI level too. The server has
    // always refused a receptionist's manager requests, but the tab still
    // rendered and greeted her by name, which reads like access. Nothing of
    // the manager UI is built for a non-manager now.
    if (state.managerMode && !isManager(state.user)) { renderNotManager(); return; }
    renderMain();
  }

  const isManager = (u) => !!u && (u.role === 'manager' || u.role === 'admin');

  // Wrong-role screen for the Manager tab: says so plainly and offers the
  // two useful ways out — go where this account belongs, or switch account.
  function renderNotManager() {
    state.mount.innerHTML = `
      <div class="panel" style="max-width:520px;margin:30px auto;text-align:center;">
        <div style="font-size:34px;line-height:1;margin-bottom:6px;">🔒</div>
        <h2 style="margin-top:0">Manager access requires a manager login</h2>
        <p class="muted" style="font-size:14px;">
          You are signed in as <b>${esc(state.user.name)}</b>
          (${esc(state.user.role)}). This tab is for the manager only —
          tasks, approvals, prices, therapists, users and the Drive mirror
          all live here.
        </p>
        <p class="muted" style="font-size:14px;">
          Everything you need is in the <b>Receptionist</b> tab: waivers,
          sessions and sales, the documents, and the approved copies.
        </p>
        <div class="row" style="justify-content:center;margin-top:12px;">
          <a class="btn primary" href="../reception/">Go to the Receptionist tab</a>
          <button id="boSwitch" class="btn">Sign out / switch account</button>
        </div>
      </div>`;
    // The page's own local-device sections (PIN card, history, sales) are
    // part of the Manager tab too — they hide themselves on this signal.
    document.dispatchEvent(new CustomEvent('tb:denied', { detail: { role: state.user.role } }));
    $('#boSwitch').addEventListener('click', () => busy($('#boSwitch'), 'Signing out…', async () => {
      await TB.logout();
      state.user = null;
      render();
    }));
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
      const out = await TB.api('/api/auth/change-password', { method: 'POST', body: { currentPassword: cur, newPassword: nw } });
      if (out.token) TB.setToken(out.token); // old token died with the tokenVersion bump
      state.user = await TB.me();  // refreshed flag under the fresh token
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
    $('#pwGo').addEventListener('click', () => busy($('#pwGo'), 'Changing…', async () => {
      if (await submitPasswordChange()) { try { await loadBasics(); } catch (_) {} render(); }
    }));
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
    const go = () => busy($('#boLogin'), 'Signing in…', async () => {
      $('#boLoginMsg').textContent = '';
      try {
        state.user = await TB.login($('#boUser').value.trim(), $('#boPass').value);
        if (!state.user.mustChangePassword) await loadBasics();
        render();
      } catch (e) {
        $('#boLoginMsg').textContent = TB.explain(e, 'sign you in');
      }
    });
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
    // default site: the device's own parlor (iPads); the laptop has none and
    // the manager picks per view
    if (!state.site) state.site = TB.deviceSite();
    if (!state.site && !state.managerMode) state.site = 'panacan';
    const [t, u] = await Promise.all([TB.api('/api/therapists'), TB.api('/api/users')]);
    state.therapists = t.therapists;
    state.users = u.users;
    if (state.site) {
      const c = await TB.api('/api/branch-config?' + siteQ());
      state.branchCfg = c.config || {};
    }
  }

  // ------------------------------------------------------- the work areas
  // Each role sees the steps of ITS OWN job, in order, one at a time —
  // rather than every panel the app owns stacked on one page.
  //
  //   Front desk : Today -> Documents -> This device
  //   Manager    : To approve -> Documents -> Admin
  //
  // Sales, history and the approved archive are deliberately NOT here: they
  // live in the shared "Sales & history" area (records/), which both roles
  // reach from the top navigation and which locks itself when left idle.
  const SECTIONS = {
    reception: [
      { id: 'today', label: 'Today', sub: 'Check and correct the day' },
      { id: 'documents', label: 'Documents', sub: 'Create, sign, submit' },
      { id: 'device', label: 'This device', sub: 'Photo and local records' },
    ],
    manager: [
      { id: 'approve', label: 'To approve', sub: 'Waiting for you' },
      { id: 'documents', label: 'Documents', sub: 'View any document' },
      { id: 'admin', label: 'Admin', sub: 'Prices, staff, users' },
    ],
  };

  const sectionsFor = () => SECTIONS[state.managerMode ? 'manager' : 'reception'];

  function renderMain() {
    const mgr = state.managerMode;
    const list = sectionsFor();
    if (!list.some((x) => x.id === state.section)) state.section = list[0].id;

    state.mount.innerHTML = `
      <div class="boBar noprint">
        <div class="boWho">
          <div class="boWhoName">${esc(state.user.name)}</div>
          <div class="boWhoRole">${esc(mgr ? 'Manager' : 'Front desk')} · ${esc(state.user.branch)}</div>
        </div>
        <div class="boSite">
          ${mgr
            ? `<label for="boSite">Parlor</label>
               <select id="boSite">
                 <option value="">— choose parlor —</option>
                 ${Object.entries(SITE_LABELS).map(([id, l]) =>
                   `<option value="${id}" ${state.site === id ? 'selected' : ''}>${esc(l)}</option>`).join('')}
               </select>`
            : siteBadge(state.site, true)}
        </div>
        <div class="boBarActions">
          <a class="btn" href="../records/">Sales &amp; history</a>
          <button id="boChangePw" class="btn">Password</button>
          <button id="boLogout" class="btn">Sign out</button>
        </div>
      </div>
      <div id="boPwPanel" class="noprint"></div>
      <nav class="boNav noprint" role="tablist">
        ${list.map((x) => `
          <button role="tab" class="boNavItem${x.id === state.section ? ' active' : ''}" data-sec="${x.id}"
            aria-selected="${x.id === state.section}">
            <span class="l">${esc(x.label)}</span><span class="s">${esc(x.sub)}</span>
            ${x.id === 'approve' ? '<span class="boBadge" id="boTaskCount" hidden></span>' : ''}
          </button>`).join('')}
      </nav>
      <div id="boSection"></div>`;

    state.mount.querySelectorAll('.boNavItem').forEach((b) =>
      b.addEventListener('click', () => {
        if (!confirmDiscard()) return;
        state.editMode = false;
        state.section = b.dataset.sec;
        renderMain();
      }));

    if (mgr) {
      $('#boSite').addEventListener('change', async () => {
        state.site = $('#boSite').value;
        state.report = null;
        if (state.site) {
          try { state.branchCfg = (await TB.api('/api/branch-config?' + siteQ())).config || {}; } catch (_) {}
        }
        renderMain();
      });
    }
    $('#boLogout').addEventListener('click', async () => { await TB.logout(); state.user = null; render(); });
    $('#boChangePw').addEventListener('click', () => {
      const p = $('#boPwPanel');
      if (p.innerHTML) { p.innerHTML = ''; return; }
      p.innerHTML = `<div class="panel" style="max-width:460px;">
        <h2 style="margin-top:0">Change password</h2>${passwordFormHtml('normal')}</div>`;
      $('#pwGo').addEventListener('click', () => busy($('#pwGo'), 'Changing…', async () => {
        if (await submitPasswordChange()) {
          p.innerHTML = '<div class="panel" style="max-width:460px;"><span class="ok">Password changed. Your other devices will need the new password.</span></div>';
          setTimeout(() => { if ($('#boPwPanel')) $('#boPwPanel').innerHTML = ''; }, 5000);
        }
      }));
      $('#pwCur').focus();
    });

    renderSection();
    if (mgr) loadTasks();   // keeps the "waiting for you" badge current

    // Tell the page a server-verified user is present: the local device
    // sections unlock off this instead of asking for their legacy PINs.
    document.dispatchEvent(new CustomEvent('tb:authed', { detail: { ...state.user } }));
  }

  const needSite = (what) =>
    `<div class="panel"><div class="muted">Choose a parlor at the top to see ${what}.</div></div>`;

  function renderSection() {
    const host = $('#boSection');
    const mgr = state.managerMode;
    if (state.section === 'today') return renderToday(host);
    if (state.section === 'documents') return renderDocuments(host);
    if (state.section === 'device') return renderDeviceSection(host);
    if (state.section === 'approve') return renderApproveSection(host);
    if (state.section === 'admin') return renderAdminSection(host);
    host.innerHTML = '';
  }

  // ---------------------------------------------------------------- today
  // The receptionist's first screen: what happened today, ready to correct.
  function renderToday(host) {
    if (!state.site) { host.innerHTML = needSite('the day'); return; }
    host.innerHTML = `
      <div class="panel">
        <div class="secHead">
          <h2>Today at a glance</h2>
          <div class="muted">Every waiver that synced. Tap <b>Edit</b> on a line to fix
            the therapist, hours, stub number, add-ons or how it was paid — the
            correction updates the record itself, so the documents you make
            afterwards already have it.</div>
        </div>
        <div class="row">
          <div><label for="fFrom">From</label><input type="date" id="fFrom" value="${todayISO()}" /></div>
          <div><label for="fTo">To</label><input type="date" id="fTo" value="${todayISO()}" /></div>
          <div><label for="fRec">Receptionist</label><select id="fRec"><option value="">All</option>
            ${state.users.map((u) => `<option value="${esc(u.id)}">${esc(u.name)}</option>`).join('')}</select></div>
          <div><label for="fTher">Therapist</label><select id="fTher"><option value="">All</option>
            ${state.therapists.map((t) => `<option value="${esc(t.id)}">${esc(t.fullName)}</option>`).join('')}</select></div>
          <button id="fApply" class="btn primary">Show</button>
          <span id="fMsg" class="muted" role="status"></span>
        </div>
        <div class="tableWrap" style="margin-top:10px;">
          <table><thead><tr>
            <th>Date</th><th>Time</th><th>Customer</th><th>Therapist</th><th>Service</th>
            <th>Add-Ons</th><th>Stub #</th><th>Hrs</th><th>Paid by</th>
            <th class="num">Net</th><th class="num">Comm.</th><th>By</th><th></th>
          </tr></thead><tbody id="sessRows"></tbody>
          <tfoot><tr id="sessTotals"></tr></tfoot></table>
        </div>
        <div id="sessEdit"></div>
      </div>
      <div class="panel nextStep noprint">
        <div>Sessions look right?</div>
        <button id="toDocs" class="btn primary">Make today’s documents →</button>
      </div>`;
    $('#fApply').addEventListener('click', loadSessions);
    $('#toDocs').addEventListener('click', () => { state.section = 'documents'; renderMain(); });
    loadSessions();
  }

  // ------------------------------------------------------------ documents
  // The receptionist creates; the manager only looks. Same viewer either way.
  function renderDocuments(host) {
    const mgr = state.managerMode;
    if (!state.site) { host.innerHTML = needSite('its documents'); return; }
    host.innerHTML = `
      <div class="panel noprint">
        <div class="secHead">
          <h2>${mgr ? 'View a document' : 'The day’s documents'}</h2>
          <div class="muted">${mgr
            ? 'Open any document for this parlor and period, exactly as it stands. Documents are created and corrected at the front desk.'
            : 'Build it from the records, correct anything that needs it, sign, and send it to the manager.'}</div>
        </div>
        <div class="row">
          <div><label for="rType">Document</label><select id="rType">
            ${Object.entries(TYPE_LABELS).map(([k, v]) =>
              `<option value="${k}" ${state.reportType === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}
          </select></div>
          <div><label for="rPeriod">Date <span class="muted">(weekly documents use that day’s week)</span></label>
            <input type="date" id="rPeriod" value="${esc(state.reportPeriod || todayISO())}" /></div>
          ${mgr ? '' : '<button id="rGen" class="btn primary" title="Builds the document from the session records. Corrections you saved are kept.">Create / refresh from records</button>'}
          <button id="rLoad" class="btn">Open saved</button>
          <span id="rMsg" class="muted" role="status"></span>
        </div>
        <div id="rStatus" style="margin-top:8px;"></div>
        <div id="rActions" class="row" style="margin-top:8px;"></div>
      </div>
      <div id="rManual" class="noprint"></div>
      <div class="panel">
        <div id="rDoc">
          <div class="muted">${mgr
            ? 'Choose a document and a date, then press “Open saved”.'
            : 'Choose a document and a date, then press “Create / refresh from records”.'}</div>
        </div>
      </div>`;

    if ($('#rGen')) {
      $('#rGen').addEventListener('click', () => busy($('#rGen'), 'Working…', async () => {
        if (!confirmDiscard()) return;
        state.editMode = false;
        return loadReport(true);
      }));
    }
    $('#rLoad').addEventListener('click', () => busy($('#rLoad'), 'Opening…', async () => {
      if (!confirmDiscard()) return;
      state.editMode = false;
      return loadReport(false);
    }));
    if (state.report) renderReport();
  }

  // --------------------------------------------------------- to approve
  function renderApproveSection(host) {
    host.innerHTML = `
      <div class="panel">
        <div class="secHead">
          <h2>Waiting for your approval</h2>
          <div class="muted">Both parlors. Opening one takes you to the document,
            signed by the receptionist, ready to read and approve.</div>
        </div>
        <div id="boTasksBody" class="muted">Loading…</div>
      </div>`;
    loadTasks();
  }

  // -------------------------------------------------------------- admin
  function renderAdminSection(host) {
    host.innerHTML = `
      <div class="panel noprint"><h2 style="margin-top:0">Prices
        <span class="muted" style="font-size:12px;">(shared — both parlors charge the same)</span></h2>
        <div id="pricesBody" class="muted">Loading…</div></div>
      <div class="panel noprint"><h2 style="margin-top:0">TOM codes
        <span class="muted" style="font-size:12px;">(the short code on the Main Office Daily Sales Report)</span></h2>
        <div id="tomBody" class="muted">Loading…</div></div>
      <div class="panel noprint"><h2 style="margin-top:0">Therapists
        <span class="muted" style="font-size:12px;">(shared — staff rotate between parlors)</span></h2>
        <div id="thBody"></div></div>
      <div class="panel noprint"><h2 style="margin-top:0">Users &amp; passwords</h2>
        <div id="usersBody"></div></div>
      <div class="panel noprint"><h2 style="margin-top:0">Google Drive mirror</h2>
        <div id="driveBody" class="muted">Loading…</div></div>`;
    renderPricesAdmin();
    renderTomCodes();
    renderTherapists();
    renderUsersAdmin();
    loadDrive();
  }

  // ------------------------------------------------------------ TOM codes
  // The short code written in the TOM column of the Main Office Daily Sales
  // Report. The pairing is business data, so the manager owns it here and no
  // code is ever written into the app: a new service gets a code in this
  // panel and the next document already prints it.
  async function renderTomCodes() {
    const host = $('#tomBody');
    if (!host) return;
    try {
      const out = await TB.api('/api/tom-codes');
      state.tom = out;
      const { codes, services, missing } = out;

      // Everything with a code, plus every priced service without one.
      const coded = Object.entries(codes)
        .map(([service, code]) => ({ service, code, priced: services.includes(service) }))
        .sort((a, b) => a.service.localeCompare(b.service));
      const uncoded = missing.map((service) => ({ service, code: '', priced: true }));
      const rows = [...coded, ...uncoded].sort((a, b) => a.service.localeCompare(b.service));

      host.innerHTML = `
        <div class="muted" style="margin-bottom:8px;">
          Each service gets a short code — BS, TS, BK, TB, TA, F — and the daily
          sales sheet prints that code instead of the full name. A service with
          no code prints its full name until you give it one.
        </div>
        ${missing.length ? `<div class="tomMissing">
          <b>${missing.length} service${missing.length > 1 ? 's' : ''} still without a code:</b>
          ${missing.map((m) => esc(m)).join(', ')}
        </div>` : '<div class="ok" style="margin-bottom:8px;">Every service in the price list has a code.</div>'}
        <div class="tableWrap"><table>
          <thead><tr><th>Service</th><th style="width:120px;">TOM code</th><th style="width:190px;"></th></tr></thead>
          <tbody>${rows.map((r) => `<tr data-service="${esc(r.service)}">
            <td>${esc(r.service)}${r.priced ? '' : ' <span class="muted">(not in the price list)</span>'}</td>
            <td><input class="tomIn" data-service="${esc(r.service)}" value="${esc(r.code)}"
              maxlength="6" size="6" inputmode="text" autocapitalize="characters"
              aria-label="TOM code for ${esc(r.service)}" placeholder="—" /></td>
            <td class="row" style="gap:6px;">
              <button class="btn primary tomSave" data-service="${esc(r.service)}">Save</button>
              ${r.code ? `<button class="btn tomClear" data-service="${esc(r.service)}">Clear</button>` : ''}
            </td>
          </tr>`).join('')}</tbody>
        </table></div>
        <div class="panel" style="background:#f8fafc;margin-top:12px;">
          <b>Add a service and its code</b>
          <div class="muted">For something the price list does not carry yet.</div>
          <div class="row" style="margin-top:8px;">
            <div><label for="tomNewService">Service</label>
              <input id="tomNewService" placeholder="e.g. Hot Stone Ritual" style="width:260px" /></div>
            <div><label for="tomNewCode">TOM code</label>
              <input id="tomNewCode" maxlength="6" style="width:100px" autocapitalize="characters" placeholder="e.g. HSR" /></div>
            <button id="tomAdd" class="btn primary">Add</button>
          </div>
        </div>
        <div id="tomMsg" role="status" style="margin-top:8px;"></div>`;

      const msg = (text, cls) => {
        const m = $('#tomMsg');
        m.className = cls || '';
        m.textContent = text;
        if (cls === 'ok') {
          const mine = text;
          setTimeout(() => { if (m.isConnected && m.textContent === mine) { m.className = ''; m.textContent = ''; } }, 4000);
        }
      };

      // Same shape of validation as the therapist editor: check here first so
      // a typo never costs a round trip, and let the server have the last word.
      const localProblem = (code) => {
        const c = String(code || '').trim().toUpperCase();
        if (!c) return 'Enter a code.';
        if (c.length > 6) return 'A code can be at most 6 characters.';
        for (const ch of c) {
          const ok = (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9');
          if (!ok) return 'Codes use letters and digits only.';
        }
        return null;
      };
      const flag = (input, problem) => {
        input.classList.toggle('bad', !!problem);
        input.title = problem || '';
      };

      const saveOne = async (service, code, btn) => {
        const input = host.querySelector(`.tomIn[data-service="${cssq(service)}"]`);
        const problem = localProblem(code);
        if (input) flag(input, problem);
        if (problem) { msg(problem, 'err'); if (input) input.focus(); return; }
        try {
          state.tom = await TB.api('/api/tom-codes/' + encodeURIComponent(service), {
            method: 'PUT', body: { code },
          });
          await renderTomCodes();                       // list refreshes itself
          $('#tomMsg').className = 'ok';
          $('#tomMsg').textContent = `${service} → ${String(code).trim().toUpperCase()} ✓`;
          setTimeout(() => { const m = $('#tomMsg'); if (m && m.className === 'ok') { m.className = ''; m.textContent = ''; } }, 4000);
        } catch (e) {
          if (input) flag(input, e.message);
          msg(e.message, 'err');
        }
      };

      host.querySelectorAll('.tomIn').forEach((el) => {
        el.addEventListener('input', () => flag(el, localProblem(el.value)));
        el.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') host.querySelector(`.tomSave[data-service="${cssq(el.dataset.service)}"]`).click();
        });
      });
      host.querySelectorAll('.tomSave').forEach((b) =>
        b.addEventListener('click', () => busy(b, 'Saving…', () => {
          const input = host.querySelector(`.tomIn[data-service="${cssq(b.dataset.service)}"]`);
          return saveOne(b.dataset.service, input.value, b);
        })));
      host.querySelectorAll('.tomClear').forEach((b) =>
        b.addEventListener('click', () => busy(b, 'Clearing…', async () => {
          if (!confirm(`Remove the code for ${b.dataset.service}? The sheet will print its full name again.`)) return;
          try {
            state.tom = await TB.api('/api/tom-codes/' + encodeURIComponent(b.dataset.service), { method: 'DELETE' });
            await renderTomCodes();
          } catch (e) { msg(e.message, 'err'); }
        })));

      $('#tomAdd').addEventListener('click', () => busy($('#tomAdd'), 'Adding…', async () => {
        const service = $('#tomNewService').value.trim();
        const code = $('#tomNewCode').value.trim();
        if (!service) { msg('Enter the service name.', 'err'); $('#tomNewService').focus(); return; }
        const problem = localProblem(code);
        if (problem) { msg(problem, 'err'); $('#tomNewCode').focus(); return; }
        try {
          state.tom = await TB.api('/api/tom-codes/' + encodeURIComponent(service), {
            method: 'PUT', body: { code },
          });
          await renderTomCodes();
          $('#tomMsg').className = 'ok';
          $('#tomMsg').textContent = `${service} → ${code.toUpperCase()} ✓ added`;
        } catch (e) { msg(e.message, 'err'); }
      }));
    } catch (e) {
      host.innerHTML = `<span class="err">${esc(e.message)}</span>`;
    }
  }

  // -------------------------------------------------------- this device
  // Two separate things that used to share one box: what the WAIVER FORM
  // does on this iPad, and the records this iPad captured.
  function renderDeviceSection(host) {
    host.innerHTML = `
      <div class="panel" id="devicePhoto">
        <div class="secHead">
          <h2>Client photo</h2>
          <div class="muted">Controls the photo step on the Waiver Form tab of this iPad.</div>
        </div>
        <div id="photoBox"></div>
      </div>
      <div class="panel" id="deviceRecords">
        <div class="secHead">
          <h2>Local records on this iPad</h2>
          <div class="muted">Waivers captured here. You can add add-ons a client asked
            for mid-session; the price, the hours and the day’s totals follow automatically.</div>
        </div>
        <div id="localPanels"></div>
        <div class="row" style="margin-top:8px;">
          <button id="btnEditRecords" class="btn primary">Show local records</button>
          <span id="localMsg" class="muted" role="status"></span>
        </div>
      </div>`;
    document.dispatchEvent(new CustomEvent('tb:device-section', { detail: {} }));
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
            : '<span class="muted" title="Manager passwords can only be reset by the administrator, from the server — not in the app.">ask administrator</span>'}</td>
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
    if (!state.site || !$('#sessRows')) return;   // not on this step
    $('#fMsg').textContent = 'Loading…';
    try {
      const q = new URLSearchParams({
        site: state.site,
        from: $('#fFrom').value, to: $('#fTo').value || $('#fFrom').value,
      });
      if ($('#fRec').value) q.set('receptionistId', $('#fRec').value);
      if ($('#fTher').value) q.set('therapistId', $('#fTher').value);
      const out = await TB.api('/api/sessions?' + q.toString());
      state.sessions = out.records;
      $('#fMsg').textContent = `${out.records.length} record(s)`;
      const linked = (r) => state.therapists.some((t) => t.id === r.therapistId);
      const rows = out.records.map((r) => `<tr data-id="${esc(r.id)}">
        <td>${esc(r.date)}</td><td>${esc(r.timestart)}</td><td>${esc(r.customer)}</td>
        <td>${linked(r)
          ? esc(r.therapistName || therapistName(r.therapistId))
          : `<span class="err" title="The typed name matches no therapist — open Edit and pick the right one; the commission will be recalculated.">⚠ unlinked: ${esc(r.therapistName || r.therapistId || '(blank)')}</span>`}</td>
        <td>${esc(r.service)}</td><td>${esc(r.addons)}</td>
        <td>${esc(r.stubNumber)}</td><td>${esc(r.hours)}</td>
        <td>${r.paymentMethod === 'bpi' ? 'BPI' : 'Cash'}</td>
        <td class="num">${money0(r.net)}</td><td class="num">${money0(r.commission)}</td>
        <td>${esc(r.receptionistName)}</td>
        <td><button class="btn boEdit" data-id="${esc(r.id)}">Edit</button></td>
      </tr>`).join('');
      $('#sessRows').innerHTML = rows ||
        `<tr><td colspan="13" class="muted">No records between ${esc($('#fFrom').value)} and ${esc($('#fTo').value)}.
         Waivers submitted on the iPad appear here automatically — try a wider date range, or clear the
         receptionist/therapist filters.</td></tr>`;
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
    const isLinked = state.therapists.some((t) => t.id === r.therapistId);
    $('#sessEdit').innerHTML = `<div class="panel" style="background:#f8fafc;margin-top:10px;">
      <b>Edit: ${esc(r.customer)} — ${esc(r.date)} ${esc(r.timestart)}</b>
      ${!isLinked ? `<div class="err" style="margin-top:6px;">⚠ Unlinked therapist — the waiver recorded
        "${esc(r.therapistName || r.therapistId || '(blank)')}", which matches no therapist.
        Pick the correct one below; the commission recalculates from their rate.</div>` : ''}
      <div class="row" style="margin-top:8px;">
        <div><label>Therapist</label><select id="eTher"><option value="">(unassigned)</option>${opts}</select></div>
        <div><label>Stub # (waiver number)</label><input id="eStub" value="${esc(r.stubNumber)}" style="width:110px" /></div>
        <div><label>Hours</label><input id="eHours" type="number" step="0.5" min="0" value="${esc(r.hours)}" style="width:90px" /></div>
        <div><label>Payment</label><select id="ePay">
          <option value="cash" ${r.paymentMethod !== 'bpi' ? 'selected' : ''}>Cash</option>
          <option value="bpi" ${r.paymentMethod === 'bpi' ? 'selected' : ''}>BPI (card)</option></select></div>
        <div><label>Commission</label><input id="eComm" type="number" step="0.01" min="0" value="${esc(r.commission)}" style="width:110px" /></div>
        <button id="eAuto" class="btn" title="Fill from the therapist's commission rate × the price paid">Calculate (rate × price)</button>
        <button id="eSave" class="btn primary">Save</button>
        <button id="eCancel" class="btn">Cancel</button>
        <span id="eMsg" role="status"></span>
      </div></div>`;
    const recalcFromRate = () => {
      const t = state.therapists.find((x) => x.id === $('#eTher').value);
      if (t) $('#eComm').value = Math.round((t.commissionRate || 0) * (Number(r.net) || 0) * 100) / 100;
    };
    $('#eAuto').addEventListener('click', recalcFromRate);
    // Relinking an unlinked record: recalculate the commission from the
    // newly chosen therapist's rate automatically (still editable pre-save).
    if (!isLinked) $('#eTher').addEventListener('change', recalcFromRate);
    $('#eCancel').addEventListener('click', () => { $('#sessEdit').innerHTML = ''; });
    $('#eSave').addEventListener('click', () => busy($('#eSave'), 'Saving…', async () => {
      $('#eMsg').textContent = 'Saving…';
      try {
        // Same server path the document write-back uses: one audit trail,
        // and the correction survives a later re-sync from the tablet.
        const fields = {
          therapistId: $('#eTher').value,
          therapistName: therapistName($('#eTher').value) || r.therapistName,
          stubNumber: $('#eStub').value.trim(),
          hours: Number($('#eHours').value) || 0,
          paymentMethod: $('#ePay').value,
          commission: Number($('#eComm').value) || 0,
        };
        await TB.api(`/api/sessions/${encodeURIComponent(r.id)}?` + siteQ(), {
          method: 'PATCH', body: { date: r.date, fields },
        });
        $('#sessEdit').innerHTML = '';
        await loadSessions(); // refresh writes its own count into #fMsg…
        const m = $('#fMsg');  // …then prepend the success confirmation
        m.className = 'ok';
        m.textContent = 'Saved ✓ · ' + m.textContent;
        setTimeout(() => { if (m.isConnected) m.className = 'muted'; }, 3000);
      } catch (e) {
        $('#eMsg').className = 'err'; $('#eMsg').textContent = e.message;
      }
    }));
  }

  // --------------------------------------------------------------- reports
  function periodFor(type, anyDate) {
    return DAILY_TYPES.includes(type) ? anyDate : mondayOf(anyDate);
  }

  async function loadReport(generate) {
    if (!state.site) { $('#rMsg').className = 'err'; $('#rMsg').textContent = 'Choose a parlor first (top of the page).'; return; }
    const type = $('#rType').value;
    const period = periodFor(type, $('#rPeriod').value || todayISO());
    state.reportType = type; state.reportPeriod = period;
    $('#rMsg').textContent = generate ? 'Generating…' : 'Loading…';
    try {
      let report;
      if (generate) {
        report = (await TB.api(`/api/reports/${type}/${period}/generate?` + siteQ(), { method: 'POST' })).report;
      } else {
        report = (await TB.api(`/api/reports/${type}/${period}?` + siteQ())).report;
      }
      state.report = report;
      $('#rMsg').textContent = '';
      renderReport();
    } catch (e) {
      $('#rMsg').className = 'err';
      $('#rMsg').textContent = TB.explain(e, generate ? 'build the document' : 'open the document')
        .split(String.fromCharCode(10))[0];
      $('#rMsg').title = TB.explain(e, generate ? 'build the document' : 'open the document');
      setTimeout(() => { $('#rMsg').className = 'muted'; }, 8000);
    }
  }

  function renderReport() {
    const r = state.report;
    if (!r) return;
    $('#rStatus').innerHTML = `${siteBadge(state.site, true)} <b>${esc(TYPE_LABELS[r.type])}</b> — ${esc(r.period)} — version ${r.version} —
      <span class="status-${esc(r.status)}">${esc(r.status.toUpperCase())}</span>
      ${r.submittedByName ? ` · submitted by ${esc(r.submittedByName)}` : ''}
      ${r.approvedByName ? ` · approved by ${esc(r.approvedByName)} at ${esc(r.approvedAt)}` : ''}`;

    // Documents are created and corrected at the front desk. The manager
    // reads and approves — never edits someone else's figures.
    const editable = r.status !== 'approved' && !state.managerMode;
    const acts = [];
    if (editable) {
      acts.push(`<button id="aEdit" class="btn ${state.editMode ? '' : 'primary'}">${
        state.editMode ? 'Stop correcting' : '✎ Correct values on the document'}</button>`);
    }
    acts.push('<button id="aPdf" class="btn">Export PDF</button>');
    acts.push('<button id="aPrint" class="btn">Print</button>');
    if (r.status === 'draft') acts.push('<button id="aSubmit" class="btn primary">Submit for approval</button>');
    if (state.managerMode && r.status === 'submitted') acts.push('<button id="aApprove" class="btn approve">Approve ✓</button>');
    $('#rActions').innerHTML = acts.join('');

    if (!editable) state.editMode = false;
    renderDocument();
    loadSubmitterSignature();

    if ($('#aEdit')) $('#aEdit').addEventListener('click', () => {
      if (state.editMode && !confirmDiscard()) return;
      state.editMode = !state.editMode;
      renderReport();
      if (state.editMode) $('#rManual').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });

    $('#aPdf').addEventListener('click', () => busy($('#aPdf'), 'Preparing PDF…', async () => {
      try {
        const blob = await TB.api(`/api/reports/${r.type}/${r.period}/pdf?` + siteQ());
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `ThaiBoran-${PDF_SITE[state.site] || state.site}_${PDF_DOC[r.type]}_${r.period}${r.status === 'approved' ? '_approved' : ''}.pdf`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      } catch (e) { TB.sorry(e, 'make the PDF'); }
    }));
    $('#aPrint').addEventListener('click', () => window.print());
    if ($('#aSubmit')) $('#aSubmit').addEventListener('click', () => busy($('#aSubmit'), 'Submitting…', async () => {
      // Submitting is signing. She draws her signature here and it is kept
      // with THIS version of the document, printed under "Raw data input by"
      // beside the manager's signature on the approved paper.
      const signature = await TBSigPad.capture({
        title: "Sign to submit for approval",
        subtitle: TYPE_LABELS[r.type] + " — " + r.period + " — " +
          (SITE_LABELS[state.site] || state.site) +
          ". Your signature goes on the document under Raw data input by." +
          " The manager reviews and signs it after you.",
        name: state.user.name,
      });
      if (!signature) return;   // cancelled — nothing is submitted
      try {
        state.report = (await TB.api(`/api/reports/${r.type}/${r.period}/submit?` + siteQ(), { method: 'POST', body: { signature } })).report;
        renderReport();
        const m = $('#rMsg'); m.className = 'ok'; m.textContent = 'Submitted ✓ — waiting for manager approval';
        const mine465 = m.textContent; setTimeout(() => { if (m.isConnected && m.textContent === mine465) { m.className = 'muted'; m.textContent = ''; } }, 5000);
      } catch (e) { TB.sorry(e, 'send this document to the manager'); }
    }));
    if ($('#aApprove')) $('#aApprove').addEventListener('click', () => busy($('#aApprove'), 'Approving…', async () => {
      if (!confirm(`Approve this ${SITE_LABELS[state.site] || state.site} document?\n\nYour stored signature and the date will be stamped on it, and a permanent copy is saved that can never be edited (corrections later create a new version).`)) return;
      try {
        state.report = (await TB.api(`/api/reports/${r.type}/${r.period}/approve?` + siteQ(), { method: 'POST' })).report;
        renderReport();
        loadTasks();
        // the signed copy now shows up under Sales & history
        const m = $('#rMsg'); m.className = 'ok'; m.textContent = 'Approved ✓ — signed and archived';
        const mine475 = m.textContent; setTimeout(() => { if (m.isConnected && m.textContent === mine475) { m.className = 'muted'; m.textContent = ''; } }, 5000);
      } catch (e) { TB.sorry(e, 'approve this document'); }
    }));
  }

  // ------------------------------------------------ editing ON the template
  // The document IS the editor. The same rendered paper the manager reviews
  // and prints is shown with its manual cells as input boxes sitting in the
  // column the value belongs to — no abstract "Block 1 / Block 2" list. Cells
  // the server calculates (gross, deductions total, net pay, row and grand
  // totals) stay read-only and are recomputed live as the cells are typed in,
  // so the form always adds up on screen.
  // Editing a document is a CORRECTION, never a recalculation. Typing 2 in
  // the hours box changes the hours and nothing else — the commission beside
  // it is a separate fact and stays exactly as it is. Only the totals move,
  // because a total is the sum of what is on the form. Figures are worked
  // out from the records ONLY when the document is created or refreshed.
  const CORRECTION_ONLY =
    'Corrections only — nothing else is recalculated from what you type. ' +
    'Only the totals re-add. To recompute from the records, use “Create / refresh from records”.';
  const EDIT_HINTS = {
    'daily-commission':
      'Type hours, stub number and commission straight into the block they belong to.',
    'weekly-payroll':
      'Day cells take an amount; the small button beside one cycles it to RD (rest day) or A (absent). An empty deduction or NH box means it is not applied this week.',
    'weekly-sales':
      'Type a corrected figure over any day. Clearing a box hands that day back to the automatic value from the records.',
    'main-office-daily-sales':
      'Correct any cell of the sheet: the massage, the hours, the add-ons, the times, what was paid. The form number and the cashier on duty are here too.',
  };

  function docRoot() {
    return $('#rDoc .doc');
  }

  function renderDocument() {
    const r = state.report;
    const host = $('#rDoc');
    host.innerHTML = TBDoc.render(r.type, r, state.branchCfg, state.logoSrc, {
      edit: state.editMode,
      submitterSignatureUrl: state.liveSubSigUrl,
    });
    TBFit.attach(host, { refit: true });
    renderEditBar();
    if (state.editMode) bindEditing();
  }

  // The receptionist's submission signature for the document on screen, so
  // the manager sees who signed it while reviewing — not only after
  // approval, and not only in the PDF. Re-fetched only when it changes.
  async function loadSubmitterSignature() {
    const r = state.report;
    const key = (r && r.submitterSignaturePath) || '';
    if (state.liveSubSigKey === key) return;
    state.liveSubSigKey = key;
    if (state.liveSubSigUrl) {
      URL.revokeObjectURL(state.liveSubSigUrl);
      state.liveSubSigUrl = '';
    }
    if (key) {
      try {
        const blob = await TB.api(`/api/reports/${r.type}/${r.period}/signature/submitter?` + siteQ());
        state.liveSubSigUrl = URL.createObjectURL(blob);
      } catch (_) { /* not fatal: the document still renders without it */ }
    }
    if (state.report === r) renderDocument();   // still the same document
  }

  // Unsaved work must never disappear silently — every route out of edit mode
  // (cancel, stop editing, regenerate, reload) goes through this.
  function confirmDiscard() {
    const root = docRoot();
    if (!state.editMode || !root || !TBDoc.isDirty(root)) return true;
    return confirm('This document has changes you have not saved yet.\n\nDiscard them?');
  }

  function markBarDirty() {
    const bar = $('#edBar');
    if (bar) bar.classList.add('dirty');
    const m = $('#edMsg');
    if (m) { m.className = 'muted'; m.textContent = 'Unsaved changes'; }
  }

  function renderEditBar() {
    const host = $('#rManual');
    const r = state.report;
    if (r.status === 'approved') {
      host.innerHTML = `<div class="muted">Approved documents are locked — this is the signed copy.
        Press “Create / refresh from records” to start a new version if a correction is needed.</div>`;
      return;
    }
    if (!state.editMode) {
      if (state.managerMode) {
        host.innerHTML = '<div class="muted">Documents are created and corrected at the front desk. You are reading this one as it stands.</div>';
        return;
      }
      host.innerHTML = `<div class="muted">Press <b>✎ Correct values on the document</b> to fix
        anything wrong, directly in its own box on the form below. ${esc(CORRECTION_ONLY)}</div>`;
      return;
    }
    host.innerHTML = `<div class="docEditBar" id="edBar">
      <b>Correcting this document</b>
      <span class="muted" style="flex:1 1 260px;">${esc(EDIT_HINTS[r.type] || '')}
        <b>${esc(CORRECTION_ONLY)}</b></span>
      <span id="edMsg" role="status"></span>
      <button id="edCancel" class="btn">Cancel</button>
      <button id="edSave" class="btn primary">Save changes</button>
    </div>`;
    $('#edCancel').addEventListener('click', () => {
      if (!confirmDiscard()) return;
      state.editMode = false;
      renderReport();
    });
    $('#edSave').addEventListener('click', () => busy($('#edSave'), 'Saving…', saveEdits));
  }

  function bindEditing() {
    const root = docRoot();
    if (!root) return;
    const live = () => {
      TBDoc.validate(root);
      TBDoc.recalc(state.report.type, root);
    };
    root.querySelectorAll('input.dcell').forEach((el) => {
      el.addEventListener('input', () => { el.dataset.dirty = '1'; markBarDirty(); live(); });
    });
    // The RD / A mark cycles in place; a marked day has no amount.
    root.querySelectorAll('.markbtn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const next = { '': 'RD', RD: 'A', A: '' }[btn.dataset.mark || ''];
        btn.dataset.mark = next;
        btn.textContent = next || '·';
        btn.classList.toggle('on', !!next);
        const amt = root.querySelector(
          `input[data-e="day"][data-k="${cssq(btn.dataset.k)}"][data-d="${cssq(btn.dataset.d)}"]`
        );
        if (amt) {
          amt.disabled = !!next;
          if (next) amt.value = '';
        }
        btn.dataset.dirty = '1';
        markBarDirty();
        live();
      });
    });
  }

  async function saveEdits() {
    const root = docRoot();
    const msg = $('#edMsg');
    const bad = TBDoc.validate(root);
    if (bad.length) {
      msg.className = 'err';
      msg.textContent = bad.length === 1
        ? 'One cell needs a number of 0 or more.'
        : `${bad.length} cells need a number of 0 or more.`;
      bad[0].focus();
      return;
    }
    if (!TBDoc.isDirty(root)) {
      msg.className = 'muted';
      msg.textContent = 'Nothing changed yet.';
      return;
    }
    await saveManual(TBDoc.collect(state.report.type, root), '#edMsg');
  }

  async function saveManual(patch, msgSel) {
    const el = $(msgSel);
    el.className = 'muted'; el.textContent = 'Saving…';
    try {
      const r = state.report;
      const out = await TB.api(`/api/reports/${r.type}/${r.period}/manual-values?` + siteQ(), {
        method: 'POST', body: patch,
      });
      state.report = out.report;
      renderReport(); // document re-renders from the server's answer, still in edit mode
      const m = $('#rMsg');
      m.className = 'ok';
      // Daily-commission cells write back to the session records they came
      // from, so the table above is now out of date — refresh it and say so.
      const wb = out.writeBack;
      const n = wb && wb.updatedSessions ? wb.updatedSessions.length : 0;
      const orphan = wb && wb.unbacked ? wb.unbacked.length : 0;
      m.textContent = 'Saved ✓ — the document and its totals are updated'
        + (n ? ` · ${n} session record${n > 1 ? 's' : ''} corrected in Sessions & sales` : '')
        + (orphan ? ` · ${orphan} cell${orphan > 1 ? 's' : ''} kept on the document only (no session record behind ${orphan > 1 ? 'them' : 'it'})` : '');
      if (n) loadSessions();
      const mine645 = m.textContent; setTimeout(() => { if (m.isConnected && m.textContent === mine645) { m.className = 'muted'; m.textContent = ''; } }, 4000);
    } catch (e) {
      el.className = 'err'; el.textContent = e.message;
    }
  }

  // ------------------------------------------------------- manager extras
  async function loadTasks() {
    if (!state.managerMode) return;
    try {
      const out = await TB.api('/api/tasks');
      // The count rides on the nav whether or not the list is on screen.
      const badge = $('#boTaskCount');
      if (badge) {
        badge.textContent = String(out.tasks.length);
        badge.hidden = out.tasks.length === 0;
      }
      const body = $('#boTasksBody');
      if (!body) return;
      body.innerHTML = out.tasks.length
        ? `<table><thead><tr><th>Parlor</th><th>Document</th><th>Period</th><th>Submitted by</th><th>When</th><th></th></tr></thead><tbody>
          ${out.tasks.map((t) => `<tr>
            <td>${siteBadge(t.site)}</td>
            <td>${esc(TYPE_LABELS[t.type])}</td><td>${esc(t.period)}</td>
            <td>${esc(t.submittedBy)}</td><td>${esc((t.submittedAt || '').slice(0, 16).replace('T', ' '))}</td>
            <td><button class="btn primary boOpenTask" data-site="${esc(t.site)}" data-type="${esc(t.type)}" data-period="${esc(t.period)}">Review</button></td>
          </tr>`).join('')}</tbody></table>`
        : '<span class="ok">Nothing waiting for approval at either parlor.</span>';
      body.querySelectorAll('.boOpenTask').forEach((b) =>
        b.addEventListener('click', async () => {
          state.site = b.dataset.site;                 // review in that parlor's context
          if ($('#boSite')) $('#boSite').value = state.site;
          // the document header must show THAT parlor's address block
          try { state.branchCfg = (await TB.api('/api/branch-config?' + siteQ())).config || {}; } catch (_) {}
          state.reportType = b.dataset.type;
          state.reportPeriod = b.dataset.period;
          state.section = 'documents';
          renderMain();                       // the viewer lives in that step
          $('#rType').value = b.dataset.type;
          $('#rPeriod').value = b.dataset.period;
          await loadReport(false);
          $('#rDoc').scrollIntoView({ behavior: 'smooth', block: 'start' });
        }));
    } catch (e) {
      const body = $('#boTasksBody');
      if (body) body.innerHTML = `<span class="err">${esc(e.message)}</span>`;
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
        <tbody>${active.map(row).join('') ||
          '<tr><td colspan="5" class="muted">No therapists yet — add the first one with the form below. They then appear in the session editor and on payroll.</td></tr>'}</tbody>
      </table></div>
      ${inactive.length ? `
      <details style="margin-top:10px;"><summary class="btn" style="display:inline-block">Inactive (${inactive.length})</summary>
        <div class="tableWrap" style="margin-top:8px;"><table>
          <thead><tr><th>ID</th><th>Full name</th><th>Rest day</th><th>Rate</th><th></th></tr></thead>
          <tbody>${inactive.map(row).join('')}</tbody>
        </table></div>
        <div class="muted" style="margin-top:6px;">Inactive therapists are hidden from new reports and pickers; their rows in historical documents are unchanged.</div>
      </details>` : ''}
      <div class="panel" style="background:#f8fafc;margin-top:12px;">
        <b>Add a therapist</b>
        <div class="row" style="margin-top:8px;">
          <div><label for="tNewName">Full name</label><input id="tNewName" placeholder="e.g. Ana Cruz" /></div>
          <div><label for="tNewId">ID <span class="muted">(suggested — you can change it)</span></label>
            <input id="tNewId" style="width:130px" placeholder="t-ana" /></div>
          <div><label for="tNewRest">Fixed rest day</label><select id="tNewRest">
            ${REST_DAYS.map((d) => `<option value="${d}">${d || '(none)'}</option>`).join('')}
          </select></div>
          <div><label for="tNewRate">Commission rate (0–1, e.g. 0.4 = 40%)</label>
            <input id="tNewRate" type="number" step="0.01" min="0" max="1" value="0.4" style="width:100px" /></div>
          <div><label for="tNewActive">Active</label><input id="tNewActive" type="checkbox" checked /></div>
          <button id="tAdd" class="btn primary">Add therapist</button>
          <span id="tMsg" role="alert"></span>
        </div>
      </div>
      <div id="tEditor"></div>`;

    const refresh = (out) => { state.therapists = out.therapists; renderTherapists(); };
    const fail = (e) => { $('#tMsg').className = 'err'; $('#tMsg').textContent = e.message; };
    const note = (text) => {
      const m = $('#tMsg'); m.className = 'ok'; m.textContent = text;
      const mine730 = m.textContent; setTimeout(() => { if (m.isConnected && m.textContent === mine730) { m.className = ''; m.textContent = ''; } }, 4000);
    };

    // Suggest an ID from the name while the manager hasn't typed one herself.
    const idInput = $('#tNewId'), nameInput = $('#tNewName');
    idInput.addEventListener('input', () => { idInput.dataset.manual = '1'; });
    nameInput.addEventListener('input', () => {
      if (idInput.dataset.manual) return;
      const first = (nameInput.value.trim().split(/\s+/)[0] || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!first) { idInput.value = ''; return; }
      let candidate = 't-' + first, n = 2;
      while (state.therapists.some((x) => x.id === candidate)) candidate = 't-' + first + n++;
      idInput.value = candidate;
    });

    // ---- full editor for every field
    host.querySelectorAll('.tEdit').forEach((b) => b.addEventListener('click', () => {
      const t = state.therapists.find((x) => x.id === b.dataset.id);
      if (!t) return;
      $('#tEditor').innerHTML = `<div class="panel" style="background:#f8fafc;margin-top:10px;">
        <b>Edit therapist — ${esc(t.id)}</b>
        <div class="row" style="margin-top:8px;">
          <div><label for="teId">ID</label><input id="teId" value="${esc(t.id)}" style="width:130px" /></div>
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
        </div>
        <div class="muted" style="margin-top:6px;">
          Changing the <b>ID</b> renames it across all historical session records,
          draft/submitted reports and manual values. Approved documents are
          historical and keep the old ID. It can touch many files and take a
          little while.
        </div>
        <div id="teProgress"></div></div>`;
      $('#teCancel').addEventListener('click', () => { $('#tEditor').innerHTML = ''; });
      $('#teSave').addEventListener('click', () => busy($('#teSave'), 'Saving…', async () => {
        const msg = $('#teMsg'); msg.textContent = '';
        const newIdRaw = $('#teId').value.trim();
        const fullName = $('#teName').value.trim();
        const rate = Number($('#teRate').value);
        if (!fullName) { msg.textContent = 'Full name cannot be empty.'; return; }
        if (!Number.isFinite(rate) || rate < 0 || rate > 1) { msg.textContent = 'Commission rate must be between 0 and 1 (e.g. 0.4).'; return; }
        if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/.test(newIdRaw)) {
          msg.textContent = 'ID must be 1–32 characters: letters, digits, hyphen, underscore.'; return;
        }

        let currentId = t.id;
        try {
          // 1. ID rename first (if changed), with warning + progress + summary
          if (newIdRaw !== t.id) {
            const sure = confirm(
              `Rename therapist ID "${t.id}" to "${newIdRaw}"?\n\n` +
              `This updates ALL historical session records, draft and submitted ` +
              `reports and manual values that reference the old ID. Approved ` +
              `documents are historical and keep the old ID. If it is interrupted, ` +
              `running the same rename again finishes it safely.`
            );
            if (!sure) return;
            $('#teSave').disabled = true;
            $('#teProgress').innerHTML = `<div style="margin-top:10px;">
              <div class="tb-progress"></div>
              <div class="muted">Renaming across records… this may take a while on a long history. Do not close the page.</div></div>`;
            const out = await TB.api('/api/therapists/' + encodeURIComponent(t.id) + '/rename', {
              method: 'POST', body: { newId: newIdRaw },
            });
            currentId = newIdRaw;
            $('#teProgress').innerHTML = `<div class="ok" style="margin-top:10px;">
              Rename complete — ${out.filesTouched} file(s) updated${out.resumed ? ' (resumed an interrupted rename)' : ''}.</div>`;
          }

          // 2. remaining field changes against the (possibly new) id
          const out2 = await TB.api('/api/therapists/' + encodeURIComponent(currentId), {
            method: 'PATCH',
            body: { fullName, restDay: $('#teRest').value, commissionRate: rate, active: $('#teActive').checked },
          });
          state.therapists = out2.therapists;
          renderTherapists();
          if (currentId !== t.id) loadSessions(); // ids in the sessions table changed
        } catch (e) {
          $('#teProgress').innerHTML = '';
          msg.textContent = e.message;
        }
      }));
    }));

    // ---- reactivate
    host.querySelectorAll('.tReact').forEach((b) => b.addEventListener('click', () => busy(b, 'Reactivating…', async () => {
      try {
        refresh(await TB.api('/api/therapists/' + encodeURIComponent(b.dataset.id), {
          method: 'PATCH', body: { active: true },
        }));
        note(`${b.closest('tr').children[1].textContent} reactivated ✓ — back in pickers and new reports.`);
      } catch (e) { fail(e); }
    })));

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
            note(`${name} deactivated ✓ — moved to the Inactive list below.`);
          }
        } else {
          const typed = prompt(
            `${name} has no session records or report rows anywhere, so she can be permanently deleted.\n\n` +
            `Type the full name exactly (${name}) to confirm the permanent delete:`
          );
          if (typed === null) return;
          if (typed.trim() !== name) { fail(new Error('Name did not match — nothing was deleted.')); return; }
          refresh(await TB.api('/api/therapists/' + encodeURIComponent(id), { method: 'DELETE' }));
          note(`${name} permanently deleted ✓`);
        }
      } catch (e) { fail(e); }
      finally { b.disabled = false; }
    }));

    $('#tAdd').addEventListener('click', () => busy($('#tAdd'), 'Adding…', async () => {
      const m = $('#tMsg'); m.className = 'err'; m.textContent = '';
      const fullName = $('#tNewName').value.trim();
      const id = $('#tNewId').value.trim();
      const rate = Number($('#tNewRate').value);
      // same validation as the Edit dialog, checked here so mistakes surface
      // immediately instead of after a server round-trip
      if (!fullName) { m.textContent = 'Full name cannot be empty.'; return; }
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/.test(id)) {
        m.textContent = 'ID must be 1–32 characters: letters, digits, hyphen, underscore.'; return;
      }
      if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
        m.textContent = 'Commission rate must be between 0 and 1 (e.g. 0.4).'; return;
      }
      try {
        refresh(await TB.api('/api/therapists', {
          method: 'POST',
          body: {
            id, fullName,
            restDay: $('#tNewRest').value,
            commissionRate: rate,
            active: $('#tNewActive').checked,
          },
        }));
        note(`${fullName} added ✓ — ready to assign in the session editor.`);
      } catch (e) { fail(e); }
    }));
  }


  // Prices admin (manager): the ORG-SHARED price list on the server — the
  // single source of truth both parlors charge from. Saving appends a new
  // dated set; older waivers keep their dated prices.
  async function renderPricesAdmin() {
    const host = $('#pricesBody');
    try {
      const out = await TB.api('/api/prices');
      state.prices = out.sets || [];
      let seededFromDevice = false;
      let cur = state.prices.slice().sort((a, b) => String(a.effectiveFrom).localeCompare(String(b.effectiveFrom))).at(-1);
      if (!cur) {
        // Server has no prices yet (fresh migration): prefill from this
        // device's cached price list so the manager can seed the server
        // with two clicks instead of retyping everything.
        try {
          const cached = JSON.parse(localStorage.getItem('tb_price_sets_v1') || '[]');
          cur = cached.slice().sort((a, b) => String(a.effectiveFrom).localeCompare(String(b.effectiveFrom))).at(-1);
          if (cur) seededFromDevice = true;
        } catch (_) {}
      }
      if (!cur) cur = { effectiveFrom: '(none yet)', services: {}, addons: {} };
      const SERVICES = ['1hr Thai Back Massage', '1hr Thai Body Massage', '1hr Thai Foot Massage', '1hr Thai Swedish Massage',
        '1hr Swedish Massage', '1hr Thai Aromatherapy Massage', 'Combo 1', 'Combo 2', 'Combo 3', 'Combo 4', 'Combo 5', 'Combo 6', 'Combo 7', 'Combo 8'];
      const ADD_ONS = ['Unscented Oil', 'Scented Oil', 'Herbal Hotpads', 'Ventosa', 'Hot Stone', 'Half Hour', '1 hr extra massage'];
      const row = (g, n) => `<tr><td>${esc(n)}</td><td>${g === 's' ? 'Service' : 'Add-On'}</td>
        <td><input class="prIn" data-g="${g}" data-n="${esc(n)}" type="number" step="1" min="0"
          value="${(g === 's' ? cur.services[n] : cur.addons[n]) ?? 0}" style="width:100px" disabled /></td></tr>`;
      host.innerHTML = `
        <div class="muted">${seededFromDevice
          ? '<b>The server has no prices yet.</b> The table below is prefilled from THIS device\'s price list — press "Edit prices" then "Save" to make it the shared list for both parlors.'
          : `Current prices (effective from ${esc(cur.effectiveFrom)}). Changes apply to BOTH parlors and reach the iPads automatically.`}</div>
        <div class="tableWrap" style="max-height:280px;overflow:auto;margin-top:8px;"><table>
          <thead><tr><th>Item</th><th>Type</th><th>Price</th></tr></thead>
          <tbody>${SERVICES.map((n) => row('s', n)).join('')}${ADD_ONS.map((n) => row('a', n)).join('')}</tbody>
        </table></div>
        <div class="row" style="margin-top:8px;">
          <button id="prEdit" class="btn">Edit prices</button>
          <button id="prSave" class="btn primary" disabled>Save — applies from today</button>
          <span id="prMsg" role="status"></span>
        </div>`;
      $('#prEdit').addEventListener('click', () => {
        if (!confirm('Unlock prices for editing? New prices apply to both parlors starting today.')) return;
        host.querySelectorAll('.prIn').forEach((i) => { i.disabled = false; });
        $('#prSave').disabled = false;
        $('#prEdit').disabled = true;
      });
      $('#prSave').addEventListener('click', () => busy($('#prSave'), 'Saving…', async () => {
        const services = {}, addons = {};
        let bad = false;
        host.querySelectorAll('.prIn').forEach((i) => {
          const v = Number(i.value);
          if (!Number.isFinite(v) || v < 0) bad = true;
          (i.dataset.g === 's' ? services : addons)[i.dataset.n] = v;
        });
        const m = $('#prMsg');
        if (bad) { m.className = 'err'; m.textContent = 'Prices must be 0 or more.'; return; }
        const d = new Date();
        const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const sets = [...state.prices.filter((x) => x.effectiveFrom !== today), { effectiveFrom: today, services, addons }];
        try {
          await TB.api('/api/prices', { method: 'PUT', body: { sets } });
          await TB.refreshPrices(); // update this device's cache too
          m.className = 'ok'; m.textContent = 'Saved ✓ — both parlors now charge these prices.';
          setTimeout(() => renderPricesAdmin(), 1500);
        } catch (e) { m.className = 'err'; m.textContent = e.message; }
      }));
    } catch (e) {
      host.innerHTML = `<span class="err">${esc(e.message)}</span>`;
    }
  }

  async function loadDrive() {
    try {
      const s = await TB.api('/api/drive/status');
      $('#driveBody').innerHTML = s.enabled
        ? `Mirror is ON. Pending uploads: <b>${s.pending}</b>
           ${s.pending ? '<button id="driveRetry" class="btn" style="margin-left:8px">Retry now</button>' : ''}`
        : 'Mirror is switched off — an administrator can enable it on the server (see SETUP guide).';
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
      // Sessions and client names are on these screens, and the iPad sits on
      // a counter facing clients: lock back to the waiver tab when it is
      // left alone, and make coming back need the password again.
      if (state.user && window.TBIdleLock) TBIdleLock.start({ waiverUrl: "../index.html" });
      if (state.user && !state.user.mustChangePassword) {
        try { await loadBasics(); } catch (_) {}
      }
      render(); // straight into login form or dashboard — no extra click
    } finally {
      startingUp = false;
    }
  }

  // An update must not reload over corrections that are typed but not saved.
  if (window.TBUpdate) {
    TBUpdate.guard('document', () => {
      const root = docRoot();
      return state.editMode && root && TBDoc.isDirty(root)
        ? 'a document has corrections you have not saved'
        : null;
    });
    TBUpdate.guard('session-edit', () =>
      ($('#sessEdit') && $('#sessEdit').innerHTML) ? 'a session is open for editing' : null);
  }

  // ------------------------------------------------------------------ init
  async function init({ managerMode, mount, logoSrc }) {
    state.managerMode = !!managerMode;
    state.mount = mount;
    if (logoSrc) state.logoSrc = logoSrc;
    window.addEventListener('online', () => startup());
    window.addEventListener('offline', render);
    // Half-typed corrections must not vanish because a tab was closed.
    window.addEventListener('beforeunload', (e) => {
      const root = docRoot();
      if (state.editMode && root && TBDoc.isDirty(root)) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
    await startup();
  }

  window.TBBackoffice = { init };
})();
