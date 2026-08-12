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

  window.TB = { CFG, injectNav, updateNetChip, api, login, logout, me, cachedUser, setCachedUser, showWaking };
})();
