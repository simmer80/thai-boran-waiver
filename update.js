// One-tap updates.
//
// The old routine was "delete the app icon and install it again", which the
// staff cannot be asked to do from 8 timezones away. Instead: the app looks
// for a new build on launch and quietly every half hour, and when one is
// ready it shows a bar at the bottom of the screen —
//
//     Update available   [ Update now ]  [ Later ]
//
// One tap installs it and reloads onto the new version. "Later" hides the
// bar and it comes back a few minutes on, and again at the next launch, so
// an update can be postponed while a client is at the counter but never
// forgotten.
//
// Nothing is lost. Before reloading, every part of the app that might be
// holding unfinished work is asked (see guard()); if a waiver is half-filled
// or a document is mid-correction the update waits and says so. Waivers
// already captured live in IndexedDB, which an update never touches — and if
// any are still waiting to reach the server, the app pushes them first.
//
//   TBUpdate.init({ swUrl })       once per page
//   TBUpdate.guard(name, fn)       fn returns a reason to wait, or nothing
//   TBUpdate.check()               manual "check for updates"

'use strict';

(function () {
  // Half an hour is plenty: a release reaches every iPad within one shift,
  // and the check costs one small file.
  const CHECK_EVERY_MS = 30 * 60 * 1000;
  // Don't re-check more often than this, however many times the app is
  // brought back to the foreground.
  const MIN_GAP_MS = 5 * 60 * 1000;
  // How long "Later" lasts before the bar returns.
  const SNOOZE_MS = 10 * 60 * 1000;

  const guards = [];
  let registration = null;
  let lastCheck = 0;
  let reloading = false;
  let snoozedUntil = 0;
  let version = '';

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // -------------------------------------------------------------- guards
  // Anything that would be lost by reloading registers here.
  function guard(name, fn) {
    guards.push({ name, fn });
  }

  function blockers() {
    const out = [];
    for (const g of guards) {
      let reason = null;
      try { reason = g.fn(); } catch (_) { reason = null; }
      if (reason) out.push(String(reason));
    }
    return out;
  }

  // ------------------------------------------------------------- version
  // Asked of the worker that is actually running, so a phone call can
  // confirm what an iPad is on rather than what it should be on.
  function askVersion() {
    return new Promise((resolve) => {
      const sw = navigator.serviceWorker;
      // Straight after a first install nothing controls the page yet, so ask
      // the active worker directly rather than showing "not installed".
      const target = (sw && sw.controller) || (registration && registration.active);
      if (!target) return resolve('');
      let done = false;
      const finish = (v) => { if (!done) { done = true; resolve(v || ''); } };
      try {
        const ch = new MessageChannel();
        ch.port1.onmessage = (e) => finish(e.data && e.data.version);
        target.postMessage({ type: 'TB_VERSION' }, [ch.port2]);
        setTimeout(() => finish(''), 1500);
      } catch (_) {
        finish('');
      }
    });
  }

  function renderFooter() {
    let el = document.getElementById('tbVersion');
    if (!el) {
      el = document.createElement('div');
      el.id = 'tbVersion';
      el.className = 'tb-version noprint';
      document.body.appendChild(el);
    }
    el.innerHTML = `
      <span>Thai Boran app · version <b id="tbVersionNo">${esc(version || 'not installed')}</b></span>
      <button type="button" id="tbCheckNow">Check for updates</button>
      <span id="tbCheckMsg"></span>`;
    document.getElementById('tbCheckNow').addEventListener('click', async () => {
      const msg = document.getElementById('tbCheckMsg');
      msg.textContent = 'Checking…';
      const found = await check({ manual: true });
      if (found) msg.textContent = '';
      else msg.textContent = 'This iPad is up to date.';
      setTimeout(() => { if (msg.textContent === 'This iPad is up to date.') msg.textContent = ''; }, 6000);
    });
  }

  // --------------------------------------------------------------- the bar
  function bar() {
    return document.getElementById('tbUpdateBar');
  }

  function showBar() {
    if (bar() || reloading) return;
    const el = document.createElement('div');
    el.id = 'tbUpdateBar';
    el.className = 'tb-update noprint';
    el.setAttribute('role', 'status');
    el.innerHTML = `
      <div class="tb-update-card">
        <div class="tb-update-text">
          <b>Update available</b>
          <span>A newer version of the app is ready. It takes a few seconds.</span>
        </div>
        <div class="tb-update-actions">
          <button type="button" id="tbUpdateLater">Later</button>
          <button type="button" id="tbUpdateNow" class="go">Update now</button>
        </div>
        <div class="tb-update-note" id="tbUpdateNote"></div>
      </div>`;
    document.body.appendChild(el);
    document.getElementById('tbUpdateLater').addEventListener('click', () => {
      snoozedUntil = Date.now() + SNOOZE_MS;
      hideBar();
    });
    document.getElementById('tbUpdateNow').addEventListener('click', apply);
  }

  function hideBar() {
    const el = bar();
    if (el) el.remove();
  }

  function note(text, cls) {
    const el = document.getElementById('tbUpdateNote');
    if (!el) return;
    el.className = 'tb-update-note ' + (cls || '');
    el.textContent = text || '';
  }

  function maybeShowBar() {
    if (Date.now() < snoozedUntil) {
      setTimeout(maybeShowBar, snoozedUntil - Date.now() + 500);
      return;
    }
    showBar();
  }

  // ---------------------------------------------------------------- apply
  async function apply() {
    const go = document.getElementById('tbUpdateNow');
    const stop = blockers();
    if (stop.length) {
      note('Finish this first, then tap Update now: ' + stop.join('; ') + '.', 'warn');
      return;
    }
    if (go) { go.disabled = true; go.textContent = 'Updating…'; }

    // Anything captured but not yet sent goes now, so the reload happens
    // with nothing in flight. It is safe on the iPad either way — this is
    // belt and braces, and it must never block the update.
    try {
      if (window.TBSync && TBSync.pendingCount) {
        const pending = await TBSync.pendingCount();
        if (pending > 0 && navigator.onLine) {
          note('Sending ' + pending + ' waiver(s) to the server first…');
          await Promise.race([
            TBSync.syncNow(),
            new Promise((r) => setTimeout(r, 8000)),
          ]);
        }
      }
    } catch (_) { /* the records stay on the iPad regardless */ }

    note('Installing the new version…');
    const reg = registration;
    const waiting = reg && reg.waiting;
    if (!waiting) {
      // Nothing waiting any more (it may have activated already): a reload
      // is all that is left.
      reloading = true;
      return location.reload();
    }
    reloading = true;
    waiting.postMessage({ type: 'TB_SKIP_WAITING' });
    // controllerchange fires when the new worker takes over; reload then.
    setTimeout(() => { if (reloading) location.reload(); }, 4000);   // fallback
  }

  // ---------------------------------------------------------------- checks
  function watch(reg) {
    if (reg.waiting && navigator.serviceWorker.controller) maybeShowBar();
    reg.addEventListener('updatefound', () => {
      const installing = reg.installing;
      if (!installing) return;
      installing.addEventListener('statechange', () => {
        // "installed" with a controller already present means this is an
        // update rather than the very first install.
        if (installing.state === 'installed' && navigator.serviceWorker.controller) {
          maybeShowBar();
        }
      });
    });
  }

  async function check(opts) {
    const manual = opts && opts.manual;
    if (!registration) return false;
    if (!manual && Date.now() - lastCheck < MIN_GAP_MS) return !!registration.waiting;
    lastCheck = Date.now();
    try {
      await registration.update();
    } catch (_) { /* offline, or the server is asleep: try again later */ }
    if (manual) snoozedUntil = 0;          // an explicit check un-snoozes
    if (registration.waiting) { maybeShowBar(); return true; }
    return false;
  }

  // ------------------------------------------------------------------ init
  async function init(options) {
    const o = options || {};
    if (!('serviceWorker' in navigator)) {
      renderFooter();
      return;
    }
    try {
      registration = await navigator.serviceWorker.register(o.swUrl || './sw.js');
    } catch (_) {
      renderFooter();
      return;
    }

    version = await askVersion();
    renderFooter();

    navigator.serviceWorker.addEventListener('controllerchange', async () => {
      if (reloading) { location.reload(); return; }
      // A worker just took over (first install, or an update applied in
      // another tab): show what is actually running now.
      version = await askVersion();
      renderFooter();
    });

    watch(registration);
    check();

    setInterval(check, CHECK_EVERY_MS);
    // Coming back to the app, or back online, is a good moment to look.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') check();
    });
    window.addEventListener('online', () => check());
  }

  window.TBUpdate = { init, guard, check, apply, blockers, version: () => version };
})();
