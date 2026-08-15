// Print-preview framing for the rendered documents.
//
// The three forms are wide paper with a fixed natural width, exactly like the
// PDF (A4 landscape for commission and payroll, portrait for sales). On a
// laptop window — or an iPad — narrower than that paper, the document used to
// run straight out through the side of its panel. Here it is scaled down to
// fit the available width instead, so the whole form is always visible at any
// window size, in review and in edit mode alike.
//
// Structure produced around the document:
//
//   <div class="docFit">
//     <div class="docZoom noprint"> − 100% + Fit </div>
//     <div class="docStage">          scroll box, sized to the scaled paper
//       <div class="docScale">        holds the scaled-down footprint
//         <div class="doc">…</div>    natural paper width, transform: scale()
//
// The scale div is given the SCALED size explicitly: a CSS transform does not
// shrink the layout box, and without that the stage would show scrollbars for
// space the document no longer visually occupies.
//
// Nothing here changes what is printed — the print stylesheet drops the
// transform and the fixed sizes, so window.print() lays out full-size paper.

'use strict';

(function () {
  const MIN = 0.25;
  const MAX = 2;
  const STEP = 0.15;

  const parts = (host) => ({
    stage: host.querySelector('.docStage'),
    scale: host.querySelector('.docScale'),
    doc: host.querySelector('.doc'),
    label: host.querySelector('.docZoomPct'),
  });

  // The scale that makes the paper exactly fill the available width. Never
  // magnified past 1 — a document that already fits keeps its natural size.
  function fitScale(stage, doc) {
    const avail = stage.clientWidth;
    const natural = doc.offsetWidth;
    if (!avail || !natural) return 1;
    return Math.min(1, avail / natural);
  }

  function apply(host) {
    const { stage, scale, doc, label } = parts(host);
    if (!stage || !scale || !doc) return;

    // Measure at natural size: an already-applied transform must not feed
    // back into the next measurement.
    doc.style.transform = 'none';
    const naturalW = doc.offsetWidth;
    const naturalH = doc.offsetHeight;

    const s = host._tbfitAuto ? fitScale(stage, doc) : (host._tbfitScale || 1);
    host._tbfitScale = s;

    doc.style.transformOrigin = 'top left';
    doc.style.transform = `scale(${s})`;
    const w = Math.ceil(naturalW * s);
    const h = Math.ceil(naturalH * s);
    scale.style.width = w + 'px';
    scale.style.height = h + 'px';
    stage.style.height = h + 'px';

    if (label) label.textContent = Math.round(s * 100) + '%';
    host.classList.toggle('zoomed', w > stage.clientWidth + 1);
    host._tbfitWidth = stage.clientWidth;
  }

  function setScale(host, s) {
    host._tbfitAuto = false;
    host._tbfitScale = Math.min(MAX, Math.max(MIN, s));
    apply(host);
  }

  function fit(host) {
    host._tbfitAuto = true;
    apply(host);
  }

  // Frame the document that `host` already contains, and keep following it.
  // Call again after re-rendering into the host; the zoom level is kept.
  function attach(host, opts) {
    if (!host) return;
    const o = opts || {};
    const doc = host.querySelector('.doc');
    if (!doc) return;

    let stage = host.querySelector('.docStage');
    if (!stage) {
      const zoom = document.createElement('div');
      zoom.className = 'docZoom noprint';
      zoom.innerHTML = `
        <button type="button" class="btn docZoomOut" aria-label="Zoom out">−</button>
        <span class="docZoomPct" aria-live="polite">100%</span>
        <button type="button" class="btn docZoomIn" aria-label="Zoom in">+</button>
        <button type="button" class="btn docZoomFit">Fit width</button>
        <span class="muted docZoomHint">The whole form is scaled to fit. Zoom in to read detail — pinch works too.</span>`;
      stage = document.createElement('div');
      stage.className = 'docStage';
      const scale = document.createElement('div');
      scale.className = 'docScale';
      host.insertBefore(zoom, host.firstChild);
      host.appendChild(stage);
      stage.appendChild(scale);
      scale.appendChild(doc);

      zoom.querySelector('.docZoomOut').addEventListener('click', () => setScale(host, host._tbfitScale - STEP));
      zoom.querySelector('.docZoomIn').addEventListener('click', () => setScale(host, host._tbfitScale + STEP));
      zoom.querySelector('.docZoomFit').addEventListener('click', () => fit(host));
    } else {
      const scale = host.querySelector('.docScale');
      if (doc.parentElement !== scale) {   // freshly rendered document
        scale.innerHTML = '';
        scale.appendChild(doc);
      }
    }

    host.classList.add('docFit');
    if (host._tbfitAuto === undefined || o.refit) host._tbfitAuto = true;
    apply(host);

    // Follow the window, the device rotating, and the panel getting narrower
    // (the host element itself survives re-renders, so it is the stable thing
    // to observe). Width only: reacting to our own height changes would loop.
    if (!host._tbfitBound) {
      host._tbfitBound = true;
      let t = null;
      const later = () => { clearTimeout(t); t = setTimeout(() => apply(host), 60); };
      window.addEventListener('resize', later);
      window.addEventListener('orientationchange', later);
      if (window.ResizeObserver) {
        new ResizeObserver(() => {
          const s = host.querySelector('.docStage');
          if (s && s.clientWidth !== host._tbfitWidth) later();
        }).observe(host);
      }
    }
    // Fonts and the logo land after first paint and can shift the natural size.
    setTimeout(() => apply(host), 0);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => apply(host)).catch(() => {});
  }

  // Drop the framing (the host is going back to plain text).
  function detach(host) {
    if (!host) return;
    host.classList.remove('docFit', 'zoomed');
    const zoom = host.querySelector('.docZoom');
    if (zoom) zoom.remove();
    const stage = host.querySelector('.docStage');
    if (stage) stage.remove();
  }

  window.TBFit = { attach, detach, refresh: apply, fit };
})();
