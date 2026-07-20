// Five text bubbles with a small, self-contained 2D rigid-body simulation.
// Collision is solved in normalized ellipse space, so the broad ovals contact
// at their actual visible edges instead of behaving like small circles.
(function () {
  const scene = document.getElementById('bubbleScene');
  if (!scene) return;

  const labels = [
    'BRAND SYSTEMS',
    'CAMPAIGNS',
    'CREATIVE DIRECTION',
    'LESS, BUT BETTER',
    'DESIGNED TO CONNECT',
  ];
  const FLOAT_MS = 2000;
  const GRAVITY = 1850;       // CSS pixels per second squared
  const AIR_DRAG = 0.995;
  const BOUNCE = 0.12;
  const FLOOR_FRICTION = 0.78;
  const WALL_PADDING = 8;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let bubbles = [];
  let active = false;
  let falling = false;
  let raf = 0;
  let lastTime = 0;
  let floatStarted = 0;

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const magnitude = (x, y) => Math.hypot(x, y);

  function bounds() {
    return { width: scene.clientWidth, height: scene.clientHeight };
  }

  function createBubbles() {
    scene.replaceChildren();
    const { width, height } = bounds();
    bubbles = labels.map((label, index) => {
      const element = document.createElement('div');
      element.className = 'physics-bubble';
      element.textContent = label;
      scene.appendChild(element);
      const rect = element.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      return {
        element, w, h,
        x: WALL_PADDING + Math.random() * Math.max(1, width - w - WALL_PADDING * 2),
        y: 70 + Math.random() * Math.max(1, height * 0.58 - h),
        vx: (Math.random() - 0.5) * 130,
        vy: (Math.random() - 0.5) * 110,
        driftX: (Math.random() - 0.5) * 34,
        driftY: (Math.random() - 0.5) * 34,
        phase: Math.random() * Math.PI * 2,
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
    if (bubble.y < WALL_PADDING) {
      bubble.y = WALL_PADDING;
      bubble.vy = Math.abs(bubble.vy) * BOUNCE;
    }
    if (falling && bubble.y + bubble.h > height) {
      bubble.y = height - bubble.h;
      bubble.vy = -bubble.vy * BOUNCE;
      bubble.vx *= FLOOR_FRICTION;
      if (Math.abs(bubble.vy) < 24) bubble.vy = 0;
      if (Math.abs(bubble.vx) < 2) bubble.vx = 0;
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
    // Separate both bodies before applying impulse: stable at rest, even when
    // several bubbles land in the same frame.
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
    if (!falling && (time - floatStarted >= FLOAT_MS || reducedMotion.matches)) falling = true;
    const { width, height } = bounds();

    for (const bubble of bubbles) {
      if (falling) {
        bubble.vy += GRAVITY * dt;
      } else {
        // Each item continuously changes direction, producing unplanned drift
        // instead of a shared orbit or a single prescribed path.
        const wander = time / 1000 + bubble.phase;
        bubble.vx += (Math.sin(wander * 1.7) * bubble.driftX - bubble.vx * 0.22) * dt;
        bubble.vy += (Math.cos(wander * 1.31) * bubble.driftY - bubble.vy * 0.22) * dt;
      }
      bubble.vx *= AIR_DRAG;
      bubble.vy *= AIR_DRAG;
      bubble.x += bubble.vx * dt;
      bubble.y += bubble.vy * dt;
      bubble.angle += bubble.angularVelocity * dt;
      contain(bubble, width, height);
    }
    // A few solver passes make a compact, stable stack rather than allowing
    // fast arrivals to tunnel through bubbles already on the floor.
    for (let pass = 0; pass < 4; pass++) {
      for (let i = 0; i < bubbles.length; i++) {
        for (let j = i + 1; j < bubbles.length; j++) collide(bubbles[i], bubbles[j]);
      }
      for (const bubble of bubbles) contain(bubble, width, height);
    }
    for (const bubble of bubbles) position(bubble);
    raf = requestAnimationFrame(tick);
  }

  function activate() {
    cancelAnimationFrame(raf);
    active = true;
    falling = false;
    scene.classList.add('is-active');
    createBubbles();
    floatStarted = performance.now();
    lastTime = floatStarted;
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
    // Preserve the existing simulation (especially its falling/settled
    // state) rather than treating a viewport resize as a new activation.
    for (const bubble of bubbles) {
      bubble.w = bubble.element.offsetWidth;
      bubble.h = bubble.element.offsetHeight;
      contain(bubble, width, height);
      position(bubble);
    }
  }

  window.addEventListener('bubbles:activate', activate);
  window.addEventListener('bubbles:deactivate', deactivate);
  window.addEventListener('resize', handleResize, { passive: true });
  // Linear is the initial position of the reinstated toggle.
  activate();
}());
