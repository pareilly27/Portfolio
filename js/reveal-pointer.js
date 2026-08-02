// Renderer-agnostic cursor/reveal state.
//
// Owns "where is the pointer, how big is the reveal area, and how fast
// is it currently moving" -- normalized to the target element's own
// bounding box (0..1 on both axes) -- and nothing about how that gets
// drawn. js/grid-reveal.js (a WebGL renderer) reads this state and
// turns it into shader uniforms; a future renderer (a randomized
// non-circular shape, different physics) can subscribe to this same
// state instead of re-implementing pointer tracking, easing, velocity,
// or coordinate math. Runs its own rAF loop rather than only updating
// on mousemove, so per-frame animation (flowing noise, idle drift)
// keeps ticking even while the cursor is still.
//
// Public state shape (passed to every subscriber):
//   x, y     -- px position relative to the target element's box
//   nx, ny   -- 0..1 normalized position within that box
//   vx, vy   -- smoothed pointer velocity, px/sec
//   radius   -- current reveal radius in px (eases toward config.radius)
//   nRadius  -- radius normalized to the box's shorter side
//   active   -- whether the pointer is currently engaged
window.RevealPointer = (function () {
  const config = {
    radius: 170,        // steady-state reveal radius, px
    growMs: 250,        // time to ease the radius in on enter
    shrinkMs: 250,       // time to ease the radius out on leave
    velocitySmoothing: 0.2, // 0..1, higher = velocity reacts faster
  };

  let target = null;
  let rect = { left: 0, top: 0, width: 1, height: 1 };
  let rawX = 0, rawY = 0;
  let currentRadius = 0;
  let active = false;
  let lastTime = null;
  let prevRawX = null, prevRawY = null, prevTime = null;
  let velX = 0, velY = 0;
  const subscribers = [];

  // --- Idle parking ---------------------------------------------------
  // This loop used to call notify() every frame forever, and the WebGL
  // renderer in grid-reveal.js runs two full-screen shader passes on
  // every notification. So the effect re-rendered at 60fps permanently,
  // even with the pointer parked and the grid scrolled out of sight.
  //
  // Now the loop parks itself once nothing is changing. It restarts on
  // the next real input. IDLE_FRAMES is the tail: the memory/trail
  // buffer keeps fading for a while after the last movement, so we must
  // keep drawing through that decay or the trail freezes mid-fade
  // instead of dissolving.
  const IDLE_FRAMES = 30;
  let idleFrames = 0;
  let running = false;
  let onScreen = true;      // set by the IntersectionObserver in init()
  let lastNotifiedRadius = -1;

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function updateRect() {
    if (!target) return;
    const box = target.getBoundingClientRect();
    rect = {
      left: box.left,
      top: box.top,
      width: box.width || 1,
      height: box.height || 1,
    };
  }

  function updateVelocity(time) {
    if (prevTime !== null) {
      const dt = Math.max(time - prevTime, 1); // ms, guard against /0
      const instVX = ((rawX - prevRawX) / dt) * 1000; // px/sec
      const instVY = ((rawY - prevRawY) / dt) * 1000;
      const s = config.velocitySmoothing;
      velX += (instVX - velX) * s;
      velY += (instVY - velY) * s;
      // Idle pointer (no mousemove this frame): decay toward zero
      // instead of holding a stale velocity forever.
      if (rawX === prevRawX && rawY === prevRawY) {
        velX *= 0.85;
        velY *= 0.85;
      }
    }
    prevRawX = rawX;
    prevRawY = rawY;
    prevTime = time;
  }

  // Restart the loop after it has parked. Safe to call on every input --
  // the `running` flag keeps only one rAF chain alive at a time.
  function wake() {
    idleFrames = 0;
    if (!running && onScreen && !document.hidden) {
      running = true;
      lastTime = null;
      requestAnimationFrame(tick);
    }
  }

  function notify() {
    const nx = clamp((rawX - rect.left) / rect.width, 0, 1);
    const ny = clamp((rawY - rect.top) / rect.height, 0, 1);
    const minDim = Math.min(rect.width, rect.height) || 1;
    const state = {
      x: rawX - rect.left,
      y: rawY - rect.top,
      nx: nx,
      ny: ny,
      vx: velX,
      vy: velY,
      radius: currentRadius,
      nRadius: currentRadius / minDim,
      active: active,
    };
    for (let i = 0; i < subscribers.length; i++) subscribers[i](state);
  }

  function tick(time) {
    if (lastTime === null) lastTime = time;
    const dt = time - lastTime;
    lastTime = time;

    updateVelocity(time);

    const targetRadius = active ? config.radius : 0;
    const duration = active ? config.growMs : config.shrinkMs;
    const rate = duration > 0 ? dt / duration : 1;
    currentRadius += (targetRadius - currentRadius) * Math.min(rate * 3, 1);
    if (Math.abs(targetRadius - currentRadius) < 0.5) currentRadius = targetRadius;

    // Something still to do? Pointer moved this frame, the radius is
    // still easing, or we are inside the post-movement decay tail.
    const moved = (rawX !== prevRawX || rawY !== prevRawY);
    const radiusSettling = Math.abs(currentRadius - lastNotifiedRadius) > 0.01;
    if (moved || radiusSettling) idleFrames = 0;
    else idleFrames++;

    notify();
    lastNotifiedRadius = currentRadius;

    // Park once the trail has had time to finish fading. Nothing is
    // moving and nothing is decaying, so further frames would redraw an
    // identical picture.
    if (idleFrames >= IDLE_FRAMES || !onScreen || document.hidden) {
      running = false;
      return;
    }
    requestAnimationFrame(tick);
  }

  function init(el, opts) {
    target = el;
    if (opts) Object.assign(config, opts);
    updateRect();
    rawX = rect.left + rect.width / 2;
    rawY = rect.top + rect.height / 2;

    // Sections the reveal effect should never engage over -- both sit
    // well below the first viewport, in normal document flow, so their
    // rects have to be read fresh on every move rather than cached like
    // the fixed `target` above.
    var EXCLUDED_IDS = ['grid-container', 'contact-section'];

    function isInsideExcludedSection(x, y) {
      for (var i = 0; i < EXCLUDED_IDS.length; i++) {
        var el = document.getElementById(EXCLUDED_IDS[i]);
        if (!el) continue;
        var r = el.getBoundingClientRect();
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true;
      }
      return false;
    }

    // Has the pointer ever actually reported a position? Until it has,
    // rawX/rawY are just the target's centre (a guess), so they must not
    // be used to decide `active`.
    var hasPointer = false;

    // Re-evaluate whether the pointer currently sits over an excluded
    // section. Deliberately NOT tied to mousemove alone: the excluded
    // sections are in normal document flow, so SCROLLING moves them
    // under a stationary cursor. Recomputing only on mousemove meant
    // the effect stayed lit after the grid container scrolled beneath
    // an unmoving pointer, until the user happened to jiggle the mouse.
    function refreshActive() {
      if (!hasPointer) return;
      // Suppressing `active` (rather than just hiding the canvas with
      // CSS) means the effect never actually engages there: it eases out
      // via the same currentRadius shrink used for mouseleave/tab-hidden,
      // and eases back in on exit.
      var next = !isInsideExcludedSection(rawX, rawY);
      if (next !== active) {
        active = next;
        wake();   // ease the radius toward its new target, then park
      }
    }

    window.addEventListener('mousemove', function (e) {
      rawX = e.clientX;
      rawY = e.clientY;
      hasPointer = true;
      wake();
      refreshActive();
    }, { passive: true });

    window.addEventListener('mouseleave', function () {
      active = false;
      wake();   // let the radius ease back down to 0, then park
    });

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        active = false;
      } else {
        wake();
      }
    });

    // Stop entirely while the grid is off-screen. Once the page is
    // scrolled to the project grid or contact section the effect is
    // behind content nobody is looking at, so every frame spent on it
    // is wasted. rootMargin keeps it alive slightly beyond the edges so
    // it is already running by the time the grid scrolls back in.
    if (typeof IntersectionObserver === 'function' && target) {
      new IntersectionObserver(function (entries) {
        onScreen = entries[0].isIntersecting;
        if (onScreen) wake();
      }, { rootMargin: '200px' }).observe(target);
    }

    window.addEventListener('resize', function () {
      updateRect();
      refreshActive();   // layout moved -> the pointer may now be over an excluded section
      wake();
    }, { passive: true });
    window.addEventListener('scroll', function () {
      updateRect();
      // The whole point: scrolling can bring #grid-container under a
      // stationary cursor, and that must kill the effect immediately
      // rather than waiting for the next mouse movement.
      refreshActive();
      wake();   // the target's rect moved, so the mapping changed
    }, { passive: true });

    lastTime = null;
    prevTime = null;
    running = true;
    requestAnimationFrame(tick);
  }

  function subscribe(fn) {
    subscribers.push(fn);
    return function unsubscribe() {
      const i = subscribers.indexOf(fn);
      if (i > -1) subscribers.splice(i, 1);
    };
  }

  return { init: init, subscribe: subscribe, config: config };
})();
