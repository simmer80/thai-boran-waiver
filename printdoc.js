// HTML views of the three paper documents (print-CSS in shared.css).
// Layout mirrors the paper originals; the server-side PDF is the official
// export, this view is for on-screen review and window.print().

'use strict';

(function () {
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const DED = [
    ['latesAndAbsences', 'Lates/Abs.'], ['sss', 'SSS'], ['phic', 'PHIC'],
    ['pagibig', 'Pag-ibig'], ['ca', 'C.A.'], ['cb', 'C.B.'],
  ];

  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const money = (n) => (Number(n) || 0) === 0 ? '' :
    (Number(n)).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const money0 = (n) => (Number(n) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function header(cfg, title, subtitle, logoSrc) {
    const h = (cfg && cfg.header) || {};
    return `<div class="dochead">
      <img class="logo" src="${logoSrc}" alt="" />
      <div class="bn">${esc(h.businessName || 'THAI BORAN FOOT & BODY MASSAGE')}</div>
      <div class="br">${esc(h.branchName || 'Panacan Branch')}</div>
      <div class="ad">${esc(h.addressLine || 'Door 206-207, GRI Bldg. Km. 14, Panacan, Bunawan District, Davao City')}</div>
      <div class="ct">${esc(h.contactLine || 'Contact Nos. 0905 440 8321')}</div>
      <div class="ti">${esc(title)}</div>
      <div class="su">${esc(subtitle)}</div>
    </div>`;
  }

  function footer(report, preparedName) {
    const approved = report.status === 'approved';
    return `<div class="foot">
      <div class="sigblock">
        <div style="text-align:left">Raw data input by:</div>
        <div class="sigline"></div>
        <div><b>${esc(preparedName || '')}</b></div>
        <div>Signature over printed name</div>
      </div>
      <div class="sigblock">
        <div style="text-align:left">Reviewed by:</div>
        <div class="sigline">${approved ? '<i>(signature on official PDF)</i>' : ''}</div>
        <div><b>${esc(report.approvedByName || '')}</b></div>
        <div>Signature over printed name</div>
        ${approved ? `<div>Approved ${esc(report.approvedAt)}</div>` : ''}
      </div>
    </div>`;
  }

  function dailyCommission(report, cfg, logoSrc) {
    const d = report.data;
    let head = '<tr><th rowspan="2">Therapist Name</th><th rowspan="2">Time</th>';
    for (let i = 1; i <= 6; i++) head += `<th colspan="3">${i}</th>`;
    head += '<th rowspan="2">TOTAL</th></tr><tr>';
    for (let i = 1; i <= 6; i++) head += '<th>Hrs</th><th>Stub #</th><th>Comm.</th>';
    head += '</tr>';

    const body = d.rows.map((r) => {
      let tds = `<td class="name">${esc(r.therapistName)}</td><td>${esc(r.time)}</td>`;
      for (let i = 0; i < 6; i++) {
        const b = r.blocks[i];
        tds += b
          ? `<td>${esc(b.hours || '')}</td><td>${esc(b.stubNumber)}</td><td>${money(b.commission)}</td>`
          : '<td></td><td></td><td></td>';
      }
      tds += `<td><b>${money0(r.total)}</b></td>`;
      return `<tr>${tds}</tr>`;
    }).join('');

    const totalRow = `<tr class="tot"><td class="name">GRAND TOTAL</td><td></td>${'<td></td>'.repeat(18)}<td>${money0(d.grandTotal)}</td></tr>`;

    return `<div class="doc">${header(cfg, 'DAILY THERAPIST COMMISSION', 'Date: ' + d.date, logoSrc)}
      <table>${head}${body}${totalRow}</table>
      ${footer(report, report.submittedByName || '')}</div>`;
  }

  function weeklyPayroll(report, cfg, logoSrc) {
    const d = report.data;
    let head = '<tr><th>Therapist</th>' + DAYS.map((x) => `<th>${x}</th>`).join('') +
      '<th>Gross</th>' + DED.map(([, l]) => `<th>${l}</th>`).join('') +
      '<th>Total Ded.</th><th>NH</th><th>Allow.</th><th>NET PAY</th><th>Signature</th></tr>';

    const cell = (c) => (c.type === 'RD' ? 'RD' : c.type === 'A' ? 'A' : money(c.amount));

    const body = d.rows.map((r) => `<tr>
      <td class="name">${esc(r.therapistName)}</td>
      ${DAY_KEYS.map((k) => `<td>${cell(r.days[k])}</td>`).join('')}
      <td><b>${money0(r.grossPay)}</b></td>
      ${DED.map(([k]) => `<td>${r.deductions[k].enabled ? money0(r.deductions[k].amount) : ''}</td>`).join('')}
      <td>${money0(r.totalDeductions)}</td>
      <td>${r.nh.enabled ? money0(r.nh.amount) : ''}</td>
      <td>${money(r.allowance)}</td>
      <td><b>${money0(r.netPay)}</b></td>
      <td style="min-width:70px"></td>
    </tr>`).join('');

    const t = d.totals;
    const totalRow = `<tr class="tot"><td class="name">TOTALS</td>
      ${DAY_KEYS.map((k) => `<td>${money(t.days[k])}</td>`).join('')}
      <td>${money0(t.grossPay)}</td>
      ${DED.map(([k]) => `<td>${money(t.deductions[k])}</td>`).join('')}
      <td>${money0(t.totalDeductions)}</td><td>${money(t.nh)}</td>
      <td>${money(t.allowance)}</td><td>${money0(t.netPay)}</td><td></td></tr>`;

    return `<div class="doc">${header(cfg, 'WEEKLY THERAPIST PAYROLL', `Week: ${d.dates[0]} to ${d.dates[6]}`, logoSrc)}
      <table>${head}${body}${totalRow}</table>
      ${footer(report, report.submittedByName || '')}</div>`;
  }

  function weeklySales(report, cfg, logoSrc) {
    const d = report.data;
    const body = d.rows.map((r) => `<tr>
      <td>${esc(r.date)}</td><td>${esc(r.day)}</td>
      <td>${money(r.grossSales)}</td><td>${money(r.commission)}</td><td>${money(r.bpi)}</td>
    </tr>`).join('');
    const totalRow = `<tr class="tot"><td>TOTAL</td><td></td>
      <td>${money0(d.totals.grossSales)}</td><td>${money0(d.totals.commission)}</td><td>${money0(d.totals.bpi)}</td></tr>`;

    return `<div class="doc">${header(cfg, 'WEEKLY SALES REPORT', `Week: ${d.rows[0].date} to ${d.rows[6].date}`, logoSrc)}
      <table><tr><th>Date</th><th>Day</th><th>Gross Sales</th><th>Commission</th><th>BPI</th></tr>
      ${body}${totalRow}</table>
      <div class="note">BPI amounts are card payments already included in Gross Sales.</div>
      ${footer(report, d.rawDataInputBy || '')}</div>`;
  }

  function render(type, report, cfg, logoSrc) {
    if (type === 'daily-commission') return dailyCommission(report, cfg, logoSrc);
    if (type === 'weekly-payroll') return weeklyPayroll(report, cfg, logoSrc);
    if (type === 'weekly-sales') return weeklySales(report, cfg, logoSrc);
    return '<div class="err">unknown document type</div>';
  }

  window.TBDoc = { render };
})();
