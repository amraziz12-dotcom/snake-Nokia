/* تطبيق الموظف — بصمة الحضور والانصراف بالصورة والموقع */
(function () {
  const { CFG, DEMO, store, deviceId, api, NetError, haversine, fmtTime, fmtDate, isoDate, fmtDist, esc, toast, vibrate, pad } = window.Att;
  const $ = s => document.querySelector(s);
  const OPEN_MS = (CFG.OPEN_SHIFT_HOURS || 20) * 3600e3;

  const S = {
    user: store.get('att_user', null),        // {id,name,dept}
    last: store.get('att_last', null),        // {t:'IN'|'OUT', ts}
    today: store.get('att_today', []),
    site: store.get('att_site', CFG.SITE || null),
    maxAcc: 150,
    pos: null,
    facing: 'user',
    stream: null,
    photo: null,
    busy: false
  };

  const initials = n => String(n || '').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('');
  const show = id => ['vLogin', 'vHome'].forEach(v => $('#' + v).classList.toggle('hidden', v !== id));
  const nextType = () => (S.last && S.last.t === 'IN' && Date.now() - S.last.ts < OPEN_MS) ? 'OUT' : 'IN';
  const queue = () => store.get('att_queue', []);

  /* ============ تشغيل ============ */
  function boot() {
    $('#loginProject').textContent = `${CFG.DEPARTMENT || 'فريق السلامة'} — ${CFG.PROJECT_NAME}`;
    $('#homeProject').textContent = CFG.PROJECT_NAME;
    $('#demoBanner').classList.toggle('hidden', !DEMO);
    setupInstall();
    setInterval(tick, 1000); tick();
    window.addEventListener('online', () => { netBadge(); syncQueue(); });
    window.addEventListener('offline', netBadge);
    netBadge();
    api('config').then(c => {
      if (c.site) { S.site = c.site; store.set('att_site', c.site); }
      if (c.maxAccuracy) S.maxAcc = +c.maxAccuracy;
      renderGeo();
    }).catch(() => {});
    if (S.user) enterHome(); else show('vLogin');
  }

  function tick() {
    const d = new Date();
    let h = d.getHours(); const ap = h >= 12 ? 'م' : 'ص'; h = h % 12 || 12;
    $('#clockT').innerHTML = `${h}:${pad(d.getMinutes())}<span style="font-size:22px;opacity:.6">:${pad(d.getSeconds())} ${ap}</span>`;
    $('#clockD').textContent = fmtDate(d);
  }

  function netBadge() {
    const on = navigator.onLine, b = $('#netBadge');
    b.className = 'badge ' + (on ? 'ok' : 'bad');
    b.innerHTML = `<span class="dot"></span>${on ? 'متصل' : 'غير متصل'}`;
  }

  /* ============ الدخول ============ */
  const empInput = $('#empId');
  empInput.addEventListener('input', () => {
    empInput.value = empInput.value.replace(/[^\d٠-٩]/g, '').replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
    const e = (window.EMPLOYEES || []).find(x => x[0] === empInput.value);
    $('#foundBox').classList.toggle('hidden', !e);
    if (e) { $('#foundName').textContent = e[1]; $('#foundDept').textContent = e[2]; $('#foundAv').textContent = initials(e[1]); }
    $('#loginBtn').disabled = empInput.value.length < 4;
  });
  empInput.addEventListener('keydown', e => { if (e.key === 'Enter' && !$('#loginBtn').disabled) login(); });
  $('#loginBtn').addEventListener('click', login);

  async function login() {
    const btn = $('#loginBtn'); btn.disabled = true; btn.textContent = 'جاري التحقق…';
    try {
      const r = await api('login', { empId: empInput.value.trim(), deviceId: deviceId(), ua: navigator.userAgent });
      saveSession(r);
      vibrate(30);
      enterHome();
      toast(`أهلاً ${r.employee.name.split(' ')[0]} 👋`, 'ok');
    } catch (e) {
      toast(e.message, 'bad', 5000);
    } finally { btn.disabled = false; btn.textContent = 'دخول'; }
  }

  function saveSession(r) {
    S.user = r.employee; store.set('att_user', S.user);
    S.last = r.last || null; store.set('att_last', S.last);
    S.today = r.today || []; store.set('att_today', S.today);
    if (r.site) { S.site = r.site; store.set('att_site', r.site); }
  }

  function logout() {
    if (queue().length && !confirm('يوجد تسجيلات غير مرسلة! هل تريد الخروج فعلاً؟ ستبقى محفوظة على الجهاز.')) return;
    ['att_user', 'att_last', 'att_today'].forEach(store.del);
    S.user = null; S.last = null; S.today = [];
    stopGeo(); closeSheet(); show('vLogin');
  }

  /* ============ الرئيسية ============ */
  function enterHome() {
    show('vHome');
    $('#av').textContent = initials(S.user.name);
    $('#empName').textContent = S.user.name;
    $('#empIdTxt').textContent = S.user.id;
    $('#empDept').textContent = S.user.dept || '';
    renderStatus(); renderToday(); renderPending();
    startGeo();
    // تحديث الحالة من الخادم
    api('login', { empId: S.user.id, deviceId: deviceId(), ua: navigator.userAgent })
      .then(r => { saveSession(r); renderStatus(); renderToday(); })
      .catch(e => { if (!(e instanceof NetError)) { toast(e.message, 'bad', 6000); if (/جهاز|غير موجود/.test(e.message)) logout(); } });
    syncQueue();
  }

  function renderStatus() {
    const t = nextType(), b = $('#statusBadge'), btn = $('#punchBtn');
    if (t === 'OUT') {
      b.className = 'badge ok'; b.innerHTML = `<span class="dot"></span>حاضر منذ ${fmtTime(S.last.ts)}`;
      btn.classList.add('out'); $('#punchTxt').textContent = 'تسجيل انصراف';
    } else {
      b.className = 'badge'; b.innerHTML = `<span class="dot"></span>لم تسجل حضور`;
      btn.classList.remove('out'); $('#punchTxt').textContent = 'تسجيل حضور';
    }
    updatePunchBtn();
  }

  function renderToday() {
    const today = isoDate(Date.now());
    const pend = queue().filter(q => q.empId === S.user.id).map(q => ({ type: q.type, ts: new Date(q.clientTime).getTime(), pending: true }));
    const list = S.today.filter(r => r.date === today).concat(pend).sort((a, b) => b.ts - a.ts);
    $('#todayLog').innerHTML = list.length ? list.map(logItem).join('') : '<li class="empty">لا توجد تسجيلات اليوم</li>';
  }

  function logItem(r) {
    const inn = r.type === 'IN';
    const extra = r.pending ? '<span class="chip warn">بانتظار الإرسال</span>'
      : (r.inRange === false ? '<span class="chip bad">خارج النطاق</span>' : r.inRange === true ? '<span class="chip ok">داخل الموقع</span>' : '');
    const sub = [r.date && r.date !== isoDate(Date.now()) ? r.date : '', r.distance !== '' && r.distance != null ? fmtDist(r.distance) : '',
      r.duration ? `مدة العمل ${r.duration} س` : '', r.late ? `تأخير ${r.late} د` : ''].filter(Boolean).join(' · ');
    return `<li><div class="ic ${inn ? 'in' : 'out'}">${inn ? '↘' : '↗'}</div>
      <div class="grow"><b>${inn ? 'حضور' : 'انصراف'} — ${fmtTime(r.ts)}</b><div class="muted small">${esc(sub)}</div></div>${extra}</li>`;
  }

  function renderPending() {
    const n = queue().length;
    $('#pendingBanner').classList.toggle('hidden', !n);
    $('#pendingTxt').textContent = `${n} تسجيل محفوظ بدون إنترنت — سيتم إرساله تلقائياً`;
  }
  $('#syncBtn').addEventListener('click', () => syncQueue(true));

  /* ============ الموقع GPS ============ */
  let geoWatch = null, geoTimer = null;
  function startGeo() {
    if (!('geolocation' in navigator)) { geoFail('الجهاز لا يدعم تحديد الموقع'); return; }
    stopGeo();
    geoWatch = navigator.geolocation.watchPosition(p => {
      const np = { lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6), acc: Math.round(p.coords.accuracy), ts: Date.now() };
      // نحتفظ بأدق قراءة حديثة
      if (!S.pos || np.acc <= S.pos.acc || Date.now() - S.pos.ts > 15000) S.pos = np;
      renderGeo();
    }, err => {
      geoFail(err.code === 1 ? 'تم رفض إذن الموقع — فعّله من إعدادات المتصفح' : 'تعذر تحديد الموقع — تأكد من تشغيل GPS');
    }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
    clearInterval(geoTimer); geoTimer = setInterval(renderGeo, 10000);
  }
  function stopGeo() { if (geoWatch != null) navigator.geolocation.clearWatch(geoWatch); geoWatch = null; clearInterval(geoTimer); }

  function geoFail(msg) {
    const b = $('#geoBadge'); b.className = 'badge bad'; b.innerHTML = `<span class="dot"></span>الموقع غير متاح`;
    $('#geoCoords').textContent = msg;
    updatePunchBtn();
  }

  function siteDistance() { return S.site && S.pos ? haversine(S.site, S.pos) : null; }

  function renderGeo() {
    const b = $('#geoBadge');
    if (!S.pos) { updatePunchBtn(); return; }
    const d = siteDistance();
    $('#geoAcc').textContent = `± ${S.pos.acc} م`;
    $('#geoDist').textContent = d == null ? 'لم يُحدد موقع المشروع' : fmtDist(d);
    $('#geoCoords').innerHTML = `${S.pos.lat}, ${S.pos.lng} · <a style="color:#7dd3fc" target="_blank" rel="noopener" href="https://maps.google.com/?q=${S.pos.lat},${S.pos.lng}">عرض على الخريطة</a>`;
    if (d == null) { b.className = 'badge ok'; b.innerHTML = '<span class="dot"></span>تم تحديد موقعك'; }
    else if (d <= S.site.radius) { b.className = 'badge ok'; b.innerHTML = '<span class="dot"></span>داخل موقع العمل'; }
    else { b.className = 'badge bad'; b.innerHTML = '<span class="dot"></span>خارج موقع العمل'; }
    if (S.pos.acc > S.maxAcc) { b.className = 'badge warn'; b.innerHTML = '<span class="dot"></span>دقة الموقع ضعيفة'; }
    updatePunchBtn();
  }

  function updatePunchBtn() {
    const btn = $('#punchBtn'), sub = $('#punchSub');
    if (!S.pos) { btn.disabled = true; sub.textContent = 'في انتظار تحديد الموقع…'; return; }
    btn.disabled = S.busy;
    const d = siteDistance();
    sub.textContent = d != null && d > S.site.radius ? 'أنت خارج نطاق الموقع' : 'اضغط للبصمة';
  }

  /* ============ البصمة ============ */
  $('#punchBtn').addEventListener('click', async () => {
    if (S.busy) return;
    if (!S.pos || Date.now() - S.pos.ts > 120000) { toast('جاري تحديث الموقع… حاول بعد ثوانٍ', 'warn'); startGeo(); return; }
    const d = siteDistance();
    if (d != null && d > S.site.radius) {
      if (!confirm(`أنت على بعد ${fmtDist(d)} من موقع المشروع (النطاق المسموح ${S.site.radius} م).\nسيتم تسجيل البصمة كـ «خارج النطاق» وإبلاغ المشرف. متابعة؟`)) return;
    }
    if (S.pos.acc > S.maxAcc && !confirm(`دقة الموقع ضعيفة (± ${S.pos.acc} م). يُفضّل الانتقال لمكان مفتوح.\nمتابعة على أي حال؟`)) return;
    openCamera();
  });

  async function openCamera() {
    const type = nextType();
    $('#camTitle').textContent = type === 'IN' ? 'صورة الحضور' : 'صورة الانصراف';
    $('#vCam').classList.remove('hidden');
    resetCamUI();
    await startStream();
  }

  async function startStream() {
    stopStream();
    try {
      S.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: S.facing, width: { ideal: 1280 }, height: { ideal: 1280 } }, audio: false });
      const v = $('#video'); v.srcObject = S.stream; await v.play().catch(() => {});
      v.style.transform = S.facing === 'user' ? 'scaleX(-1)' : 'none';
    } catch (e) {
      closeCamera();
      toast(e.name === 'NotAllowedError' ? 'تم رفض إذن الكاميرا — فعّله من إعدادات المتصفح' : 'تعذر تشغيل الكاميرا', 'bad', 6000);
    }
  }
  function stopStream() { if (S.stream) S.stream.getTracks().forEach(t => t.stop()); S.stream = null; }
  function closeCamera() { stopStream(); $('#vCam').classList.add('hidden'); }
  function resetCamUI() {
    S.photo = null;
    $('#shot').classList.add('hidden'); $('#video').classList.remove('hidden'); $('#guide').classList.remove('hidden');
    $('#camBar').classList.remove('hidden'); $('#camBar2').classList.add('hidden');
  }

  $('#camCancel').addEventListener('click', closeCamera);
  $('#camFlip').addEventListener('click', () => { S.facing = S.facing === 'user' ? 'environment' : 'user'; startStream(); });
  $('#retake').addEventListener('click', () => { resetCamUI(); if (!S.stream) startStream(); });
  $('#shutter').addEventListener('click', capture);
  $('#confirmShot').addEventListener('click', () => { closeCamera(); submitPunch(); });

  function capture() {
    const v = $('#video');
    if (!v.videoWidth) { toast('الكاميرا لم تجهز بعد', 'warn'); return; }
    const W = 720, H = Math.round(W * v.videoHeight / v.videoWidth);
    const c = $('#canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d');
    if (S.facing === 'user') { x.translate(W, 0); x.scale(-1, 1); }
    x.drawImage(v, 0, 0, W, H);
    x.setTransform(1, 0, 0, 1, 0, 0);
    // علامة مائية: الاسم + الوقت + الموقع (تمنع إعادة استخدام الصورة)
    const now = new Date(), type = nextType();
    const lines = [
      `${type === 'IN' ? 'حضور' : 'انصراف'} — ${S.user.name} (${S.user.id})`,
      `${isoDate(now)}  ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`,
      `GPS ${S.pos.lat}, ${S.pos.lng}  ±${S.pos.acc}m` + (siteDistance() != null ? `  •  ${siteDistance()}m` : ''),
      CFG.PROJECT_NAME
    ];
    const lh = 28, band = lines.length * lh + 20;
    x.fillStyle = 'rgba(0,0,0,.55)'; x.fillRect(0, H - band, W, band);
    x.fillStyle = type === 'IN' ? '#22c55e' : '#ef4444'; x.fillRect(W - 8, H - band, 8, band);
    x.fillStyle = '#fff'; x.font = '600 21px Cairo, Tahoma, sans-serif'; x.textAlign = 'right'; x.direction = 'rtl';
    lines.forEach((l, i) => { x.direction = (i === 1 || i === 2) ? 'ltr' : 'rtl'; x.fillText(l, W - 20, H - band + 32 + i * lh); });
    S.photo = c.toDataURL('image/jpeg', 0.72);
    // صورة مصغرة (لوضع التجربة فقط)
    const t = document.createElement('canvas'); t.width = 240; t.height = Math.round(240 * H / W);
    t.getContext('2d').drawImage(c, 0, 0, t.width, t.height); S.thumb = t.toDataURL('image/jpeg', 0.6);
    $('#shot').src = S.photo; $('#shot').classList.remove('hidden');
    $('#video').classList.add('hidden'); $('#guide').classList.add('hidden');
    $('#camBar').classList.add('hidden'); $('#camBar2').classList.remove('hidden');
    stopStream(); vibrate(40);
  }

  async function submitPunch() {
    const type = nextType();
    const payload = {
      empId: S.user.id, deviceId: deviceId(), type,
      lat: S.pos.lat, lng: S.pos.lng, acc: S.pos.acc,
      clientTime: new Date().toISOString(), photo: S.photo, ua: navigator.userAgent
    };
    if (DEMO) payload.photoThumb = S.thumb;
    S.busy = true; updatePunchBtn();
    openSheet(`<div class="success"><div class="spinner"></div><h2>جاري إرسال البصمة…</h2><p class="muted">يتم رفع الصورة والموقع</p></div>`, false);
    try {
      const r = await api('punch', payload);
      applyRecord(r.record, r.last);
      vibrate([40, 60, 40]);
      showSuccess(r.record);
    } catch (e) {
      if (e instanceof NetError) {
        const q = queue(); q.push(Object.assign({ offline: true, qid: Date.now() }, payload));
        if (!store.set('att_queue', q)) { closeSheet(); toast('مساحة الجهاز ممتلئة — تعذر حفظ البصمة', 'bad', 6000); return; }
        S.last = { t: type, ts: Date.now() }; store.set('att_last', S.last);
        renderStatus(); renderToday(); renderPending();
        openSheet(`<div class="success"><div class="check ${type === 'OUT' ? 'out' : ''}" style="background:rgba(245,158,11,.15)"><svg viewBox="0 0 24 24" style="stroke:#f59e0b"><path d="M5 12l5 5L20 7"/></svg></div>
          <h2>تم حفظ البصمة على الجهاز</h2><p class="muted">لا يوجد اتصال بالإنترنت. سيتم إرسالها تلقائياً بوقتها الفعلي (${fmtTime(Date.now())}) عند عودة الاتصال.</p>
          <button class="btn" data-close>حسناً</button></div>`);
      } else {
        vibrate(200);
        openSheet(`<div class="success"><div class="check out"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></div>
          <h2>لم يتم التسجيل</h2><p class="muted">${esc(e.message)}</p><button class="btn" data-close>حسناً</button></div>`);
        if (/حضور|انصراف/.test(e.message)) enterHome();
      }
    } finally { S.busy = false; S.photo = null; updatePunchBtn(); }
  }

  function applyRecord(rec, last) {
    S.last = last || { t: rec.type, ts: rec.ts }; store.set('att_last', S.last);
    const lite = Object.assign({}, rec); delete lite.photo;
    S.today = S.today.filter(r => r.ts !== rec.ts).concat(lite).slice(-20); store.set('att_today', S.today);
    renderStatus(); renderToday();
  }

  function showSuccess(r) {
    const inn = r.type === 'IN';
    openSheet(`<div class="success">
      <div class="check ${inn ? '' : 'out'}"><svg viewBox="0 0 24 24"><path d="M5 12l5 5L20 7"/></svg></div>
      <h2>تم تسجيل ${inn ? 'الحضور' : 'الانصراف'} بنجاح</h2>
      <p class="muted">${esc(S.user.name)}</p>
      <div class="kv">
        <span>الوقت</span><b>${fmtTime(r.ts)}</b>
        <span>التاريخ</span><span>${fmtDate(r.ts)}</span>
        ${r.distance !== '' && r.distance != null ? `<span>البعد عن الموقع</span><span>${fmtDist(r.distance)} ${r.inRange === false ? '<span class="chip bad">خارج النطاق</span>' : '<span class="chip ok">داخل الموقع</span>'}</span>` : ''}
        ${r.address ? `<span>العنوان</span><span>${esc(r.address)}</span>` : ''}
        ${r.duration ? `<span>مدة العمل</span><b>${r.duration} ساعة</b>` : ''}
        ${r.late ? `<span>التأخير</span><span class="chip warn">${r.late} دقيقة</span>` : ''}
      </div>
      <button class="btn" data-close>تم</button></div>`);
  }

  /* ============ المزامنة بدون إنترنت ============ */
  let syncing = false;
  async function syncQueue(manual) {
    if (syncing || !navigator.onLine) { if (manual) toast('لا يوجد اتصال بالإنترنت', 'warn'); return; }
    let q = queue(); if (!q.length) return;
    syncing = true; let sent = 0;
    try {
      while (q.length) {
        const item = q[0];
        try {
          const r = await api('punch', item);
          if (S.user && item.empId === S.user.id) applyRecord(r.record, r.last);
          sent++;
        } catch (e) {
          if (e instanceof NetError) break;
          toast(`تم تجاهل تسجيل محفوظ: ${e.message}`, 'warn', 6000);
        }
        q = queue().filter(x => x.qid !== item.qid); store.set('att_queue', q);
      }
    } finally { syncing = false; }
    if (sent) toast(`تم إرسال ${sent} تسجيل محفوظ ✓`, 'ok');
    renderPending(); if (S.user) renderToday();
  }
  setInterval(() => syncQueue(), 60000);

  /* ============ السجل والقائمة ============ */
  $('#histBtn').addEventListener('click', async () => {
    openSheet(`<h2>سجل الحضور</h2><div class="spinner"></div>`);
    try {
      const r = await api('history', { empId: S.user.id, deviceId: deviceId() });
      const recs = r.records || [];
      const groups = {};
      recs.forEach(x => (groups[x.date] = groups[x.date] || []).push(x));
      const html = Object.keys(groups).sort().reverse().map(d => {
        const items = groups[d].sort((a, b) => b.ts - a.ts);
        const hrs = items.reduce((s, x) => s + (+x.duration || 0), 0);
        return `<div class="card" style="padding:12px"><div class="row"><b>${fmtDate(d + 'T12:00')}</b>${hrs ? `<span class="badge">${hrs.toFixed(1)} س</span>` : ''}</div>
          <ul class="log">${items.map(logItem).join('')}</ul></div>`;
      }).join('');
      openSheet(`<h2>سجل الحضور</h2>${html || '<p class="empty">لا توجد تسجيلات</p>'}<button class="btn ghost" data-close>إغلاق</button>`);
    } catch (e) { openSheet(`<h2>سجل الحضور</h2><p class="empty">${esc(e.message)}</p><button class="btn ghost" data-close>إغلاق</button>`); }
  });

  $('#menuBtn').addEventListener('click', () => {
    openSheet(`<h2>القائمة</h2>
      <div class="card"><div class="emp"><div class="avatar">${esc(initials(S.user.name))}</div><div><b>${esc(S.user.name)}</b><div class="muted small">${esc(S.user.id)} · ${esc(S.user.dept || '')}</div></div></div></div>
      <div class="kv"><span>رقم الجهاز</span><span class="small" style="direction:ltr;text-align:right">${esc(deviceId().slice(0, 13))}</span>
      <span>الإصدار</span><span>1.0${DEMO ? ' (تجريبي)' : ''}</span></div>
      <div style="display:grid;gap:10px">
        <button class="btn ghost" id="mRefresh">🔄 تحديث الموقع والحالة</button>
        <button class="btn bad" id="mLogout">تسجيل الخروج</button>
        <button class="btn ghost" data-close>إغلاق</button>
      </div>`);
    $('#mLogout').onclick = logout;
    $('#mRefresh').onclick = () => { closeSheet(); S.pos = null; startGeo(); enterHome(); };
  });

  /* ============ نافذة منبثقة ============ */
  function openSheet(html, closable = true) {
    $('#sheet').innerHTML = html; $('#overlay').classList.remove('hidden');
    $('#overlay').dataset.closable = closable ? '1' : '';
    $('#sheet').querySelectorAll('[data-close]').forEach(b => b.onclick = closeSheet);
  }
  function closeSheet() { $('#overlay').classList.add('hidden'); }
  $('#overlay').addEventListener('click', e => { if (e.target.id === 'overlay' && $('#overlay').dataset.closable) closeSheet(); });

  /* ============ التثبيت كتطبيق ============ */
  function setupInstall() {
    let deferred = null;
    const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    if (standalone) return;
    window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; $('#installBox').classList.remove('hidden'); });
    $('#installBtn').addEventListener('click', async () => {
      if (!deferred) return; deferred.prompt(); await deferred.userChoice; deferred = null; $('#installBox').classList.add('hidden');
    });
    if (/iphone|ipad|ipod/i.test(navigator.userAgent)) $('#iosHint').classList.remove('hidden');
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && S.user) { renderStatus(); syncQueue(); }
  });

  boot();
})();
