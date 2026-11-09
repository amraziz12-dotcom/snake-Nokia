/**
 * ============================================================
 *  نظام بصمة الحضور والانصراف — الخادم (Google Apps Script)
 *  فريق السلامة — كوبري المروة
 * ============================================================
 *  طريقة التركيب (تفصيلياً في README.md):
 *   1) أنشئ Google Sheet جديد ← Extensions ← Apps Script
 *   2) الصق هذا الملف كاملاً مكان Code.gs واحفظ
 *   3) شغّل الدالة setup مرة واحدة ووافق على الصلاحيات
 *   4) Deploy ← New deployment ← Web app
 *        Execute as: Me   |   Who has access: Anyone
 *   5) انسخ رابط Web app وضعه في config.js داخل API_URL
 * ============================================================
 */

const TZ = 'Asia/Riyadh';
const OPEN_SHIFT_HOURS = 20;          // بعدها يعتبر الحضور المفتوح منتهياً
const SH_EMP = 'الموظفين';
const SH_DEV = 'الأجهزة';
const SH_SET = 'الإعدادات';
const SH_ADM = 'المشرفين';          // من يحق له دخول لوحة المتابعة فقط
const SH_LOG = 'سجل دخول المشرفين';
const REC_PREFIX = 'سجل ';
const REC_HEADERS = ['التاريخ', 'الوقت', 'الرقم الوظيفي', 'اسم الموظف', 'القسم', 'النوع', 'داخل النطاق',
  'المسافة (م)', 'دقة GPS (م)', 'خط العرض', 'خط الطول', 'العنوان', 'الخريطة', 'الصورة',
  'مدة العمل (ساعة)', 'تأخير (دقيقة)', 'مزامنة لاحقة', 'معرف الجهاز', 'وقت الاستلام', 'PhotoID', 'TS'];

const DEFAULT_SETTINGS = [
  ['lat', '', 'خط عرض موقع المشروع (اتركه فارغاً لإلغاء التحقق من الموقع)'],
  ['lng', '', 'خط طول موقع المشروع'],
  ['radius', 300, 'نصف قطر النطاق المسموح بالمتر'],
  ['shiftStart', '07:00', 'بداية الدوام HH:mm'],
  ['grace', 15, 'سماحية التأخير بالدقائق'],
  ['maxAccuracy', 150, 'أقصى دقة GPS مقبولة بالمتر'],
  ['strictDevice', 'TRUE', 'ربط كل موظف بجهاز واحد TRUE/FALSE']
];

/* قائمة فريق العمل (من ملف Excel) — تُنسخ إلى ورقة الموظفين عند التهيئة */
const EMPLOYEES_SEED = [
  ["3054140", "حسن حسن علي ابكر", "السلامة - كوبري المروة", "كوبري المروة"],
  ["7016294", "موتلي شيخ", "السلامة - كوبري المروة", "كوبري المروة"],
  ["4028035", "عبد اللطيف علي السيد", "السلامة - كوبري المروة", "كوبري المروة"],
  ["9376685", "محمد خالد بازعزوع", "السلامة - كوبري المروة", "كوبري المروة"],
  ["9358724", "محمد خالد كابلي", "السلامة - كوبري المروة", "كوبري المروة"],
  ["3084458", "كمال شاكر محمد أحمد", "السلامة - كوبري المروة", "كوبري المروة"],
  ["4025574", "ياسر احمد خير الدين", "السلامة - كوبري المروة", "كوبري المروة"],
  ["9383962", "خالد الحيزون", "السلامة - كوبري المروة", "كوبري المروة"],
  ["9376678", "خالد عماد خان", "السلامة - كوبري المروة", "كوبري المروة"],
  ["9370083", "طارق حمدي هنيدي", "السلامة - كوبري المروة", "كوبري المروة"],
  ["7017453", "اشفاق ديلافار مولانى", "السلامة - كوبري المروة", "كوبري المروة"],
  ["9370391", "محمد مازن صبغة", "السلامة - كوبري المروة", "كوبري المروة"],
  ["7016289", "عبدالله خان", "السلامة - كوبري المروة", "كوبري المروة"],
  ["9383100", "احمد اشفاق", "السلامة - كوبري المروة", "كوبري المروة"],
  ["4014040", "محمد عمادالدين عبدالعزيز", "السلامة - كوبري المروة", "كوبري المروة"],
  ["3075247", "رضا حمدي شفيق السيد", "السلامة - كوبري المروة", "كوبري المروة"],
  ["3090389", "أيمن محمود محمد", "السلامة - كوبري المروة", "كوبري المروة"],
  ["7016134", "نواب خان", "السلامة - كوبري المروة", "كوبري المروة"],
  ["9326307", "قمر عباس محمد", "السلامة - كوبري المروة", "كوبري المروة"],
  ["9311108", "فيصل زمان", "السلامة - كوبري المروة", "كوبري المروة"],
  ["5012835", "بهاء الدين محمد حسن عطيه", "السلامة - كوبري المروة", "كوبري المروة"],
  ["5012936", "كريم خالد منسي سراج", "السلامة - كوبري المروة", "كوبري المروة"],
  ["5013233", "محمود محمد محمود محمد عبدالله", "السلامة - كوبري المروة", "كوبري المروة"],
  ["5013230", "سامي رمضان عبدالجليل الصيفي", "السلامة - كوبري المروة", "كوبري المروة"],
  ["5013231", "أنور عبدالله عبدالونيس عبدالله", "السلامة - كوبري المروة", "كوبري المروة"],
  ["8035233", "محمد ماهر محمود احمد", "السلامة - كوبري المروة", "كوبري المروة"],
  ["5014562", "احمد كمال الدين ابو شادي", "السلامة - كوبري المروة", "كوبري المروة"],
  ["5013440", "محمود محمد السيد عشري", "السلامة - كوبري المروة", "كوبري المروة"],
  ["5013232", "شريف صادق توفيق السحلي", "السلامة - كوبري المروة", "كوبري المروة"],
  ["5012834", "احمد زينهم محمد ابراهيم", "السلامة - كوبري المروة", "كوبري المروة"],
  ["5013401", "خليل احمد ابراهيم سوروي", "السلامة - كوبري المروة", "كوبري المروة"],
  ["5012838", "عبدالوهاب طارق عبدالوهاب عشماوي", "السلامة - كوبري المروة", "كوبري المروة"],
  ["5013870", "محمد احمد صبحي ابراهيم", "السلامة - كوبري المروة", "كوبري المروة"],
  ["5013911", "عبد الرحمن محمد محمود", "السلامة - كوبري المروة", "كوبري المروة"],
  ["5012921", "اسلام ممدوح محمد كمال عبدالباقي", "السلامة - كوبري المروة", "كوبري المروة"],
  ["5013586", "حسن احمد حسن حجاج", "السلامة - كوبري المروة", "كوبري المروة"],
  ["8086607", "على بلال على محمد هشهش", "السلامة - كوبري المروة", "كوبري المروة"],
  ["5013294", "عمرو عزيز حسن النحراوي", "السلامة - كوبري المروة", "كوبري المروة"],
  ["5013234", "جهاد عبدالمنعم حسن عبدالرحيم", "السلامة - كوبري المروة", "كوبري المروة"],
  ["5014602", "محمد ابوبكر عبدالواحد المسيري", "السلامة - كوبري المروة", "كوبري المروة"],
  ["5014052", "عبدالله محمد حامد اسماعيل", "السلامة - كوبري المروة", "كوبري المروة"],
  ["5014778", "محمود ايمن محمود محمد", "السلامة - كوبري المروة", "كوبري المروة"],
  ["5014607", "محمد محمد عبدالعزيز السيد", "السلامة - كوبري المروة", "كوبري المروة"],
  ["5013914", "عبدالرحمن جمال محمد", "السلامة - كوبري المروة", "كوبري المروة"],
  ["5013418", "عماد عبدالله عبدالونيس عبدالله", "السلامة - كوبري المروة", "كوبري المروة"],
  ["5012840", "محمد السيد أحمد قمر", "السلامة - كوبري المروة", "كوبري المروة"],
  ["5013934", "جابر عبد المنعم حسن", "السلامة - كوبري المروة", "كوبري المروة"],
  ["8035237", "عمر احمد محمد عبد الحميد", "السلامة - كوبري المروة", "كوبري المروة"],
  ["8035235", "يوسف صبري عبد الكريم", "السلامة - كوبري المروة", "كوبري المروة"],
  ["5013537", "احمد عبد الرحيم احمد عبدالرحيم", "السلامة - كوبري المروة", "كوبري المروة"],
  ["5013816", "مصطفى ابراهيم عمار", "السلامة - كوبري المروة", "كوبري المروة"],
  ["5014603", "محمد السيد سعد التمامى", "السلامة - كوبري المروة", "كوبري المروة"],
  ["8086620", "عمر محمد عيسى المعايطه", "السلامة - كوبري المروة", "كوبري المروة"],
  ["8086611", "عبد السلام محمد عبد الرزاق الجدواي", "السلامة - كوبري المروة", "كوبري المروة"],
  ["5013602", "حامد محمد حامد محمود", "السلامة - كوبري المروة", "كوبري المروة"],
  ["8014136", "احمد محمد علي محمد", "السلامة - كوبري المروة", "كوبري المروة"],
  ["5014475", "عبد العزيز صالح محمد العود", "السلامة - كوبري المروة", "كوبري المروة"],
  ["5014604", "احمد عزت ابوالفتح سليمان", "السلامة - كوبري المروة", "كوبري المروة"],
  ["5014570", "احمد كمال احمد محمد", "السلامة - كوبري المروة", "كوبري المروة"],
  ["8013467", "فيصل معين الدين سروي", "السلامة - كوبري المروة", "كوبري المروة"],
  ["5013698", "محمد نبيل الديب", "السلامة - كوبري المروة", "كوبري المروة"],
  ["5013953", "محمد سفراز محمد", "السلامة - كوبري المروة", "كوبري المروة"],
  ["5015174", "احمد حسام بركات", "السلامة - كوبري المروة", "كوبري المروة"],
  ["5014016", "اسامة مسعد سعيد", "السلامة - كوبري المروة", "كوبري المروة"],
  ["5014680", "كريم كرم حافظ عبد المنعم", "السلامة - كوبري المروة", "كوبري المروة"],
  ["5015171", "شريف محمد فتحي منصور", "السلامة - كوبري المروة", "كوبري المروة"],
  ["5013605", "احمد السعيد السعيد النجدي", "السلامة - كوبري المروة", "كوبري المروة"],
  ["5014017", "محمد حسين خليل الشافعي", "السلامة - كوبري المروة", "كوبري المروة"],
  ["8086622", "محمد محمد احمد يونس", "السلامة - كوبري المروة", "كوبري المروة"],
  ["8086612", "عبد الرحمن محمد أحمد الزلباني", "السلامة - كوبري المروة", "كوبري المروة"],
  ["8086616", "محمد صلاح أحمد حسن عبد الباسط", "السلامة - كوبري المروة", "كوبري المروة"],
  ["8086623", "محمود سعد احمد رزدق", "السلامة - كوبري المروة", "كوبري المروة"],
  ["5013614", "هشام يحي محمد", "السلامة - كوبري المروة", "كوبري المروة"],
  ["5014847", "علاء محمد ياقوت", "السلامة - كوبري المروة", "كوبري المروة"],
  ["8035230", "محمد اقبال نصار", "السلامة - كوبري المروة", "كوبري المروة"],
  ["5013811", "عبد الرحمن احمد بدوي", "السلامة - كوبري المروة", "كوبري المروة"],
  ["5012836", "صلاح عبدالعزيز مسعود أبو بكر", "السلامة - كوبري المروة", "كوبري المروة"],
  ["5013167", "محمد انور حسن عطية", "السلامة - كوبري المروة", "كوبري المروة"],
  ["5012918", "شادي عطيه السعداوي", "السلامة - كوبري المروة", "كوبري المروة"],
  ["8035234", "احمد محمد ابو الحمد", "السلامة - كوبري المروة", "كوبري المروة"],
  ["8086615", "محمد إبراهيم محمد الالفى", "السلامة - كوبري المروة", "كوبري المروة"],
  ["5014534", "احمد صلاح كامل", "السلامة - كوبري المروة", "كوبري المروة"],
  ["8086617", "احمد محمد السيد القاضى", "السلامة - كوبري المروة", "كوبري المروة"],
  ["8035236", "علاء الدين شعبان", "السلامة - كوبري المروة", "كوبري المروة"],
  ["5013820", "وائل عبد الناصر فهمي عبد الحميد", "السلامة - كوبري المروة", "كوبري المروة"],
  ["5014119", "محمد الشافعي الاحمدي", "السلامة - كوبري المروة", "كوبري المروة"],
  ["8035232", "محمد حسين ابراهيم حسين سليمان", "السلامة - كوبري المروة", "كوبري المروة"],
  ["8087900", "عمر حسين محمد عمر", "السلامة - كوبري المروة", "كوبري المروة"],
  ["8035274", "محمد توصيف شيخ", "السلامة - كوبري المروة", "كوبري المروة"],
  ["5013205", "مؤمن اسماعيل محمد محمد", "السلامة - كوبري المروة", "كوبري المروة"],
  ["5014032", "محمد متولي محمد المشد", "السلامة - كوبري المروة", "كوبري المروة"],
  ["8011847", "هشام الحسيني عثمان رجب", "السلامة - كوبري المروة", "كوبري المروة"],
  ["8015689", "احمد سعيد علي إبراهيم جمعة", "السلامة - كوبري المروة", "كوبري المروة"],
  ["5013285", "محمد النادي سالم بيلي سرحان", "السلامة - كوبري المروة", "كوبري المروة"],
  ["5013935", "احمد حماده اسماعيل", "السلامة - كوبري المروة", "كوبري المروة"],
  ["5015334", "محمد عبد الخلق عمر", "السلامة - كوبري المروة", "كوبري المروة"],
  ["8014137", "عمروعبد الرحيم", "السلامة - كوبري المروة", "كوبري المروة"],
  ["8011844", "محمد حامد محمد رضوان", "السلامة - كوبري المروة", "كوبري المروة"],
  ["5013149", "محمود علي حماد ابودوح", "السلامة - كوبري المروة", "كوبري المروة"],
  ["5013292", "حسام عبد الحميد محمد سليمان", "السلامة - كوبري المروة", "كوبري المروة"],
  ["8086606", "السيد ايمن السيد محمد", "السلامة - كوبري المروة", "كوبري المروة"],
  ["8011851", "محمد بدران حسين طالون", "السلامة - كوبري المروة", "كوبري المروة"],
  ["8011852", "احمد محمد راغب يونس", "السلامة - كوبري المروة", "كوبري المروة"],
  ["8086619", "عمر رجب عطيه عبد الحميد", "السلامة - كوبري المروة", "كوبري المروة"],
  ["5014565", "محمد حامد عبده يوسف", "السلامة - كوبري المروة", "كوبري المروة"],
  ["5012839", "محمود مجدي", "السلامة - كوبري المروة", "كوبري المروة"],
  ["8086621", "محمد عبدالله محمد العرضى", "السلامة - كوبري المروة", "كوبري المروة"],
  ["5014780", "محمود ابراهيم عبد الحميد غز", "السلامة - كوبري المروة", "كوبري المروة"],
  ["5014573", "محمد حسين عزيز السيد", "السلامة - كوبري المروة", "كوبري المروة"],
  ["5013855", "محمد مصطفى محمد حسن", "السلامة - كوبري المروة", "كوبري المروة"],
  ["5013604", "محمود احمد علي نورالدين", "السلامة - كوبري المروة", "كوبري المروة"],
  ["5013996", "مدحت محمد ربيع عبد الغفار", "السلامة - كوبري المروة", "كوبري المروة"],
  ["8035231", "احمد محمد ضياء الدين رجب اسماعيل", "السلامة - كوبري المروة", "كوبري المروة"],
  ["5014018", "طارق علي السيد حسن", "السلامة - كوبري المروة", "كوبري المروة"]
];

/* ======================= نقطة الدخول ======================= */
function doGet() {
  return out_({ ok: true, service: 'attendance', time: new Date().toISOString() });
}

function doPost(e) {
  let req;
  try { req = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (err) { return out_({ ok: false, error: 'طلب غير صالح' }); }
  try {
    const fn = ACTIONS[req.action];
    if (!fn) throw new Error('إجراء غير معروف');
    return out_(Object.assign({ ok: true }, fn(req)));
  } catch (err) {
    return out_({ ok: false, error: String((err && err.message) || err) });
  }
}

function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

const ACTIONS = {
  config: () => {
    const s = settings_();
    return { projectName: 'كوبري المروة', site: site_(s), maxAccuracy: +s.maxAccuracy || 150 };
  },
  login: login_,
  punch: punch_,
  history: history_,
  admin_login: r => {
    const a = checkPin_(r.pin);
    try { sheet_(SH_LOG).appendRow([fmt_(new Date(), 'yyyy-MM-dd HH:mm:ss'), a.name, a.role, String(r.ua || '').slice(0, 150)]); } catch (e) {}
    return { admin: a, settings: publicSettings_() };
  },
  admin_day: adminDay_,
  admin_photo: adminPhoto_,
  admin_reset_device: adminResetDevice_,
  admin_save_settings: adminSaveSettings_
};

/* ======================= أدوات ======================= */
function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }
function sheet_(name) {
  const sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('النظام غير مُهيأ — شغّل الدالة setup من محرر Apps Script');
  return sh;
}
const fmt_ = (d, p) => Utilities.formatDate(d, TZ, p);
const props_ = () => PropertiesService.getScriptProperties();

function settings_() {
  const c = CacheService.getScriptCache().get('settings');
  if (c) return JSON.parse(c);
  const vals = sheet_(SH_SET).getDataRange().getValues();
  const s = {};
  vals.slice(1).forEach(r => { if (r[0]) s[String(r[0]).trim()] = r[1]; });
  CacheService.getScriptCache().put('settings', JSON.stringify(s), 300);
  return s;
}

function publicSettings_() {
  const s = Object.assign({}, settings_());
  delete s.adminPin;
  s.strictDevice = String(s.strictDevice).toUpperCase() !== 'FALSE';
  if (s.shiftStart instanceof Date || /T/.test(String(s.shiftStart))) s.shiftStart = fmt_(new Date(s.shiftStart), 'HH:mm');
  return s;
}

function site_(s) {
  if (s.lat === '' || s.lng === '' || s.lat == null || isNaN(+s.lat) || isNaN(+s.lng)) return null;
  return { lat: +s.lat, lng: +s.lng, radius: +s.radius || 300 };
}

function employees_() {
  const cache = CacheService.getScriptCache();
  const c = cache.get('emps');
  if (c) return JSON.parse(c);
  const vals = sheet_(SH_EMP).getDataRange().getValues().slice(1);
  const list = vals.filter(r => r[0] !== '' && String(r[4]).toUpperCase() !== 'FALSE')
    .map(r => ({ id: String(r[0]).trim(), name: String(r[1]).trim(), dept: String(r[2]).trim(), location: String(r[3]).trim() }));
  cache.put('emps', JSON.stringify(list), 600);
  return list;
}

function findEmp_(id) {
  id = String(id || '').trim();
  const e = employees_().find(x => x.id === id);
  if (!e) throw new Error('الرقم الوظيفي غير موجود في قائمة فريق العمل');
  return e;
}

function distance_(a, b) {
  const R = 6371000, toR = x => x * Math.PI / 180;
  const dLat = toR(b.lat - a.lat), dLng = toR(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(s)));
}

function getLast_(empId) {
  const v = props_().getProperty('last_' + empId);
  return v ? JSON.parse(v) : null;
}

/* ---------- ربط الجهاز (منع البصمة نيابة عن الغير) ---------- */
function checkDevice_(empId, deviceId, ua) {
  if (!deviceId) throw new Error('معرف الجهاز مفقود');
  const strict = String(settings_().strictDevice).toUpperCase() !== 'FALSE';
  const sh = sheet_(SH_DEV);
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === empId) {
      if (String(data[i][1]) === deviceId || !strict) return;
      throw new Error('هذا الحساب مُفعّل على جهاز آخر. تواصل مع المشرف لفك الربط.');
    }
  }
  if (strict) {
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][1]) === deviceId && String(data[i][0]) !== empId)
        throw new Error('هذا الجهاز مسجل باسم موظف آخر (' + data[i][0] + '). لا يمكن البصمة لأكثر من موظف من نفس الجهاز.');
    }
  }
  const lock = LockService.getScriptLock(); lock.waitLock(15000);
  try { sh.appendRow([empId, deviceId, fmt_(new Date(), 'yyyy-MM-dd HH:mm'), String(ua || '').slice(0, 200)]); }
  finally { lock.releaseLock(); }
}

/* ---------- سجلات الشهر ---------- */
function recSheet_(date, create) {
  const name = REC_PREFIX + fmt_(date, 'yyyy-MM');
  let sh = ss_().getSheetByName(name);
  if (!sh && create) {
    sh = ss_().insertSheet(name, 0);
    sh.appendRow(REC_HEADERS);
    sh.getRange(1, 1, 1, REC_HEADERS.length).setFontWeight('bold').setBackground('#0b1220').setFontColor('#ffffff');
    sh.setFrozenRows(1);
    sh.setRightToLeft(true);
    sh.getRange('A:C').setNumberFormat('@');
    sh.hideColumns(18, 4);
  }
  return sh;
}

function rowToRec_(r) {
  return {
    date: String(r[0]), time: String(r[1]), empId: String(r[2]), name: r[3], dept: r[4],
    type: r[5] === 'حضور' ? 'IN' : 'OUT',
    inRange: r[6] === 'نعم' ? true : (r[6] === 'لا' ? false : ''),
    distance: r[7], acc: r[8], lat: r[9], lng: r[10], address: r[11],
    duration: r[14], late: r[15], offline: r[16] === 'نعم', photoId: r[19], ts: +r[20]
  };
}

function readRecs_(date, filterFn) {
  const sh = recSheet_(date, false);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, REC_HEADERS.length).getValues().filter(filterFn).map(rowToRec_);
}

/* ---------- مجلد الصور ---------- */
function rootFolder_() {
  const id = props_().getProperty('PHOTO_FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  const f = DriveApp.createFolder('صور بصمة الحضور — كوبري المروة');
  props_().setProperty('PHOTO_FOLDER_ID', f.getId());
  return f;
}
function dayFolder_(dateStr) {
  const root = rootFolder_();
  const it = root.getFoldersByName(dateStr);
  return it.hasNext() ? it.next() : root.createFolder(dateStr);
}

/* ======================= الإجراءات ======================= */
function login_(r) {
  const emp = findEmp_(r.empId);
  checkDevice_(emp.id, r.deviceId, r.ua);
  const today = fmt_(new Date(), 'yyyy-MM-dd');
  return {
    employee: emp,
    last: getLast_(emp.id),
    site: site_(settings_()),
    today: readRecs_(new Date(), x => String(x[2]) === emp.id && String(x[0]) === today)
  };
}

function punch_(r) {
  const emp = findEmp_(r.empId);
  checkDevice_(emp.id, r.deviceId, r.ua);
  const S = settings_();
  if (r.type !== 'IN' && r.type !== 'OUT') throw new Error('نوع البصمة غير صالح');
  const lat = +r.lat, lng = +r.lng, acc = Math.round(+r.acc || 0);
  if (!isFinite(lat) || !isFinite(lng) || (lat === 0 && lng === 0)) throw new Error('الموقع مطلوب لتسجيل البصمة');

  const m = String(r.photo || '').match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
  if (!m) throw new Error('الصورة مطلوبة لتسجيل البصمة');
  if (m[2].length > 4 * 1024 * 1024) throw new Error('حجم الصورة كبير جداً');

  const now = new Date();
  let when = now, offline = false;
  if (r.offline && r.clientTime) {
    const ct = new Date(r.clientTime);
    if (!isNaN(ct) && ct.getTime() <= now.getTime() + 5 * 60e3 && now.getTime() - ct.getTime() < 72 * 3600e3) { when = ct; offline = true; }
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const last = getLast_(emp.id);
    const open = last && last.t === 'IN' && when.getTime() >= last.ts && when.getTime() - last.ts < OPEN_SHIFT_HOURS * 3600e3;
    const expected = open ? 'OUT' : 'IN';
    if (r.type !== expected) {
      throw new Error(r.type === 'IN' ? 'أنت مسجل حضور بالفعل — سجّل الانصراف أولاً' : 'لا يوجد تسجيل حضور مفتوح — سجّل الحضور أولاً');
    }

    const site = site_(S);
    const dist = site ? distance_(site, { lat, lng }) : '';
    const inRange = site ? dist <= site.radius : '';

    let address = '';
    try {
      const g = Maps.newGeocoder().setLanguage('ar').reverseGeocode(lat, lng);
      if (g && g.results && g.results.length) address = g.results[0].formatted_address;
    } catch (e) {}

    const dateStr = fmt_(when, 'yyyy-MM-dd'), timeStr = fmt_(when, 'HH:mm:ss');
    const blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1],
      emp.id + '_' + (r.type === 'IN' ? 'حضور' : 'انصراف') + '_' + fmt_(when, 'yyyyMMdd_HHmmss') + '.jpg');
    const file = dayFolder_(dateStr).createFile(blob);
    file.setDescription(emp.name + ' | ' + lat + ',' + lng);

    const duration = r.type === 'OUT' && last ? Math.round((when.getTime() - last.ts) / 36e3) / 100 : '';
    let late = 0;
    if (r.type === 'IN') {
      const ss = String(S.shiftStart instanceof Date ? fmt_(S.shiftStart, 'HH:mm') : S.shiftStart || '07:00').split(':').map(Number);
      const mins = (+fmt_(when, 'H')) * 60 + (+fmt_(when, 'm')) - (ss[0] * 60 + (ss[1] || 0));
      if (mins > (+S.grace || 0) && mins < 360) late = mins;
    }

    const mapUrl = 'https://maps.google.com/?q=' + lat + ',' + lng;
    const row = [dateStr, timeStr, emp.id, emp.name, emp.dept, r.type === 'IN' ? 'حضور' : 'انصراف',
      site ? (inRange ? 'نعم' : 'لا') : '', dist, acc, lat, lng, address, mapUrl, file.getUrl(),
      duration, late || '', offline ? 'نعم' : '', String(r.deviceId).slice(0, 40), fmt_(now, 'yyyy-MM-dd HH:mm:ss'),
      file.getId(), when.getTime()];
    const sh = recSheet_(when, true);
    sh.appendRow(row);
    const lr = sh.getLastRow();
    if (site && !inRange) sh.getRange(lr, 1, 1, 17).setBackground('#fde2e2');
    else if (late) sh.getRange(lr, 1, 1, 17).setBackground('#fff4d6');

    const newLast = { t: r.type, ts: when.getTime() };
    if (!last || when.getTime() >= last.ts) props_().setProperty('last_' + emp.id, JSON.stringify(newLast));

    return { record: rowToRec_(row), last: newLast };
  } finally {
    lock.releaseLock();
  }
}

function history_(r) {
  const emp = findEmp_(r.empId);
  checkDevice_(emp.id, r.deviceId, r.ua);
  const now = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 15);
  const f = x => String(x[2]) === emp.id;
  const recs = readRecs_(now, f).concat(readRecs_(prev, f)).sort((a, b) => b.ts - a.ts).slice(0, 80);
  return { records: recs };
}

/* ---------- المشرف ---------- */
/* ---------- صلاحية الدخول: المدير والمسؤول الإداري فقط ---------- */
function admins_() {
  return sheet_(SH_ADM).getDataRange().getValues().slice(1)
    .map((r, i) => ({ row: i + 2, name: String(r[0]).trim(), role: String(r[1]).trim(), pin: String(r[2]).trim(), active: String(r[3]).toUpperCase() !== 'FALSE' }))
    .filter(a => a.name && a.pin);
}

function checkPin_(pin) {
  const cache = CacheService.getScriptCache();
  const fails = +(cache.get('pinFails') || 0);
  if (fails >= 10) throw new Error('محاولات كثيرة خاطئة — حاول بعد 10 دقائق');
  pin = String(pin || '').trim();
  const a = pin.length >= 4 ? admins_().find(x => x.active && x.pin === pin) : null;
  if (!a) {
    cache.put('pinFails', String(fails + 1), 600);
    throw new Error('غير مصرح — لوحة المتابعة للمدير والمسؤول الإداري فقط');
  }
  return { name: a.name, role: a.role, row: a.row };
}

function randomPin_() { return String(Math.floor(100000 + Math.random() * 900000)); }

function adminDay_(r) {
  checkPin_(r.pin);
  const d = String(r.date || fmt_(new Date(), 'yyyy-MM-dd'));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error('تاريخ غير صالح');
  const date = new Date(d + 'T12:00:00');
  return {
    employees: employees_(),
    records: readRecs_(date, x => String(x[0]) === d),
    settings: publicSettings_()
  };
}

function adminPhoto_(r) {
  checkPin_(r.pin);
  const file = DriveApp.getFileById(String(r.fileId || ''));
  // أمان: السماح فقط بصور مجلد البصمة
  const rootId = rootFolder_().getId();
  const day = file.getParents();
  let allowed = false;
  while (day.hasNext()) {
    const p = day.next().getParents();
    while (p.hasNext()) if (p.next().getId() === rootId) allowed = true;
  }
  if (!allowed) throw new Error('غير مسموح');
  const blob = file.getBlob();
  return { dataUrl: 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes()), url: file.getUrl() };
}

function adminResetDevice_(r) {
  checkPin_(r.pin);
  const id = String(r.empId || '').trim();
  const sh = sheet_(SH_DEV);
  const data = sh.getDataRange().getValues();
  let removed = 0;
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]) === id) { sh.deleteRow(i + 1); removed++; }
  }
  return { removed };
}

function adminSaveSettings_(r) {
  const me = checkPin_(r.pin);
  const inS = r.settings || {};
  const allowed = { lat: 1, lng: 1, radius: 1, shiftStart: 1, grace: 1, maxAccuracy: 1, strictDevice: 1 };
  const upd = {};
  Object.keys(inS).forEach(k => { if (allowed[k]) upd[k] = inS[k]; });
  if (upd.strictDevice !== undefined) upd.strictDevice = upd.strictDevice === true || String(upd.strictDevice).toUpperCase() === 'TRUE' ? 'TRUE' : 'FALSE';
  if (inS.newPin) {
    const np = String(inS.newPin);
    if (!/^\d{6,12}$/.test(np)) throw new Error('الرمز يجب أن يكون من 6 إلى 12 رقماً');
    if (admins_().some(x => x.pin === np && x.row !== me.row)) throw new Error('هذا الرمز غير متاح — اختر رمزاً آخر');
    sheet_(SH_ADM).getRange(me.row, 3).setValue(np);   // يغيّر رمز المشرف الحالي فقط
  }
  ['lat', 'lng'].forEach(k => { if (upd[k] !== undefined && upd[k] !== '' && isNaN(+upd[k])) throw new Error('إحداثيات غير صالحة'); });
  const sh = sheet_(SH_SET);
  const vals = sh.getDataRange().getValues();
  Object.keys(upd).forEach(k => {
    let row = vals.findIndex((x, i) => i > 0 && String(x[0]) === k);
    if (row < 0) { sh.appendRow([k, upd[k], '']); }
    else sh.getRange(row + 1, 2).setValue(upd[k]);
  });
  CacheService.getScriptCache().remove('settings');
  return { settings: publicSettings_() };
}

/* ======================= التهيئة ======================= */
function setup() {
  const ss = ss_();
  ss.setSpreadsheetTimeZone(TZ);

  let emp = ss.getSheetByName(SH_EMP);
  if (!emp) {
    emp = ss.insertSheet(SH_EMP);
    emp.appendRow(['الرقم الوظيفي', 'اسم الموظف', 'القسم', 'الموقع', 'نشط']);
    emp.getRange('A:A').setNumberFormat('@');
    const rows = EMPLOYEES_SEED.map(e => [e[0], e[1], e[2], e[3], 'TRUE']);
    emp.getRange(2, 1, rows.length, 5).setValues(rows);
    emp.getRange(1, 1, 1, 5).setFontWeight('bold').setBackground('#0b1220').setFontColor('#ffffff');
    emp.setFrozenRows(1); emp.setRightToLeft(true); emp.autoResizeColumns(1, 5);
  }

  let dev = ss.getSheetByName(SH_DEV);
  if (!dev) {
    dev = ss.insertSheet(SH_DEV);
    dev.appendRow(['الرقم الوظيفي', 'معرف الجهاز', 'تاريخ الربط', 'نوع الجهاز']);
    dev.getRange(1, 1, 1, 4).setFontWeight('bold');
    dev.getRange('A:A').setNumberFormat('@');
    dev.setFrozenRows(1); dev.setRightToLeft(true);
  }

  let set = ss.getSheetByName(SH_SET);
  if (!set) {
    set = ss.insertSheet(SH_SET);
    set.appendRow(['المفتاح', 'القيمة', 'الوصف']);
    set.getRange('B:B').setNumberFormat('@');
    set.getRange(2, 1, DEFAULT_SETTINGS.length, 3).setValues(DEFAULT_SETTINGS.map(r => [r[0], String(r[1]), r[2]]));
    set.getRange(1, 1, 1, 3).setFontWeight('bold');
    set.setFrozenRows(1); set.setRightToLeft(true); set.autoResizeColumns(1, 3);
  }

  let adm = ss.getSheetByName(SH_ADM);
  if (!adm) {
    adm = ss.insertSheet(SH_ADM);
    adm.appendRow(['الاسم', 'الصفة', 'رمز الدخول', 'نشط']);
    adm.getRange('C:C').setNumberFormat('@');
    adm.getRange(2, 1, 2, 4).setValues([
      ['المدير', 'مدير المشروع', randomPin_(), 'TRUE'],
      ['المسؤول الإداري', 'مسؤول إداري', randomPin_(), 'TRUE']
    ]);
    adm.getRange(1, 1, 1, 4).setFontWeight('bold').setBackground('#7f1d1d').setFontColor('#ffffff');
    adm.setFrozenRows(1); adm.setRightToLeft(true); adm.autoResizeColumns(1, 4);
    adm.getRange('E1').setValue('⚠️ سرّي — اكتب الاسم الحقيقي لكل منهما، وأعط كل واحد رمزه فقط. لا تشارك هذه الورقة مع أحد.');
    adm.protect().setDescription('المشرفين — المالك فقط').setWarningOnly(true);
  }

  let lg = ss.getSheetByName(SH_LOG);
  if (!lg) {
    lg = ss.insertSheet(SH_LOG);
    lg.appendRow(['الوقت', 'الاسم', 'الصفة', 'الجهاز']);
    lg.getRange(1, 1, 1, 4).setFontWeight('bold');
    lg.setFrozenRows(1); lg.setRightToLeft(true);
  }

  const def = ss.getSheetByName('Sheet1') || ss.getSheetByName('ورقة1');
  if (def && ss.getSheets().length > 1 && def.getLastRow() === 0) ss.deleteSheet(def);

  recSheet_(new Date(), true);
  rootFolder_();
  // تفعيل صلاحية الخرائط (للعنوان)
  try { Maps.newGeocoder().reverseGeocode(21.5, 39.2); } catch (e) {}
  CacheService.getScriptCache().removeAll(['settings', 'emps']);
  admins_().forEach(a => Logger.log('🔐 ' + a.name + ' — رمز الدخول: ' + a.pin));
  Logger.log('✓ تمت التهيئة. رموز الدخول موجودة في ورقة «المشرفين». الآن: Deploy ← New deployment ← Web app');
}

/** شغّلها بعد تعديل ورقة الموظفين لتحديث القائمة فوراً */
function refreshCache() { CacheService.getScriptCache().removeAll(['settings', 'emps']); }

function onOpen() {
  SpreadsheetApp.getUi().createMenu('🕒 نظام الحضور')
    .addItem('تهيئة النظام (مرة واحدة)', 'setup')
    .addItem('تحديث بعد تعديل الموظفين/الإعدادات', 'refreshCache')
    .addToUi();
}
