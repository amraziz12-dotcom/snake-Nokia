/* لوحة المشرف — متابعة حضور وانصراف فريق العمل */
(function () {
  const { CFG, DEMO, api, fmtTime, isoDate, fmtDist, esc, toast } = window.Att;
  const $ = s => document.querySelector(s);
  const A = { pin: sessionStorage.getItem('att_pin') || '', data: null, tab: 'all', settings: {} };

  $('#aProject').textContent = `${CFG.DEPARTMENT || ''} — ${CFG.PROJECT_NAME}`;
  $('#aDemo').classList.toggle('hidden', !DEMO);
  $('#day').value = isoDate(Date.now());

  /* ---------- الدخول ---------- */
  async function login(pin) {
    const btn = $('#pinBtn'); btn.disabled = true; btn.textContent = 'جاري التحقق…';
    try {
      const r = await api('admin_login', { pin, ua: navigator.userAgent });
      A.admin = r.admin || {};
      $('#aWho').textContent = `${A.admin.name || ''}${A.admin.role ? ' · ' + A.admin.role : ''}`;
      A.pin = pin; A.settings = r.settings || {}; sessionStorage.setItem('att_pin', pin);
      $('#aLogin').classList.add('hidden'); $('#aMain').classList.remove('hidden');
      load();
    } catch (e) { toast(e.message, 'bad'); sessionStorage.removeItem('att_pin'); }
    finally { btn.disabled = false; btn.textContent = 'دخول'; }
  }
  $('#pinBtn').onclick = () => login($('#pin').value.trim());
  $('#pin').addEventListener('keydown', e => { if (e.key === 'Enter') login($('#pin').value.trim()); });
  $('#outBtn').onclick = () => { sessionStorage.removeItem('att_pin'); location.reload(); };
  if (A.pin) login(A.pin);

  /* ---------- تحميل بيانات اليوم ---------- */
  async function load() {
    $('#refreshBtn').textContent = '…';
    try {
      const r = await api('admin_day', { pin: A.pin, date: $('#day').value });
      A.data = r; if (r.settings) A.settings = r.settings;
      render();
      $('#updated').textContent = 'آخر تحديث: ' + fmtTime(Date.now());
    } catch (e) { toast(e.message, 'bad'); }
    finally { $('#refreshBtn').textContent = '⟳'; }
  }
  $('#refreshBtn').onclick = load;
  $('#day').onchange = load;
  $('#q').oninput = render;
  setInterval(() => { if (!document.hidden && A.data) load(); }, 60000);

  function summarize() {
    const { employees, records } = A.data;
    const by = {};
    records.forEach(r => (by[r.empId] = by[r.empId] || []).push(r));
    return employees.map(e => {
      const rs = (by[e.id] || []).sort((a, b) => a.ts - b.ts);
      const ins = rs.filter(r => r.type === 'IN'), outs = rs.filter(r => r.type === 'OUT');
      const fin = ins[0], lout = outs[outs.length - 1];
      const hours = outs.reduce((s, r) => s + (+r.duration || 0), 0);
      const outOfRange = rs.some(r => r.inRange === false);
      const late = fin && fin.late ? +fin.late : 0;
      const status = !rs.length ? 'absent' : (lout && lout.ts > (ins[ins.length - 1] || {}).ts ? 'left' : 'present');
      return { e, rs, fin, lout, hours, outOfRange, late, status, offline: rs.some(r => r.offline) };
    });
  }

  const TABS = [
    ['all', 'الكل'], ['present', 'متواجد الآن'], ['attended', 'حضروا'], ['absent', 'لم يحضر'],
    ['late', 'متأخر'], ['range', 'خارج النطاق']
  ];
  const filt = {
    all: () => true, present: x => x.status === 'present', attended: x => x.status !== 'absent', absent: x => x.status === 'absent',
    late: x => x.late > 0, range: x => x.outOfRange
  };

  function render() {
    if (!A.data) return;
    const rows = summarize();
    const site = A.settings && A.settings.lat !== '' && A.settings.lat != null;
    $('#aNoSite').classList.toggle('hidden', !!site);
    const cnt = k => rows.filter(filt[k]).length;
    $('#stats').innerHTML = `
      <div class="stat pri"><b>${rows.length}</b><span>إجمالي فريق العمل</span></div>
      <div class="stat ok"><b>${cnt('attended')}</b><span>حضروا اليوم</span></div>
      <div class="stat"><b>${cnt('present')}</b><span>متواجد الآن</span></div>
      <div class="stat bad"><b>${cnt('absent')}</b><span>لم يحضر</span></div>
      <div class="stat warn"><b>${cnt('late')}</b><span>متأخر</span></div>
      <div class="stat bad"><b>${cnt('range')}</b><span>خارج النطاق</span></div>`;
    $('#tabs').innerHTML = TABS.map(([k, l]) => `<button class="tab ${A.tab === k ? 'on' : ''}" data-k="${k}">${l} (${cnt(k)})</button>`).join('');
    $('#tabs').querySelectorAll('.tab').forEach(b => b.onclick = () => { A.tab = b.dataset.k; render(); });

    const q = $('#q').value.trim();
    const list = rows.filter(filt[A.tab]).filter(x => !q || x.e.name.includes(q) || x.e.id.includes(q));
    $('#tbody').innerHTML = list.map((x, i) => {
      const chips = [];
      if (x.status === 'absent') chips.push('<span class="chip bad">غائب</span>');
      if (x.status === 'present') chips.push('<span class="chip ok">متواجد</span>');
      if (x.status === 'left') chips.push('<span class="chip mut">انصرف</span>');
      if (x.late) chips.push(`<span class="chip warn">تأخير ${x.late} د</span>`);
      if (x.outOfRange) chips.push('<span class="chip bad">خارج النطاق</span>');
      if (x.offline) chips.push('<span class="chip mut">مزامنة لاحقة</span>');
      const photos = x.rs.map(r => `<button class="btn ghost sm" style="padding:4px 8px" data-photo="${esc(r.photoId || '')}" data-cap="${esc(x.e.name)} — ${r.type === 'IN' ? 'حضور' : 'انصراف'} ${fmtTime(r.ts)}">${r.type === 'IN' ? '📷↘' : '📷↗'}</button>`).join(' ');
      const ref = x.lout || x.fin;
      const dist = x.rs.length ? Math.max(...x.rs.map(r => +r.distance || 0)) : '';
      return `<tr>
        <td>${i + 1}</td><td><b>${esc(x.e.name)}</b></td><td>${esc(x.e.id)}</td>
        <td>${x.fin ? fmtTime(x.fin.ts) : '—'}</td><td>${x.lout ? fmtTime(x.lout.ts) : '—'}</td>
        <td>${x.hours ? x.hours.toFixed(2) : '—'}</td>
        <td>${x.rs.length && site ? fmtDist(dist) : '—'}</td>
        <td>${chips.join(' ')}</td><td>${photos || '—'}</td>
        <td>${ref ? `<a target="_blank" rel="noopener" href="https://maps.google.com/?q=${ref.lat},${ref.lng}">📍 فتح</a>` : '—'}</td></tr>`;
    }).join('') || '<tr><td colspan="10" class="empty">لا توجد نتائج</td></tr>';
    $('#tbody').querySelectorAll('[data-photo]').forEach(b => b.onclick = () => showPhoto(b.dataset.photo, b.dataset.cap));
  }

  async function showPhoto(id, cap) {
    openSheet(`<h2>${esc(cap)}</h2><div class="spinner"></div>`);
    try {
      const r = await api('admin_photo', { pin: A.pin, fileId: id });
      openSheet(`<h2>${esc(cap)}</h2><img class="photo-full" src="${r.dataUrl}" alt="">
        ${r.url ? `<p><a style="color:#7dd3fc" target="_blank" rel="noopener" href="${esc(r.url)}">فتح في Google Drive</a></p>` : ''}
        <button class="btn ghost" data-close style="margin-top:10px">إغلاق</button>`);
    } catch (e) { openSheet(`<h2>${esc(cap)}</h2><p class="empty">${esc(e.message)}</p><button class="btn ghost" data-close>إغلاق</button>`); }
  }

  /* ---------- تصدير ---------- */
  $('#csvBtn').onclick = () => {
    if (!A.data) return;
    const head = ['م', 'الرقم الوظيفي', 'اسم الموظف', 'القسم', 'التاريخ', 'الحضور', 'الانصراف', 'ساعات العمل', 'تأخير (دقيقة)', 'خارج النطاق', 'الحالة', 'الموقع'];
    const st = { absent: 'غائب', present: 'متواجد', left: 'انصرف' };
    const lines = summarize().map((x, i) => [i + 1, x.e.id, x.e.name, x.e.dept, $('#day').value,
      x.fin ? fmtTime(x.fin.ts) : '', x.lout ? fmtTime(x.lout.ts) : '', x.hours ? x.hours.toFixed(2) : '', x.late || '',
      x.outOfRange ? 'نعم' : '', st[x.status], x.fin ? `https://maps.google.com/?q=${x.fin.lat},${x.fin.lng}` : '']);
    const csv = '﻿' + [head].concat(lines).map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `حضور-${CFG.PROJECT_NAME}-${$('#day').value}.csv`; a.click();
  };

  /* ---------- الإعدادات ---------- */
  function settingsSheet() {
    const s = A.settings || {};
    openSheet(`<h2>⚙ الإعدادات</h2>
      <div class="card"><h3>📍 موقع المشروع (السياج الجغرافي)</h3>
        <div class="grid2">
          <div class="field"><label>خط العرض</label><input class="input" id="sLat" value="${esc(s.lat ?? '')}" inputmode="decimal"></div>
          <div class="field"><label>خط الطول</label><input class="input" id="sLng" value="${esc(s.lng ?? '')}" inputmode="decimal"></div>
        </div>
        <div class="field"><label>نصف قطر النطاق المسموح (متر)</label><input class="input" id="sRad" value="${esc(s.radius ?? 300)}" inputmode="numeric"></div>
        <button class="btn ghost" id="useLoc">📍 استخدم موقعي الحالي (وأنا في الموقع)</button>
      </div>
      <div class="card"><h3>⏰ الدوام</h3>
        <div class="grid2">
          <div class="field"><label>بداية الدوام</label><input class="input" type="time" id="sShift" value="${esc(s.shiftStart || '07:00')}"></div>
          <div class="field"><label>سماحية التأخير (دقيقة)</label><input class="input" id="sGrace" value="${esc(s.grace ?? 15)}" inputmode="numeric"></div>
        </div>
        <div class="field"><label>أقصى دقة GPS مقبولة (متر)</label><input class="input" id="sAcc" value="${esc(s.maxAccuracy ?? 150)}" inputmode="numeric"></div>
        <label class="row" style="justify-content:flex-start;gap:10px"><input type="checkbox" id="sStrict" ${s.strictDevice !== false && s.strictDevice !== 'FALSE' ? 'checked' : ''} style="width:20px;height:20px"> ربط كل موظف بجهاز واحد (منع البصمة نيابةً عن الغير)</label>
      </div>
      <div class="card"><h3>🔐 تغيير رمز الدخول الخاص بك</h3>
        <input class="input" id="sPin" type="password" placeholder="اتركه فارغاً لعدم التغيير" inputmode="numeric">
      </div>
      <button class="btn ok" id="saveS">حفظ الإعدادات</button>
      <div class="card" style="margin-top:12px"><h3>📱 فك ربط جهاز موظف</h3>
        <p class="muted small" style="margin-top:0">استخدمه عند تغيير الموظف لهاتفه أو مسح بيانات المتصفح</p>
        <div class="btns"><input class="input" id="rId" placeholder="الرقم الوظيفي" inputmode="numeric"><button class="btn bad sm" id="rBtn">فك الربط</button></div>
      </div>
      <button class="btn ghost" data-close>إغلاق</button>`);
    $('#useLoc').onclick = () => {
      $('#useLoc').textContent = 'جاري تحديد الموقع…';
      navigator.geolocation.getCurrentPosition(p => {
        $('#sLat').value = p.coords.latitude.toFixed(6); $('#sLng').value = p.coords.longitude.toFixed(6);
        $('#useLoc').textContent = `✓ تم (دقة ± ${Math.round(p.coords.accuracy)} م)`;
      }, () => { $('#useLoc').textContent = 'تعذر تحديد الموقع'; }, { enableHighAccuracy: true, timeout: 20000 });
    };
    $('#saveS').onclick = async () => {
      const settings = {
        lat: $('#sLat').value.trim(), lng: $('#sLng').value.trim(), radius: $('#sRad').value.trim(),
        shiftStart: $('#sShift').value, grace: $('#sGrace').value.trim(), maxAccuracy: $('#sAcc').value.trim(),
        strictDevice: $('#sStrict').checked
      };
      const np = $('#sPin').value.trim();
      if (np) { if (!/^\d{6,12}$/.test(np)) return toast('الرمز يجب أن يكون من 6 إلى 12 رقماً', 'warn'); settings.newPin = np; }
      try {
        const r = await api('admin_save_settings', { pin: A.pin, settings });
        A.settings = r.settings || settings;
        if (np) { A.pin = np; sessionStorage.setItem('att_pin', np); }
        toast('تم حفظ الإعدادات ✓', 'ok'); closeSheet(); render();
      } catch (e) { toast(e.message, 'bad'); }
    };
    $('#rBtn').onclick = async () => {
      const id = $('#rId').value.trim(); if (!id) return;
      if (!confirm(`فك ربط جهاز الموظف ${id}؟ سيتمكن من الدخول من جهاز جديد.`)) return;
      try { const r = await api('admin_reset_device', { pin: A.pin, empId: id }); toast(r.removed ? 'تم فك الربط ✓' : 'لا يوجد جهاز مربوط بهذا الرقم', r.removed ? 'ok' : 'warn'); }
      catch (e) { toast(e.message, 'bad'); }
    };
  }
  $('#settingsBtn').onclick = settingsSheet;
  $('#setSiteBtn').onclick = settingsSheet;

  function openSheet(html) {
    $('#sheet').innerHTML = html; $('#overlay').classList.remove('hidden');
    $('#sheet').querySelectorAll('[data-close]').forEach(b => b.onclick = closeSheet);
  }
  function closeSheet() { $('#overlay').classList.add('hidden'); }
  $('#overlay').addEventListener('click', e => { if (e.target.id === 'overlay') closeSheet(); });
})();
