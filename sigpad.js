// Signature capture for a document submission.
//
// The same idea as the client waiver signature on the Waiver Form tab:
// strokes are kept in NORMALISED (0..1) coordinates rather than pixels, so
// the pad re-renders crisply after a rotation or a resize, and the exported
// PNG is a fixed size no matter how large the box was on screen.
//
// Used by the back office when the receptionist submits a document for
// approval: she signs, and that signature is stored against that submission
// and printed under "Raw data input by" on the finished paper.
//
//   TBSigPad.capture({ title, subtitle, name })
//     -> Promise<string|null>   PNG data URL, or null if she cancelled

'use strict';

(function () {
  const OUT_W = 600;   // exported PNG size — plenty for an 80pt-wide stamp
  const OUT_H = 200;

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  function capture(opts) {
    const o = opts || {};
    return new Promise((resolve) => {
      const host = document.createElement('div');
      host.className = 'sigModal';
      host.innerHTML = [
        '<div class="sigCard" role="dialog" aria-modal="true" aria-labelledby="sigTitle">',
        '  <h2 id="sigTitle">' + esc(o.title || 'Sign to submit') + '</h2>',
        '  <p class="muted">' + esc(o.subtitle || '') + '</p>',
        '  <canvas id="sigPad" class="sigPad" aria-label="Signature pad"></canvas>',
        '  <div class="sigRule"></div>',
        '  <div class="sigName">' + esc(o.name || '') + '</div>',
        '  <div class="muted" style="text-align:center;">Signature over printed name</div>',
        '  <div class="sigHint muted" id="sigHint">Sign above with your finger.</div>',
        '  <div class="sigActions">',
        '    <button type="button" class="btn" id="sigClear">Clear</button>',
        '    <span style="flex:1"></span>',
        '    <button type="button" class="btn" id="sigCancel">Cancel</button>',
        '    <button type="button" class="btn primary" id="sigOk" disabled>Save &amp; submit</button>',
        '  </div>',
        '</div>',
      ].join('');
      document.body.appendChild(host);

      const canvas = host.querySelector('#sigPad');
      const ctx = canvas.getContext('2d');
      const okBtn = host.querySelector('#sigOk');
      const hint = host.querySelector('#sigHint');
      let strokes = [];
      let current = null;
      let drawing = false;

      function penStyle(c, width) {
        c.strokeStyle = '#111';
        c.lineWidth = width;
        c.lineCap = 'round';
        c.lineJoin = 'round';
      }

      // Repaint every stored stroke into a box of w x h CSS pixels.
      function paintAll(c, w, h, width) {
        c.fillStyle = '#fff';
        c.fillRect(0, 0, w, h);
        penStyle(c, width);
        for (let s = 0; s < strokes.length; s++) {
          const stroke = strokes[s];
          if (!stroke.length) continue;
          c.beginPath();
          if (stroke.length === 1) {
            const x = stroke[0].x * w, y = stroke[0].y * h;
            c.moveTo(x, y);
            c.lineTo(x + 0.1, y + 0.1);      // a lone tap is a dot
          } else {
            for (let i = 0; i < stroke.length; i++) {
              const x = stroke[i].x * w, y = stroke[i].y * h;
              if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
            }
          }
          c.stroke();
        }
      }

      function resize() {
        const rect = canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.max(1, Math.floor(rect.width * dpr));
        canvas.height = Math.max(1, Math.floor(rect.height * dpr));
        // Setting width/height clears the transform; re-apply a clean scale.
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.scale(dpr, dpr);
        paintAll(ctx, rect.width, rect.height, 2.2);
      }

      let raf = 0;
      function scheduleResize() {
        if (raf) cancelAnimationFrame(raf);
        raf = requestAnimationFrame(function () { raf = 0; resize(); });
      }

      function point(e) {
        const rect = canvas.getBoundingClientRect();
        const t = e.touches && e.touches[0];
        const cx = t ? t.clientX : e.clientX;
        const cy = t ? t.clientY : e.clientY;
        return {
          x: Math.min(1, Math.max(0, (cx - rect.left) / (rect.width || 1))),
          y: Math.min(1, Math.max(0, (cy - rect.top) / (rect.height || 1))),
        };
      }

      function down(e) {
        drawing = true;
        current = [point(e)];
        strokes.push(current);
        e.preventDefault();
      }

      function move(e) {
        if (!drawing) return;
        const rect = canvas.getBoundingClientRect();
        const p = point(e);
        penStyle(ctx, 2.2);
        ctx.beginPath();
        const prev = current[current.length - 1];
        ctx.moveTo(prev.x * rect.width, prev.y * rect.height);
        ctx.lineTo(p.x * rect.width, p.y * rect.height);
        ctx.stroke();
        current.push(p);
        okBtn.disabled = false;
        hint.textContent = 'Sign above with your finger.';
        hint.className = 'sigHint muted';
        e.preventDefault();
      }

      function up() { drawing = false; current = null; }

      canvas.addEventListener('pointerdown', down);
      canvas.addEventListener('pointermove', move);
      canvas.addEventListener('pointerup', up);
      canvas.addEventListener('pointercancel', up);
      window.addEventListener('resize', scheduleResize);
      window.addEventListener('orientationchange', scheduleResize);

      function close(value) {
        window.removeEventListener('resize', scheduleResize);
        window.removeEventListener('orientationchange', scheduleResize);
        document.removeEventListener('keydown', onKey);
        host.remove();
        resolve(value);
      }
      function onKey(e) { if (e.key === 'Escape') close(null); }
      document.addEventListener('keydown', onKey);

      host.querySelector('#sigClear').addEventListener('click', function () {
        strokes = [];
        okBtn.disabled = true;
        resize();
      });
      host.querySelector('#sigCancel').addEventListener('click', function () { close(null); });
      host.addEventListener('click', function (e) { if (e.target === host) close(null); });

      okBtn.addEventListener('click', function () {
        if (!strokes.length) {
          hint.textContent = 'Please sign before submitting.';
          hint.className = 'sigHint err';
          return;
        }
        // Export from the normalised strokes at a fixed size, so the stored
        // PNG never depends on how big the box happened to be on screen.
        const out = document.createElement('canvas');
        out.width = OUT_W;
        out.height = OUT_H;
        const octx = out.getContext('2d');
        paintAll(octx, OUT_W, OUT_H, 4);
        close(out.toDataURL('image/png'));
      });

      resize();
      setTimeout(resize, 0);   // again once the modal has laid out
    });
  }

  window.TBSigPad = { capture };
})();
