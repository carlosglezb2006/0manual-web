/* ============================================
   0Manual — Contact form + booking calendar
   Reused from previous site. Same n8n endpoints,
   same payload shape, fire-and-forget UX.
   ============================================ */

/* ───── Booking calendar (Google Calendar busy slots) ─────
   Backend (n8n) endpoint:
     GET <URL_AVAIL>?from=YYYY-MM-DD&to=YYYY-MM-DD
     → returns JSON: { "busy": [ { "start": "<ISO>", "end": "<ISO>" }, ... ] }
*/
(function bookingCalendar(){
  const grid = document.getElementById('cf-cal-grid');
  const monthEl = document.getElementById('cf-cal-month');
  const prev = document.getElementById('cf-cal-prev');
  const next = document.getElementById('cf-cal-next');
  const slotsBody = document.getElementById('cf-slots-body');
  const slotsDay = document.getElementById('cf-slots-day');
  const statusEl = document.getElementById('cf-cal-status');
  const hidden = document.getElementById('cf-fecha-hora');
  const tag = document.getElementById('cf-slot-tag');
  const tagText = document.getElementById('cf-slot-tag-text');
  if (!grid) return;

  const URL_AVAIL = 'https://n8n.srv1039378.hstgr.cloud/webhook/disponibilidad';
  const SLOT_MIN = 60;
  const HOURS = [
    { label: 'mañana', range: [{ h: 10, m: 0 }, { h: 12, m: 0 }] },
    { label: 'tarde',  range: [{ h: 16, m: 0 }, { h: 20, m: 0 }] },
  ];
  const MONTH_NAMES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const WEEKDAY_NAMES = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let viewYear = today.getFullYear();
  let viewMonth = today.getMonth();
  let selectedDay = null;
  let selectedSlotISO = null;
  const busyCache = new Map();
  const inflight = new Map();

  function fmtDate(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
  function fmtTime(d){ return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; }
  function fmtISOLocal(d){
    const off = -d.getTimezoneOffset();
    const sign = off >= 0 ? '+' : '-';
    const oh = String(Math.floor(Math.abs(off)/60)).padStart(2,'0');
    const om = String(Math.abs(off)%60).padStart(2,'0');
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:00${sign}${oh}:${om}`;
  }
  function setStatus(text, loading){
    statusEl.textContent = text || '';
    statusEl.classList.toggle('is-loading', !!loading);
  }
  async function fetchBusy(year, month){
    const key = `${year}-${String(month+1).padStart(2,'0')}`;
    if (busyCache.has(key)) return busyCache.get(key);
    if (inflight.has(key)) return inflight.get(key);
    const from = new Date(year, month, 1);
    const to   = new Date(year, month + 1, 1);
    const p = (async () => {
      try {
        setStatus('comprobando disponibilidad…', true);
        const res = await fetch(`${URL_AVAIL}?from=${fmtDate(from)}&to=${fmtDate(to)}`, { method: 'GET' });
        if (!res.ok) throw new Error('avail http ' + res.status);
        const json = await res.json();
        const arr = (json && Array.isArray(json.busy) ? json.busy : []).map(b => ({
          start: new Date(b.start), end: new Date(b.end)
        })).filter(b => !isNaN(b.start) && !isNaN(b.end));
        busyCache.set(key, arr);
        setStatus('');
        return arr;
      } catch(err) {
        busyCache.set(key, []);
        setStatus('');
        return [];
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, p);
    return p;
  }
  function isBusy(slotStart, busyList){
    const slotEnd = new Date(slotStart.getTime() + SLOT_MIN * 60000);
    return busyList.some(b => b.start < slotEnd && b.end > slotStart);
  }
  function isWorkDay(d){ const dow = d.getDay(); return dow >= 1 && dow <= 5; }
  function isPastDay(d){ return d < today; }
  function maxDate(){ const m = new Date(today); m.setMonth(m.getMonth() + 3); return m; }

  function renderMonth(){
    monthEl.textContent = `${MONTH_NAMES[viewMonth]} ${viewYear}`;
    grid.innerHTML = '';
    const first = new Date(viewYear, viewMonth, 1);
    const startDow = (first.getDay() + 6) % 7;
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const prevMonthDays = new Date(viewYear, viewMonth, 0).getDate();
    for (let i = 0; i < 42; i++) {
      const dayNum = i - startDow + 1;
      let d, isOther = false;
      if (dayNum < 1) { d = new Date(viewYear, viewMonth - 1, prevMonthDays + dayNum); isOther = true; }
      else if (dayNum > daysInMonth) { d = new Date(viewYear, viewMonth + 1, dayNum - daysInMonth); isOther = true; }
      else { d = new Date(viewYear, viewMonth, dayNum); }
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cf-cal-day' + (isOther ? ' is-other' : '');
      btn.textContent = d.getDate();
      const past = isPastDay(d);
      const workday = isWorkDay(d);
      const tooFar = d > maxDate();
      const disabled = isOther || past || !workday || tooFar;
      if (disabled) btn.setAttribute('disabled', '');
      if (+d === +today) btn.classList.add('is-today');
      if (selectedDay && +d === +selectedDay) btn.classList.add('is-active');
      btn.addEventListener('click', () => selectDay(d));
      grid.appendChild(btn);
    }
    const minMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const maxMonth = new Date(maxDate().getFullYear(), maxDate().getMonth(), 1);
    prev.toggleAttribute('disabled', new Date(viewYear, viewMonth, 1) <= minMonth);
    next.toggleAttribute('disabled', new Date(viewYear, viewMonth, 1) >= maxMonth);
  }

  async function selectDay(d){
    selectedDay = d;
    renderMonth();
    slotsDay.innerHTML = `huecos del <em>${WEEKDAY_NAMES[d.getDay()]} ${d.getDate()} de ${MONTH_NAMES[d.getMonth()]}</em>`;
    slotsBody.innerHTML = '<span class="cf-slots-empty">cargando huecos…</span>';
    const busy = await fetchBusy(d.getFullYear(), d.getMonth());
    renderSlots(d, busy);
  }

  function renderSlots(d, busy){
    slotsBody.innerHTML = '';
    let anyAvailable = false;
    HOURS.forEach(section => {
      const sectionEl = document.createElement('div');
      sectionEl.className = 'cf-slots-section';
      const label = document.createElement('span');
      label.className = 'cf-slots-section-label';
      label.textContent = section.label;
      sectionEl.appendChild(label);
      const row = document.createElement('div');
      row.className = 'cf-slots-row';
      const [s, e] = section.range;
      const start = new Date(d); start.setHours(s.h, s.m, 0, 0);
      const end = new Date(d); end.setHours(e.h, e.m, 0, 0);
      const nowD = new Date();
      for (let t = new Date(start); t < end; t = new Date(t.getTime() + SLOT_MIN * 60000)) {
        const slot = document.createElement('button');
        slot.type = 'button';
        slot.className = 'cf-slot';
        slot.textContent = fmtTime(t);
        const past = t < nowD;
        const taken = isBusy(t, busy);
        if (past || taken) slot.setAttribute('disabled', '');
        else anyAvailable = true;
        const iso = fmtISOLocal(t);
        if (selectedSlotISO === iso) slot.classList.add('is-active');
        slot.addEventListener('click', () => selectSlot(t, slot));
        row.appendChild(slot);
      }
      sectionEl.appendChild(row);
      slotsBody.appendChild(sectionEl);
    });
    if (!anyAvailable) {
      const empty = document.createElement('span');
      empty.className = 'cf-slots-empty';
      empty.textContent = 'no quedan huecos en este día. prueba otra fecha.';
      slotsBody.appendChild(empty);
    }
  }

  function selectSlot(d, btn){
    selectedSlotISO = fmtISOLocal(d);
    hidden.value = selectedSlotISO;
    slotsBody.querySelectorAll('.cf-slot.is-active').forEach(b => b.classList.remove('is-active'));
    btn.classList.add('is-active');
    const labelText = `${WEEKDAY_NAMES[d.getDay()]} ${d.getDate()} ${MONTH_NAMES[d.getMonth()]} — ${fmtTime(d)}`;
    tagText.textContent = labelText;
    tag.style.display = 'inline-flex';
    const errSlot = document.querySelector('[data-error-for="fecha_hora"]');
    if (errSlot) errSlot.textContent = '';
  }

  prev.addEventListener('click', () => {
    if (prev.hasAttribute('disabled')) return;
    viewMonth--;
    if (viewMonth < 0) { viewMonth = 11; viewYear--; }
    renderMonth();
  });
  next.addEventListener('click', () => {
    if (next.hasAttribute('disabled')) return;
    viewMonth++;
    if (viewMonth > 11) { viewMonth = 0; viewYear++; }
    renderMonth();
  });

  renderMonth();
  fetchBusy(viewYear, viewMonth);
})();

/* ───── Contact form ───── */
(function contactForm(){
  const form = document.getElementById('contact-form');
  const status = document.getElementById('cf-status');
  const statusMsg = document.getElementById('cf-status-msg');
  const statusSub = document.getElementById('cf-status-sub');
  const submit = document.getElementById('cf-submit');
  const submitLabel = submit && submit.querySelector('.cf-submit-label');
  if (!form) return;

  const URL_WEBHOOK = 'https://n8n.srv1039378.hstgr.cloud/webhook/contacto-0manual';

  function setError(name, msg){
    const slot = form.querySelector(`[data-error-for="${name}"]`);
    const input = form.querySelector(`[name="${name}"]`);
    if (slot) slot.textContent = msg || '';
    if (input) input.classList.toggle('is-invalid', !!msg);
  }
  function clearErrors(){
    form.querySelectorAll('.cf-error').forEach(e => e.textContent = '');
    form.querySelectorAll('.is-invalid').forEach(e => e.classList.remove('is-invalid'));
  }
  function validate(data){
    let ok = true;
    if (!data.nombre || data.nombre.trim().length < 2) { setError('nombre', 'introduce tu nombre.'); ok = false; }
    if (!data.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email.trim())) { setError('email', 'correo no válido.'); ok = false; }
    if (!data.telefono || data.telefono.replace(/\D/g, '').length < 6) { setError('telefono', 'teléfono no válido.'); ok = false; }
    if (!data.empresa || data.empresa.trim().length < 2) { setError('empresa', 'introduce el nombre de tu inmobiliaria.'); ok = false; }
    if (!data.problema || data.problema.trim().length < 8) { setError('problema', 'cuéntanos un poco más (mín. 8 caracteres).'); ok = false; }
    return ok;
  }

  ['nombre','email','telefono','empresa','problema'].forEach(name => {
    const el = form.querySelector(`[name="${name}"]`);
    if (el) el.addEventListener('input', () => setError(name, ''));
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    clearErrors();
    const data = {
      nombre: form.nombre.value.trim(),
      email: form.email.value.trim(),
      telefono: form.telefono.value.trim(),
      empresa: form.empresa.value.trim(),
      problema: form.problema.value.trim(),
      fecha_hora: (form.fecha_hora && form.fecha_hora.value) ? form.fecha_hora.value : '',
    };
    if (!validate(data)) return;

    // Show success immediately — fire-and-forget.
    form.style.display = 'none';
    status.classList.add('is-on');
    status.classList.remove('error');
    statusMsg.textContent = 'gracias. te contactamos en menos de 48 horas para confirmar el diagnóstico.';
    statusSub.textContent = '';

    // Enviar SIN provocar un "preflight" de CORS: form-urlencoded es una
    // petición "simple", así que el navegador la entrega a n8n directamente
    // aunque n8n no tenga CORS configurado. (Un cuerpo JSON obliga a un
    // preflight OPTIONS que n8n no contesta, y el POST se perdía en silencio.)
    const body = new URLSearchParams(data).toString();
    let sent = false;
    try {
      if (navigator.sendBeacon) {
        const blob = new Blob([body], { type: 'application/x-www-form-urlencoded;charset=UTF-8' });
        sent = navigator.sendBeacon(URL_WEBHOOK, blob);
      }
    } catch (e) {}
    if (!sent) {
      fetch(URL_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: body,
        keepalive: true,
        mode: 'no-cors',
      }).catch(() => {});
    }
  });
})();

/* ───── Smooth fluid scroll for all in-page nav links ───── */
(function smoothNav(){
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function scrollToY(targetY, dur){
    if (reduce) { window.scrollTo(0, targetY); return; }
    const startY = window.scrollY;
    const dist = targetY - startY;
    const t0 = performance.now();
    window.__navScrolling = true;
    function step(now){
      const p = Math.min(1, (now - t0) / dur);
      // easeInOutCubic — fluid, gentle start and stop
      const e = p < 0.5 ? 4*p*p*p : 1 - Math.pow(-2*p + 2, 3) / 2;
      window.scrollTo(0, Math.round(startY + dist * e));
      if (p < 1) requestAnimationFrame(step);
      else window.__navScrolling = false;
    }
    requestAnimationFrame(step);
  }

  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', (e) => {
      const href = a.getAttribute('href');
      if (!href || href.length < 1) return;
      let top;
      if (href === '#') {
        top = 0; // logo → back to top
      } else {
        const target = document.querySelector(href);
        if (!target) return;
        top = Math.max(0, target.getBoundingClientRect().top + window.scrollY - 40);
      }
      e.preventDefault();
      const dist = Math.abs(top - window.scrollY);
      const dur = Math.min(1500, Math.max(550, dist * 0.5));
      scrollToY(top, dur);
    });
  });
})();
