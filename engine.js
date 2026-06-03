/* 0Manual — scroll engine
   Captures every frame of the chart + counter videos into canvas arrays,
   then draws frames[index] based on scroll progress — true frame-by-frame
   scroll-driven playback. The hero is now a static premium screen (no video),
   so there is NO splash and NO scroll lock: the page opens straight on the hero
   while these later-section videos capture quietly in the background. */

(function engine() {
  const stages = Array.from(document.querySelectorAll('[data-stage]'));

  function clamp(v, a, b){ return v < a ? a : v > b ? b : v; }
  function smooth(t){ t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }

  function waitMeta(v) {
    return new Promise(resolve => {
      if (v.readyState >= 1 && isFinite(v.duration) && v.duration > 0) return resolve();
      const onMeta = () => { v.removeEventListener('loadedmetadata', onMeta); resolve(); };
      v.addEventListener('loadedmetadata', onMeta);
      v.load();
    });
  }

  /* Capture frames by playing the video fast and drawImage on each rendered frame. */
  async function captureFrames(video, maxWidth, targetFrames, rate, onProgress) {
    const frames = [];
    const scale = Math.min(1, maxWidth / video.videoWidth);
    const w = Math.max(1, Math.round(video.videoWidth * scale));
    const h = Math.max(1, Math.round(video.videoHeight * scale));
    const targetInterval = video.duration / targetFrames;
    let nextSampleT = 0;

    function captureAt() {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      try { ctx.drawImage(video, 0, 0, w, h); } catch (e) {}
      frames.push(c);
      nextSampleT += targetInterval;
    }

    return new Promise(resolve => {
      let done = false;
      function finish() {
        if (done) return; done = true;
        try { video.pause(); video.playbackRate = 1; video.currentTime = 0; } catch(e) {}
        resolve(frames);
      }

      video.addEventListener('error', () => {
        console.warn('video error during capture:', video.src, video.error && video.error.message);
        finish();
      }, { once: true });

      video.muted = true;
      try { video.playbackRate = rate; } catch(e) {}

      function step(now, meta) {
        if (done) return;
        if (video.error) return finish();
        const t = meta && meta.mediaTime != null ? meta.mediaTime : video.currentTime;
        while (t >= nextSampleT && nextSampleT < video.duration) {
          captureAt();
        }
        if (onProgress) onProgress(clamp(t / video.duration, 0, 1));
        if (video.ended || t >= video.duration - 0.03) {
          if (frames.length < 2) captureAt();
          return finish();
        }
        if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(step);
        else requestAnimationFrame(() => step(performance.now()));
      }

      video.addEventListener('ended', finish, { once: true });

      const playPromise = video.play();
      if (playPromise && playPromise.then) {
        playPromise.then(() => {
          if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(step);
          else requestAnimationFrame(() => step(performance.now()));
        }).catch(async () => {
          // Autoplay blocked OR decode failed — try seek-based capture.
          for (let t = 0; t < video.duration - 0.03; t += targetInterval) {
            if (done) return;
            if (video.error) return finish();
            try {
              video.currentTime = t;
              await Promise.race([
                new Promise(r => {
                  const h2 = () => { video.removeEventListener('seeked', h2); r(); };
                  video.addEventListener('seeked', h2);
                }),
                new Promise(r => setTimeout(r, 500)),
              ]);
              captureAt();
              if (onProgress) onProgress(clamp(t / video.duration, 0, 1));
            } catch(e) { break; }
          }
          finish();
        });
      }

      setTimeout(finish, 30000); // hard safety cap
    });
  }

  function progressOf(section){
    const r = section.getBoundingClientRect();
    const vh = window.innerHeight;
    const dist = r.height - vh;
    if (dist <= 0) return 0;
    return clamp(-r.top / dist, 0, 1);
  }

  const stageData = stages.map(stage => {
    const video = stage.querySelector('video');
    const canvas = stage.querySelector('canvas.scroll-canvas');
    return {
      stage, video, canvas,
      ctx: canvas ? canvas.getContext('2d') : null,
      frames: null,
      smooth: stage.hasAttribute('data-smooth'),
      targetIdx: 0,
      currentIdx: 0,
      lastDrawKey: '',
      scrubVideo: false,
      blocks: Array.from(stage.querySelectorAll('[data-from][data-to]')).map(el => {
        const isCh3 = el.classList.contains('ch3-block');
        return {
          el,
          from: parseFloat(el.getAttribute('data-from')),
          to:   parseFloat(el.getAttribute('data-to')),
          stay: el.hasAttribute('data-stay'),
          baseTransform: isCh3 ? 'translateY(-50%)' : '',
          shiftPx: isCh3 ? 24 : 18,
          lastO: -1,
        };
      }),
    };
  });

  function drawStage(s) {
    // Smoothest path: captured frames → draw to canvas.
    if (s.frames && s.frames.length > 0 && s.canvas) {
      const p = progressOf(s.stage);
      const N = s.frames.length;

      const target = clamp(p * (N - 1), 0, N - 1);
      s.targetIdx = target;

      if (s.smooth) {
        const delta = s.targetIdx - s.currentIdx;
        const speed = clamp(Math.abs(delta) * 0.08 + 0.15, 0.15, 0.45);
        s.currentIdx += delta * speed;
        if (Math.abs(delta) < 0.0015) s.currentIdx = s.targetIdx;
      } else {
        s.currentIdx = s.targetIdx;
      }

      const idxFloor = Math.floor(s.currentIdx);
      const idxNext  = Math.min(idxFloor + 1, N - 1);
      const frac     = s.currentIdx - idxFloor;

      const drawKey = idxFloor + ':' + (s.smooth ? frac.toFixed(3) : '0');
      if (drawKey === s.lastDrawKey) return;
      s.lastDrawKey = drawKey;

      const a = s.frames[idxFloor];
      const b = s.frames[idxNext];
      if (s.canvas.width !== a.width || s.canvas.height !== a.height) {
        s.canvas.width = a.width;
        s.canvas.height = a.height;
      }
      const ctx = s.ctx;
      ctx.globalAlpha = 1;
      ctx.drawImage(a, 0, 0);
      if (s.smooth && frac > 0.001 && b !== a) {
        ctx.globalAlpha = frac;
        ctx.drawImage(b, 0, 0);
        ctx.globalAlpha = 1;
      }
      return;
    }

    // Fallback (frames not ready yet, or capture failed): scrub the raw <video>
    // by currentTime so the section ALWAYS advances with scroll. Skip while a
    // capture is actively playing this video (would fight the playhead), and
    // only seek once the video has real frame data (readyState ≥ 2) so we never
    // seek to black.
    if (s.capturing) return;
    if (s.video && s.video.readyState >= 2) {
      const p = progressOf(s.stage);
      const d = s.video.duration;
      if (isFinite(d) && d > 0) {
        const t = clamp(p * d, 0, Math.max(0, d - 0.05));
        if (Math.abs(t - (s._lastSeek || 0)) > 0.02) {
          try { s.video.currentTime = t; s._lastSeek = t; } catch(e) {}
        }
      }
    }
  }

  function updateBlocks(s, p) {
    s.blocks.forEach(b => {
      const fadeIn = 0.10;
      const fadeOut = 0.10;
      const inV = smooth((p - b.from) / fadeIn);
      const out = b.stay ? 1 : (p < b.to - fadeOut ? 1 : smooth((b.to - p) / fadeOut));
      const o = clamp(Math.min(inV, out), 0, 1);
      if (b.lastO !== o) {
        b.el.style.opacity = o.toFixed(3);
        const shift = ((1 - o) * b.shiftPx).toFixed(2);
        b.el.style.transform = b.baseTransform + ' translateY(' + shift + 'px)';
        b.lastO = o;
      }
    });
  }

  function tick() {
    stageData.forEach(s => {
      const p = progressOf(s.stage);
      s.stage.style.setProperty('--prog', p.toFixed(4));
      updateBlocks(s, p);
      drawStage(s);
    });
    requestAnimationFrame(tick);
  }

  /* ─── Background capture: NO splash, NO scroll lock ─── */
  (async function captureInBackground(){
    try {
      const mem = navigator.deviceMemory || 4;
      const isMobile = window.matchMedia('(max-width: 820px)').matches
        || /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
      const cores = navigator.hardwareConcurrency || 4;
      let tier;
      if (isMobile || mem <= 3 || cores <= 4) tier = 0;
      else if (mem <= 6) tier = 1;
      else tier = 2;

      const SIST_FRAMES  = [150, 170, 190][tier];
      const COUNT_FRAMES = [120, 130, 140][tier];

      const captureOrder = [
        { id: 'sistema',     maxW: 1280, frames: SIST_FRAMES },
        { id: 'resultados',  maxW: 1280, frames: COUNT_FRAMES },
      ];

      for (const cfg of captureOrder) {
        const s = stageData.find(x => x.stage.id === cfg.id);
        if (!s || !s.video) continue;

        // Wait for THIS video's own metadata (don't gate on the other one).
        await Promise.race([waitMeta(s.video), new Promise(r => setTimeout(r, 8000))]);

        s.capturing = true;
        const captured = await Promise.race([
          captureFrames(s.video, cfg.maxW, cfg.frames, 4),
          new Promise(r => setTimeout(() => r([]), 32000)),
        ]);
        s.capturing = false;
        s.frames = captured || [];

        if (s.frames.length > 0) {
          s.video.style.display = 'none';
          if (s.canvas) s.canvas.style.display = 'block';
          drawStage(s);
        } else {
          // Capture failed — keep the raw <video> visible; drawStage will scrub
          // it by currentTime on scroll (it's loaded from the capture attempt).
          try {
            s.video.loop = false;
            s.video.muted = true;
            s.video.pause();
            s.video.currentTime = 0;
          } catch(e) {}
          s.scrubVideo = true;
          if (s.canvas) s.canvas.style.display = 'none';
          s.video.style.display = 'block';
          console.warn('frame capture failed for', cfg.id, '— scrubbing raw <video> via currentTime');
        }
      }
    } catch (err) {
      console.error('engine capture error:', err);
    }
  })();

  // Render loop starts immediately — sections animate as soon as frames land.
  requestAnimationFrame(tick);
})();

/* ─── Hero: warm→dark fade + content lift as the user starts scrolling ─── */
(function heroScrollFade(){
  const hero = document.getElementById('hero');
  if (!hero) return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let scheduled = false;
  function apply(){
    scheduled = false;
    const vh = window.innerHeight;
    const y = window.scrollY;
    // progress across roughly the first viewport-height of scrolling
    const t = Math.min(1, y / (vh * 0.85));
    // warm light layers fade out a touch faster than the content
    hero.style.setProperty('--hero-warm', (1 - Math.min(1, t * 1.25)).toFixed(3));
    // a soft dark layer eases in, melting into the dark 1% atmosphere
    hero.style.setProperty('--hero-dark', (Math.min(1, t * 1.15)).toFixed(3));
    // content gently fades and lifts
    hero.style.setProperty('--hero-fade', (1 - t * 0.92).toFixed(3));
    hero.style.setProperty('--hero-lift', (t * 64).toFixed(1));
  }
  window.addEventListener('scroll', () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(apply);
  }, { passive: true });
  apply();
})();

/* ─── Hero: subtle cursor parallax on the background layers (desktop only) ─── */
(function heroParallax(){
  const hero = document.getElementById('hero');
  if (!hero) return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  // Pointer parallax only makes sense with a fine pointer (mouse/trackpad).
  if (!window.matchMedia || !window.matchMedia('(pointer: fine)').matches) return;

  const layers = Array.from(hero.querySelectorAll('.hero-layer[data-depth]')).map(el => ({
    el, depth: parseFloat(el.getAttribute('data-depth')) || 0,
  }));
  if (!layers.length) return;

  let tx = 0, ty = 0;   // target (-1..1)
  let cx = 0, cy = 0;   // current (smoothed)
  let active = false;

  window.addEventListener('pointermove', (e) => {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    tx = (e.clientX / window.innerWidth) * 2 - 1;
    ty = (e.clientY / window.innerHeight) * 2 - 1;
    active = true;
  }, { passive: true });
  window.addEventListener('pointerleave', () => { tx = 0; ty = 0; }, { passive: true });

  function loop(){
    cx += (tx - cx) * 0.06;
    cy += (ty - cy) * 0.06;
    if (active || Math.abs(cx) > 0.001 || Math.abs(cy) > 0.001) {
      for (const L of layers) {
        const x = (-cx * L.depth).toFixed(2);
        const y = (-cy * L.depth).toFixed(2);
        L.el.style.translate = x + 'px ' + y + 'px';
      }
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();

/* ─── Nav: visible from the first moment ─── */
(function navVisibility(){
  const nav = document.getElementById('nav');
  if (!nav) return;
  nav.classList.remove('is-hidden');
})();

/* ─── Edge section: autoplay video only while in view (loop, muted) ─── */
(function edgeAutoplay(){
  const v = document.getElementById('edge-video');
  if (!v) return;
  v.muted = true;
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          const p = v.play();
          if (p && p.catch) p.catch(() => {});
        } else {
          v.pause();
        }
      });
    }, { threshold: 0.25 });
    io.observe(v);
  } else {
    const p = v.play();
    if (p && p.catch) p.catch(() => {});
  }
})();

/* ─── Edge section: brief one-time scroll lock so the copy gets read ─── */
(function edgeScrollLock(){
  const section = document.querySelector('.edge');
  if (!section) return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const LOCK_MS = 5000;
  let armed = true;
  let locked = false;
  let holding = false;   // true once the glide has settled — then we hold position
  let lockY = 0;

  function prevent(e){ e.preventDefault(); }
  function snap(){ if (locked && holding) window.scrollTo(0, lockY); }
  function keyBlock(e){
    const blocked = [' ', 'Spacebar', 'PageDown', 'PageUp', 'ArrowDown', 'ArrowUp', 'Home', 'End'];
    if (blocked.indexOf(e.key) !== -1) e.preventDefault();
  }

  // Where the section sits perfectly fitted to the viewport.
  function idealY(){
    const r = section.getBoundingClientRect();
    const top = r.top + window.scrollY;
    const h = section.offsetHeight;
    const vh = window.innerHeight;
    if (h <= vh) return Math.round(top + h / 2 - vh / 2); // center it
    return Math.round(top - 60); // taller than screen → align near top
  }

  function blockInput(){
    window.addEventListener('wheel', prevent, { passive: false });
    window.addEventListener('touchmove', prevent, { passive: false });
    window.addEventListener('keydown', keyBlock, { passive: false });
    window.addEventListener('scroll', snap, { passive: true });
  }
  function unblockInput(){
    window.removeEventListener('wheel', prevent, { passive: false });
    window.removeEventListener('touchmove', prevent, { passive: false });
    window.removeEventListener('keydown', keyBlock, { passive: false });
    window.removeEventListener('scroll', snap);
  }

  function engage(){
    armed = false; locked = true; holding = false;
    blockInput();

    // Glide to fit the section to the screen, THEN hold for the read time.
    const startY = window.scrollY;
    const targetY = idealY();
    lockY = targetY;
    const GLIDE = 620;
    const t0 = performance.now();
    function step(now){
      const p = Math.min(1, (now - t0) / GLIDE);
      const e = p < 0.5 ? 2*p*p : 1 - Math.pow(-2*p + 2, 2) / 2; // easeInOutQuad
      window.scrollTo(0, Math.round(startY + (targetY - startY) * e));
      if (p < 1) requestAnimationFrame(step);
      else holding = true; // now snap() will keep it pinned
    }
    requestAnimationFrame(step);

    setTimeout(release, GLIDE + LOCK_MS);
  }
  function release(){
    locked = false; holding = false;
    unblockInput();
  }

  let lastY = window.scrollY;
  window.addEventListener('scroll', () => {
    const y = window.scrollY;
    const goingDown = y > lastY;
    lastY = y;
    // Don't trap a deliberate nav-button scroll; only fire once, on manual scroll-down.
    if (!armed || locked || window.__navScrolling) return;
    const r = section.getBoundingClientRect();
    const vh = window.innerHeight;
    const centerY = r.top + r.height / 2;
    if (goingDown && centerY <= vh * 0.62) {
      engage();
    }
  }, { passive: true });
})();
