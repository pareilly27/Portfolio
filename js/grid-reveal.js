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

  // Capped at 1 (was min(devicePixelRatio, 2)) -- on a 2x/Retina
  // screen this shader was rendering 4x the pixels every frame,
  // forever, for a soft/blurry effect where the difference is barely
  // visible. This is the single biggest ongoing GPU cost on the page.
  const DPR = 1;

  // ---- Tunables --------------------------------------------------------
  const CORE_RATIO = 0.25;
  const FALLOFF_POWER = 1.25;     // cohesive interior; particles concentrate at the liquid boundary
  const MAX_SCATTER_RATIO = 0.11;
  const OUTLIER_REACH = 0.22;
  const OUTLIER_DENSITY = 0.004;
  const DRIFT_SPEED = 0.8;        // re-rolls/sec -- how often each stray picks a new random target
  const BLOCK_CSS_PX = 1;         // pixelation granularity, CSS px
  const MAX_WIND_SPEED = 900;     // device px/sec of cursor motion for full-strength response
  const WIND_ATTACK = 0.035;      // per-frame easing toward rising cursor speed (smaller = softer ramp-in)
  const WIND_RELEASE = 0.012;     // per-frame easing toward falling speed (smaller = slower relax)
  const OUTER_SHAPE_AMP = 0.50;
  const CORE_SHAPE_AMP = 0.55;
  const SHAPE_DRIFT = 0.46;
  const STRETCH_AMP = 0.17;
  const SQUEEZE_AMP = 0.06;
  const LEAD_COMPRESS = 0.15;     // how much the shape flattens AHEAD of cursor motion
  const MOTION_WOBBLE_BOOST = 0.06;// thick lobes retain their shape without fluttering at speed
  const MOTION_SCATTER_BOOST = 0.45;

  // --- Memory (trail) buffer -----------------------------------------
  // The displacement maths below is stateless: it only knows where the
  // cursor IS. These drive a persistent off-screen texture recording
  // where the cursor HAS BEEN and how long ago -- 1.0 directly under
  // the cursor, fading toward 0 over TRAIL_HALFLIFE. The main pass
  // reads it, so disturbance lingers and recovers instead of being
  // rigidly tied to the current cursor position.
  const TRAIL_SCALE = 0.16;   // low-resolution fluid grid, linearly sampled by the reveal shader
  const TRAIL_HALFLIFE = 1.15;
  // Pure exponential decay stalls in an 8-bit feedback texture: once a
  // texel's per-frame delta drops below ~half a quantization step
  // (1/255), the GPU rounds the write back to the same 8-bit value
  // every frame and the spot never reaches zero -- exactly the
  // "leftover pixels that never go away" bug. A small constant
  // subtraction (below, in TRAIL_FRAG_SRC) guarantees a decrease big
  // enough to clear that step every frame, so faint tails always finish
  // fading instead of stalling just above the cull threshold.
  const TRAIL_LINEAR_FADE = 0.08;
  const TRAIL_BRUSH = 0.82;
  const TRAIL_BREAKUP = 0.0;  // each old footprint stays soft and whole
                              // tail dissolves into patches/grains as it ages
  const TRAIL_TAIL_BIAS = 1.0;
                              // faster than the fresh end (distillation)

  // --- Grid lines as a barrier ---------------------------------------
  // The cell borders act as a slight obstruction: crossing one leaves
  // pixels banked up on the side the cursor came FROM, and thinned on
  // the side it went TO, as if the line caught some of them. Fades with
  // the same memory the rest of the effect uses.
  const LINE_STICK = 0.26;    // pile-up strength BEHIND the line (shift applied to t, 0..1)
  const LINE_REACH = 0.22;    // how far from the line the pile-up reaches, as a fraction of cell size
  const LINE_SHADOW = 0.22;   // forward thinning, as a fraction of the pile-up -- deliberately
                              // much weaker: ahead of the line is only SLIGHTLY less pixelated
  const LINE_SPREAD = 0.75;   // how far the pile-up washes ALONG the line (fraction of cell size),
                              // like water hitting a wall and running sideways
  const LINE_SPREAD_TAPS = 4; // samples per side for that lateral wash

  // ---- Shaders ---------------------------------------------------------
  const VERTEX_SRC = [
    'attribute vec2 aPosition;',
    'void main() {',
    '  gl_Position = vec4(aPosition, 0.0, 1.0);',
    '}',
  ].join('\n');

  // Fragment shader for the memory buffer: decay what's already there,
  // then stamp the cursor's current footprint on top. Runs into a
  // framebuffer, ping-ponged between two textures each frame.
  const TRAIL_FRAG_SRC = [
    'precision mediump float;',
    'uniform sampler2D uPrev;',
    'uniform vec2 uSize;',      // trail buffer size, px
    'uniform vec2 uCursorFB;',  // cursor in trail-buffer pixel coords
    'uniform vec2 uPrevCursorFB;',
    'uniform float uBrush;',    // stamp radius, trail px
    'uniform float uDecay;',    // per-frame multiplier (time-corrected)
    'uniform float uLinearFade;',// flat per-frame subtraction -- breaks 8-bit stall
    'uniform float uActive;',   // 0 while the cursor is away -> decay only
    'uniform float uBreakup;',  // spatial variation in decay rate
    'uniform float uTailBias;', // extra decay once a spot is already faint
    '',
    'float hash(vec2 p) {',
    '  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);',
    '}',
    'void main() {',
    '  float prev = texture2D(uPrev, gl_FragCoord.xy / uSize).r;',
    '',
    '  // Per-texel decay rate. A single uniform decay makes the whole',
    '  // trail dim as one solid sheet; varying the exponent per texel',
    '  // means neighbouring spots fade at different speeds, so the',
    '  // trail breaks into patches and grains instead.',
    '  float h = hash(floor(gl_FragCoord.xy));',
    '  float rate = mix(1.0 - uBreakup * 0.5, 1.0 + uBreakup * 0.5, h);',
    '',
    '  // Bias toward the tail: the fainter a spot already is, the',
    '  // faster it gives up what is left. This concentrates the trail',
    '  // near the cursor and lets the far end distil away rather than',
    '  // trailing off in an even ramp.',
    '  rate *= mix(uTailBias, 1.0, clamp(prev, 0.0, 1.0));',
    '',
    '  prev = pow(uDecay, max(rate, 0.05)) * prev;',
    '  // Guarantees the write changes by more than one 8-bit step, so it',
    '  // can never round back to the same stored value forever.',
    '  prev = max(prev - uLinearFade, 0.0);',
    '  float stamp = 0.0;',
    '  if (uActive > 0.5 && uBrush > 0.5) {',
    '    vec2 segment = uCursorFB - uPrevCursorFB;',
    '    float segmentLengthSq = max(dot(segment, segment), 0.0001);',
    '    float along = clamp(dot(gl_FragCoord.xy - uPrevCursorFB, segment) / segmentLengthSq, 0.0, 1.0);',
    '    vec2 nearest = uPrevCursorFB + segment * along;',
    '    float headDistance = length(gl_FragCoord.xy - uCursorFB);',
    '    float trailDistance = length(gl_FragCoord.xy - nearest);',
    '    float headShape = 1.0 + 0.10 * sin(atan(gl_FragCoord.y - uCursorFB.y, gl_FragCoord.x - uCursorFB.x) * 3.0 + uCursorFB.x * 0.017);',
    '    float headStamp = 1.0 - smoothstep(uBrush * 0.30, uBrush * headShape, headDistance);',
    '    float trailWidth = uBrush * 0.30 * (0.82 + 0.18 * sin(along * 12.0 + uCursorFB.y * 0.013));',
    '    float trailStamp = (1.0 - smoothstep(trailWidth * 0.38, trailWidth, trailDistance)) * 0.54;',
    '    stamp = max(headStamp, trailStamp);',
    '  }',
    '  // max(), not add: a spot is "fully disturbed" at most once, so',
    '  // holding still cannot drive it past 1 and blow out.',
    '  gl_FragColor = vec4(max(prev, stamp), 0.0, 0.0, 1.0);',
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
    '#define SPREAD_TAPS ' + LINE_SPREAD_TAPS,
    'uniform sampler2D uTrailTex;',
    'uniform vec2 uCellPx;',    // grid cell size in device px (line spacing)
    'uniform float uLineStick;',
    'uniform float uLineReach;',
    'uniform float uLineShadow;',
    'uniform float uLineSpread;',
    '',
    'float hash(vec2 p) {',
    '  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);',
    '}',
    'float fluidNoise(vec2 p) {',
    '  vec2 cell = floor(p);',
    '  vec2 local = fract(p);',
    '  local = local * local * (3.0 - 2.0 * local);',
    '  float n00 = hash(cell);',
    '  float n10 = hash(cell + vec2(1.0, 0.0));',
    '  float n01 = hash(cell + vec2(0.0, 1.0));',
    '  float n11 = hash(cell + vec2(1.0, 1.0));',
    '  return mix(mix(n00, n10, local.x), mix(n01, n11, local.x), local.y);',
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
    'float blobField(vec2 point, vec2 center, float radius, float seed, float strength,',
    '                float time, vec2 windDir, float windStrength) {',
    '  if (strength <= 0.001) return 0.0;',
    '  vec2 delta = point - center;',
    '  float theta = atan(delta.y, delta.x);',
    '  float edge = boundaryR(theta, radius, uOuterShapeAmp, seed, time + seed * 1.7, windDir, windStrength * 0.35);',
    '  float normalizedDistance = length(delta) / max(edge, 1.0);',
    '  return (1.0 - smoothstep(0.42, 1.0, normalizedDistance)) * strength;',
    '}',
    '',
    '// A fluid head is not one radial disc. Several heavily overlapping,',
    '// independently deforming masses create deep bays, long lobes and',
    '// narrow joins while the exact cursor position remains fully dense.',
    'float liquidHeadField(vec2 point, vec2 center, float radius, float time,',
    '                      vec2 windDir, float windStrength) {',
    '  vec2 flow = windStrength > 0.025',
    '    ? windDir',
    '    : vec2(cos(time * 0.71), sin(time * 0.71));',
    '  vec2 side = vec2(-flow.y, flow.x);',
    '  float pulseA = sin(time * 0.64);',
    '  float pulseB = cos(time * 0.47 + 1.8);',
    '',
    '  float mass = blobField(point, center, radius * 0.82, 0.0, 1.0, time, flow, windStrength);',
    '  vec2 rearCenter = center - flow * radius * (0.37 + 0.09 * windStrength)',
    '                  + side * radius * (0.23 * pulseA);',
    '  vec2 frontCenter = center + flow * radius * (0.41 + 0.11 * windStrength)',
    '                   - side * radius * (0.19 * pulseB);',
    '  vec2 sideCenter = center + side * radius * (0.46 * sin(time * 0.31 + 2.4))',
    '                  - flow * radius * (0.09 + 0.08 * pulseA);',
    '',
    '  mass = max(mass, blobField(point, rearCenter, radius * 0.74, 1.7, 0.90, time * 0.48, flow, windStrength));',
    '  mass = max(mass, blobField(point, frontCenter, radius * 0.70, 3.1, 0.86, time * 0.55, flow, windStrength));',
    '  mass = max(mass, blobField(point, sideCenter, radius * 0.64, 4.9, 0.78, time * 0.39, flow, windStrength));',
    '  return mass;',
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
    '  // The visible mass comes from the same simulated density as the',
    '  // trail. Keep only a compact core at the pointer so the pointer',
    '  // is always the strongest location without imposing a round head.',
    '  float influence = blobField(fragPos, uCursor, uRadius * 0.20, 0.0, 1.0, shapeTime, windDir, windStrength);',
    '  // How disturbed is this spot, per the memory buffer? 1 = the',
    '  // cursor is here now, falling toward 0 as it recovers.',
    '  float mem = texture2D(uTrailTex, gl_FragCoord.xy / uResolution).r;',
    '  // The reference thresholds a distorted density field rather than',
    '  // drawing the raw splat. Slow coherent noise pinches the advected',
    '  // trail into necks and separate lobes without affecting the live blob.',
    '  vec2 fluidNoiseDrift = vec2(uTime * 0.035, -uTime * 0.025);',
    '  float fluidShape = pow(mem, 1.28) + (fluidNoise(fragPos / 110.0 + fluidNoiseDrift) - 0.5) * 0.075;',
    '  float fluidAgeStrength = mix(0.74, 1.0, smoothstep(0.16, 0.88, mem));',
    '  float visibleFluid = smoothstep(0.19, 0.30, fluidShape) * fluidAgeStrength;',
    '  influence = max(influence, visibleFluid);',
    '',
    '  // Cull only where the cursor is neither here NOR recently was.',
    '  if (uRadius < 1.0 && mem < 0.008) discard;',
    '  // Perf cull only: below this, memory is too faint to render',
    '  // anything anyway. Distance alone must NOT cull, or trails get',
    '  // clipped to a disc around the cursor again.',
    '  if (influence < 0.008) discard;',
    '',
    '  // Quantize to a block grid: density and scatter are decided per',
    '  // block, so the fringe reads as discrete square particles of',
    '  // the image, not smooth translucency.',
    '  vec2 blockCoord = floor(fragPos / uBlock) * uBlock + uBlock * 0.5;',
    '  vec2 blockDelta = blockCoord - uCursor;',
    '  float blockDist = length(blockDelta);',
    '  float blockTheta = atan(blockDelta.y, blockDelta.x);',
    '',
    '  float blockInfluence = blobField(blockCoord, uCursor, uRadius * 0.20, 0.0, 1.0, shapeTime, windDir, windStrength);',
    '  float blockMem = texture2D(uTrailTex, vec2(blockCoord.x, uResolution.y - blockCoord.y) / uResolution).r;',
    '  float blockFluidShape = pow(blockMem, 1.28) + (fluidNoise(blockCoord / 110.0 + fluidNoiseDrift) - 0.5) * 0.075;',
    '  float blockFluidAgeStrength = mix(0.74, 1.0, smoothstep(0.16, 0.88, blockMem));',
    '  float visibleBlockFluid = smoothstep(0.19, 0.30, blockFluidShape) * blockFluidAgeStrength;',
    '  blockInfluence = max(blockInfluence, visibleBlockFluid);',
    '  float t = 1.0 - blockInfluence;',
    '',
    '  // Fold in memory. `live` is this frame\'s blob (1 at the core),',
    '  // `mem` is the lingering record of past passes. Taking the max',
    '  // means a spot the cursor has just left stays partially',
    '  // disturbed and recovers over time, rather than snapping back',
    '  // the instant the cursor moves off it -- so t is now driven by',
    '  // BOTH distance and recency, and every downstream effect',
    '  // (density, scatter, drift) inherits that for free.',
    '  float live = 1.0 - t;',
    '',
    '  // --- Grid lines as a barrier --------------------------------',
    '  // Applied to t (position along the density gradient), NOT to',
    '  // density itself: near the cursor density is already saturated',
    '  // at 1.0, so scaling it there is a no-op and the effect was',
    '  // mathematically invisible. Shifting t moves the block along',
    '  // the falloff, which reads everywhere the gradient is live.',
    '  //',
    '  // Cell borders sit at every multiple of uCellPx. Find the',
    '  // nearest one, then decide whether this block is on the side',
    '  // the cursor came FROM (banks up, t decreases -> denser) or the',
    '  // side it went TO (thins, t increases -> sparser).',
    '  if (uLineStick > 0.001 && uCellPx.x > 1.0 && uCellPx.y > 1.0) {',
    '    vec2 lineDelta = blockCoord - (floor(blockCoord / uCellPx + 0.5) * uCellPx);',
    '    vec2 reachPx = uCellPx * uLineReach;',
    '    vec2 nearLine = 1.0 - smoothstep(vec2(0.0), reachPx, abs(lineDelta));',
    '',
    '    vec2 approach = -sign(windDir);',
    '    vec2 blockSide = sign(lineDelta);',
    '    vec2 agree = blockSide * approach;   // +1 same side, -1 far side',
    '    // Strongly asymmetric: material banks up behind the line at',
    '    // full strength, but only a little is missing in front of it.',
    '    vec2 signedGain = mix(vec2(-uLineShadow), vec2(1.0), step(0.0, agree));',
    '',
    '    // Lateral wash. Sampling memory only at THIS point confines the',
    '    // pile-up to wherever the cursor itself went. Taking the max of',
    '    // memory sampled ALONG the line lets the banked-up material',
    '    // run sideways past the cursor\'s own footprint -- water',
    '    // hitting a wall and spreading along it. Vertical lines wash',
    '    // vertically (offset in y), horizontal lines wash in x.',
    '    float spreadPx = max(uCellPx.x, uCellPx.y) * uLineSpread;',
    '    float memV = mem;',
    '    float memH = mem;',
    '    for (int s = 1; s <= SPREAD_TAPS; s++) {',
    '      float f = float(s) / float(SPREAD_TAPS);',
    '      float o = f * spreadPx;',
    '      float w = 1.0 - f;   // taper: the far edge of the wash is weakest',
    '      memV = max(memV, texture2D(uTrailTex, (fragPos + vec2(0.0,  o)) / uResolution).r * w);',
    '      memV = max(memV, texture2D(uTrailTex, (fragPos + vec2(0.0, -o)) / uResolution).r * w);',
    '      memH = max(memH, texture2D(uTrailTex, (fragPos + vec2( o, 0.0)) / uResolution).r * w);',
    '      memH = max(memH, texture2D(uTrailTex, (fragPos + vec2(-o, 0.0)) / uResolution).r * w);',
    '    }',
    '',
    '    // x-component = vertical lines (crossed by horizontal motion),',
    '    // and those wash vertically -> memV. y-component mirrors it.',
    '    vec2 crossing = abs(windDir) * windStrength * vec2(memV, memH);',
    '    float gain = dot(nearLine * signedGain * crossing, vec2(1.0));',
    '    t = clamp(t - uLineStick * gain, 0.0, 1.0);',
    '  }',
    '',
    '  // Density: 1.0 in the core (all blocks drawn -> solid clear',
    '  // image), falling to 0.0 at the rim. A block survives if its',
    '  // static hash clears the local density -- fewer and fewer do as',
    '  // t rises, giving the dense-center/sparse-edge cloud.',
    '  // Density comes from `t`, which already folds in memory -- so a',
    '  // spot the cursor has left keeps a density of its own and thins',
    '  // out as that memory fades, at ANY distance.',
    '  //',
    '  // This used to be an if/else on blockDist: past the live rim a',
    '  // pixel could only be a straggler, and straggler odds reach 0 at',
    '  // blockOuterR * (1 + reach). That hard-clipped every trail pixel',
    '  // to a disc around the CURRENT cursor, which is why the trail',
    '  // looked uniform and cut off instead of distilling away.',
    '  float density = pow(1.0 - t, uFalloffPower);',
    '',
    '  // Stragglers are now an ADDITIONAL floor near the live rim, not',
    '  // a replacement for the memory-driven density.',
    '  density = max(density, uOutlierDensity * blockInfluence);',
    '',
    '  if (hash(blockCoord * 0.53) > max(density, 0.0)) {',
    '    discard;',
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

  // Second program: updates the memory buffer (decay + stamp).
  const trailFrag = compileShader(gl.FRAGMENT_SHADER, TRAIL_FRAG_SRC);
  if (!trailFrag) return;
  const trailProgram = gl.createProgram();
  gl.attachShader(trailProgram, vertexShader);
  gl.attachShader(trailProgram, trailFrag);
  gl.linkProgram(trailProgram);
  if (!gl.getProgramParameter(trailProgram, gl.LINK_STATUS)) {
    console.error('grid-reveal trail link error:', gl.getProgramInfoLog(trailProgram));
    return;
  }
  const tuPrev = gl.getUniformLocation(trailProgram, 'uPrev');
  const tuSize = gl.getUniformLocation(trailProgram, 'uSize');
  const tuCursorFB = gl.getUniformLocation(trailProgram, 'uCursorFB');
  const tuPrevCursorFB = gl.getUniformLocation(trailProgram, 'uPrevCursorFB');
  const tuBrush = gl.getUniformLocation(trailProgram, 'uBrush');
  const tuDecay = gl.getUniformLocation(trailProgram, 'uDecay');
  const tuActive = gl.getUniformLocation(trailProgram, 'uActive');
  const tuBreakup = gl.getUniformLocation(trailProgram, 'uBreakup');
  const tuTailBias = gl.getUniformLocation(trailProgram, 'uTailBias');
  const tuLinearFade = gl.getUniformLocation(trailProgram, 'uLinearFade');
  const trailPosAttr = gl.getAttribLocation(trailProgram, 'aPosition');

  // Ping-pong pair: read one, write the other, swap. A single texture
  // can't be both source and destination in one draw.
  let trailFBOs = [];
  let trailTex = [];
  let trailW = 0, trailH = 0;
  let trailSrc = 0;
  let fluidVX, fluidVY, fluidNextVX, fluidNextVY;
  let fluidDensity, fluidNextDensity, fluidPressure, fluidNextPressure, fluidDivergence, fluidCurl;
  let fluidSplitMemory;
  let fluidPixels;
  let fluidPointerX = null, fluidPointerY = null;

  function initTrailBuffers(w, h) {
    trailW = Math.max(1, Math.round(w * TRAIL_SCALE));
    trailH = Math.max(1, Math.round(h * TRAIL_SCALE));
    trailFBOs.forEach(function (f) { gl.deleteFramebuffer(f); });
    trailTex.forEach(function (t) { gl.deleteTexture(t); });
    trailFBOs = []; trailTex = [];
    for (var i = 0; i < 2; i++) {
      var tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, trailW, trailH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      // LINEAR so the half-res buffer reads back smoothly, CLAMP so the
      // edges don't wrap disturbance around the screen.
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      var fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      trailTex.push(tex); trailFBOs.push(fbo);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    trailSrc = 0;
    const fluidSize = trailW * trailH;
    fluidVX = new Float32Array(fluidSize);
    fluidVY = new Float32Array(fluidSize);
    fluidNextVX = new Float32Array(fluidSize);
    fluidNextVY = new Float32Array(fluidSize);
    fluidDensity = new Float32Array(fluidSize);
    fluidNextDensity = new Float32Array(fluidSize);
    fluidPressure = new Float32Array(fluidSize);
    fluidNextPressure = new Float32Array(fluidSize);
    fluidDivergence = new Float32Array(fluidSize);
    fluidCurl = new Float32Array(fluidSize);
    fluidSplitMemory = new Float32Array(fluidSize);
    fluidPixels = new Uint8Array(fluidSize * 4);
  }

  function fluidSample(field, x, y) {
    x = Math.max(0, Math.min(trailW - 1.001, x));
    y = Math.max(0, Math.min(trailH - 1.001, y));
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const x1 = Math.min(x0 + 1, trailW - 1), y1 = Math.min(y0 + 1, trailH - 1);
    const fx = x - x0, fy = y - y0;
    const a = field[y0 * trailW + x0] * (1 - fx) + field[y0 * trailW + x1] * fx;
    const b = field[y1 * trailW + x0] * (1 - fx) + field[y1 * trailW + x1] * fx;
    return a * (1 - fy) + b * fy;
  }

  function stepFluid(state, dt) {
    if (!fluidDensity || !trailW || !trailH) return;
    const safeDt = Math.min(dt, 1 / 30);
    const pointerX = state.x / canvas.width * trailW;
    const pointerY = (canvas.height - state.y) / canvas.height * trailH;
    if (fluidPointerX === null) {
      fluidPointerX = pointerX;
      fluidPointerY = pointerY;
    }

    const pointerVX = (pointerX - fluidPointerX) / Math.max(safeDt, 0.001);
    const pointerVY = (pointerY - fluidPointerY) / Math.max(safeDt, 0.001);

    // Advect velocity through itself.
    for (let y = 0; y < trailH; y += 1) {
      for (let x = 0; x < trailW; x += 1) {
        const index = y * trailW + x;
        const backX = x - fluidVX[index] * safeDt;
        const backY = y - fluidVY[index] * safeDt;
        const advectedVX = fluidSample(fluidVX, backX, backY);
        const advectedVY = fluidSample(fluidVY, backX, backY);
        const neighbourVX = (
          fluidSample(fluidVX, x - 1, y) + fluidSample(fluidVX, x + 1, y)
          + fluidSample(fluidVX, x, y - 1) + fluidSample(fluidVX, x, y + 1)
        ) * 0.25;
        const neighbourVY = (
          fluidSample(fluidVY, x - 1, y) + fluidSample(fluidVY, x + 1, y)
          + fluidSample(fluidVY, x, y - 1) + fluidSample(fluidVY, x, y + 1)
        ) * 0.25;
        // Viscous diffusion: nearby velocities pull toward one another,
        // keeping the material thick and cohesive instead of flame-like.
        fluidNextVX[index] = (advectedVX * 0.72 + neighbourVX * 0.28) * 0.982;
        fluidNextVY[index] = (advectedVY * 0.72 + neighbourVY * 0.28) * 0.982;
      }
    }
    [fluidVX, fluidNextVX] = [fluidNextVX, fluidVX];
    [fluidVY, fluidNextVY] = [fluidNextVY, fluidVY];

    if (state.active) {
      const splatRadius = Math.max(2, state.radius / canvas.width * trailW * 0.38);
      const pointerSpeed = Math.hypot(pointerVX, pointerVY);
      const flowX = pointerSpeed > 0.001 ? pointerVX / pointerSpeed : 1;
      const flowY = pointerSpeed > 0.001 ? pointerVY / pointerSpeed : 0;
      const motionAmount = Math.min(1, pointerSpeed / 55);
      const alongRadius = splatRadius * (1 + motionAmount * 0.48);
      const acrossRadius = splatRadius * (1 - motionAmount * 0.14);
      const bound = Math.max(alongRadius, splatRadius) * 2;
      const minX = Math.max(0, Math.floor(pointerX - bound));
      const maxX = Math.min(trailW - 1, Math.ceil(pointerX + bound));
      const minY = Math.max(0, Math.floor(pointerY - bound));
      const maxY = Math.min(trailH - 1, Math.ceil(pointerY + bound));
      for (let y = minY; y <= maxY; y += 1) {
        for (let x = minX; x <= maxX; x += 1) {
          const index = y * trailW + x;
          const dx = x - pointerX, dy = y - pointerY;
          const along = dx * flowX + dy * flowY;
          const across = -dx * flowY + dy * flowX;
          const theta = Math.atan2(across / acrossRadius, along / alongRadius);
          const fluidTime = performance.now() * 0.00032;
          const boundary = Math.max(0.42,
            1
            + 0.34 * Math.sin(theta + fluidTime)
            + 0.24 * Math.sin(theta * 2 - fluidTime * 0.73 + 1.4)
            + 0.16 * Math.sin(theta * 3 + fluidTime * 0.51 + 3.2)
          );
          const ellipticalDistance = ((along * along) / (alongRadius * alongRadius)
            + (across * across) / (acrossRadius * acrossRadius)) / (boundary * boundary);
          const splat = Math.exp(-ellipticalDistance * 1.18);
          fluidVX[index] += pointerVX * splat * 0.036;
          fluidVY[index] += pointerVY * splat * 0.036;
          fluidDensity[index] = Math.min(1, fluidDensity[index] + splat * 0.78);
        }
      }

    }

    // Vorticity confinement creates the folding and breakaway motion.
    for (let y = 1; y < trailH - 1; y += 1) {
      for (let x = 1; x < trailW - 1; x += 1) {
        const i = y * trailW + x;
        fluidCurl[i] = (fluidVY[i + 1] - fluidVY[i - 1] - fluidVX[i + trailW] + fluidVX[i - trailW]) * 0.5;
      }
    }
    for (let y = 2; y < trailH - 2; y += 1) {
      for (let x = 2; x < trailW - 2; x += 1) {
        const i = y * trailW + x;
        let nx = Math.abs(fluidCurl[i + 1]) - Math.abs(fluidCurl[i - 1]);
        let ny = Math.abs(fluidCurl[i + trailW]) - Math.abs(fluidCurl[i - trailW]);
        const length = Math.hypot(nx, ny) + 0.0001;
        nx /= length; ny /= length;
        const force = fluidCurl[i] * 8 * safeDt;
        fluidVX[i] += ny * force;
        fluidVY[i] -= nx * force;
      }
    }

    // Project the velocity field so material behaves incompressibly.
    fluidPressure.fill(0);
    for (let y = 1; y < trailH - 1; y += 1) {
      for (let x = 1; x < trailW - 1; x += 1) {
        const i = y * trailW + x;
        fluidDivergence[i] = (fluidVX[i + 1] - fluidVX[i - 1] + fluidVY[i + trailW] - fluidVY[i - trailW]) * 0.5;
      }
    }
    for (let iteration = 0; iteration < 12; iteration += 1) {
      for (let y = 1; y < trailH - 1; y += 1) {
        for (let x = 1; x < trailW - 1; x += 1) {
          const i = y * trailW + x;
          fluidNextPressure[i] = (fluidPressure[i - 1] + fluidPressure[i + 1] + fluidPressure[i - trailW] + fluidPressure[i + trailW] - fluidDivergence[i]) * 0.25;
        }
      }
      [fluidPressure, fluidNextPressure] = [fluidNextPressure, fluidPressure];
    }
    for (let y = 1; y < trailH - 1; y += 1) {
      for (let x = 1; x < trailW - 1; x += 1) {
        const i = y * trailW + x;
        fluidVX[i] -= (fluidPressure[i + 1] - fluidPressure[i - 1]) * 0.5;
        fluidVY[i] -= (fluidPressure[i + trailW] - fluidPressure[i - trailW]) * 0.5;
      }
    }

    // Advect and dissipate density through the projected velocity.
    // Density stays where it was laid down long enough to read as a
    // reservoir and connecting trail; it still returns fully over time.
    const densityDecay = Math.pow(0.01, safeDt / 5.5);
    for (let y = 0; y < trailH; y += 1) {
      for (let x = 0; x < trailW; x += 1) {
        const i = y * trailW + x;
        fluidNextDensity[i] = fluidSample(
          fluidDensity,
          x - fluidVX[i] * safeDt,
          y - fluidVY[i] * safeDt
        ) * densityDecay;
      }
    }
    [fluidDensity, fluidNextDensity] = [fluidNextDensity, fluidDensity];

    // --- Physically-conditioned neck formation and separation ---------
    // Erosion is allowed only from an existing boundary under sustained
    // extensional strain. Once that boundary leaves a genuinely thin
    // connection with substantial fluid on both ends, the neck receives
    // stronger decay. No interior cell can begin a cut on its own.
    const fluidThreshold = 0.24;
    const sampleDensityAt = (x, y) => {
      if (x < 0 || x >= trailW || y < 0 || y >= trailH) return 0;
      return fluidDensity[y * trailW + x];
    };
    const patchDensity = (cx, cy) => {
      let total = 0;
      let samples = 0;
      for (let oy = -2; oy <= 2; oy += 1) {
        for (let ox = -2; ox <= 2; ox += 1) {
          total += sampleDensityAt(cx + ox, cy + oy);
          samples += 1;
        }
      }
      return total / samples;
    };

    for (let y = 4; y < trailH - 4; y += 1) {
      for (let x = 4; x < trailW - 4; x += 1) {
        const i = y * trailW + x;
        const density = fluidDensity[i];
        if (density < fluidThreshold) {
          fluidSplitMemory[i] *= Math.pow(0.12, safeDt);
          continue;
        }

        const openLeft = sampleDensityAt(x - 1, y) < fluidThreshold;
        const openRight = sampleDensityAt(x + 1, y) < fluidThreshold;
        const openUp = sampleDensityAt(x, y - 1) < fluidThreshold;
        const openDown = sampleDensityAt(x, y + 1) < fluidThreshold;
        const isBoundary = openLeft || openRight || openUp || openDown;

        // Positive directional strain means the two sides are moving apart.
        const strainX = fluidVX[i + 2] - fluidVX[i - 2];
        const strainY = fluidVY[i + trailW * 2] - fluidVY[i - trailW * 2];

        // Measure the local cross-section in both directions. A horizontal
        // neck is thin vertically and joins meaningful mass left/right;
        // a vertical neck is the converse.
        let up = 0, down = 0, left = 0, right = 0;
        while (up < 5 && sampleDensityAt(x, y - up - 1) >= fluidThreshold) up += 1;
        while (down < 5 && sampleDensityAt(x, y + down + 1) >= fluidThreshold) down += 1;
        while (left < 5 && sampleDensityAt(x - left - 1, y) >= fluidThreshold) left += 1;
        while (right < 5 && sampleDensityAt(x + right + 1, y) >= fluidThreshold) right += 1;

        const horizontalNeck = up + down <= 5
          && patchDensity(x - 7, y) > 0.30
          && patchDensity(x + 7, y) > 0.30
          && strainX > 0.055;
        const verticalNeck = left + right <= 5
          && patchDensity(x, y - 7) > 0.30
          && patchDensity(x, y + 7) > 0.30
          && strainY > 0.055;

        // A concave boundary has open space immediately beside it but is
        // still substantially surrounded by fluid in a wider neighborhood.
        let occupied = 0;
        let neighbours = 0;
        if (isBoundary && density < 0.68) {
          for (let oy = -3; oy <= 3; oy += 1) {
            for (let ox = -3; ox <= 3; ox += 1) {
              if (ox === 0 && oy === 0) continue;
              neighbours += 1;
              if (sampleDensityAt(x + ox, y + oy) >= fluidThreshold) occupied += 1;
            }
          }
        }
        const concaveBoundary = isBoundary
          && density < 0.68
          && occupied / Math.max(neighbours, 1) > 0.56
          && Math.max(strainX, strainY) > 0.045;

        const neckCandidate = horizontalNeck || verticalNeck;
        const candidateStrength = neckCandidate ? 2.2 : (concaveBoundary ? 1.0 : 0.0);
        if (candidateStrength > 0) {
          fluidSplitMemory[i] = Math.min(1, fluidSplitMemory[i] + safeDt * candidateStrength);
        } else {
          fluidSplitMemory[i] *= Math.pow(0.04, safeDt);
        }

        // Persistence gate: the first stage advances an indentation slowly;
        // a verified two-mass neck contracts more decisively.
        if (fluidSplitMemory[i] > 0.10) {
          const decayRate = neckCandidate ? 18.0 : 1.65;
          fluidDensity[i] *= Math.exp(-decayRate * safeDt * fluidSplitMemory[i]);
        }
      }
    }

    for (let i = 0; i < fluidDensity.length; i += 1) {
      const value = Math.max(0, Math.min(255, Math.round(fluidDensity[i] * 255)));
      const pixel = i * 4;
      fluidPixels[pixel] = value;
      fluidPixels[pixel + 1] = 0;
      fluidPixels[pixel + 2] = 0;
      fluidPixels[pixel + 3] = 255;
    }
    gl.bindTexture(gl.TEXTURE_2D, trailTex[0]);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, trailW, trailH, gl.RGBA, gl.UNSIGNED_BYTE, fluidPixels);
    trailSrc = 0;
    fluidPointerX = pointerX;
    fluidPointerY = pointerY;
  }

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
  const uTrailTex = gl.getUniformLocation(program, 'uTrailTex');
  const uCellPx = gl.getUniformLocation(program, 'uCellPx');
  const uLineStick = gl.getUniformLocation(program, 'uLineStick');
  const uLineReach = gl.getUniformLocation(program, 'uLineReach');
  const uLineShadow = gl.getUniformLocation(program, 'uLineShadow');
  const uLineSpread = gl.getUniformLocation(program, 'uLineSpread');

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
  gl.uniform1f(uLineStick, LINE_STICK);
  gl.uniform1f(uLineReach, LINE_REACH);
  gl.uniform1f(uLineShadow, LINE_SHADOW);
  gl.uniform1f(uLineSpread, LINE_SPREAD);

  // ---- Mosaic texture: a composite of every cell's image at its exact
  // on-screen position, built with an offscreen 2D canvas and uploaded
  // as a GL texture (re-uploaded whenever rebuilt). --------------------
  const mosaic = document.createElement('canvas');
  const mctx = mosaic.getContext('2d');
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
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
  let cellPxW = 0, cellPxH = 0;   // grid line spacing, device px

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
    initTrailBuffers(pxWidth, pxHeight);

    mosaic.width = pxWidth;
    mosaic.height = pxHeight;
    mctx.clearRect(0, 0, pxWidth, pxHeight);

    const cells = grid.children;
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      const rect = cell.getBoundingClientRect();
      if (i === 0) {
        // Line spacing = the real laid-out cell box, in device px.
        cellPxW = rect.width * DPR;
        cellPxH = rect.height * DPR;
      }
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

  RevealPointer.init(grid, { radius: 165 });

  const startTime = performance.now();
  let lastFrameMs = performance.now();

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
    if (!trailFBOs.length) return;

    // ---- Pass 1: advance the memory buffer -------------------------
    // Decay is computed from real elapsed time, not a fixed per-frame
    // constant, so the fade rate is identical at 30fps and 144fps.
    const nowMs = performance.now();
    const dt = Math.min((nowMs - lastFrameMs) / 1000, 0.1); // clamp tab-switch spikes
    lastFrameMs = nowMs;
    stepFluid(state, dt);

    // ---- Pass 2: draw the visible reveal ---------------------------
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, pxWidth, pxHeight);
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    gl.enableVertexAttribArray(aPosition);
    gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // NOTE: no early-out on radius any more -- the memory buffer must
    // keep decaying and drawing after the cursor leaves, otherwise the
    // lingering disturbance would freeze mid-fade.

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
    gl.uniform2f(uCellPx, cellPxW, cellPxH);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(uMosaic, 0);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, trailTex[trailSrc]);
    gl.uniform1i(uTrailTex, 2);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  });
});
