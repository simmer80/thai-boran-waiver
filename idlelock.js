// Idle auto-lock for everything behind the login.
//
// The iPad lives on the reception counter with clients on the other side of
// it. Sales figures, the day's takings and client records must never be
// sitting on that screen when nobody is using it — so any signed-in area
// locks itself after a short idle period, signs the session out and returns
// the tablet to the Waiver Form tab, which shows nothing but the waiver.
//
// A warning appears first, with a countdown and a "Keep me signed in"
// button, so the receptionist is never surprised mid-task.
//
//   TBIdleLock.start({ minutes, warnSeconds, waiverUrl })
//
// Any real interaction (touch, click, key, scroll) resets the clock. The
// timer is also tripped immediately when the page is hidden for longer than
// the idle period — walking away with the tab in the background counts.

'use strict';

(function () {
  const DEFAULT_MINUTES = 3;
  const DEFAULT_WARN_SECONDS = 20;

  let cfg = null;
  let deadline = 0;
  let tick = null;
  let warned = false;
  let stopped = false;

  function panel() {
    let el = document.getElementById('tbIdleWarn');
    if (!el) {
      el = document.createElement('div');
      el.id = 'tbIdleWarn';
      el.className = 'idleWarn';
      el.setAttribute('role', 'alertdialog');
      el.innerHTML = `
        <div class="idleCard">
          <h2>Still there?</h2>
          <p>This screen shows sales and client records, so it signs itself out
             when it is left alone — the app goes back to the Waiver Form.
             <b>Nothing is lost.</b></p>
          <p class="idleCount">Signing out in <b><span id="tbIdleSecs">0</span></b> <span id="tbIdleUnit">seconds</span>.</p>
          <button type="button" class="btn primary" id="tbIdleStay">I’m still here — keep me signed in</button>
        </div>`;
      document.body.appendChild(el);
      el.querySelector('#tbIdleStay').addEventListener('click', () => reset());
    }
    return el;
  }

  function hideWarning() {
    const el = document.getElementById('tbIdleWarn');
    if (el) el.remove();
    warned = false;
  }

  async function lockNow() {
    if (stopped) return;
    stopped = true;
    clearInterval(tick);
    hideWarning();
    try {
      // A real sign-out, not just a blank screen: coming back needs the
      // password again, so nothing is one tap away.
      if (window.TB && TB.logout) await TB.logout();
    } catch (_) { /* locking must never fail loudly */ }
    location.replace(cfg.waiverUrl);
  }

  function reset() {
    if (stopped) return;
    deadline = Date.now() + cfg.minutes * 60 * 1000;
    hideWarning();
  }

  function check() {
    if (stopped) return;
    const left = deadline - Date.now();
    if (left <= 0) return lockNow();
    if (left <= cfg.warnSeconds * 1000) {
      warned = true;
      const el = panel();
      const n = Math.ceil(left / 1000);
      const secs = el.querySelector('#tbIdleSecs');
      const unit = el.querySelector('#tbIdleUnit');
      if (secs) secs.textContent = String(n);
      if (unit) unit.textContent = n === 1 ? 'second' : 'seconds';
    } else if (warned) {
      hideWarning();
    }
  }

  function start(options) {
    cfg = {
      minutes: DEFAULT_MINUTES,
      warnSeconds: DEFAULT_WARN_SECONDS,
      waiverUrl: '../index.html',
      ...(options || {}),
    };
    stopped = false;
    reset();
    clearInterval(tick);
    tick = setInterval(check, 1000);

    // Interaction that means a person is actually there. Deliberately not
    // "mousemove": a bumped table should not keep the takings on screen.
    for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart', 'input', 'change']) {
      window.addEventListener(ev, reset, { passive: true });
    }
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') check();
    });
  }

  window.TBIdleLock = { start, reset, lockNow };
})();
