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

    notify();
    requestAnimationFrame(tick);
  }

  function init(el, opts) {
    target = el;
    if (opts) Object.assign(config, opts);
    updateRect();
    rawX = rect.left + rect.width / 2;
    rawY = rect.top + rect.height / 2;

    window.addEventListener('mousemove', function (e) {
      rawX = e.clientX;
      rawY = e.clientY;
      active = true;
    }, { passive: true });

    window.addEventListener('mouseleave', function () {
      active = false;
    });

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) active = false;
    });

    window.addEventListener('resize', updateRect, { passive: true });
    window.addEventListener('scroll', updateRect, { passive: true });

    lastTime = null;
    prevTime = null;
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
