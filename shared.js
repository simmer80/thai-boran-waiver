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
    const depth = location.pathname.includes('/reception/') || location.pathname.includes('/manager/') ? '../' : './';
    const tabs = [
      { id: 'waiver', label: 'Waiver Form', href: depth === './' ? './index.html' : '../index.html' },
      { id: 'reception', label: 'Receptionist', href: depth + 'reception/' },
      { id: 'manager', label: 'Manager', href: depth + 'manager/' },
    ];
    bar.innerHTML = tabs
      .map((t) => `<a href="${t.href}" class="tb-tab${t.id === active ? ' active' : ''}">${t.label}</a>`)
      .join('') + '<span id="tbNetChip" class="tb-chip">…</span>';
    document.body.insertBefore(bar, document.body.firstChild);
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

  async function api(path, options = {}) {
    const url = (CFG.apiBase || '') + path;
    if (!navigator.onLine) {
      const e = new Error('offline');
      e.offline = true;
      throw e;
    }
    if (!wakingTimer) wakingTimer = setTimeout(() => showWaking(true), 3500);
    try {
      const res = await fetch(url, {
        credentials: 'include',
        headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
        ...options,
        body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body,
      });
      if (res.status === 401) {
        const e = new Error('not logged in');
        e.unauthorized = true;
        throw e;
      }
      if (!res.ok) {
        let msg = 'request failed';
        try { msg = (await res.json()).error || msg; } catch (_) {}
        throw new Error(msg);
      }
      return res.headers.get('content-type') && res.headers.get('content-type').includes('pdf')
        ? res.blob()
        : res.json();
    } finally {
      clearTimeout(wakingTimer);
      wakingTimer = null;
      showWaking(false);
    }
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
    const out = await api('/api/auth/login', { method: 'POST', body: { username, password } });
    setCachedUser(out.user);
    return out.user;
  }
  async function logout() {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch (_) {}
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

  window.TB = {
    CFG, injectNav, updateNetChip, api, login, logout, me, cachedUser, setCachedUser, showWaking,
    SITES, deviceSite, setDeviceSite, siteLabel, refreshPrices,
  };
})();
