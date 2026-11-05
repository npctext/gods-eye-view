(() => {
  const screen = document.getElementById('loading-screen');
  const canvas = screen?.querySelector('.loader-globe-canvas');
  const ctx = canvas?.getContext('2d');
  if (!ctx) return;

  // Keep the 430 × 932 artwork's sphere, polar grid and camera inclination.
  const RADIUS = 365;
  const TURN_MS = 108000;
  const TAU = Math.PI * 2;
  const tilt = 20 * Math.PI / 180;
  const ct = Math.cos(tilt);
  const st = Math.sin(tilt);
  const phone = matchMedia('(max-width: 720px)');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const abort = new AbortController();
  let points;
  let pending = false;
  let failed = false;
  let destroyed = false;
  let frame = 0;
  let elapsed = 0;
  let lastTime = 0;
  let lastPaint = 0;
  let scale = 1;
  let dx = 0;
  let dy = 0;
  let pixelRatio = 1;

  const orbits = [
    { radius: 378, normal: [-0.1956, 0.7144, 0.6719], color: '#0db5cf', period: 11000, phase: -2.05 },
    { radius: 375, normal: [0.1914, 0.7662, 0.6135], color: '#1abbc1', period: 14000, phase: -1.23 },
  ];
  for (const orbit of orbits) {
    const [x, y, z] = orbit.normal;
    const length = Math.hypot(x, y, z);
    const n = [x / length, y / length, z / length];
    const horizontal = Math.hypot(n[0], n[1]);
    orbit.u = [n[1] / horizontal, -n[0] / horizontal, 0];
    orbit.v = [-n[2] * orbit.u[1], n[2] * orbit.u[0], n[0] * orbit.u[1] - n[1] * orbit.u[0]];
  }

  function orbitPoint(orbit, angle, cosine, sine) {
    const ca = Math.cos(angle) * orbit.radius;
    const sa = Math.sin(angle) * orbit.radius;
    const x = orbit.u[0] * ca + orbit.v[0] * sa;
    const y = orbit.u[1] * ca + orbit.v[1] * sa;
    const z = orbit.v[2] * sa;
    // Convert the initial orbital plane into globe space, rotate, then project.
    const localY = y * ct - z * st;
    const localZ = y * st + z * ct;
    const rotatedX = x * cosine + localZ * sine;
    const rotatedZ = -x * sine + localZ * cosine;
    return { x: rotatedX, y: localY * ct + rotatedZ * st, z: -localY * st + rotatedZ * ct };
  }

  function visible(point) {
    return point.z >= 0 || point.x * point.x + point.y * point.y >= RADIUS * RADIUS;
  }

  function draw(time) {
    const angle = (time % TURN_MS) / TURN_MS * TAU;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(pixelRatio * scale, 0, 0, pixelRatio * scale, pixelRatio * dx, pixelRatio * dy);
    const scanY = 538 + ((time + 900) % 5600) / 5600 * 394;
    for (const point of points) {
      const x = point.x * cosine + point.z * sine;
      const z = -point.x * sine + point.z * cosine;
      const y = point.y * ct + z * st;
      const depth = (-point.y * st + z * ct) / RADIUS;
      if (depth <= 0 || x < -218 || x > 218 || y > -61) continue;
      const edge = Math.min(1, depth / 0.06);
      const fade = edge * edge * (3 - 2 * edge);
      const wave = 0.12 * Math.exp(-(((y + 995 - scanY) / 26) ** 2));
      ctx.globalAlpha = Math.min(1, point.opacity * fade * (1 + wave));
      ctx.fillStyle = point.color;
      const height = point.size * (0.3 + depth * 0.7);
      ctx.fillRect(215 + x - point.size / 2, 995 + y - height / 2, point.size, height);
    }

    ctx.lineCap = 'round';
    for (const orbit of orbits) {
      ctx.strokeStyle = orbit.color;
      ctx.lineWidth = 0.7;
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      let drawing = false;
      for (let step = 0; step <= 180; step++) {
        const point = orbitPoint(orbit, step / 180 * TAU, cosine, sine);
        if (!visible(point)) { drawing = false; continue; }
        if (drawing) ctx.lineTo(215 + point.x, 995 + point.y);
        else ctx.moveTo(215 + point.x, 995 + point.y);
        drawing = true;
      }
      ctx.stroke();
      const phase = orbit.phase + time / orbit.period * TAU;
      for (let step = 0; step < 8; step++) {
        const a = orbitPoint(orbit, phase - (8 - step) * 0.014, cosine, sine);
        const b = orbitPoint(orbit, phase - (7 - step) * 0.014, cosine, sine);
        if (!visible(a) || !visible(b)) continue;
        ctx.globalAlpha = 0.08 + step * 0.055;
        ctx.strokeStyle = '#8bb8c2';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(215 + a.x, 995 + a.y);
        ctx.lineTo(215 + b.x, 995 + b.y);
        ctx.stroke();
      }
      const marker = orbitPoint(orbit, phase, cosine, sine);
      if (!visible(marker)) continue;
      ctx.globalAlpha = 0.45;
      ctx.strokeStyle = '#69b3bd';
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.arc(215 + marker.x, 995 + marker.y, 4, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#8bb8c2';
      ctx.beginPath();
      ctx.arc(215 + marker.x, 995 + marker.y, 1.8, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function resize() {
    const { width, height } = screen.getBoundingClientRect();
    pixelRatio = Math.min(devicePixelRatio || 1, 2);
    const w = Math.round(width * pixelRatio);
    const h = Math.round(height * pixelRatio);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    scale = Math.max(width / 430, height / 932);
    dx = (width - 430 * scale) / 2;
    dy = (height - 932 * scale) / 2;
  }

  function tick(now) {
    if (lastTime) elapsed += now - lastTime;
    lastTime = now;
    if (now - lastPaint >= 32) {
      draw(elapsed);
      lastPaint = now;
    }
    frame = requestAnimationFrame(tick);
  }

  function stop() {
    cancelAnimationFrame(frame);
    frame = 0;
    lastTime = 0;
  }

  function destroy() {
    destroyed = true;
    stop();
    abort.abort();
    observer.disconnect();
    phone.removeEventListener('change', sync);
    reduced.removeEventListener('change', sync);
    window.removeEventListener('resize', sync);
    window.removeEventListener('pagehide', destroy);
    document.removeEventListener('visibilitychange', sync);
  }

  function sync() {
    if (destroyed) return;
    stop();
    if (screen.classList.contains('hidden')) { destroy(); return; }
    if (!phone.matches || reduced.matches) {
      delete screen.dataset.globeRotation;
      return;
    }
    if (document.hidden || failed) return;
    if (screen.querySelector('.loader-content > button')) {
      if (points && screen.hasAttribute('data-globe-rotation')) { resize(); draw(elapsed); }
      return;
    }
    if (!points) {
      if (pending) return;
      pending = true;
      fetch('/loading/globe-points.json', { signal: abort.signal })
        .then(response => {
          if (!response.ok) throw new Error('Loading globe points unavailable');
          return response.json();
        })
        .then(data => {
          if (destroyed) return;
          points = [];
          for (let row = 0; row < data.rows.length; row++) {
            const polar = (4 + row * 3.5) * Math.PI / 180;
            for (let col = 0; col < 103; col++) {
              const longitude = (1.5 + col * 3.5) * Math.PI / 180;
              const [color, opacity, size] = data.palette[Number(data.rows[row][col])];
              points.push({ x: RADIUS * Math.sin(polar) * Math.cos(longitude), y: -RADIUS * Math.cos(polar), z: RADIUS * Math.sin(polar) * Math.sin(longitude), color, opacity, size });
            }
          }
          sync();
        })
        .catch(() => { failed = true; });
      return;
    }
    resize();
    draw(elapsed);
    screen.dataset.globeRotation = '';
    frame = requestAnimationFrame(tick);
  }

  const observer = new MutationObserver(sync);
  observer.observe(screen, { attributes: true, attributeFilter: ['class'], childList: true, subtree: true });
  phone.addEventListener('change', sync);
  reduced.addEventListener('change', sync);
  window.addEventListener('resize', sync);
  window.addEventListener('pagehide', destroy);
  document.addEventListener('visibilitychange', sync);
  sync();
})();
