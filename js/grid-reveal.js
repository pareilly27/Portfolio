// Cursor-following pixel-cloud reveal -- WebGL renderer.
//
// A circular reveal where visibility is a matter of PIXEL DENSITY:
//   - Core (inner ~45% of the radius): every block drawn, no offset --
//     the image is simply there, fully clear. No white spot, no noise.
//   - Outward: a decreasing fraction of blocks survive (per-block hash
//     vs. a density curve that falls from 1 to 0), and the survivors
//     scatter increasingly far from their true position -- the outer
//     region of a particle cloud, sparser and more dispersed with
//     distance.
//   - Rim: density reaches zero before the circle's edge, so the
//     reveal dissolves into stray pixel dust rather than ending in a
//     hard line.
//   - Non-surviving blocks discard -- the page's default grid shows.
//
// Motion is kept subtle: survival (the density pattern) is static per
// block so the cloud doesn't strobe; surviving strays slowly orbit via
// a time-drifting scatter angle, and the cursor's own velocity adds a
// gentle directional sweep on the fringe. The core stays rock solid.
//
// Per-pixel in a fragment shader: fine block sizes and continuous
// animation cost nothing extra on the GPU. Pointer position/velocity/
// radius come from js/reveal-pointer.js.
document.addEventListener('DOMContentLoaded', function () {
  const grid = document.getElementById('grid');
  if (!grid || !window.RevealPointer) return;

  const canvas = document.createElement('canvas');
  canvas.className = 'grid-reveal-canvas';
  canvas.id = 'grid-reveal-canvas';
  grid.insertAdjacentElement('afterend', canvas);

  const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
  if (!gl) return; // no WebGL support -- fail quiet, no reveal effect

  const DPR = Math.min(window.devicePixelRatio || 1, 2);

  // ---- Tunables --------------------------------------------------------
  const CORE_RATIO = 0.25;        // fraction of radius that is solid, untouched image
  const FALLOFF_POWER = 2.2;      // density curve: higher = sharper dropoff past the core
  const MAX_SCATTER_RATIO = 0.45; // how far strays drift, relative to radius
  const OUTLIER_REACH = 0.4;      // how far past the edge stragglers can land (fraction of boundary)
  const OUTLIER_DENSITY = 0.01;   // fraction of blocks just past the edge that become stragglers
  const DRIFT_SPEED = 0.8;        // re-rolls/sec -- how often each stray picks a new random target
  const BLOCK_CSS_PX = 1;         // pixelation granularity, CSS px
  const MAX_WIND_SPEED = 900;     // device px/sec of cursor motion for full-strength response
  const WIND_ATTACK = 0.035;      // per-frame easing toward rising cursor speed (smaller = softer ramp-in)
  const WIND_RELEASE = 0.012;     // per-frame easing toward falling speed (smaller = slower relax)
  const OUTER_SHAPE_AMP = 0.22;   // how far the outer edge deviates from a circle AT REST (fraction of radius)
  const CORE_SHAPE_AMP = 1.0;     // how far the core boundary deviates from a circle AT REST
  const SHAPE_DRIFT = 4.0;        // rad/sec -- continuous morph of both boundary shapes (0 = frozen)
  const STRETCH_AMP = 0.55;       // oblong stretch ALONG the motion axis (both ends), at full speed
  const SQUEEZE_AMP = 0.22;       // matching pinch PERPENDICULAR to motion, at full speed
  const LEAD_COMPRESS = 0.15;     // how much the shape flattens AHEAD of cursor motion
  const MOTION_WOBBLE_BOOST = -0.5;// negative = boundary SMOOTHS OUT at speed (lumps fade while moving)
  const MOTION_SCATTER_BOOST = 0.8;// extra stray scatter distance at full cursor speed

  // ---- Shaders ---------------------------------------------------------
  const VERTEX_SRC = [
    'attribute vec2 aPosition;',
    'void main() {',
    '  gl_Position = vec4(aPosition, 0.0, 1.0);',
    '}',
  ].join('\n');

  const FRAGMENT_SRC = [
    'precision mediump float;',
    'uniform vec2 uResolution;',
    'uniform vec2 uCursor;',
    'uniform vec2 uVelocity;',
    'uniform float uRadius;',
    'uniform float uCore;',
    'uniform float uFalloffPower;',
    'uniform float uMaxScatterRatio;',
    'uniform float uOutlierReach;',
    'uniform float uOutlierDensity;',
    'uniform float uDriftSpeed;',
    'uniform float uOuterShapeAmp;',
    'uniform float uCoreShapeAmp;',
    'uniform float uShapeDrift;',
    'uniform float uStretchAmp;',
    'uniform float uSqueezeAmp;',
    'uniform float uLeadCompress;',
    'uniform float uMotionWobbleBoost;',
    'uniform float uMotionScatterBoost;',
    'uniform float uMaxWindSpeed;',
    'uniform float uBlock;',
    'uniform float uTime;',
    'uniform sampler2D uMosaic;',
    '',
    'float hash(vec2 p) {',
    '  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);',
    '}',
    '',
    '// Organic-blob profile, modeled on classic abstract "blob" shape',
    '// families: ONLY low harmonics (1-4), heavily weighted toward the',
    '// lowest. Harmonic 1 makes eggs/crescents (lopsided mass),',
    '// harmonic 2 makes oblongs/peanuts, harmonic 3 makes beans and',
    '// tri-lobed potatoes, harmonic 4 adds mild squarish character.',
    '// No high-frequency terms at all -- that is what keeps every',
    '// silhouette smooth and rounded rather than wavy or jagged.',
    '// Each harmonic amplitude breathes on its own slow, mutually',
    '// non-syncing cycle, so the shape wanders through the whole',
    '// family: circle -> egg -> peanut -> bean -> back, never',
    '// repeating exactly.',
    '// Smoothstep-shaped envelope: dwells near 0 and 1 instead of',
    '// hovering mid-range, so each harmonic is usually either clearly',
    '// ON (distinct character: peanut, bean...) or clearly OFF, and',
    '// blends pass through quickly.',
    'float dwell(float x) {',
    '  float e = 0.5 + 0.5 * sin(x);',
    '  return e * e * (3.0 - 2.0 * e);',
    '}',
    '',
    'float wobble(float theta, float seed, float time) {',
    '  float a1 = dwell(time * 0.13 + seed * 2.1);',
    '  float a2 = dwell(time * 0.09 + seed * 4.7);',
    '  float a3 = dwell(time * 0.17 + seed * 1.3);',
    '  float a4 = dwell(time * 0.11 - seed * 3.3);',
    '',
    '  return sin(theta * 1.0 + seed * 6.2831 + time * 0.29) * 0.45 * a1',
    '       + sin(theta * 2.0 - seed * 9.42 + time * 0.31) * 0.65 * a2',
    '       + sin(theta * 3.0 + seed * 3.77 - time * 0.23) * 0.42 * a3',
    '       + sin(theta * 4.0 - seed * 7.3 + time * 0.19) * 0.20 * a4;',
    '}',
    '',
    '// One boundary radius for a given direction: base circle, plus',
    '// the random harmonic wobble, plus an oblong deformation from',
    '// cursor motion (stretched along the travel axis, pinched across).',
    'float boundaryR(float theta, float base, float amp, float seed, float time,',
    '                vec2 windDir, float windStrength) {',
    '  float lumpy = amp * (1.0 + uMotionWobbleBoost * windStrength);',
    '  // Floor keeps the radius positive even at extreme wobble peaks.',
    '  float r = base * max(1.0 + lumpy * wobble(theta, seed, time), 0.15);',
    '',
    '  // Motion response. along: -1 (dead behind) .. +1 (dead ahead).',
    '  // axis: 1 on the motion axis (either end), 0 perpendicular --',
    '  // this is what makes the shape OBLONG when dragged: stretched',
    '  // along the direction of travel, pinched across it.',
    '  vec2 dirVec = vec2(cos(theta), sin(theta));',
    '  float along = dot(dirVec, windDir);',
    '  float axis = along * along;',
    '  r += base * windStrength * (uStretchAmp * axis - uSqueezeAmp * (1.0 - axis));',
    '  return r;',
    '}',
    '',
    'void main() {',
    '  // gl_FragCoord is bottom-left origin, y-up. Flip to top-left,',
    '  // y-down, to match the DOM coordinate space RevealPointer uses.',
    '  vec2 fragPos = vec2(gl_FragCoord.x, uResolution.y - gl_FragCoord.y);',
    '',
    '  vec2 fragDelta = fragPos - uCursor;',
    '  float dist = length(fragDelta);',
    '  float fragTheta = atan(fragDelta.y, fragDelta.x);',
    '',
    '  // Cursor-motion "physics" inputs, used by both the boundary',
    '  // deformation and the stray scatter below.',
    '  float windSpeed = length(uVelocity);',
    '  vec2 windDir = windSpeed > 1.0 ? uVelocity / windSpeed : vec2(0.0, 0.0);',
    '  float windStrength = clamp(windSpeed / uMaxWindSpeed, 0.0, 1.0);',
    '',
    '  // Independently randomized, continuously-morphing boundaries:',
    '  // the outer edge and the core each deviate from a circle by',
    '  // their own harmonic wobble (different seeds -> uncorrelated),',
    '  // deformed further by cursor motion (oblong stretch).',
    '  float shapeTime = uTime * uShapeDrift;',
    '  float outerR = boundaryR(fragTheta, uRadius, uOuterShapeAmp, 0.0, shapeTime, windDir, windStrength);',
    '',
    '  if (uRadius < 1.0 || dist > outerR * (1.0 + uOutlierReach)) {',
    '    discard;',
    '  }',
    '',
    '  // Quantize to a block grid: density and scatter are decided per',
    '  // block, so the fringe reads as discrete square particles of',
    '  // the image, not smooth translucency.',
    '  vec2 blockCoord = floor(fragPos / uBlock) * uBlock + uBlock * 0.5;',
    '  vec2 blockDelta = blockCoord - uCursor;',
    '  float blockDist = length(blockDelta);',
    '  float blockTheta = atan(blockDelta.y, blockDelta.x);',
    '',
    '  float blockOuterR = boundaryR(blockTheta, uRadius, uOuterShapeAmp, 0.0, shapeTime, windDir, windStrength);',
    '  float coreR = boundaryR(blockTheta, uRadius * uCore, uCoreShapeAmp, 42.7, shapeTime, windDir, windStrength);',
    '',
    '  // 0 inside the (wobbled) core -> 1 at the (wobbled) rim.',
    '  float t = clamp((blockDist - coreR) / max(blockOuterR - coreR, 1.0), 0.0, 1.0);',
    '',
    '  // Density: 1.0 in the core (all blocks drawn -> solid clear',
    '  // image), falling to 0.0 at the rim. A block survives if its',
    '  // static hash clears the local density -- fewer and fewer do as',
    '  // t rises, giving the dense-center/sparse-edge cloud.',
    '  if (blockDist > blockOuterR) {',
    '    // Stragglers: a very small fraction of pixels flung past the',
    '    // edge, thinning to nothing across the reach band. The main',
    '    // density gradient is untouched -- the shape and its falloff',
    '    // stay exactly as they are; these are just loose ejecta.',
    '    float excess = (blockDist - blockOuterR) / max(blockOuterR * uOutlierReach, 1.0);',
    '    float odds = uOutlierDensity * (1.0 - clamp(excess, 0.0, 1.0));',
    '    if (hash(blockCoord * 0.53) > odds) {',
    '      discard;',
    '    }',
    '  } else {',
    '    // Floor the inner density at the straggler density so the',
    '    // profile is continuous across the rim: without this, density',
    '    // dips to ~0 just inside the edge while stragglers outside',
    '    // start at uOutlierDensity, leaving a visible sparse ring.',
    '    float density = max(pow(1.0 - t, uFalloffPower), uOutlierDensity);',
    '    if (hash(blockCoord * 0.53) > density) {',
    '      discard;',
    '    }',
    '  }',
    '',
    '  // Scatter: zero in the core (image stays perfectly crisp),',
    '  // growing towards the rim. Each stray does a RANDOM WALK: time',
    '  // is divided into per-block-desynchronized intervals, a fresh',
    '  // random 2D target is rolled each interval, and the stray',
    '  // smoothly eases from its previous target to the next (1D value',
    '  // noise in time, evaluated per block). Continuous motion, no',
    '  // orbits, no periodicity -- and neighbouring blocks stay fully',
    '  // uncorrelated because every roll re-hashes the block coord.',
    '  float phase = hash(blockCoord * 1.13 + 3.1);',
    '  float cellT = uTime * uDriftSpeed + phase;',
    '  float interval = floor(cellT);',
    '  float frac = cellT - interval;',
    '  // Smoothstep easing between targets: velocity is zero at each',
    '  // endpoint, so paths bend gently instead of kinking.',
    '  float ease = frac * frac * (3.0 - 2.0 * frac);',
    '',
    '  vec2 targetA = vec2(',
    '    hash(blockCoord * 0.37 + vec2(interval * 7.31, 91.7)),',
    '    hash(blockCoord * 0.59 + vec2(17.3, interval * 5.17))',
    '  ) * 2.0 - 1.0;',
    '  vec2 targetB = vec2(',
    '    hash(blockCoord * 0.37 + vec2((interval + 1.0) * 7.31, 91.7)),',
    '    hash(blockCoord * 0.59 + vec2(17.3, (interval + 1.0) * 5.17))',
    '  ) * 2.0 - 1.0;',
    '',
    '  vec2 wander = mix(targetA, targetB, ease);',
    '',
    '  float n1 = hash(blockCoord * 0.71 + 7.7);',
    '  // Strays scatter further while the cursor is moving fast.',
    '  float mag = uRadius * uMaxScatterRatio * t * (0.3 + 0.7 * n1)',
    '            * (1.0 + uMotionScatterBoost * windStrength);',
    '  vec2 offset = wander * mag;',
    '',
    '  // Directional sweep: strays get dragged along with the cursor',
    '  // motion, fringe most of all.',
    '  offset += windDir * uRadius * uMaxScatterRatio * windStrength * t * 0.6;',
    '',
    '  // Sample from where this stray came from, snapped back onto the',
    '  // block grid so each tile is one solid colour.',
    '  vec2 sampleCoord = floor((blockCoord - offset) / uBlock) * uBlock + uBlock * 0.5;',
    '  vec2 sampleUV = sampleCoord / uResolution;',
    '  if (sampleUV.x < 0.0 || sampleUV.x > 1.0 || sampleUV.y < 0.0 || sampleUV.y > 1.0) {',
    '    discard;',
    '  }',
    '',
    '  gl_FragColor = texture2D(uMosaic, sampleUV);',
    '}',
  ].join('\n');

  function compileShader(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('grid-reveal shader error:', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  const vertexShader = compileShader(gl.VERTEX_SHADER, VERTEX_SRC);
  const fragmentShader = compileShader(gl.FRAGMENT_SHADER, FRAGMENT_SRC);
  if (!vertexShader || !fragmentShader) return;

  const program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('grid-reveal program link error:', gl.getProgramInfoLog(program));
    return;
  }
  gl.useProgram(program);

  const quadBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1, -1,
     1, -1,
    -1,  1,
     1,  1,
  ]), gl.STATIC_DRAW);

  const aPosition = gl.getAttribLocation(program, 'aPosition');
  gl.enableVertexAttribArray(aPosition);
  gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);

  const uResolution = gl.getUniformLocation(program, 'uResolution');
  const uCursor = gl.getUniformLocation(program, 'uCursor');
  const uVelocity = gl.getUniformLocation(program, 'uVelocity');
  const uRadius = gl.getUniformLocation(program, 'uRadius');
  const uCore = gl.getUniformLocation(program, 'uCore');
  const uFalloffPower = gl.getUniformLocation(program, 'uFalloffPower');
  const uMaxScatterRatio = gl.getUniformLocation(program, 'uMaxScatterRatio');
  const uOutlierReach = gl.getUniformLocation(program, 'uOutlierReach');
  const uOutlierDensity = gl.getUniformLocation(program, 'uOutlierDensity');
  const uDriftSpeed = gl.getUniformLocation(program, 'uDriftSpeed');
  const uOuterShapeAmp = gl.getUniformLocation(program, 'uOuterShapeAmp');
  const uCoreShapeAmp = gl.getUniformLocation(program, 'uCoreShapeAmp');
  const uShapeDrift = gl.getUniformLocation(program, 'uShapeDrift');
  const uStretchAmp = gl.getUniformLocation(program, 'uStretchAmp');
  const uSqueezeAmp = gl.getUniformLocation(program, 'uSqueezeAmp');
  const uLeadCompress = gl.getUniformLocation(program, 'uLeadCompress');
  const uMotionWobbleBoost = gl.getUniformLocation(program, 'uMotionWobbleBoost');
  const uMotionScatterBoost = gl.getUniformLocation(program, 'uMotionScatterBoost');
  const uMaxWindSpeed = gl.getUniformLocation(program, 'uMaxWindSpeed');
  const uBlock = gl.getUniformLocation(program, 'uBlock');
  const uTime = gl.getUniformLocation(program, 'uTime');
  const uMosaic = gl.getUniformLocation(program, 'uMosaic');

  gl.uniform1f(uCore, CORE_RATIO);
  gl.uniform1f(uFalloffPower, FALLOFF_POWER);
  gl.uniform1f(uMaxScatterRatio, MAX_SCATTER_RATIO);
  gl.uniform1f(uOutlierReach, OUTLIER_REACH);
  gl.uniform1f(uOutlierDensity, OUTLIER_DENSITY);
  gl.uniform1f(uDriftSpeed, DRIFT_SPEED);
  gl.uniform1f(uOuterShapeAmp, OUTER_SHAPE_AMP);
  gl.uniform1f(uCoreShapeAmp, CORE_SHAPE_AMP);
  gl.uniform1f(uShapeDrift, SHAPE_DRIFT);
  gl.uniform1f(uStretchAmp, STRETCH_AMP);
  gl.uniform1f(uSqueezeAmp, SQUEEZE_AMP);
  gl.uniform1f(uLeadCompress, LEAD_COMPRESS);
  gl.uniform1f(uMotionWobbleBoost, MOTION_WOBBLE_BOOST);
  gl.uniform1f(uMotionScatterBoost, MOTION_SCATTER_BOOST);
  gl.uniform1f(uMaxWindSpeed, MAX_WIND_SPEED);

  // ---- Mosaic texture: a composite of every cell's image at its exact
  // on-screen position, built with an offscreen 2D canvas and uploaded
  // as a GL texture (re-uploaded whenever rebuilt). --------------------
  const mosaic = document.createElement('canvas');
  const mctx = mosaic.getContext('2d');
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  // NEAREST, not LINEAR: block edges must stay hard for the pixel look.
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

  // Resolve a cell's --bg-image (e.g. "url('img/grid_img1.webp')") the
  // same way grid/style.css would: relative to that stylesheet's own
  // location, not this document's. A plain inline src set from JS
  // resolves against the document instead and 404s.
  const styleLink = document.querySelector('link[href*="grid/style.css"]');
  const baseHref = styleLink ? styleLink.href : document.baseURI;

  function extractUrl(bgImageValue) {
    const match = /url\((['"]?)(.*?)\1\)/.exec(bgImageValue || '');
    return match ? match[2] : null;
  }

  function resolveUrl(rawUrl) {
    try {
      return new URL(rawUrl, baseHref).href;
    } catch (e) {
      return rawUrl;
    }
  }

  const imageCache = {};
  function loadImage(url) {
    if (imageCache[url]) return imageCache[url];
    const img = new Image();
    img.src = url;
    imageCache[url] = img;
    return img;
  }

  function uploadTexture() {
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, mosaic);
  }

  function drawCover(context, img, dx, dy, dw, dh) {
    if (!img.naturalWidth || !img.naturalHeight) return;
    const scale = Math.max(dw / img.naturalWidth, dh / img.naturalHeight);
    const sw = dw / scale;
    const sh = dh / scale;
    const sx = (img.naturalWidth - sw) / 2;
    const sy = (img.naturalHeight - sh) / 2;
    context.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
    uploadTexture();
  }

  let rebuildPending = false;

  function rebuildMosaic() {
    const gridRect = grid.getBoundingClientRect();
    const displayWidth = Math.max(1, Math.round(gridRect.width));
    const displayHeight = Math.max(1, Math.round(gridRect.height));

    const pxWidth = Math.round(displayWidth * DPR);
    const pxHeight = Math.round(displayHeight * DPR);

    canvas.width = pxWidth;
    canvas.height = pxHeight;
    canvas.style.width = displayWidth + 'px';
    canvas.style.height = displayHeight + 'px';
    gl.viewport(0, 0, pxWidth, pxHeight);

    mosaic.width = pxWidth;
    mosaic.height = pxHeight;
    mctx.clearRect(0, 0, pxWidth, pxHeight);

    const cells = grid.children;
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      const rect = cell.getBoundingClientRect();
      const dx = (rect.left - gridRect.left) * DPR;
      const dy = (rect.top - gridRect.top) * DPR;
      const dw = rect.width * DPR;
      const dh = rect.height * DPR;

      const rawUrl = extractUrl(cell.style.getPropertyValue('--bg-image'));
      if (!rawUrl) continue;
      const url = resolveUrl(rawUrl);
      const img = loadImage(url);

      if (img.complete && img.naturalWidth) {
        drawCover(mctx, img, dx, dy, dw, dh);
      } else {
        img.addEventListener('load', function onLoad() {
          drawCover(mctx, img, dx, dy, dw, dh);
        }, { once: true });
      }
    }

    uploadTexture();
  }

  function queueRebuild() {
    if (rebuildPending) return;
    rebuildPending = true;
    requestAnimationFrame(function () {
      rebuildPending = false;
      rebuildMosaic();
    });
  }

  queueRebuild();

  const observer = new MutationObserver(queueRebuild);
  observer.observe(grid, { childList: true });

  let resizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(queueRebuild, 150);
  }, { passive: true });

  RevealPointer.init(grid, { radius: 130 });

  const startTime = performance.now();

  // Second smoothing stage for the shape's motion response. The raw
  // pointer velocity is jumpy (it tracks the mouse within ~100ms), so
  // feeding it straight into the boundary deformation made the shape
  // SNAP oblong on motion and snap back at rest. This envelope eases
  // toward the raw velocity with a gentle attack and an even slower
  // release, so the shape leans into motion and relaxes out of it.
  let windVX = 0;
  let windVY = 0;

  RevealPointer.subscribe(function (state) {
    const pxWidth = canvas.width;
    const pxHeight = canvas.height;
    if (!pxWidth || !pxHeight) return;

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    if (state.radius <= 0.5) return;

    gl.uniform2f(uResolution, pxWidth, pxHeight);
    gl.uniform2f(uCursor, state.x * DPR, state.y * DPR);
    const rising = (state.vx * state.vx + state.vy * state.vy) >
                   (windVX * windVX + windVY * windVY);
    const k = rising ? WIND_ATTACK : WIND_RELEASE;
    windVX += (state.vx - windVX) * k;
    windVY += (state.vy - windVY) * k;

    gl.uniform2f(uVelocity, windVX * DPR, windVY * DPR);
    gl.uniform1f(uRadius, state.radius * DPR);
    gl.uniform1f(uBlock, Math.max(BLOCK_CSS_PX * DPR, 1));
    gl.uniform1f(uTime, (performance.now() - startTime) / 1000);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(uMosaic, 0);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  });
});
