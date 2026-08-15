// HTML views of the three paper documents (print-CSS in shared.css).
// Layout mirrors the paper originals; the server-side PDF is the official
// export, this view is for on-screen review, editing and window.print().
//
// EDIT MODE (opts.edit): the SAME template renders with its manual cells as
// inputs sitting in the exact column the value belongs to — no abstract
// "Block 1 / Block 2" list any more. Auto-calculated cells (gross, totals,
// net, grand total) stay read-only and are recomputed live from the inputs
// as they are typed, so the receptionist sees the finished document while
// she corrects it.
//
// Three responsibilities live here because all three need the layout:
//   render(type, report, cfg, logo, opts) -> HTML
//   recalc(type, root)                    -> refresh every read-only cell
//   collect(type, root)                   -> manual-values patch (dirty only)

'use strict';

(function () {
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const DED = [
    ['latesAndAbsences', 'Lates/Abs.'], ['sss', 'SSS'], ['phic', 'PHIC'],
    ['pagibig', 'Pag-ibig'], ['ca', 'C.A.'], ['cb', 'C.B.'],
  ];
  const MAX_BLOCKS = 6;

  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // Attribute-safe: keys and names end up inside quoted attributes and are
  // read back with querySelector, so quotes must not survive.
  const escA = (s) => esc(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const money = (n) => (Number(n) || 0) === 0 ? '' :
    (Number(n)).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const money0 = (n) => (Number(n) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  // Raw value for an input box: no thousands separators (they would not parse
  // back), blank instead of a bare zero so empty cells look empty on paper.
  const raw = (n) => (Number(n) || 0) === 0 ? '' : String(Math.round(Number(n) * 100) / 100);
  const num = (v) => {
    const s = String(v == null ? '' : v).trim().replace(/,/g, '');
    if (!s) return 0;
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  };
  const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

  // ------------------------------------------------------------ cell inputs
  // attrs: the data-* hooks that identify the cell. mode: 'money' | 'text'.
  function cellInput(attrs, value, mode, label) {
    const inputmode = mode === 'money' ? 'decimal' : 'numeric';
    return `<input class="dcell${mode === 'money' ? ' num' : ''}" type="text"
      inputmode="${inputmode}" autocomplete="off" autocorrect="off" spellcheck="false"
      aria-label="${escA(label || '')}" value="${escA(value)}" ${attrs} />`;
  }

  // ------------------------------------------------------------------ header
  function header(cfg, title, subtitle, logoSrc) {
    const h = (cfg && cfg.header) || {};
    return `<div class="dochead">
      <img class="logo" src="${escA(logoSrc)}" alt="" />
      <div class="bn">${esc(h.businessName || 'THAI BORAN FOOT & BODY MASSAGE')}</div>
      <div class="br">${esc(h.branchName || 'Panacan Branch')}</div>
      <div class="ad">${esc(h.addressLine || 'Door 206-207, GRI Bldg. Km. 14, Panacan, Bunawan District, Davao City')}</div>
      <div class="ct">${esc(h.contactLine || 'Contact Nos. 0905 440 8321')}</div>
      <div class="ti">${esc(title)}</div>
      <div class="su">${esc(subtitle)}</div>
    </div>`;
  }

  // ------------------------------------------------------------------ footer
  // "Raw data input by" names the receptionist(s) who keyed the period's
  // records (derived server-side); it is editable in place like any other
  // manual value. "Reviewed by" is the approval record — never editable.
  function footer(report, inputBy, opts) {
    const o = opts || {};
    const approved = report.status === 'approved';
    const left = o.edit
      ? cellInput('data-e="inputby"', inputBy || '', 'text', 'Raw data input by')
      : `<b>${esc(inputBy || '')}</b>`;
    const sig = o.signatureUrl
      ? `<img src="${escA(o.signatureUrl)}" alt="Approved signature" />`
      : (approved ? '<i>(signature on official PDF)</i>' : '');
    return `<div class="foot">
      <div class="sigblock">
        <div style="text-align:left">Raw data input by:</div>
        <div class="sigline"></div>
        <div class="signame${o.edit ? ' ed' : ''}">${left}</div>
        <div>Signature over printed name</div>
      </div>
      <div class="sigblock">
        <div style="text-align:left">Reviewed by:</div>
        <div class="sigline">${sig}</div>
        <div class="signame"><b>${esc(report.approvedByName || '')}</b></div>
        <div>Signature over printed name</div>
        ${approved ? `<div>Approved ${esc(stamp(report.approvedAt))}</div>` : ''}
      </div>
    </div>`;
  }

  // Approval stamps are stored as full ISO timestamps; on paper they read as
  // a date and a clock time, not "2026-08-15T13:39:52.317Z".
  const stamp = (iso) => {
    const s = String(iso || '');
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s) ? s.slice(0, 10) + ' ' + s.slice(11, 16) : s;
  };

  const inputByOf = (report) =>
    (report.data && report.data.rawDataInputBy) || report.createdByName || '';

  // --------------------------------------------------- 1. daily commission
  function dailyCommission(report, cfg, logoSrc, o) {
    const d = report.data;
    let head = '<tr><th rowspan="2">Therapist Name</th><th rowspan="2">Time</th>';
    for (let i = 1; i <= MAX_BLOCKS; i++) head += `<th colspan="3">${i}</th>`;
    head += '<th rowspan="2">TOTAL</th></tr><tr>';
    for (let i = 1; i <= MAX_BLOCKS; i++) head += '<th>Hrs</th><th>Stub #</th><th>Comm.</th>';
    head += '</tr>';

    const body = d.rows.map((r) => {
      const k = r.therapistId || r.therapistName;
      const kA = `data-k="${escA(k)}"`;
      // Commissions past block 6 still count towards the row total but have
      // no column on the paper form — carried as a constant for the recalc.
      const extra = round2((r.overflow || []).reduce((s, b) => s + (Number(b.commission) || 0), 0));
      let tds = `<td class="name">${esc(r.therapistName)}</td><td>${esc(r.time)}</td>`;
      for (let i = 0; i < MAX_BLOCKS; i++) {
        const b = r.blocks[i] || {};
        if (o.edit) {
          const at = (f) => `${kA} data-i="${i}" data-f="${f}" data-e="blk"`;
          tds += `<td class="ed">${cellInput(at('hours'), b.hours ? String(b.hours) : '', 'money', 'hours')}</td>
            <td class="ed">${cellInput(at('stubNumber'), b.stubNumber || '', 'text', 'stub number')}</td>
            <td class="ed">${cellInput(at('commission'), raw(b.commission), 'money', 'commission')}</td>`;
        } else {
          tds += r.blocks[i]
            ? `<td>${esc(b.hours || '')}</td><td>${esc(b.stubNumber)}</td><td>${money(b.commission)}</td>`
            : '<td></td><td></td><td></td>';
        }
      }
      tds += `<td data-c="rowTotal" ${kA} data-extra="${extra}"><b>${money0(r.total)}</b></td>`;
      return `<tr>${tds}</tr>`;
    }).join('');

    const span = MAX_BLOCKS * 3;
    const totalRow = `<tr class="tot"><td class="name">GRAND TOTAL</td><td></td>${'<td></td>'.repeat(span)}
      <td data-c="grandTotal">${money0(d.grandTotal)}</td></tr>`;

    return `${header(cfg, 'DAILY THERAPIST COMMISSION', 'Date: ' + d.date, logoSrc)}
      <table>${head}${body}${totalRow}</table>
      ${footer(report, inputByOf(report), o)}`;
  }

  // ----------------------------------------------------- 2. weekly payroll
  function weeklyPayroll(report, cfg, logoSrc, o) {
    const d = report.data;
    const head = '<tr><th>Therapist</th>' + DAYS.map((x) => `<th>${x}</th>`).join('') +
      '<th>Gross</th>' + DED.map(([, l]) => `<th>${l}</th>`).join('') +
      '<th>Total Ded.</th><th>NH</th><th>Allow.</th><th>NET PAY</th><th>Signature</th></tr>';

    const cell = (c) => (c.type === 'RD' ? 'RD' : c.type === 'A' ? 'A' : money(c.amount));

    // A day is either an amount or a mark (RD/A). The mark button cycles
    // ·(amount) -> RD -> A -> · so the whole cell stays inside its column and
    // the amount box can keep a numbers-only keyboard on the iPad.
    function dayCell(kA, key, c) {
      const mark = c.type === 'RD' ? 'RD' : c.type === 'A' ? 'A' : '';
      const at = `${kA} data-d="${key}"`;
      return `<td class="ed daycell">
        ${cellInput(`${at} data-e="day"${mark ? ' disabled' : ''}`, mark ? '' : raw(c.amount), 'money', key + ' amount')}
        <button type="button" class="markbtn${mark ? ' on' : ''}" ${at} data-e="daymark" data-mark="${mark}"
          title="Tap to cycle: amount → RD (rest day) → A (absent)">${mark || '·'}</button>
      </td>`;
    }

    const body = d.rows.map((r) => {
      const kA = `data-k="${escA(r.therapistId)}"`;
      const days = o.edit
        ? DAY_KEYS.map((k) => dayCell(kA, k, r.days[k])).join('')
        : DAY_KEYS.map((k) => `<td>${cell(r.days[k])}</td>`).join('');
      const deds = DED.map(([k]) => (o.edit
        ? `<td class="ed">${cellInput(`${kA} data-x="${k}" data-e="ded"`,
            r.deductions[k].enabled ? raw(r.deductions[k].amount) : '', 'money', k)}</td>`
        : `<td>${r.deductions[k].enabled ? money0(r.deductions[k].amount) : ''}</td>`)).join('');
      const nh = o.edit
        ? `<td class="ed">${cellInput(`${kA} data-e="nh"`, r.nh.enabled ? raw(r.nh.amount) : '', 'money', 'NH')}</td>`
        : `<td>${r.nh.enabled ? money0(r.nh.amount) : ''}</td>`;
      const allow = o.edit
        ? `<td class="ed">${cellInput(`${kA} data-e="allow"`, raw(r.allowance), 'money', 'allowance')}</td>`
        : `<td>${money(r.allowance)}</td>`;
      return `<tr>
        <td class="name">${esc(r.therapistName)}</td>
        ${days}
        <td data-c="gross" ${kA}><b>${money0(r.grossPay)}</b></td>
        ${deds}
        <td data-c="totded" ${kA}>${money0(r.totalDeductions)}</td>
        ${nh}${allow}
        <td data-c="net" ${kA}><b>${money0(r.netPay)}</b></td>
        <td style="min-width:70px"></td>
      </tr>`;
    }).join('');

    const t = d.totals;
    const totalRow = `<tr class="tot"><td class="name">TOTALS</td>
      ${DAY_KEYS.map((k) => `<td data-c="tday" data-d="${k}">${money(t.days[k])}</td>`).join('')}
      <td data-c="tgross">${money0(t.grossPay)}</td>
      ${DED.map(([k]) => `<td data-c="tded" data-x="${k}">${money(t.deductions[k])}</td>`).join('')}
      <td data-c="ttotded">${money0(t.totalDeductions)}</td>
      <td data-c="tnh">${money(t.nh)}</td>
      <td data-c="tallow">${money(t.allowance)}</td>
      <td data-c="tnet">${money0(t.netPay)}</td><td></td></tr>`;

    return `${header(cfg, 'WEEKLY THERAPIST PAYROLL', `Week: ${d.dates[0]} to ${d.dates[6]}`, logoSrc)}
      <table>${head}${body}${totalRow}</table>
      ${footer(report, inputByOf(report), o)}`;
  }

  // ------------------------------------------------------- 3. weekly sales
  function weeklySales(report, cfg, logoSrc, o) {
    const d = report.data;
    const body = d.rows.map((r) => {
      const at = (f) => `data-e="sales" data-d="${escA(r.date)}" data-f="${f}"`;
      const cells = o.edit
        ? `<td class="ed">${cellInput(at('grossSales'), raw(r.grossSales), 'money', 'gross sales')}</td>
           <td class="ed">${cellInput(at('commission'), raw(r.commission), 'money', 'commission')}</td>
           <td class="ed">${cellInput(at('bpi'), raw(r.bpi), 'money', 'BPI')}</td>`
        : `<td>${money(r.grossSales)}</td><td>${money(r.commission)}</td><td>${money(r.bpi)}</td>`;
      return `<tr><td>${esc(r.date)}</td><td>${esc(r.day)}</td>${cells}</tr>`;
    }).join('');
    const totalRow = `<tr class="tot"><td>TOTAL</td><td></td>
      <td data-c="tgross">${money0(d.totals.grossSales)}</td>
      <td data-c="tcomm">${money0(d.totals.commission)}</td>
      <td data-c="tbpi">${money0(d.totals.bpi)}</td></tr>`;

    return `${header(cfg, 'WEEKLY SALES REPORT', `Week: ${d.rows[0].date} to ${d.rows[6].date}`, logoSrc)}
      <table><tr><th>Date</th><th>Day</th><th>Gross Sales</th><th>Commission</th><th>BPI</th></tr>
      ${body}${totalRow}</table>
      <div class="note">BPI amounts are card payments already included in Gross Sales.</div>
      ${footer(report, inputByOf(report), o)}`;
  }

  // ------------------------------------------------------------------ render
  function render(type, report, cfg, logoSrc, opts) {
    const o = opts || {};
    let inner;
    if (type === 'daily-commission') inner = dailyCommission(report, cfg, logoSrc, o);
    else if (type === 'weekly-payroll') inner = weeklyPayroll(report, cfg, logoSrc, o);
    else if (type === 'weekly-sales') inner = weeklySales(report, cfg, logoSrc, o);
    else return '<div class="err">unknown document type</div>';
    return `<div class="doc${o.edit ? ' editing' : ''}" data-type="${escA(type)}">${inner}</div>`;
  }

  // ------------------------------------------------------------------ recalc
  // Every read-only cell is recomputed from what is currently in the inputs,
  // with exactly the arithmetic the server uses, so the document on screen
  // always adds up while it is being edited.
  const setCell = (el, text) => {
    if (!el) return;
    const b = el.querySelector('b');
    if (b) b.textContent = text; else el.textContent = text;
  };
  const q = (root, sel) => root.querySelector(sel);
  const qa = (root, sel) => Array.from(root.querySelectorAll(sel));

  // The amount a day cell contributes: a marked cell (RD/A) contributes 0.
  function dayAmount(root, k, d) {
    const mark = q(root, `.markbtn[data-e="daymark"][data-k="${k}"][data-d="${d}"]`);
    if (mark && mark.dataset.mark) return 0;
    const inp = q(root, `input[data-e="day"][data-k="${k}"][data-d="${d}"]`);
    return inp ? num(inp.value) : 0;
  }

  function recalcCommission(root) {
    let grand = 0;
    qa(root, 'td[data-c="rowTotal"]').forEach((td) => {
      const k = td.dataset.k;
      const sum = qa(root, `input[data-e="blk"][data-f="commission"][data-k="${k}"]`)
        .reduce((s, el) => s + num(el.value), 0) + num(td.dataset.extra);
      const total = round2(sum);
      setCell(td, money0(total));
      grand += total;
    });
    setCell(q(root, 'td[data-c="grandTotal"]'), money0(round2(grand)));
  }

  function recalcPayroll(root) {
    const tot = { days: {}, gross: 0, ded: {}, totded: 0, nh: 0, allow: 0, net: 0 };
    DAY_KEYS.forEach((d) => { tot.days[d] = 0; });
    DED.forEach(([k]) => { tot.ded[k] = 0; });

    qa(root, 'td[data-c="gross"]').forEach((td) => {
      const k = td.dataset.k;
      const gross = round2(DAY_KEYS.reduce((s, d) => {
        const v = dayAmount(root, k, d);
        tot.days[d] = round2(tot.days[d] + v);
        return s + v;
      }, 0));

      let totded = 0;
      DED.forEach(([x]) => {
        const el = q(root, `input[data-e="ded"][data-k="${k}"][data-x="${x}"]`);
        const v = el && String(el.value).trim() !== '' ? round2(num(el.value)) : 0;
        totded += v;
        tot.ded[x] = round2(tot.ded[x] + v);
      });
      totded = round2(totded);

      const nhEl = q(root, `input[data-e="nh"][data-k="${k}"]`);
      const nh = nhEl && String(nhEl.value).trim() !== '' ? round2(num(nhEl.value)) : 0;
      const alEl = q(root, `input[data-e="allow"][data-k="${k}"]`);
      const allow = alEl ? round2(num(alEl.value)) : 0;
      const net = round2(gross + nh - totded + allow);

      setCell(td, money0(gross));
      setCell(q(root, `td[data-c="totded"][data-k="${k}"]`), money0(totded));
      setCell(q(root, `td[data-c="net"][data-k="${k}"]`), money0(net));

      tot.gross = round2(tot.gross + gross);
      tot.totded = round2(tot.totded + totded);
      tot.nh = round2(tot.nh + nh);
      tot.allow = round2(tot.allow + allow);
      tot.net = round2(tot.net + net);
    });

    DAY_KEYS.forEach((d) => setCell(q(root, `td[data-c="tday"][data-d="${d}"]`), money(tot.days[d])));
    DED.forEach(([k]) => setCell(q(root, `td[data-c="tded"][data-x="${k}"]`), money(tot.ded[k])));
    setCell(q(root, 'td[data-c="tgross"]'), money0(tot.gross));
    setCell(q(root, 'td[data-c="ttotded"]'), money0(tot.totded));
    setCell(q(root, 'td[data-c="tnh"]'), money(tot.nh));
    setCell(q(root, 'td[data-c="tallow"]'), money(tot.allow));
    setCell(q(root, 'td[data-c="tnet"]'), money0(tot.net));
  }

  function recalcSales(root) {
    const sum = (f) => round2(qa(root, `input[data-e="sales"][data-f="${f}"]`)
      .reduce((s, el) => s + num(el.value), 0));
    setCell(q(root, 'td[data-c="tgross"]'), money0(sum('grossSales')));
    setCell(q(root, 'td[data-c="tcomm"]'), money0(sum('commission')));
    setCell(q(root, 'td[data-c="tbpi"]'), money0(sum('bpi')));
  }

  function recalc(type, root) {
    if (!root) return;
    if (type === 'daily-commission') recalcCommission(root);
    else if (type === 'weekly-payroll') recalcPayroll(root);
    else if (type === 'weekly-sales') recalcSales(root);
  }

  // ----------------------------------------------------------- validation
  // A cell is valid when it is empty or a non-negative number; day cells may
  // also hold nothing at all (the mark button carries RD/A). Invalid cells
  // are flagged in place and block saving.
  function validate(root) {
    const bad = [];
    qa(root, 'input.dcell.num').forEach((el) => {
      const s = String(el.value).trim().replace(/,/g, '');
      const ok = s === '' || (Number.isFinite(Number(s)) && Number(s) >= 0);
      el.classList.toggle('bad', !ok);
      el.title = ok ? '' : 'Enter a number of 0 or more, or leave the cell empty.';
      if (!ok) bad.push(el);
    });
    return bad;
  }

  // -------------------------------------------------------------- collect
  // Only cells the user actually touched (data-dirty) are sent, so untouched
  // values keep following the generated data — same contract as before.
  const dirty = (root, sel) => qa(root, sel).filter((el) => el.dataset.dirty === '1');

  function collectCommission(root) {
    const patch = { rows: {} };
    dirty(root, 'input[data-e="blk"]').forEach((el) => {
      const rp = (patch.rows[el.dataset.k] = patch.rows[el.dataset.k] || { blocks: {} });
      const bp = (rp.blocks[el.dataset.i] = rp.blocks[el.dataset.i] || {});
      bp[el.dataset.f] = el.dataset.f === 'stubNumber' ? el.value.trim() : num(el.value);
    });
    return patch;
  }

  function collectPayroll(root) {
    const patch = { therapists: {} };
    const T = (k) => (patch.therapists[k] = patch.therapists[k] || {});

    // A day is dirty if either half of the cell was touched.
    const dayKeys = new Set();
    dirty(root, '[data-e="day"],[data-e="daymark"]').forEach((el) =>
      dayKeys.add(el.dataset.k + '|' + el.dataset.d));
    dayKeys.forEach((key) => {
      const [k, d] = key.split('|');
      const t = T(k); t.days = t.days || {};
      const mark = q(root, `.markbtn[data-k="${k}"][data-d="${d}"]`);
      const inp = q(root, `input[data-e="day"][data-k="${k}"][data-d="${d}"]`);
      if (mark && mark.dataset.mark) t.days[d] = { type: mark.dataset.mark };
      else if (!inp || String(inp.value).trim() === '') t.days[d] = null; // back to auto
      else t.days[d] = { type: 'value', amount: num(inp.value) };
    });

    // Deductions and NH: an empty box means "not deducted this week".
    dirty(root, 'input[data-e="ded"]').forEach((el) => {
      const t = T(el.dataset.k); t.deductions = t.deductions || {};
      const on = String(el.value).trim() !== '';
      t.deductions[el.dataset.x] = { enabled: on, amount: on ? num(el.value) : 0 };
    });
    dirty(root, 'input[data-e="nh"]').forEach((el) => {
      const on = String(el.value).trim() !== '';
      T(el.dataset.k).nh = { enabled: on, amount: on ? num(el.value) : 0 };
    });
    dirty(root, 'input[data-e="allow"]').forEach((el) => {
      T(el.dataset.k).allowance = num(el.value);
    });
    return patch;
  }

  function collectSales(root) {
    const patch = { days: {} };
    dirty(root, 'input[data-e="sales"]').forEach((el) => {
      const d = (patch.days[el.dataset.d] = patch.days[el.dataset.d] || {});
      // empty -> null -> the generated value takes over again
      d[el.dataset.f] = String(el.value).trim() === '' ? null : num(el.value);
    });
    return patch;
  }

  function collect(type, root) {
    let patch;
    if (type === 'daily-commission') patch = collectCommission(root);
    else if (type === 'weekly-payroll') patch = collectPayroll(root);
    else if (type === 'weekly-sales') patch = collectSales(root);
    else patch = {};
    const by = q(root, 'input[data-e="inputby"]');
    if (by && by.dataset.dirty === '1') patch.rawDataInputBy = by.value.trim();
    return patch;
  }

  function isDirty(root) {
    return !!(root && root.querySelector('[data-dirty="1"]'));
  }

  window.TBDoc = { render, recalc, collect, validate, isDirty, DAY_KEYS };
})();
