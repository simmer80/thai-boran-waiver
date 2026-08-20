// Shared frontend plumbing: top navigation tabs, API client with
// cold-start ("waking up") handling, login state cache, online detection.
// Vanilla JS, no build, iPad Safari compatible.

'use strict';

(function () {
  const CFG = window.TB_CONFIG || { apiBase: '', branchId: 'panacan' };

  // ------------------------------------------------------------ nav tabs
  // Injects the three top-level tabs on every page.
  function injectNav(active) {
    const bar = document.createElement('nav');
    bar.className = 'tb-nav';
    const depth = ["/reception/", "/manager/", "/records/"].some((x) => location.pathname.includes(x)) ? "../" : "./";
    const tabs = [
      { id: 'waiver', label: 'Waiver Form', href: depth === './' ? './index.html' : '../index.html' },
      { id: 'reception', label: 'Front desk', href: depth + 'reception/' },
      { id: 'manager', label: 'Manager', href: depth + 'manager/' },
      { id: "records", label: "Sales & history", href: depth + "records/" },
    ];
    // The WAIVER tab is a client-facing screen: an iPad handed across the
    // counter. It must advertise nothing about the business, so it carries
    // only itself and one quiet way back to work. The back office is behind
    // a login anyway, but the labels alone are more than a client should read.
    const shown = active === "waiver"
      ? [tabs[0], { id: "staff", label: "Staff", href: tabs[1].href, quiet: true }]
      : tabs;
    bar.innerHTML = shown
      .map((t) => `<a href="${t.href}" class="tb-tab${t.id === active ? " active" : ""}${t.quiet ? " quiet" : ""}">${t.label}</a>`)
      .join("") + `<span id="tbNetChip" class="tb-chip">...</span>`;
    document.body.insertBefore(bar, document.body.firstChild);
    // The back-office pages get the app canvas behind them; the waiver
    // page keeps its own cream background.
    if (document.querySelector('.bo')) document.body.classList.add('tb-app');
    updateNetChip();
    window.addEventListener('online', updateNetChip);
    window.addEventListener('offline', updateNetChip);
  }

  function updateNetChip(extra) {
    const chip = document.getElementById('tbNetChip');
    if (!chip) return;
    if (typeof extra === 'string') { chip.textContent = extra; return; }
    chip.textContent = navigator.onLine ? 'Online' : 'Offline';
    chip.classList.toggle('off', !navigator.onLine);
  }

  // ------------------------------------------------------------- API client
  // Free Render services sleep after 15 min; the first request can take
  // 30-60s. If a request is slow we surface a "waking up" banner rather
  // than looking broken.
  let wakingTimer = null;

  function showWaking(on) {
    let el = document.getElementById('tbWaking');
    if (on) {
      if (!el) {
        el = document.createElement('div');
        el.id = 'tbWaking';
        el.className = 'tb-waking';
        el.textContent = 'Server is waking up (free hosting sleeps when idle) — this can take up to a minute…';
        document.body.insertBefore(el, document.body.children[1] || null);
      }
    } else if (el) {
      el.remove();
    }
  }

  // ---------------------------------------------------------- bearer token
  // The API lives on a different origin (Render) from this page (GitHub
  // Pages), so its session cookie is a THIRD-PARTY cookie — iPad Safari's
  // ITP refuses to store/send it (desktop browsers cope, which is why the
  // laptop worked). The signed session token therefore travels as an
  // Authorization: Bearer header, stored in localStorage. Reading it fresh
  // from localStorage on every call keeps multiple tabs consistent; a 401
  // clears it everywhere. Kiosk devices + short expiry + server-side
  // tokenVersion invalidation make localStorage acceptable here.
  function token() {
    return localStorage.getItem('tb_token') || '';
  }
  function setToken(t) {
    if (t) localStorage.setItem('tb_token', t);
    else localStorage.removeItem('tb_token');
  }

  async function api(path, options = {}) {
    const url = (CFG.apiBase || '') + path;
    if (!navigator.onLine) {
      const e = new Error('offline');
      e.offline = true;
      throw e;
    }
    if (!wakingTimer) wakingTimer = setTimeout(() => showWaking(true), 3500);
    try {
      const t = token(); // fresh from localStorage each call (multi-tab safe)
      const res = await fetch(url, {
        credentials: 'include', // cookie stays as the secondary path
        ...options,
        headers: {
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
          ...(t ? { Authorization: 'Bearer ' + t } : {}),
          ...(options.headers || {}),
        },
        body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body,
      });
      if (res.status === 401) {
        setToken(null);          // dead/expired/invalid token — drop it
        setCachedUser(null);
        const e = new Error('not logged in');
        e.unauthorized = true;
        throw e;
      }
      if (!res.ok) {
        let msg = 'request failed';
        try { msg = (await res.json()).error || msg; } catch (_) {}
        // Carry the status: a caller needs to tell "try again later" (5xx,
        // asleep) from "this will never work" (4xx — bad format, too big),
        // or it retries a doomed request on every pass for ever.
        const err = new Error(msg);
        err.status = res.status;
        throw err;
      }
      // Binary answers (PDF exports, the approver's signature image) come
      // back as blobs; everything else is JSON.
      const ct = res.headers.get('content-type') || '';
      return ct.includes('pdf') || ct.startsWith('image/') ? res.blob() : res.json();
    } finally {
      clearTimeout(wakingTimer);
      wakingTimer = null;
      showWaking(false);
    }
  }

  // ------------------------------------------------------- plain English
  // Every failure the staff can see goes through here. The server's own
  // wording is for developers ("report not found — generate it first"); what
  // a receptionist needs is what went wrong and what to do about it, in the
  // words she would use. `doing` names the action in progress, e.g.
  // "export the PDF", so the sentence reads naturally either way.
  function explain(err, doing) {
    const what = doing ? doing : 'do that';
    if (!err) return `Could not ${what}. Please try again.`;
    const msg = String((err && err.message) || err || '');

    if (err.offline || !navigator.onLine) {
      return `The iPad has no WiFi at the moment, so it could not ${what}.\n\n` +
        `Waivers you take are still saved on this iPad and will be sent by ` +
        `themselves when the WiFi is back. Check the WiFi and try again.`;
    }
    if (err.badCredentials) {
      return [
        'That username or password was not recognised.',
        '',
        'Capital letters in the username do not matter, but the password must be typed exactly.',
        'If you have forgotten it, ask the manager to reset it for you.',
      ].join(String.fromCharCode(10));
    }
    if (err.unauthorized || /not logged in/i.test(msg)) {
      return `You have been signed out (this happens after a while for safety), ` +
        `so the app could not ${what}.\n\nSign in again and repeat what you were doing.`;
    }
    if (/invalid credentials/i.test(msg)) {
      return `That username or password was not recognised.\n\n` +
        `Capital letters in the username do not matter, but the password must be exact. ` +
        `If you have forgotten it, ask the manager to reset it for you.`;
    }
    if (/password change required/i.test(msg)) {
      return `You need to choose your own password before you can continue. ` +
        `Type the temporary password the manager gave you, then pick a new one.`;
    }
    if (/report not found/i.test(msg)) {
      return `That document has not been made yet for the day you picked.\n\n` +
        `Open Documents, choose the document and the date, then press ` +
        `"Create / refresh from records".`;
    }
    if (/signature is required/i.test(msg)) {
      return `The document has to be signed before it goes to the manager.\n\n` +
        `Press "Submit for approval" again and sign in the white box with your finger.`;
    }
    if (/already approved/i.test(msg)) {
      return `The manager has already approved this document, so it cannot be changed.\n\n` +
        `If something on it is wrong, press "Create / refresh from records" to start a new version.`;
    }
    if (/cannot approve/i.test(msg)) {
      return `This document is not waiting for approval — the front desk may have ` +
        `changed it since it was sent.\n\nAsk them to submit it again, then approve the new version.`;
    }
    if (/unknown site/i.test(msg)) {
      return `No parlor is chosen. Pick Panacan or Airport Road at the top of the screen and try again.`;
    }
    if (/must be the Monday/i.test(msg)) {
      return `Weekly documents always cover Monday to Sunday. Pick any day in the week ` +
        `you want and the app will use that whole week.`;
    }
    if (/timeout|failed to fetch|networkerror|load failed|request failed/i.test(msg)) {
      return `The server did not answer, so the app could not ${what}.\n\n` +
        `The server falls asleep when nobody has used it for a while and takes ` +
        `up to a minute to wake up. Wait a moment and try again. Nothing has been lost.`;
    }
    // Anything else: show what the server said, but still say what to do.
    return `Could not ${what}.\n\n${msg}\n\nIf it happens again, wait a minute and try once more.`;
  }

  // A failure the staff must acknowledge. Native alert on purpose: on an iPad
  // it is unmissable and needs no styling.
  function sorry(err, doing) {
    alert(explain(err, doing));
  }

  // ------------------------------------------------------------ login cache
  // The cookie is the real session; this cache lets the UI show who is
  // logged in and stamp receptionist ids on offline-captured records.
  function cachedUser() {
    try { return JSON.parse(localStorage.getItem('tb_user') || 'null'); } catch { return null; }
  }
  function setCachedUser(u) {
    if (u) localStorage.setItem('tb_user', JSON.stringify(u));
    else localStorage.removeItem('tb_user');
  }

  async function login(username, password) {
    let out;
    try {
      out = await api('/api/auth/login', { method: 'POST', body: { username, password } });
    } catch (e) {
      // A 401 HERE means the name or password was wrong — not that a session
      // expired, which is what a 401 means everywhere else. Without this the
      // sign-in screen tells people they have been signed out.
      if (e.unauthorized) {
        const bad = new Error('invalid credentials');
        bad.badCredentials = true;
        throw bad;
      }
      throw e;
    }
    if (out.token) setToken(out.token); // primary auth from here on
    setCachedUser(out.user);
    return out.user;
  }
  async function logout() {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch (_) {}
    setToken(null);
    setCachedUser(null);
  }
  async function me() {
    try {
      const out = await api('/api/auth/me');
      setCachedUser(out.user);
      return out.user;
    } catch (e) {
      if (e.unauthorized) setCachedUser(null);
      return null;
    }
  }

  // ------------------------------------------------------------ device site
  // Which parlor this device belongs to. Set by the manager in the Manager
  // tab's device section. The laptop typically has none (manager picks per
  // view); iPads are set once to their own parlor.
  const SITES = [
    { id: 'panacan', label: 'Panacan' },
    { id: 'airport-road', label: 'Airport Road' },
  ];
  function deviceSite() {
    const s = localStorage.getItem('tb_site') || '';
    return SITES.some((x) => x.id === s) ? s : '';
  }
  function setDeviceSite(id) {
    if (id) localStorage.setItem('tb_site', id);
    else localStorage.removeItem('tb_site');
  }
  function siteLabel(id) {
    const s = SITES.find((x) => x.id === id);
    return s ? s.label : (id || 'no site selected');
  }

  // ------------------------------------------------------- shared prices
  // Prices are ORG-SHARED and live on the server (single source of truth
  // for both parlors). Every page refreshes the local cache
  // (tb_price_sets_v1 — the same key the waiver form charges from) on load;
  // offline the last-known cached prices keep the till working.
  async function refreshPrices() {
    if (!navigator.onLine) return { offline: true };
    try {
      const res = await fetch((CFG.apiBase || '') + '/api/prices', { cache: 'no-store' });
      if (!res.ok) throw new Error('prices fetch failed');
      const out = await res.json();
      if (!Array.isArray(out.sets)) return { ok: false };
      const before = localStorage.getItem('tb_price_sets_v1') || '';
      const after = JSON.stringify(out.sets);
      const changed = before !== after && out.sets.length > 0;
      if (out.sets.length > 0) localStorage.setItem('tb_price_sets_v1', after);
      document.dispatchEvent(new CustomEvent('tb:prices', {
        detail: { changed, updatedAt: out.updatedAt, count: out.sets.length },
      }));
      return { ok: true, changed };
    } catch (_) {
      return { ok: false }; // cache stays; charging keeps working offline
    }
  }

  // --------------------------------------------------- shared therapists
  // Active therapist list (id + full name only) for the waiver picker.
  // Cached exactly like prices: refreshed on every successful fetch so the
  // picker keeps working offline with the last-known list; an empty answer
  // never clobbers a populated cache.
  function cachedTherapists() {
    try {
      const a = JSON.parse(localStorage.getItem('tb_therapists') || '[]');
      return Array.isArray(a) ? a : [];
    } catch { return []; }
  }
  async function refreshTherapists() {
    if (!navigator.onLine) return { offline: true };
    try {
      const res = await fetch((CFG.apiBase || '') + '/api/therapists/public', { cache: 'no-store' });
      if (!res.ok) throw new Error('fetch failed');
      const out = await res.json();
      if (!Array.isArray(out.therapists)) return { ok: false };
      const before = localStorage.getItem('tb_therapists') || '';
      const after = JSON.stringify(out.therapists);
      const changed = before !== after && out.therapists.length > 0;
      if (out.therapists.length > 0) localStorage.setItem('tb_therapists', after);
      document.dispatchEvent(new CustomEvent('tb:therapists', { detail: { changed, count: out.therapists.length } }));
      return { ok: true, changed };
    } catch (_) {
      return { ok: false }; // cache stays; picker keeps working offline
    }
  }

  window.TB = {
    CFG, injectNav, updateNetChip, api, login, logout, me, cachedUser, setCachedUser, showWaking,
    explain, sorry,
    SITES, deviceSite, setDeviceSite, siteLabel, refreshPrices,
    token, setToken, cachedTherapists, refreshTherapists,
  };
})();
