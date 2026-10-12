// Background swarm: one graph that changes formation as the page scrolls.
// Raw WebGL, no dependencies. Every formation is precomputed once into its own GPU
// buffer, plus a k-nearest-neighbour edge list (index buffer) so each formation reads
// as a graph. Each frame only binds a (from, to) pair and sets a mix uniform; lines and
// points share one vertex shader, so edges morph with their nodes. Lines are drawn
// first, crisp discs on top. Disabled under prefers-reduced-motion and without WebGL.
(function () {
  "use strict";

  var canvas = document.getElementById("swarm");
  if (!canvas) return;

  var reduce = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  if (reduce && reduce.matches) { canvas.hidden = true; return; }

  var gl = null;
  try {
    var opts = { alpha: true, antialias: true, premultipliedAlpha: true, depth: false, stencil: false, powerPreference: "low-power" };
    gl = canvas.getContext("webgl", opts) || canvas.getContext("experimental-webgl", opts);
  } catch (e) { gl = null; }
  if (!gl) { canvas.hidden = true; return; }

  var N = 1000;
  var K = 3; // neighbours per node in each formation's graph
  var MAX_SEGS = 2500; // per formation
  var ACCENT = [0x1d / 255, 0x35 / 255, 0x57 / 255];
  var INK = [0x16 / 255, 0x18 / 255, 0x1d / 255];
  var POINT_ALPHA = 0.92, LINE_ALPHA = 0.42;
  var R = 1.2; // every formation is fitted inside this radius (drift included)
  var DRIFT_MAX = 0.03; // per-axis upper bound of u_drift below

  // Deterministic PRNG so the composition is the same on every visit.
  var seed = 0x9e3779b9;
  function rnd() {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function gauss() { return (rnd() + rnd() + rnd() - 1.5) / 0.5; } // approx N(0,1), bounded

  function inSphere(out, o, r) {
    var x, y, z;
    do { x = rnd() * 2 - 1; y = rnd() * 2 - 1; z = rnd() * 2 - 1; } while (x * x + y * y + z * z > 1);
    out[o] = x * r; out[o + 1] = y * r; out[o + 2] = z * r;
  }
  function onSphere(out, o, r) {
    var u = rnd() * 2 - 1, a = rnd() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    out[o] = Math.cos(a) * s * r; out[o + 1] = u * r; out[o + 2] = Math.sin(a) * s * r;
  }

  // --- Formations (unit scale ~1.1) -------------------------------------------
  function cloud() { // hero: loose cloud of independent nodes
    var a = new Float32Array(N * 3);
    for (var i = 0; i < N; i++) {
      inSphere(a, i * 3, 1.15);
      var k = 0.55 + 0.45 * Math.cbrt(rnd());
      a[i * 3] *= k; a[i * 3 + 1] *= k; a[i * 3 + 2] *= k;
    }
    return a;
  }

  function clusters() { // what it is: many small groups, nodes on their own machines
    var a = new Float32Array(N * 3), C = 24, c = new Float32Array(C * 3);
    for (var j = 0; j < C; j++) inSphere(c, j * 3, 1.05);
    for (var i = 0; i < N; i++) {
      var k = (i % C) * 3;
      a[i * 3] = c[k] + gauss() * 0.06;
      a[i * 3 + 1] = c[k + 1] + gauss() * 0.06;
      a[i * 3 + 2] = c[k + 2] + gauss() * 0.06;
    }
    return a;
  }

  function ballVsSwarm() { // why distributed: one dense ball above, a scattered swarm below
    var a = new Float32Array(N * 3), split = Math.floor(N * 0.45);
    for (var i = 0; i < N; i++) {
      var o = i * 3;
      if (i < split) {
        inSphere(a, o, 0.3);
        a[o + 1] += 0.62;
      } else {
        a[o] = (rnd() * 2 - 1) * 1.1;
        a[o + 1] = -0.25 - rnd() * 0.85;
        a[o + 2] = (rnd() * 2 - 1) * 0.9;
      }
    }
    return a;
  }

  function ring() { // how it works: the lease cycle, a tilted ring with a faint inner orbit
    var a = new Float32Array(N * 3), tilt = 1.1, ct = Math.cos(tilt), st = Math.sin(tilt);
    for (var i = 0; i < N; i++) {
      var o = i * 3, th = rnd() * Math.PI * 2;
      var r = (i % 7 === 0 ? 0.55 : 0.95) + gauss() * 0.025;
      var x = Math.cos(th) * r, y = gauss() * 0.02, z = Math.sin(th) * r;
      a[o] = x; a[o + 1] = y * ct - z * st; a[o + 2] = y * st + z * ct;
    }
    return a;
  }

  function lattice() { // live network: one node per site of a jittered 10x10x10 lattice
    var a = new Float32Array(N * 3), G = 10, step = 2.0 / (G - 1);
    for (var i = 0; i < N; i++) {
      var n = i % (G * G * G), gx = n % G, gy = Math.floor(n / G) % G, gz = Math.floor(n / (G * G));
      a[i * 3] = (-1 + gx * step + gauss() * 0.012) * 0.95;
      a[i * 3 + 1] = (-1 + gy * step + gauss() * 0.012) * 0.95;
      a[i * 3 + 2] = (-1 + gz * step + gauss() * 0.012) * 0.95;
    }
    return a;
  }

  function mark() { // join: converge into the wordmark, a ring around a dense core
    var a = new Float32Array(N * 3), core = Math.floor(N * 0.3);
    for (var i = 0; i < N; i++) {
      var o = i * 3;
      if (i < core) {
        var rr = Math.sqrt(rnd()) * 0.24, t = rnd() * Math.PI * 2;
        a[o] = Math.cos(t) * rr; a[o + 1] = Math.sin(t) * rr; a[o + 2] = gauss() * 0.03;
      } else {
        var th = rnd() * Math.PI * 2, r = 0.82 + gauss() * 0.03;
        a[o] = Math.cos(th) * r; a[o + 1] = Math.sin(th) * r; a[o + 2] = gauss() * 0.03;
      }
    }
    return a;
  }

  function disperse() { // footer: drift apart into a sparse shell at the edge of the box
    var a = new Float32Array(N * 3);
    for (var i = 0; i < N; i++) onSphere(a, i * 3, 0.7 + 0.5 * Math.sqrt(rnd()));
    return a;
  }

  // Uniformly shrink a formation so no point, with drift added, leaves the radius-R
  // ball. Keeps the projected bounding box predictable.
  function fit(a) {
    var lim = R - DRIFT_MAX * Math.sqrt(3), m = 0, i;
    for (i = 0; i < a.length; i += 3) m = Math.max(m, Math.hypot(a[i], a[i + 1], a[i + 2]));
    if (m > lim) for (i = 0; i < a.length; i++) a[i] *= lim / m;
    return a;
  }

  // Undirected k-nearest-neighbour graph of one formation, as LINES index pairs.
  // Brute force (N^2, once at init); duplicate pairs are dropped.
  function knn(a) {
    var seen = {}, out = [], bestD = new Float64Array(K), bestJ = new Int32Array(K);
    for (var i = 0; i < N && out.length < MAX_SEGS * 2; i++) {
      var xi = a[i * 3], yi = a[i * 3 + 1], zi = a[i * 3 + 2], q, j;
      for (q = 0; q < K; q++) { bestD[q] = Infinity; bestJ[q] = -1; }
      for (j = 0; j < N; j++) {
        if (j === i) continue;
        var dx = a[j * 3] - xi, dy = a[j * 3 + 1] - yi, dz = a[j * 3 + 2] - zi;
        var d = dx * dx + dy * dy + dz * dz;
        if (d >= bestD[K - 1]) continue;
        for (q = K - 1; q > 0 && bestD[q - 1] > d; q--) { bestD[q] = bestD[q - 1]; bestJ[q] = bestJ[q - 1]; }
        bestD[q] = d; bestJ[q] = j;
      }
      for (q = 0; q < K; q++) {
        j = bestJ[q];
        if (j < 0) continue;
        var key = i < j ? i * N + j : j * N + i;
        if (seen[key]) continue;
        seen[key] = 1;
        out.push(i, j);
      }
    }
    return new Uint16Array(out.slice(0, MAX_SEGS * 2));
  }

  var formations = [cloud(), clusters(), ballVsSwarm(), ring(), lattice(), mark(), disperse()];
  formations.forEach(fit);
  var edgeLists = formations.map(knn);
  var F = formations.length;

  // Per-point attributes: drift phase (xyz) and a colour seed.
  var seeds = new Float32Array(N * 4);
  for (var i = 0; i < N; i++) {
    seeds[i * 4] = rnd() * 6.2832; seeds[i * 4 + 1] = rnd() * 6.2832;
    seeds[i * 4 + 2] = rnd() * 6.2832; seeds[i * 4 + 3] = rnd();
  }

  // --- GL setup ---------------------------------------------------------------
  // One program for both passes: u_line = 1 draws the edges (solid accent), 0 the nodes.
  var VS = [
    "attribute vec3 a_from;",
    "attribute vec3 a_to;",
    "attribute vec4 a_seed;",
    "uniform float u_time;",
    "uniform float u_rot;",
    "uniform float u_scale;",
    "uniform float u_aspect;",
    "uniform vec2 u_center;", // box centre, NDC
    "uniform float u_mix;",
    "uniform float u_drift;",
    "uniform float u_size;", // node diameter in device pixels
    "varying float v_alpha;",
    "varying float v_ink;",
    "varying float v_px;", // gl_PointSize
    "varying float v_rad;", // disc radius, device pixels
    "void main() {",
    "  vec3 p = mix(a_from, a_to, u_mix);",
    "  vec3 ph = a_seed.xyz;",
    "  p += u_drift * vec3(sin(u_time * 0.37 + ph.x), sin(u_time * 0.29 + ph.y), cos(u_time * 0.33 + ph.z));",
    "  float c = cos(u_rot), s = sin(u_rot);",
    "  p = vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);",
    "  float ct = 0.96, st = 0.28;", // fixed slight downward tilt
    "  p = vec3(p.x, ct * p.y - st * p.z, st * p.y + ct * p.z);",
    "  float w = p.z + 3.4;",
    "  gl_Position = vec4(p.x * u_scale / u_aspect + u_center.x * w, p.y * u_scale + u_center.y * w, 0.0, w);",
    "  float depth = clamp((4.6 - w) / 2.4, 0.0, 1.0);", // 1 = near, 0 = far
    "  v_rad = 0.5 * u_size * (0.8 + 0.4 * depth);",
    "  v_px = 2.0 * v_rad + 2.0;", // one pixel of room for the antialiased rim
    "  gl_PointSize = v_px;",
    "  v_alpha = 0.85 + 0.15 * depth;",
    "  v_ink = step(0.86, a_seed.w);",
    "}"
  ].join("\n");

  var FS = [
    "precision mediump float;",
    "uniform vec3 u_accent;",
    "uniform vec3 u_ink;",
    "uniform float u_alpha;",
    "uniform float u_line;",
    "uniform vec4 u_clip;", // box in device pixels: xmin, ymin, xmax, ymax
    "varying float v_alpha;",
    "varying float v_ink;",
    "varying float v_px;",
    "varying float v_rad;",
    "void main() {",
    "  if (any(lessThan(gl_FragCoord.xy, u_clip.xy)) || any(greaterThan(gl_FragCoord.xy, u_clip.zw))) discard;",
    "  if (u_line > 0.5) { gl_FragColor = vec4(u_accent * u_alpha, u_alpha); return; }",
    "  float r = length(gl_PointCoord - 0.5) * v_px;", // device pixels from the centre
    "  float a = (1.0 - smoothstep(v_rad - 0.5, v_rad + 0.5, r)) * v_alpha * u_alpha;",
    "  if (a < 0.004) discard;",
    "  vec3 col = mix(u_accent, u_ink, v_ink);",
    "  gl_FragColor = vec4(col * a, a);", // premultiplied
    "}"
  ].join("\n");

  function compile(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  function program(vs, fs) {
    var p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
  }
  function staticBuffer(target, data) {
    var b = gl.createBuffer();
    gl.bindBuffer(target, b);
    gl.bufferData(target, data, gl.STATIC_DRAW);
    return b;
  }

  var prog;
  try { prog = program(VS, FS); } catch (e) { canvas.hidden = true; return; }

  var u = {};
  ["u_time", "u_rot", "u_scale", "u_aspect", "u_center", "u_clip", "u_mix", "u_drift", "u_size",
    "u_accent", "u_ink", "u_alpha", "u_line"].forEach(function (n) { u[n] = gl.getUniformLocation(prog, n); });
  var aFrom = gl.getAttribLocation(prog, "a_from");
  var aTo = gl.getAttribLocation(prog, "a_to");
  var aSeed = gl.getAttribLocation(prog, "a_seed");

  var formBufs = formations.map(function (a) { return staticBuffer(gl.ARRAY_BUFFER, a); });
  var edgeBufs = edgeLists.map(function (e) { return staticBuffer(gl.ELEMENT_ARRAY_BUFFER, e); });
  var edgeCounts = edgeLists.map(function (e) { return e.length; });
  staticBuffer(gl.ARRAY_BUFFER, seeds);
  gl.enableVertexAttribArray(aSeed);
  gl.vertexAttribPointer(aSeed, 4, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(aFrom);
  gl.enableVertexAttribArray(aTo);
  gl.useProgram(prog);
  gl.uniform3fv(u.u_accent, ACCENT); gl.uniform3fv(u.u_ink, INK);

  var debug = /[?&]swarmdebug\b/.test(location.search);
  if (!debug) { formations = null; edgeLists = null; } // CPU copies only kept for the layout check below

  var lineRange = gl.getParameter(gl.ALIASED_LINE_WIDTH_RANGE) || [1, 1];
  gl.disable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0, 0, 0, 0);

  // --- Layout + scroll mapping -----------------------------------------------
  // One anchor per formation: the scroll offset at which that formation is fully formed.
  var anchorEls = [
    document.querySelector(".hero"),
    document.getElementById("what"),
    document.getElementById("why"),
    document.getElementById("how"),
    document.getElementById("network"),
    document.getElementById("join"),
    document.querySelector("footer")
  ];
  var anchors = new Float64Array(F);
  var width = 0, height = 0, aspect = 1, dpr = 1, narrow = false;
  // The canvas covers the page; formations live in a box (NDC) on the right on desktop,
  // clear of the text column, and use most of the width on phones. CSS masks the left edge.
  var BOX_DESKTOP = [0.10, -0.86, 0.97, 0.86], BOX_NARROW = [-0.9, -0.86, 0.9, 0.86];
  var box = BOX_DESKTOP, center = [0, 0], scale = 1, clip = [0, 0, 1, 1];

  // Largest scale for which the radius-R ball projects inside the box on both axes:
  // under perspective (w = 3.4 + z) the ball's silhouette is max x/w = R / sqrt(3.4^2 - R^2).
  function layout() {
    box = narrow ? BOX_NARROW : BOX_DESKTOP;
    center = [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
    var hx = (box[2] - box[0]) / 2, hy = (box[3] - box[1]) / 2;
    scale = Math.min(hx * aspect, hy) * Math.sqrt(3.4 * 3.4 - R * R) / R;
    clip = [(box[0] + 1) / 2 * canvas.width, (box[1] + 1) / 2 * canvas.height,
      (box[2] + 1) / 2 * canvas.width, (box[3] + 1) / 2 * canvas.height];
    gl.uniform1f(u.u_scale, scale); gl.uniform1f(u.u_aspect, aspect);
    gl.uniform2fv(u.u_center, center); gl.uniform4fv(u.u_clip, clip);
    gl.uniform1f(u.u_size, (narrow ? 2.6 : 2.8) * dpr);
    gl.lineWidth(Math.min(Math.max(dpr, lineRange[0]), lineRange[1])); // 1 CSS px where supported
  }

  function measure() {
    var vh = window.innerHeight;
    var maxScroll = Math.max(0, document.documentElement.scrollHeight - vh);
    var prev = 0;
    for (var k = 0; k < F; k++) {
      var el = anchorEls[k], y = 0;
      if (k > 0 && el) y = el.getBoundingClientRect().top + window.pageYOffset - vh * 0.35;
      y = Math.min(Math.max(y, prev), maxScroll);
      if (k === F - 1) y = Math.max(y, Math.min(maxScroll, prev + 1)); // footer = bottom of page
      anchors[k] = y; prev = y;
    }
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = canvas.clientWidth; height = canvas.clientHeight;
    var w = Math.max(1, Math.round(width * dpr)), h = Math.max(1, Math.round(height * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    aspect = width / Math.max(1, height);
    narrow = window.matchMedia("(max-width: 760px)").matches;
    layout();
    measure();
  }

  function scrollTarget() {
    var y = window.pageYOffset;
    if (y <= anchors[0]) return 0;
    for (var k = 0; k < F - 1; k++) {
      var a = anchors[k], b = anchors[k + 1];
      if (y < b) return b > a ? k + (y - a) / (b - a) : k + 1;
    }
    return F - 1;
  }

  // --- Frame loop ---------------------------------------------------------------
  var running = false, raf = 0, last = 0, t = 0, rot = 0.4, drift = 0;
  var s = scrollTarget(), pairFrom = -1;
  var visible = true;

  function ease(x) { // hold each formation a little, then glide
    x = Math.min(Math.max((x - 0.12) / 0.76, 0), 1);
    return x * x * (3 - 2 * x);
  }

  function bindPair(k) {
    gl.bindBuffer(gl.ARRAY_BUFFER, formBufs[k]);
    gl.vertexAttribPointer(aFrom, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, formBufs[Math.min(k + 1, F - 1)]);
    gl.vertexAttribPointer(aTo, 3, gl.FLOAT, false, 0, 0);
    pairFrom = k;
  }

  function drawEdges(k, a) {
    if (a < 0.004 || !edgeCounts[k]) return;
    gl.uniform1f(u.u_alpha, a);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, edgeBufs[k]);
    gl.drawElements(gl.LINES, edgeCounts[k], gl.UNSIGNED_SHORT, 0);
  }

  function frame(now) {
    raf = 0;
    if (!running) return;
    var dt = last ? Math.min((now - last) / 1000, 0.05) : 0.016;
    last = now;
    t += dt;

    // Smooth the continuous formation index toward the scroll target.
    var target = scrollTarget();
    s += (target - s) * (1 - Math.exp(-dt * 3.2));
    if (Math.abs(target - s) < 1e-4) s = target;
    var k = Math.min(Math.floor(s), F - 2), f = ease(s - k);

    // Weight of the wordmark formation: rotation settles so the ring faces the viewer.
    var wMark = Math.max(0, 1 - Math.abs(s - 5));
    var wLat = Math.max(0, 1 - Math.abs(s - 4) * 1.6);
    rot += dt * 0.06 * (1 - wMark);
    if (wMark > 0) { var face = Math.round(rot / Math.PI) * Math.PI; rot += (face - rot) * (1 - Math.exp(-dt * 2.5)) * wMark; }

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT);

    var wEnd = Math.max(0, s - (F - 2)); // footer: the shell thins out as it disperses
    var fade = 1 - 0.45 * wEnd;

    if (k !== pairFrom) bindPair(k);
    gl.uniform1f(u.u_time, t); gl.uniform1f(u.u_rot, rot);
    gl.uniform1f(u.u_mix, f);
    drift = Math.min(DRIFT_MAX, 0.018 * (1 - 0.6 * wMark) + 0.012 * (1 - wLat));
    gl.uniform1f(u.u_drift, drift);

    // Edges: the outgoing graph fades out while the incoming one fades in; both ride
    // the interpolated node positions, so mid-glide (stretched) edges are faintest.
    gl.uniform1f(u.u_line, 1);
    drawEdges(k, LINE_ALPHA * fade * (1 - f) * (1 - f));
    drawEdges(k + 1, LINE_ALPHA * fade * f * f);

    gl.uniform1f(u.u_line, 0);
    gl.uniform1f(u.u_alpha, POINT_ALPHA * fade);
    gl.drawArrays(gl.POINTS, 0, N);
    pose.k = k; pose.f = f;

    raf = requestAnimationFrame(frame);
  }

  // ?swarmdebug: CPU mirror of VS so tests can check where points land.
  var pose = { k: -1, f: 0 };
  if (debug) window.__swarm = {
    box: function () { return box.slice(); },
    edges: function () { return edgeCounts.map(function (c) { return c / 2; }); },
    points: function () { // NDC [x, y] of every point (edge endpoints are points)
      if (pose.k < 0) return [];
      var A = formations[pose.k], B = formations[Math.min(pose.k + 1, F - 1)], out = [];
      function proj(x, y, z, ph) {
        x += drift * Math.sin(t * 0.37 + ph[0]); y += drift * Math.sin(t * 0.29 + ph[1]); z += drift * Math.cos(t * 0.33 + ph[2]);
        var c = Math.cos(rot), sn = Math.sin(rot), px = c * x + sn * z, pz = -sn * x + c * z;
        var py = 0.96 * y - 0.28 * pz, qz = 0.28 * y + 0.96 * pz, w = qz + 3.4;
        return [px * scale / aspect / w + center[0], py * scale / w + center[1]];
      }
      for (var i = 0; i < N; i++) {
        var o = i * 3;
        out.push(proj(A[o] + (B[o] - A[o]) * pose.f, A[o + 1] + (B[o + 1] - A[o + 1]) * pose.f,
          A[o + 2] + (B[o + 2] - A[o + 2]) * pose.f, [seeds[i * 4], seeds[i * 4 + 1], seeds[i * 4 + 2]]));
      }
      return out;
    }
  };

  function start() {
    if (running || document.hidden || !visible) return;
    running = true; last = 0;
    raf = requestAnimationFrame(frame);
  }
  function stop() {
    running = false;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
  }

  document.addEventListener("visibilitychange", function () { if (document.hidden) stop(); else start(); });
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (entries) {
      visible = entries[entries.length - 1].isIntersecting;
      if (visible) start(); else stop();
    }).observe(canvas);
  }
  if (reduce) {
    var onReduce = function (e) { if (e.matches) { stop(); canvas.hidden = true; } };
    if (reduce.addEventListener) reduce.addEventListener("change", onReduce);
    else if (reduce.addListener) reduce.addListener(onReduce);
  }
  canvas.addEventListener("webglcontextlost", function (e) { e.preventDefault(); stop(); canvas.hidden = true; });

  window.addEventListener("resize", resize);
  if ("ResizeObserver" in window) new ResizeObserver(measure).observe(document.body); // late content (stats table) moves anchors
  window.addEventListener("load", measure);

  resize();
  s = scrollTarget();
  start();
})();
