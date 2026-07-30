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

  // Contact section's curve line -- fixed relationship taken straight
  // from grid/contactSection.css: the SVG box is 30vw tall with
  // viewBox "0 -0.4 100 24" and an ellipse (cx 50, cy 20, rx 58,
  // ry 20); .contact-bubble-scene sits 13vw below that same top edge.
  // If either file changes these numbers, update both together.
  // Computing off these fixed constants (rather than reading the
  // SVG/scene boxes back with getBoundingClientRect at spawn time)
  // means there's no dependency on exactly when/how those elements
  // have laid out -- the curve's shape is just math, wherever the
  // section ends up landing on the page.
  const CONTACT_CURVE_HEIGHT_VW = 30;
  const CONTACT_CURVE_VIEWBOX_MIN_Y = -0.4;
  const CONTACT_CURVE_VIEWBOX_HEIGHT = 24;
  const CONTACT_CURVE_ELLIPSE = { cx: 50, cy: 20, rx: 58, ry: 20 };
  // .contact-bubble-scene now starts at the very top of the section
  // (top: 0 in contactSection.css) so the whole curve falls inside its
  // overflow:hidden box -- see the long note there. Kept as a named
  // constant because the curve-to-scene offset is what this maths is
  // actually about; if that CSS top ever changes, change this too.
  const CONTACT_SCENE_TOP_VW = 0;

  // xFrac: 0..1 across the full width of the contact section (the SVG,
  // the scene, and the curve's own viewBox x-axis all share that same
  // width). Returns a y in px, local to .contact-bubble-scene's own
  // box -- negative means above the scene's top edge, matching how
  // bubble.y already works.
  function contactCurveLocalY(xFrac) {
    const vwPx = window.innerWidth / 100;
    const xv = clamp(xFrac, 0, 1) * 100;
    const e = CONTACT_CURVE_ELLIPSE;
    const t = e.rx > 0 ? (xv - e.cx) / e.rx : 0;
    const inside = Math.max(0, 1 - t * t);
    // Upper arc only -- the only half of the ellipse the viewBox
    // actually shows (see the identical note in contactSection.css).
    const yv = e.cy - e.ry * Math.sqrt(inside);
    const yFracInBox = (yv - CONTACT_CURVE_VIEWBOX_MIN_Y) / CONTACT_CURVE_VIEWBOX_HEIGHT;
    const curveVw = yFracInBox * CONTACT_CURVE_HEIGHT_VW;
    return (curveVw - CONTACT_SCENE_TOP_VW) * vwPx;
  }

  // Builds one independent bubble simulation bound to `scene`.
  // Returns { activate, deactivate }, or null if the scene isn't on the page.
  function createBubbleScene(scene, labels, options) {
    if (!scene) return null;
    const mode = (options && options.mode) || 'fall';
    // A label is either a plain string or { text, href }. Entries with
    // an href render as real anchors so they're clickable (and
    // keyboard-reachable) rather than inert decorative divs.
    const items = labels.map(function (label) {
      return typeof label === 'string' ? { text: label, href: null } : label;
    });

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
      const cols = mode === 'hover' ? Math.ceil(Math.sqrt(items.length)) : 1;
      const rows = mode === 'hover' ? Math.ceil(items.length / cols) : 1;
      const cellW = width / cols;
      const cellH = height / rows;

      // Fall mode normally spawns across the scene's full width, from a
      // fixed distance above it. When a spawnTarget is given (contact
      // section: the contact-info text), x is confined to that
      // element's own span instead of the full width -- bubbles only
      // ever drop from directly above it. When useContactCurve is set,
      // the drop height at each bubble's x is read off the curve's
      // fixed geometry (contactCurveLocalY, above) instead of an
      // arbitrary offset -- so bubbles genuinely originate from the
      // curve line itself, not just "somewhere above the section."
      let spawnMinX = WALL_PADDING;
      let spawnMaxX = Math.max(spawnMinX + 1, width - WALL_PADDING);
      if (mode !== 'hover' && options && options.spawnTarget) {
        const sceneRect = scene.getBoundingClientRect();
        const targetRect = options.spawnTarget.getBoundingClientRect();
        if (targetRect.width > 0) {
          const min = Math.max(spawnMinX, targetRect.left - sceneRect.left);
          const max = Math.min(spawnMaxX, targetRect.right - sceneRect.left);
          if (max - min > 20) {
            spawnMinX = min;
            spawnMaxX = max;
          }
        }
      }

      const useCurve = mode !== 'hover' && !!(options && options.useContactCurve);

      // Precomputed spawn points sitting ON the curve, evenly sampled
      // across the allowed x range and then shuffled, so each bubble
      // gets a distinct point rather than several landing on the same
      // spot by chance. Sampling (rather than one random x per bubble)
      // is what guarantees the set visibly spans the curve's arc.
      const curvePoints = [];
      if (useCurve) {
        const n = items.length;
        for (let i = 0; i < n; i++) {
          // Inset from the very ends of the range so no bubble spawns
          // half-off the edge of the text it is meant to fall over.
          const f = n === 1 ? 0.5 : (i + 0.5) / n;
          const px = spawnMinX + f * (spawnMaxX - spawnMinX);
          curvePoints.push({ x: px, y: contactCurveLocalY(px / width) });
        }
        for (let i = curvePoints.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          const tmp = curvePoints[i];
          curvePoints[i] = curvePoints[j];
          curvePoints[j] = tmp;
        }
      }

      bubbles = items.map((item, index) => {
        // Anchor when the item has a destination, plain div otherwise.
        // .bubble-scene sets pointer-events:none so the whole layer
        // stays click-through; the anchor re-enables it for itself only,
        // so only the pill is clickable, not the empty space around it.
        const element = document.createElement(item.href ? 'a' : 'div');
        element.className = 'physics-bubble';
        if (item.href) {
          element.href = item.href;
          element.classList.add('physics-bubble--link');
          if (/^https?:/i.test(item.href)) {
            element.target = '_blank';
            element.rel = 'noopener noreferrer';
          }
        } else {
          element.setAttribute('aria-hidden', 'true');
        }
        element.textContent = item.text;
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

        // Curve points are centres; convert to a left edge, then clamp
        // so a wide bubble near the end of the range can't start
        // half-off the scene and get snapped sideways by contain().
        const spawnX = useCurve
          ? clamp(curvePoints[index % curvePoints.length].x - w / 2,
                  WALL_PADDING,
                  Math.max(WALL_PADDING, width - w - WALL_PADDING))
          : spawnMinX + Math.random() * Math.max(1, (spawnMaxX - w) - spawnMinX);
        // Curve mode: start immediately UNDERNEATH the curve at this
        // bubble's own x, so the line the bubbles emerge from traces the
        // curve rather than sitting flat. The old code subtracted a
        // large random + per-index offset here, which pushed every
        // bubble far enough above the curve that the relationship was
        // invisible; the stagger is now small enough to keep them
        // reading as coming off the line.
        const y = useCurve
          ? curvePoints[index % curvePoints.length].y + 2 + Math.random() * 10 + index * 14
          : -h - Math.random() * 220 - index * 80;
        return {
          element, w, h,
          x: spawnX,
          y: y,
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
    'ART DIRECTION',
    'CREATIVE DIRECTION',
    'VISUAL IDENTITY',
    'PACKAGING DESIGN',
    'EDITORIAL DESIGN',
    'UI / UX',
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
    { text: 'EMAIL', href: 'mailto:ssatodia97@gmail.com' },
    { text: 'PH. 857.437.9148', href: 'tel:+18574379148' },
    { text: 'LINKEDIN', href: 'https://www.linkedin.com/in/shreyanshi-satodia-396b9318a/' },
  ], {
    spawnTarget: document.getElementById('contactInfo'),
    useContactCurve: true,
  });
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
    'Curiosity First',
    'Systems Thinking',
    'Less, But Better',
    'Built to Last',
    'Concept to Launch',
  ], { mode: 'hover' });
  if (aboutBubbles) aboutBubbles.activate();
}());
