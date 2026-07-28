// Text bubbles with a small, self-contained 2D rigid-body simulation.
// Two modes, both sharing the same collision/wall solver:
//   'fall'  -- every bubble drops straight in from above the scene and
//              lands under gravity, no floating/drift phase (home page).
//   'hover' -- no gravity; each bubble starts in its own quadrant of the
//              scene (so the set never spawns on top of itself) and
//              drifts gently within the scene's bounds forever (about page).
// Collision is solved in normalized ellipse space, so the broad ovals
// contact at their actual visible edges instead of behaving like small
// circles.
(function () {
  const GRAVITY = 650;        // CSS pixels per second squared -- slow, gentle fall
  const AIR_DRAG = 0.995;
  const BOUNCE = 0.12;
  const FLOOR_FRICTION = 0.78;
  const WALL_PADDING = 8;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const magnitude = (x, y) => Math.hypot(x, y);

  // Builds one independent bubble simulation bound to `scene`.
  // Returns { activate, deactivate }, or null if the scene isn't on the page.
  function createBubbleScene(scene, labels, options) {
    if (!scene) return null;
    const mode = (options && options.mode) || 'fall';

    let bubbles = [];
    let active = false;
    let raf = 0;
    let lastTime = 0;

    function bounds() {
      return { width: scene.clientWidth, height: scene.clientHeight };
    }

    function createBubbles() {
      scene.replaceChildren();
      const { width, height } = bounds();
      // Hover mode lays bubbles out in a grid of quadrants across the
      // scene first, so with N labels no two ever start overlapping --
      // then each one gets a random offset within its own cell.
      const cols = mode === 'hover' ? Math.ceil(Math.sqrt(labels.length)) : 1;
      const rows = mode === 'hover' ? Math.ceil(labels.length / cols) : 1;
      const cellW = width / cols;
      const cellH = height / rows;

      bubbles = labels.map((label, index) => {
        const element = document.createElement('div');
        element.className = 'physics-bubble';
        element.textContent = label;
        scene.appendChild(element);
        const rect = element.getBoundingClientRect();
        const w = rect.width;
        const h = rect.height;

        if (mode === 'hover') {
          const col = index % cols;
          const row = Math.floor(index / cols);
          const cellX = col * cellW;
          const cellY = row * cellH;
          return {
            element, w, h,
            x: cellX + Math.random() * Math.max(1, cellW - w),
            y: cellY + Math.random() * Math.max(1, cellH - h),
            vx: (Math.random() - 0.5) * 20,
            vy: (Math.random() - 0.5) * 20,
            driftX: (Math.random() - 0.5) * 30,
            driftY: (Math.random() - 0.5) * 30,
            phase: Math.random() * Math.PI * 2,
            angle: (Math.random() - 0.5) * 4,
            angularVelocity: (Math.random() - 0.5) * 0.3,
            index,
          };
        }

        return {
          element, w, h,
          x: WALL_PADDING + Math.random() * Math.max(1, width - w - WALL_PADDING * 2),
          // Start above the scene's own top edge, staggered per bubble, so
          // each one visibly drops in from off-screen rather than
          // appearing mid-air.
          y: -h - Math.random() * 220 - index * 80,
          vx: 0,
          vy: 0,
          angle: (Math.random() - 0.5) * 4,
          angularVelocity: (Math.random() - 0.5) * 0.45,
          index,
        };
      });
    }

    function position(bubble) {
      bubble.element.style.transform = `translate3d(${bubble.x}px, ${bubble.y}px, 0) rotate(${bubble.angle}deg)`;
    }

    function contain(bubble, width, height) {
      if (bubble.x < WALL_PADDING) {
        bubble.x = WALL_PADDING;
        bubble.vx = Math.abs(bubble.vx) * BOUNCE;
      } else if (bubble.x + bubble.w > width - WALL_PADDING) {
        bubble.x = width - bubble.w - WALL_PADDING;
        bubble.vx = -Math.abs(bubble.vx) * BOUNCE;
      }
      if (mode === 'hover') {
        // No floor to settle on -- bounce off all four walls so it stays
        // hovering within the scene indefinitely.
        if (bubble.y < WALL_PADDING) {
          bubble.y = WALL_PADDING;
          bubble.vy = Math.abs(bubble.vy) * BOUNCE;
        } else if (bubble.y + bubble.h > height - WALL_PADDING) {
          bubble.y = height - bubble.h - WALL_PADDING;
          bubble.vy = -Math.abs(bubble.vy) * BOUNCE;
        }
        return;
      }
      if (bubble.y + bubble.h > height) {
        bubble.y = height - bubble.h;
        bubble.vy = -bubble.vy * BOUNCE;
        bubble.vx *= FLOOR_FRICTION;
        // Spin also has to settle to exactly 0, same as vx/vy below --
        // otherwise a bubble sitting still but still slowly rotating
        // would keep the "everything's asleep" check in tick() from
        // ever passing, and the render loop would never actually stop.
        bubble.angularVelocity *= FLOOR_FRICTION;
        if (Math.abs(bubble.vy) < 24) bubble.vy = 0;
        if (Math.abs(bubble.vx) < 2) bubble.vx = 0;
        if (Math.abs(bubble.angularVelocity) < 0.02) bubble.angularVelocity = 0;
      }
    }

    function collide(a, b) {
      const ax = a.x + a.w / 2;
      const ay = a.y + a.h / 2;
      const bx = b.x + b.w / 2;
      const by = b.y + b.h / 2;
      let dx = bx - ax;
      let dy = by - ay;
      const radiusX = (a.w + b.w) / 2;
      const radiusY = (a.h + b.h) / 2;
      let scaledX = dx / radiusX;
      let scaledY = dy / radiusY;
      let distance = magnitude(scaledX, scaledY);
      if (distance >= 1) return;
      if (distance < 0.001) {
        dx = 0.01 + Math.random() * 0.01;
        dy = 0.01;
        scaledX = dx / radiusX;
        scaledY = dy / radiusY;
        distance = magnitude(scaledX, scaledY);
      }
      const ellipseX = scaledX / distance;
      const ellipseY = scaledY / distance;
      // Convert the normal from ellipse space back to screen space.
      let nx = ellipseX * radiusX;
      let ny = ellipseY * radiusY;
      const normalLength = magnitude(nx, ny);
      nx /= normalLength;
      ny /= normalLength;
      const overlap = 1 - distance;
      // Separate both bodies before applying impulse: stable at rest, even
      // when several bubbles land in the same frame.
      a.x -= ellipseX * radiusX * overlap * 0.5;
      a.y -= ellipseY * radiusY * overlap * 0.5;
      b.x += ellipseX * radiusX * overlap * 0.5;
      b.y += ellipseY * radiusY * overlap * 0.5;

      const relativeVelocity = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (relativeVelocity < 0) {
        const impulse = -(1 + BOUNCE) * relativeVelocity * 0.5;
        a.vx -= impulse * nx;
        a.vy -= impulse * ny;
        b.vx += impulse * nx;
        b.vy += impulse * ny;
      }
      const tangentX = -ny;
      const tangentY = nx;
      const tangentSpeed = (b.vx - a.vx) * tangentX + (b.vy - a.vy) * tangentY;
      const friction = clamp(tangentSpeed * 0.14, -38, 38);
      a.vx += friction * tangentX;
      a.vy += friction * tangentY;
      b.vx -= friction * tangentX;
      b.vy -= friction * tangentY;
    }

    function tick(time) {
      if (!active) return;
      const dt = Math.min((time - lastTime) / 1000 || 0, 1 / 30);
      lastTime = time;
      const { width, height } = bounds();

      for (const bubble of bubbles) {
        if (mode === 'hover') {
          // Each bubble continuously changes direction, producing
          // unplanned drift instead of a shared orbit or fixed path.
          const wander = time / 1000 + bubble.phase;
          bubble.vx += (Math.sin(wander * 1.7) * bubble.driftX - bubble.vx * 0.22) * dt;
          bubble.vy += (Math.cos(wander * 1.31) * bubble.driftY - bubble.vy * 0.22) * dt;
        } else {
          bubble.vy += GRAVITY * dt;
        }
        bubble.vx *= AIR_DRAG;
        bubble.vy *= AIR_DRAG;
        bubble.x += bubble.vx * dt;
        bubble.y += bubble.vy * dt;
        bubble.angle += bubble.angularVelocity * dt;
        contain(bubble, width, height);
      }
      // A few solver passes make a compact, stable stack rather than
      // allowing fast arrivals to tunnel through bubbles already on the floor.
      for (let pass = 0; pass < 4; pass++) {
        for (let i = 0; i < bubbles.length; i++) {
          for (let j = i + 1; j < bubbles.length; j++) collide(bubbles[i], bubbles[j]);
        }
        for (const bubble of bubbles) contain(bubble, width, height);
      }
      for (const bubble of bubbles) position(bubble);

      // Once every bubble has zero velocity and zero spin (fall mode
      // only -- hover mode is meant to drift forever), there's nothing
      // left for another frame to change. Stop scheduling instead of
      // running gravity/collision math on stationary objects forever.
      if (mode !== 'hover' && bubbles.every((b) => b.vx === 0 && b.vy === 0 && b.angularVelocity === 0)) {
        raf = 0;
        return;
      }

      raf = requestAnimationFrame(tick);
    }

    function activate() {
      if (active) return;
      cancelAnimationFrame(raf);
      active = true;
      scene.classList.add('is-active');
      createBubbles();
      lastTime = performance.now();

      if (reducedMotion.matches) {
        // Skip the physics entirely: place bubbles at rest (on the floor
        // for 'fall', in their starting cell for 'hover').
        const { width, height } = bounds();
        for (const bubble of bubbles) {
          if (mode !== 'hover') bubble.y = height - bubble.h;
          contain(bubble, width, height);
          position(bubble);
        }
        return;
      }
      raf = requestAnimationFrame(tick);
    }

    function deactivate() {
      active = false;
      cancelAnimationFrame(raf);
      scene.classList.remove('is-active');
      scene.replaceChildren();
    }

    function handleResize() {
      if (!active) return;
      const { width, height } = bounds();
      for (const bubble of bubbles) {
        bubble.w = bubble.element.offsetWidth;
        bubble.h = bubble.element.offsetHeight;
        contain(bubble, width, height);
        position(bubble);
      }
    }

    window.addEventListener('resize', handleResize, { passive: true });

    return { activate, deactivate };
  }

  // ---- Hero scene: shown in the "Linear" (non-experimental) state ----
  const heroBubbles = createBubbleScene(document.getElementById('bubbleScene'), [
    'BRAND SYSTEMS',
    'CAMPAIGNS',
    'CREATIVE DIRECTION',
    'LESS, BUT BETTER',
    'DESIGNED TO CONNECT',
  ]);
  if (heroBubbles) {
    window.addEventListener('bubbles:activate', heroBubbles.activate);
    window.addEventListener('bubbles:deactivate', heroBubbles.deactivate);
    // Linear is the initial position of the reinstated toggle.
    heroBubbles.activate();
  }

  // ---- Contact scene: falls in once, the first time it scrolls into view ----
  const contactScene = document.getElementById('contactBubbleScene');
  const contactBubbles = createBubbleScene(contactScene, [
    'EMAIL',
    'PH. 857.437.9148',
    'LINKEDIN',
  ]);
  if (contactBubbles) {
    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          contactBubbles.activate();
          observer.disconnect();
        }
      }, { threshold: 0.15 });
      observer.observe(contactScene);
    } else {
      contactBubbles.activate();
    }
  }

  // ---- About page scene: hovers around the portrait, no falling, active
  // for as long as the page is open ----
  const aboutBubbles = createBubbleScene(document.getElementById('aboutBubbleScene'), [
    'CAMPAIGNS',
    'DESIGNED TO CONNECT',
    'CREATIVE DIRECTION',
    'BRAND SYSTEMS',
  ], { mode: 'hover' });
  if (aboutBubbles) aboutBubbles.activate();
}());
