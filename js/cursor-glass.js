// Custom glass cursor.
//
// A small backdrop-blurred circle that trails the mouse with a light
// ease and shrinks a touch on click. Size is otherwise fixed (no
// hover-grow).
//
// Hidden entirely while over the home page's hero grid (#grid /
// #grid-reveal-canvas / its .cell children) -- that area already has
// its own cursor-following pixel-cloud WebGL effect
// (js/grid-reveal.js), and stacking a second cursor indicator on top
// of it was redundant.
//
// Bails out entirely on touch/coarse-pointer devices (no fine mouse),
// where a custom cursor doesn't make sense and native touch behavior
// should be left alone.
document.addEventListener('DOMContentLoaded', function () {
  if (!window.matchMedia || !window.matchMedia('(pointer: fine)').matches) {
    return;
  }

  document.documentElement.classList.add('glass-cursor-active');

  const el = document.createElement('div');
  el.className = 'glass-cursor';
  // Appended to <html>, NOT document.body: several project pages
  // (css/workPage__NEW.css) put `transform: translateX(0)` on <body>
  // to power the slide page-transition. Any `transform` on an
  // ancestor creates a new containing block for position:fixed
  // descendants, so a cursor appended under body on those pages isn't
  // actually fixed to the viewport -- it's anchored to body's box
  // instead, and drifts/scrolls out of view on tall scrolling pages.
  // <html> has no such transform, so appending here keeps it
  // genuinely viewport-fixed everywhere.
  document.documentElement.appendChild(el);

  const HOVER_SELECTOR = 'a, button, input, textarea, select, [role="button"], .square';
  const HIDE_SELECTOR = '#grid, #grid-reveal-canvas, .cell';
  // The toggles show a native pixel-art hand cursor instead (see
  // css/cursor-glass.css). Hide the glass circle over them so the hand
  // replaces it, rather than both appearing at once. Unlike
  // HIDE_SELECTOR this applies in Experimental mode too -- the toggle
  // is present and usable in both states.
  const NATIVE_CURSOR_SELECTOR = '.toggle-btn';
  const POSITION_EASE = 0.35; // higher = tighter tracking, lower = more trail
  const SIZE_EASE = 0.2;
  const BASE_SIZE = 26;  // px
  const PRESS_SIZE_MULT = 0.85;

  let targetX = window.innerWidth / 2;
  let targetY = window.innerHeight / 2;
  let x = targetX;
  let y = targetY;
  let size = BASE_SIZE;
  let inWindow = false;
  let suppressed = false; // true while over the hero grid hide-zone
  let hovering = false;
  let pressed = false;

  function updateVisibility() {
    el.classList.toggle('is-visible', inWindow && !suppressed);
  }

  function onMove(e) {
    targetX = e.clientX;
    targetY = e.clientY;

    const wasInWindow = inWindow;
    if (!inWindow) {
      inWindow = true;
      x = targetX;
      y = targetY;
    }

    const target = e.target;
    // Linear uses the WebGL cursor reveal and hides the secondary cursor.
    // Experimental has full-cell image reveals, so the glass cursor remains
    // visible above those images and the locator lines.
    const overNativeCursor = !!(target && target.closest && target.closest(NATIVE_CURSOR_SELECTOR));
    const nowSuppressed = overNativeCursor
      || (!document.body.classList.contains('is-experimental')
        && !!(target && target.closest && target.closest(HIDE_SELECTOR)));
    const hovered = !nowSuppressed && target && target.closest && target.closest(HOVER_SELECTOR);

    if (nowSuppressed !== suppressed || !wasInWindow) {
      suppressed = nowSuppressed;
      updateVisibility();
    }

    if (!!hovered !== hovering) {
      hovering = !!hovered;
      el.classList.toggle('is-hover', hovering);
    }
  }

  function hide() {
    inWindow = false;
    updateVisibility();
  }

  window.addEventListener('mousemove', function (e) {
    onMove(e);
    wake();
  }, { passive: true });

  // mouseleave on <html> (unlike mouseout) doesn't bubble and only
  // fires when the pointer genuinely leaves the document -- not on
  // every element-to-element transition. The old approach (window
  // 'mouseout' + checking relatedTarget is null) is a common pattern,
  // but it's a heuristic: some browsers fire that same null-
  // relatedTarget mouseout spuriously mid-page, especially around
  // large images still decoding/painting (this project's gallery
  // images run 15-95MB), which was reading as "cursor left the
  // window" and hiding it while the mouse was still over the page.
  document.documentElement.addEventListener('mouseleave', hide);

  window.addEventListener('mousedown', function () { pressed = true; wake(); });
  window.addEventListener('mouseup', function () { pressed = false; wake(); });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) hide();
  });

  // Last values actually written to the element, so we can skip
  // redundant style writes. width/height are the expensive pair: each
  // change invalidates layout for this element, whereas transform is
  // compositor-only. The old code wrote all three every single frame,
  // forever, even while the cursor sat perfectly still.
  var lastW = -1;
  var running = false;

  function tick() {
    x += (targetX - x) * POSITION_EASE;
    y += (targetY - y) * POSITION_EASE;

    var targetSize = pressed ? BASE_SIZE * PRESS_SIZE_MULT : BASE_SIZE;
    size += (targetSize - size) * SIZE_EASE;

    // Snap the tail of each ease so "close enough" becomes "settled"
    // and the loop can actually reach a resting state.
    if (Math.abs(targetX - x) < 0.05) x = targetX;
    if (Math.abs(targetY - y) < 0.05) y = targetY;
    if (Math.abs(targetSize - size) < 0.05) size = targetSize;

    var half = size / 2;
    // Only touch width/height when the rounded pixel value changes.
    var wpx = Math.round(size * 100) / 100;
    if (wpx !== lastW) {
      el.style.width = wpx + 'px';
      el.style.height = wpx + 'px';
      lastW = wpx;
    }
    el.style.transform = 'translate3d(' + (x - half) + 'px, ' + (y - half) + 'px, 0)';

    // Park when the cursor has caught up and the size has settled.
    // Any subsequent input calls wake() and restarts the chain.
    if (x === targetX && y === targetY && size === targetSize) {
      running = false;
      return;
    }
    requestAnimationFrame(tick);
  }

  function wake() {
    if (running) return;
    running = true;
    requestAnimationFrame(tick);
  }

  wake();
});
