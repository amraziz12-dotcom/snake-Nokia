/* أدوات مشتركة بين تطبيق الموظف ولوحة المشرف */
(function () {
  const CFG = window.APP_CONFIG || {};
  const DEMO = !CFG.API_URL;

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} }
  };

  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  function deviceId() {
    let id = store.get('att_device');
    if (!id) { id = uuid(); store.set('att_device', id); }
    return id;
  }

  class NetError extends Error {}

  async function api(action, payload = {}) {
    if (DEMO) return window.DemoAPI(action, payload);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 45000);
    let res;
    try {
      // text/plain يتجنب طلب CORS المسبق مع Google Apps Script
      res = await fetch(CFG.API_URL, {
        method: 'POST',
        body: JSON.stringify(Object.assign({ action }, payload)),
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        redirect: 'follow',
        signal: ctrl.signal
      });
    } catch (e) {
      throw new NetError('تعذر الاتصال بالخادم — تحقق من الإنترنت');
    } finally { clearTimeout(timer); }
    let j;
    try { j = await res.json(); } catch (e) { throw new NetError('رد غير صالح من الخادم'); }
    if (!j.ok) throw new Error(j.error || 'حدث خطأ');
    return j;
  }

  function haversine(a, b) {
    const R = 6371000, toR = x => x * Math.PI / 180;
    const dLat = toR(b.lat - a.lat), dLng = toR(b.lng - a.lng);
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
    return Math.round(2 * R * Math.asin(Math.sqrt(s)));
  }

  const pad = n => String(n).padStart(2, '0');
  const fmtTime = d => { d = new Date(d); let h = d.getHours(), m = pad(d.getMinutes()); const ap = h >= 12 ? 'م' : 'ص'; h = h % 12 || 12; return `${h}:${m} ${ap}`; };
  const fmtDate = d => new Date(d).toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const isoDate = d => { d = new Date(d); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const fmtDist = m => m == null || m === '' ? '—' : (m >= 1000 ? (m / 1000).toFixed(1) + ' كم' : m + ' م');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function toast(msg, type = 'info', ms = 3500) {
    let box = document.getElementById('toasts');
    if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.appendChild(box); }
    const t = document.createElement('div');
    t.className = 'toast ' + type; t.textContent = msg;
    box.appendChild(t);
    setTimeout(() => { t.classList.add('hide'); setTimeout(() => t.remove(), 400); }, ms);
  }

  function vibrate(p) { try { navigator.vibrate && navigator.vibrate(p); } catch (e) {} }

  /* ---------------- وضع التجربة (بدون خادم) ---------------- */
  window.DemoAPI = async function (action, p) {
    await new Promise(r => setTimeout(r, 450));
    const emps = (window.EMPLOYEES || []).map(e => ({ id: e[0], name: e[1], dept: e[2], location: e[3] }));
    const recs = store.get('att_demo_records', []);
    const settings = Object.assign({ lat: '', lng: '', radius: 300, shiftStart: '07:00', grace: 15, maxAccuracy: 150, strictDevice: true }, store.get('att_demo_settings', {}));
    const site = settings.lat !== '' && settings.lat != null ? { lat: +settings.lat, lng: +settings.lng, radius: +settings.radius } : (CFG.SITE || null);
    const find = id => emps.find(e => e.id === String(id).trim());
    const lastOf = id => recs.filter(r => r.empId === id).sort((a, b) => b.ts - a.ts)[0] || null;
    const checkPin = () => { if (String(p.pin) !== String(store.get('att_demo_pin', '1234'))) throw new Error('رمز المشرف غير صحيح'); };

    switch (action) {
      case 'config': return { ok: true, projectName: CFG.PROJECT_NAME, site, maxAccuracy: settings.maxAccuracy, demo: true };
      case 'login': {
        const e = find(p.empId); if (!e) throw new Error('الرقم الوظيفي غير موجود في قائمة فريق العمل');
        const l = lastOf(e.id);
        return { ok: true, employee: e, last: l ? { t: l.type, ts: l.ts } : null, site, today: recs.filter(r => r.empId === e.id && r.date === isoDate(Date.now())) };
      }
      case 'punch': {
        const e = find(p.empId); if (!e) throw new Error('موظف غير معروف');
        const when = p.offline && p.clientTime ? new Date(p.clientTime) : new Date();
        const l = lastOf(e.id);
        const expected = l && l.type === 'IN' && when - l.ts < (CFG.OPEN_SHIFT_HOURS || 20) * 3600e3 ? 'OUT' : 'IN';
        if (p.type !== expected) throw new Error(p.type === 'IN' ? 'أنت مسجل حضور بالفعل — سجّل الانصراف أولاً' : 'لا يوجد حضور مفتوح — سجّل الحضور أولاً');
        const dist = site ? haversine(site, { lat: p.lat, lng: p.lng }) : '';
        const [sh, sm] = String(settings.shiftStart).split(':').map(Number);
        const mins = when.getHours() * 60 + when.getMinutes() - (sh * 60 + sm);
        const r = {
          empId: e.id, name: e.name, dept: e.dept, type: p.type, ts: when.getTime(), date: isoDate(when),
          time: `${pad(when.getHours())}:${pad(when.getMinutes())}`, lat: p.lat, lng: p.lng, acc: p.acc,
          distance: dist, inRange: site ? dist <= site.radius : '', address: '', offline: !!p.offline,
          duration: p.type === 'OUT' && l ? +((when - l.ts) / 3600e3).toFixed(2) : '',
          late: p.type === 'IN' && mins > settings.grace && mins < 360 ? mins : 0,
          photo: p.photoThumb || '', photoId: String(when.getTime()) + e.id
        };
        recs.push(r);
        if (!store.set('att_demo_records', recs)) { r.photo = ''; recs.forEach(x => x.photo = ''); store.set('att_demo_records', recs); }
        return { ok: true, record: r, last: { t: r.type, ts: r.ts } };
      }
      case 'history': return { ok: true, records: recs.filter(r => r.empId === String(p.empId)).sort((a, b) => b.ts - a.ts).slice(0, 60) };
      case 'admin_login': checkPin(); return { ok: true, settings, demo: true };
      case 'admin_day': checkPin(); return { ok: true, employees: emps, records: recs.filter(r => r.date === p.date), settings };
      case 'admin_photo': {
        checkPin(); const r = recs.find(x => x.photoId === p.fileId);
        if (!r || !r.photo) throw new Error('الصورة غير محفوظة في وضع التجربة'); return { ok: true, dataUrl: r.photo };
      }
      case 'admin_reset_device': checkPin(); return { ok: true, removed: 1 };
      case 'admin_save_settings': {
        checkPin(); const s = Object.assign({}, settings, p.settings);
        if (p.settings.newPin) { store.set('att_demo_pin', p.settings.newPin); delete s.newPin; }
        store.set('att_demo_settings', s); return { ok: true, settings: s };
      }
    }
    throw new Error('إجراء غير معروف');
  };

  window.Att = { CFG, DEMO, store, deviceId, api, NetError, haversine, fmtTime, fmtDate, isoDate, fmtDist, esc, toast, vibrate, pad };

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
})();
