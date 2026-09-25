/* ==================================================
   Escort 示範後端（純 Node.js，零套件依賴）
   啟動：node server.js  →  http://localhost:3000
   功能：靜態頁面伺服 + 多資源 REST API + JSON 持久化 + Session 認證
   資料檔：data/*.json（members / bookings / messages / reviews / reports / settings）
           首次啟動自動由種子資料建立，所有資料皆為示範用 Placeholder
   ================================================== */
'use strict';

var http = require('http');
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var os = require('os');

var PORT = Number(process.env.PORT) || 3000;
var ROOT = __dirname;

/* ---------- 雲端部署用的路徑覆寫 ----------
   有些平台（如 Render / Fly.io）可掛載持久化磁碟；
   只要有掛載，就用環境變數指向它，資料才不會在重新部署時消失。
   例：DATA_DIR=/var/data/data  UPLOAD_DIR=/var/data/uploads */
var DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');

/* ---------- 圖片上傳設定 ---------- */
var UPLOAD_DIR = process.env.UPLOAD_DIR ? path.resolve(process.env.UPLOAD_DIR) : path.join(ROOT, 'uploads');
var UPLOADS_URL = '/uploads/';
var MAX_UPLOAD_BYTES = 3 * 1024 * 1024;            /* 單張圖片上限 3MB（解碼後） */
var MAX_BODY_BYTES = 6 * 1024 * 1024;              /* 上傳請求 body 上限（base64 會膨脹約 1.33 倍） */
var MAX_MEMBER_IMAGES = 4;                         /* 成員照片上限（前台相片牆 4 格） */
var MAX_REVIEW_IMAGES = 3;                         /* 評價圖片上限 */
var IMAGE_EXT = { png: 'png', jpeg: 'jpg', gif: 'gif', webp: 'webp' };

/* ---------- 分享模式（把站台暫時開給他人試用／觀看時使用） ----------
   啟動方式：SHARE_MODE=1 node server.js
   開啟後僅保留前台功能（瀏覽列表、詳情、預約、訊息、評價、檢舉），
   所有後台管理端點與 admin.html 一律停用，避免對外暴露管理權限。 */
var SHARE_MODE = !!(process.env.SHARE_MODE && process.env.SHARE_MODE !== '0' && process.env.SHARE_MODE !== 'false');

var CITIES = ['台北市', '新北市', '桃園市', '新竹市', '台中市', '台南市', '高雄市', '宜蘭縣', '花蓮縣'];
var MEMBER_STATUSES = ['on', 'pending', 'off'];
var BOOKING_STATUSES = ['pending', 'confirmed', 'done', 'cancelled'];
var MESSAGE_STATUSES = ['unread', 'read', 'replied'];
var REVIEW_STATUSES = ['pending', 'on', 'off'];   /* on = 已審核通過並顯示 */
var REPORT_STATUSES = ['open', 'resolved', 'dismissed'];

var SERVICE_OPTIONS = ['陪伴用餐', '聊天談心', '唱歌同樂', '追劇時光', '出遊同行', '拍照留念', '咖啡小酌', '桌遊互動', '夜間陪伴', '旅遊規劃'];
var ADDON_OPTIONS = ['按摩舒壓', '電玩同樂', '逛街陪同', '逛展同遊', '角色扮演', '造型建議', '語言練習', '運動同樂', '深夜談心', '節日驚喜', '深夜食堂', '小酌聊天', '假期出遊', '旅拍跟拍', '活動陪伴', '演唱會同行'];
var PLAN_OPTIONS = ['方案 A／50 分鐘', '方案 B／100 分鐘', '方案 C／200 分鐘（加贈優惠）'];

/* ---------- 時間工具 ---------- */
function pad2(n) { return (n < 10 ? '0' : '') + n; }

function stamp(offsetMinutes) {
  var d = new Date(Date.now() + (offsetMinutes || 0) * 60000);
  return pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

function dateLabel(offsetDays) {
  var d = new Date(Date.now() + (offsetDays || 0) * 86400000);
  var suffix = offsetDays === 0 ? '（今天）' : offsetDays === 1 ? '（明天）' : '';
  return pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + suffix;
}

function todayKey() {
  var d = new Date();
  return pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

/* ---------- 圖片產生器（Placeholder） ---------- */
function avatarFor(name) {
  return 'https://placehold.co/72x72/2b2b36/f4f4f7/png?text=' + encodeURIComponent(String(name || '?').charAt(0));
}

function imgFor(name, n) {
  return 'https://placehold.co/600x800/2b2b36/565660/png?text=' + encodeURIComponent(String(name || '?')) + (n ? '+' + n : '');
}

function rotate(list, start, count) {
  var out = [];
  for (var i = 0; i < count; i++) out.push(list[(start + i) % list.length]);
  return out;
}

function buildSlots() {
  return [
    { date: dateLabel(0), time: '16:00~02:00', open: true },
    { date: dateLabel(1), time: '18:00~02:00', open: true },
    { date: dateLabel(2), time: '20:00~02:00', open: false }
  ];
}

/* ---------- 成員種子資料 ----------
   [編號, 暱稱, 年齡, 地區, 類型, 底價, 狀態, 更新時間, 標籤, 國旗, 國別, 身高, 體重, 罩杯, 自我介紹] */
var MEMBER_BASE = [
  ['A1024', 'Kiki', 22, '台北市', '外送', 4000, 'on', '09-21 14:02', ['白人', '三通', '過夜'], '🇺🇸', '美國', 161, 46, 'C', '喜歡旅行與美食，個性直率好聊，第一次見面也不尷尬，歡迎聊聊你想安排的行程。'],
  ['A1031', 'Yuki', 24, '新北市', '定點', 3500, 'on', '09-21 11:47', ['日系', '甜美', '可預約'], '🇯🇵', '日本', 158, 44, 'B', '講話慢慢的、喜歡聽人說話，擅長陪伴吃飯與逛街，時間安排彈性好配合。'],
  ['A1046', 'Anna', 26, '台中市', '外送', 5000, 'pending', '09-20 22:31', ['俄系', '高挑', '不限時'], '🇷🇺', '俄羅斯', 170, 50, 'C', '高挑的身材、喜歡戶外活動，能陪你跑一整天行程，也很好聊。'],
  ['A1052', '小嵐', 23, '台北市', '定點', 3000, 'on', '09-20 18:05', ['氣質', '溫柔', '兼職'], '🇹🇼', '台灣', 165, 48, 'D', '氣質型、講話溫柔，喜歡看展與喝咖啡，臨時預約也可以問問看。'],
  ['A1067', 'Mina', 27, '高雄市', '外送', 4500, 'off', '09-19 20:14', ['韓系', '魅惑', '過夜'], '🇰🇷', '韓國', 163, 47, 'C', '韓系打扮、喜歡唱歌，唱歌好聽是招牌，週末時間較滿建議提早預約。'],
  ['A1071', 'Luna', 25, '桃園市', '定點', 3800, 'on', '09-19 16:40', ['混血', '活潑', '旅伴'], '🇬🇧', '英國', 168, 49, 'C', '混血外型、個性活潑，喜歡旅行與拍照，能當你的旅伴與攝影幫手。'],
  ['A1088', 'Nikki', 22, '台南市', '外送', 4200, 'pending', '09-18 21:22', ['混血', '甜美', '兼職'], '🇹🇭', '泰國', 160, 45, 'B', '甜美可愛，喜歡桌遊與追劇，初次見面會害羞但很快就熟了。'],
  ['A1093', '米娜', 28, '台中市', '定點', 5500, 'off', '09-17 15:03', ['氣質', '高挑', '過夜'], '🇸🇬', '新加坡', 172, 52, 'E', '氣質高挑、談吐穩重，適合正式場合陪同與商務聚餐。']
];

function buildMemberSeed() {
  return MEMBER_BASE.map(function (r, i) {
    var name = r[1];
    return {
      id: r[0], name: name, age: r[2], city: r[3], type: r[4], price: r[5],
      status: r[6], updated: r[7], tags: r[8], flag: r[9], flagName: r[10],
      height: r[11], weight: r[12], cup: r[13], intro: r[14],
      views: 180 + i * 63,
      avatar: avatarFor(name), img: imgFor(name),
      images: [1, 2, 3, 4].map(function (n) { return imgFor(name, n); }),
      services: rotate(SERVICE_OPTIONS, i, 8),
      addons: rotate(ADDON_OPTIONS, i * 2, 12),
      slots: buildSlots()
    };
  });
}

/* ---------- 預約種子資料 ---------- */
function buildBookingSeed() {
  return [
    { id: 'B2001', memberId: 'A1024', memberName: 'Kiki', plan: PLAN_OPTIONS[0], price: 4000, date: dateLabel(0), time: '16:00~02:00', contact: 'line: demo_user1', note: '第一次預約，麻煩準時', status: 'pending', createdAt: stamp(-150) },
    { id: 'B2002', memberId: 'A1031', memberName: 'Yuki', plan: PLAN_OPTIONS[1], price: 7000, date: dateLabel(1), time: '18:00~02:00', contact: 'phone: 0912-345-678', note: '', status: 'confirmed', createdAt: stamp(-420) },
    { id: 'B2003', memberId: 'A1052', memberName: '小嵐', plan: PLAN_OPTIONS[0], price: 3000, date: dateLabel(0), time: '20:00~02:00', contact: 'line: kai_77', note: '想在信義區碰面', status: 'pending', createdAt: stamp(-60) },
    { id: 'B2004', memberId: 'A1071', memberName: 'Luna', plan: PLAN_OPTIONS[2], price: 11000, date: dateLabel(-2), time: '16:00~02:00', contact: 'line: traveller_lin', note: '一日旅伴行程', status: 'done', createdAt: stamp(-1600) },
    { id: 'B2005', memberId: 'A1031', memberName: 'Yuki', plan: PLAN_OPTIONS[0], price: 3500, date: dateLabel(-3), time: '18:00~02:00', contact: 'phone: 0987-654-321', note: '臨時有事取消', status: 'cancelled', createdAt: stamp(-2100) }
  ];
}

/* ---------- 客服訊息種子資料 ---------- */
function buildMessageSeed() {
  return [
    { id: 'M3001', name: '小林', contact: 'line: xiaolin88', memberId: 'A1024', memberName: 'Kiki', body: '想請問今天 16:00 還有空檔嗎？', status: 'unread', reply: '', createdAt: stamp(-25) },
    { id: 'M3002', name: '阿宏', contact: 'phone: 0933-221-100', memberId: '', memberName: '', body: '方案 C 的加贈優惠是送什麼？想了解一下。', status: 'unread', reply: '', createdAt: stamp(-95) },
    { id: 'M3003', name: 'Kevin', contact: 'line: kevin_h', memberId: 'A1071', memberName: 'Luna', body: '想預約週末兩天，請問可以安排嗎？', status: 'read', reply: '', createdAt: stamp(-300) },
    { id: 'M3004', name: '小美', contact: 'line: mei_2024', memberId: '', memberName: '', body: '請問要怎麼成為貴平台的合作對象？', status: 'replied', reply: '你好，請加官方 LINE 並提供基本資料與照片，我們會有專人與你聯繫，謝謝。', createdAt: stamp(-880) }
  ];
}

/* ---------- 顧客評價種子資料（status: on = 已通過顯示；images = 後台上傳的客評截圖） ---------- */
function buildReviewSeed() {
  var shot = function (n) { return 'https://placehold.co/360x640/2b2b36/9a9aa6/png?text=Chat+' + n; };
  return [
    { id: 'R4001', memberId: 'A1024', memberName: 'Kiki', nick: '小杰', text: '人很好相處，聊天很自然，時間也抓得很準，下次還會再約。', images: [shot(1)], status: 'on', createdAt: stamp(-260) },
    { id: 'R4002', memberId: 'A1024', memberName: 'Kiki', nick: 'Kevin', text: '照片跟本人完全一致，全程很放鬆，誠意推薦。', images: [shot(2)], status: 'on', createdAt: stamp(-540) },
    { id: 'R4003', memberId: 'A1031', memberName: 'Yuki', nick: '阿凱', text: '講話很溫柔也很有耐心，時間抓得很準，不拖拉。', images: [], status: 'on', createdAt: stamp(-700) },
    { id: 'R4004', memberId: 'A1052', memberName: '小嵐', nick: '匿名', text: '氣質真的很好，聊天內容也很有深度，推薦給喜歡慢步調的人。', images: [], status: 'on', createdAt: stamp(-1100) },
    { id: 'R4005', memberId: 'A1071', memberName: 'Luna', nick: '旅人Lin', text: '當了一整天的旅伴，拍照技術超好，行程安排也很貼心。', images: [shot(3)], status: 'on', createdAt: stamp(-1500) },
    { id: 'R4006', memberId: 'A1024', memberName: 'Kiki', nick: '匿名客', text: '整體不錯，但希望下次能早一點確認時間。', images: [], status: 'pending', createdAt: stamp(-40) },
    { id: 'R4007', memberId: 'A1031', memberName: 'Yuki', nick: '小明', text: '很棒的體驗，會再回訪！（示範待審核資料）', images: [], status: 'pending', createdAt: stamp(-15) },
    { id: 'R4008', memberId: 'A1071', memberName: 'Luna', nick: '匿名', text: '不太符合預期，細節就不多說了。', images: [], status: 'off', createdAt: stamp(-80) }
  ];
}

/* ---------- 檢舉案件種子資料 ---------- */
function buildReportSeed() {
  return [
    { id: 'P5001', memberId: 'A1067', memberName: 'Mina', reason: '照片與本人不符', detail: '實際見面後差異過大，希望能重新審核照片。', reporter: '匿名使用者', status: 'open', createdAt: stamp(-70) },
    { id: 'P5002', memberId: 'A1046', memberName: 'Anna', reason: '要求先付款', detail: '對方要求先用點數付款，覺得可疑。', reporter: 'line: warn_user', status: 'open', createdAt: stamp(-200) },
    { id: 'P5003', memberId: 'A1093', memberName: '米娜', reason: '服務內容與說明不符', detail: '與方案說明不一致，已私下處理完成。', reporter: '匿名使用者', status: 'resolved', createdAt: stamp(-1400) }
  ];
}

/* ---------- 站台設定種子資料 ---------- */
function buildSettingsSeed() {
  return {
    siteName: process.env.SITE_NAME || 'Escort',
    lineId: process.env.LINE_ID || '@escort.demo',
    notice: '新會員首次預約可折 $500，活動至月底止（示範公告）。',
    defaultCity: '全台縣市',
    siteOpen: true,
    /* 雲端部署務必設定 ADMIN_PASSWORD，否則會是預設值（任何人都能登入後台） */
    adminPassword: process.env.ADMIN_PASSWORD || 'admin1234',
    updated: stamp(0)
  };
}

/* 是否使用預設管理密碼（雲端部署時要警告使用者） */
function usingDefaultPassword() {
  return loadSettings().adminPassword === 'admin1234';
}

/* 是否為雲端環境（Render / Fly.io / Railway 等會設定這些變數） */
function isCloudEnv() {
  return !!(process.env.RENDER || process.env.FLY_APP_NAME || process.env.RAILWAY_ENVIRONMENT
    || process.env.DYNO || process.env.KOYEB_APP_NAME || process.env.WEBSITE_SITE_NAME);
}

/* ---------- 集合存取層（每種資源一個 JSON 檔） ---------- */
var SEEDS = {
  members: buildMemberSeed,
  bookings: buildBookingSeed,
  messages: buildMessageSeed,
  reviews: buildReviewSeed,
  reports: buildReportSeed
};

var store = {};   /* 記憶體快取 */

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function fileOf(name) { return path.join(DATA_DIR, name + '.json'); }

function load(name) {
  if (store[name]) return store[name];
  ensureDataDir();
  try {
    if (fs.existsSync(fileOf(name))) {
      var arr = JSON.parse(fs.readFileSync(fileOf(name), 'utf8'));
      if (Array.isArray(arr)) { store[name] = arr; return store[name]; }
    }
  } catch (e) {
    console.error('⚠ 讀取 ' + name + '.json 失敗，改用種子資料：' + e.message);
  }
  store[name] = SEEDS[name] ? SEEDS[name]() : [];
  save(name);
  return store[name];
}

function save(name) {
  ensureDataDir();
  fs.writeFileSync(fileOf(name), JSON.stringify(store[name] || [], null, 2), 'utf8');
}

function loadSettings() {
  if (store.settings) return store.settings;
  ensureDataDir();
  try {
    if (fs.existsSync(fileOf('settings'))) {
      var obj = JSON.parse(fs.readFileSync(fileOf('settings'), 'utf8'));
      if (obj && typeof obj === 'object') { store.settings = Object.assign(buildSettingsSeed(), obj); return store.settings; }
    }
  } catch (e) {
    console.error('⚠ 讀取 settings.json 失敗，改用種子資料：' + e.message);
  }
  store.settings = buildSettingsSeed();
  saveSettings();
  return store.settings;
}

function saveSettings() {
  ensureDataDir();
  fs.writeFileSync(fileOf('settings'), JSON.stringify(store.settings || {}, null, 2), 'utf8');
}

/* 重置全部資料（後台「重置示範資料」用） */
function resetAll() {
  store = {};
  Object.keys(SEEDS).forEach(function (name) {
    store[name] = SEEDS[name]();
    save(name);
  });
  store.settings = buildSettingsSeed();
  saveSettings();
  return store;
}

/* ---------- 通用工具 ---------- */
function nextId(list, prefix, start) {
  var max = start || 1000;
  list.forEach(function (item) {
    var n = parseInt(String(item.id || '').replace(/\D/g, ''), 10);
    if (n > max) max = n;
  });
  return prefix + (max + 1);
}

function findById(list, id) {
  for (var i = 0; i < list.length; i++) {
    if (list[i].id === id) return i;
  }
  return -1;
}

function trimStr(v, max) {
  var s = String(v == null ? '' : v).trim();
  return max && s.length > max ? s.slice(0, max) : s;
}

/* ---------- 輸入驗證 ---------- */
function validateMember(body) {
  var errors = [];
  var name = trimStr(body.name, 20);
  var age = parseInt(body.age, 10);
  var price = parseInt(body.price, 10);
  if (!name) errors.push('暱稱為必填欄位');
  if (!age || age < 18) errors.push('年齡需為 18 歲以上的整數');
  if (!price || price <= 0) errors.push('價格需為正整數');

  var tags = Array.isArray(body.tags)
    ? body.tags.map(function (t) { return trimStr(t, 10); }).filter(Boolean).slice(0, 3)
    : [];

  /* 成員照片（後台上傳的 /uploads/xxx 或示範用 Placeholder URL） */
  var images = Array.isArray(body.images)
    ? body.images.map(function (u) { return trimStr(u, 300); }).filter(Boolean).slice(0, MAX_MEMBER_IMAGES)
    : [];

  return {
    ok: errors.length === 0,
    errors: errors,
    data: {
      name: name,
      age: age,
      price: price,
      city: CITIES.indexOf(body.city) !== -1 ? body.city : CITIES[0],
      type: body.type === '定點' ? '定點' : '外送',
      status: MEMBER_STATUSES.indexOf(body.status) !== -1 ? body.status : 'pending',
      height: parseInt(body.height, 10) || 160,
      weight: parseInt(body.weight, 10) || 45,
      cup: trimStr(body.cup, 4) || 'B',
      intro: trimStr(body.intro, 120),
      tags: tags,
      flag: trimStr(body.flag, 8) || '🇹🇼',
      flagName: trimStr(body.flagName, 12) || '台灣',
      images: images,
      /* 第一張上傳照片同時作為列表主圖與頭像 */
      img: images[0] || trimStr(body.img, 300) || imgFor(name),
      avatar: trimStr(body.avatar, 300) || images[0] || avatarFor(name)
    }
  };
}

function validateBooking(body) {
  var errors = [];
  var memberId = trimStr(body.memberId, 16);
  var plan = trimStr(body.plan, 40);
  var contact = trimStr(body.contact, 60);
  var date = trimStr(body.date, 20);
  var time = trimStr(body.time, 20);
  if (!memberId) errors.push('缺少預約對象');
  if (!plan) errors.push('請選擇方案');
  if (!date) errors.push('請選擇可約時間');
  if (!contact) errors.push('請留下聯絡方式（LINE 或手機）');
  return {
    ok: errors.length === 0,
    errors: errors,
    data: { memberId: memberId, plan: plan, date: date, time: time, contact: contact, note: trimStr(body.note, 120) }
  };
}

function validateMessage(body) {
  var errors = [];
  var name = trimStr(body.name, 20);
  var contact = trimStr(body.contact, 60);
  var text = trimStr(body.body, 300);
  if (!name) errors.push('請填寫稱呼');
  if (!text) errors.push('請填寫訊息內容');
  if (!contact) errors.push('請留下聯絡方式（LINE 或手機）');
  return {
    ok: errors.length === 0,
    errors: errors,
    data: { name: name, contact: contact, body: text, memberId: trimStr(body.memberId, 16), memberName: trimStr(body.memberName, 20) }
  };
}

function validateReview(body) {
  var errors = [];
  var memberId = trimStr(body.memberId, 16);
  var text = trimStr(body.text, 300);
  if (!memberId) errors.push('缺少評價對象');
  if (!text) errors.push('請填寫評價內容');

  /* 評價圖片（後台上傳的 /uploads/xxx，最多 3 張） */
  var images = Array.isArray(body.images)
    ? body.images.map(function (u) { return trimStr(u, 300); }).filter(Boolean).slice(0, MAX_REVIEW_IMAGES)
    : [];

  return {
    ok: errors.length === 0,
    errors: errors,
    data: { memberId: memberId, nick: trimStr(body.nick, 20) || '匿名', text: text, images: images }
  };
}

function validateReport(body) {
  var errors = [];
  var reason = trimStr(body.reason, 40);
  var detail = trimStr(body.detail, 300);
  if (!reason) errors.push('請選擇檢舉原因');
  if (!detail) errors.push('請簡述檢舉內容');
  return {
    ok: errors.length === 0,
    errors: errors,
    data: {
      memberId: trimStr(body.memberId, 16),
      reason: reason,
      detail: detail,
      reporter: trimStr(body.reporter, 30) || '匿名使用者'
    }
  };
}

/* ---------- Session 認證（示範用，記憶體保存） ---------- */
var sessions = {};                                /* token → { createdAt } */
var SESSION_TTL = 12 * 60 * 60 * 1000;            /* 12 小時 */
var COOKIE_NAME = 'escort_sid';

function parseCookies(req) {
  var out = {};
  String(req.headers.cookie || '').split(';').forEach(function (part) {
    var i = part.indexOf('=');
    if (i > -1) {
      var k = part.slice(0, i).trim();
      try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); }
      catch (e) { out[k] = part.slice(i + 1).trim(); }
    }
  });
  return out;
}

function currentToken(req) {
  var token = parseCookies(req)[COOKIE_NAME];
  if (!token || !sessions[token]) return null;
  if (Date.now() - sessions[token].createdAt > SESSION_TTL) {
    delete sessions[token];
    return null;
  }
  return token;
}

function isAuthed(req) { return !!currentToken(req); }

function createSession() {
  var token = crypto.randomBytes(18).toString('hex');
  sessions[token] = { createdAt: Date.now() };
  return token;
}

function destroySession(req) {
  var token = currentToken(req);
  if (token) delete sessions[token];
}

/* ---------- 登入嘗試頻率限制（防止密碼被暴力嘗試） ---------- */
var loginAttempts = {};                       /* ip → { count, firstAt, blockedUntil } */
var LOGIN_MAX_FAILS = 5;                      /* 同一 IP 可失敗次數 */
var LOGIN_WINDOW_MS = 10 * 60 * 1000;         /* 計算區間：10 分鐘 */
var LOGIN_BLOCK_MS = 15 * 60 * 1000;          /* 超過後封鎖：15 分鐘 */

/* 取得來源 IP（若經過 Tunnel / 反向代理，優先取 X-Forwarded-For） */
function clientIp(req) {
  var xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xff || (req.socket && req.socket.remoteAddress) || 'unknown';
}

/* 回傳剩餘封鎖分鐘數；未被封鎖則回 0 */
function loginBlockedMinutes(ip) {
  var rec = loginAttempts[ip];
  if (!rec || !rec.blockedUntil) return 0;
  var left = rec.blockedUntil - Date.now();
  return left > 0 ? Math.ceil(left / 60000) : 0;
}

function recordLoginFail(ip) {
  var now = Date.now();
  var rec = loginAttempts[ip];
  if (!rec || now - rec.firstAt > LOGIN_WINDOW_MS) {
    rec = { count: 0, firstAt: now, blockedUntil: 0 };
    loginAttempts[ip] = rec;
  }
  rec.count++;
  if (rec.count >= LOGIN_MAX_FAILS) rec.blockedUntil = now + LOGIN_BLOCK_MS;
}

function clearLoginFails(ip) { delete loginAttempts[ip]; }

/* 對外公開的設定（不包含管理密碼） */
function publicSettings() {
  var s = loadSettings();
  return {
    siteName: s.siteName,
    lineId: s.lineId,
    notice: s.notice,
    defaultCity: s.defaultCity,
    siteOpen: !!s.siteOpen,
    updated: s.updated
  };
}

/* ---------- HTTP 工具 ---------- */
function sendJSON(res, code, obj, headers) {
  var head = Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  }, headers || {});
  res.writeHead(code, head);
  res.end(JSON.stringify(obj));
}

function sendText(res, code, text) {
  res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

/* 需要登入的操作：未登入回 401 */
function requireAuth(req, res) {
  if (isAuthed(req)) return true;
  sendJSON(res, 401, { error: '請先登入管理後台' });
  return false;
}

function readBody(req, maxBytes) {
  var limit = maxBytes || 64 * 1024;
  return new Promise(function (resolve, reject) {
    var size = 0;
    var chunks = [];
    req.on('data', function (ch) {
      size += ch.length;
      if (size > limit) {
        reject(new Error('請求內容過大（上限 ' + Math.round(limit / 1024) + 'KB）'));
        req.destroy();
        return;
      }
      chunks.push(ch);
    });
    req.on('end', function () {
      if (!chunks.length) { resolve({}); return; }
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (e) { reject(new Error('JSON 格式不正確')); }
    });
    req.on('error', reject);
  });
}

/* 解析查詢參數的排序／分頁（後台列表共用） */
function sortByCreatedAtDesc(list) {
  return list.slice().sort(function (a, b) {
    return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
  });
}

/* ---------- 圖片上傳：解析 / 驗證 / 寫檔（零依賴，接受 base64 data URL） ---------- */
function ensureUploadDir() {
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

/* 解析 data URL → { mime, buf }；格式不符回 null */
function decodeImageDataUrl(dataUrl) {
  var text = String(dataUrl == null ? '' : dataUrl).replace(/\s/g, '');
  var m = /^data:image\/(png|jpe?g|gif|webp);base64,([A-Za-z0-9+/=]+)$/.exec(text);
  if (!m) return null;
  var mime = m[1] === 'png' ? 'png' : m[1] === 'gif' ? 'gif' : m[1] === 'webp' ? 'webp' : 'jpeg';
  var buf;
  try { buf = Buffer.from(m[2], 'base64'); } catch (e) { return null; }
  if (!buf || !buf.length) return null;
  return { mime: mime, buf: buf };
}

/* 以檔案開頭位元組判斷真實圖片格式（不信任前端宣告的 MIME） */
function sniffImage(buf) {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length > 6 && buf.slice(0, 3).toString('latin1') === 'GIF') return 'gif';
  if (buf.length > 12 && buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

/* 儲存一張圖片 → { name, url, size, mime }；格式或大小不合則丟出錯誤 */
function saveImage(dataUrl) {
  var dec = decodeImageDataUrl(dataUrl);
  if (!dec) throw new Error('圖片格式不正確（僅接受 PNG / JPEG / GIF / WebP 的 base64 data URL）');
  if (dec.buf.length > MAX_UPLOAD_BYTES) {
    throw new Error('圖片過大（單張上限 ' + Math.round(MAX_UPLOAD_BYTES / 1024 / 1024) + 'MB）');
  }
  var real = sniffImage(dec.buf);
  if (!real) throw new Error('檔案內容不是有效的圖片');
  var name = 'img-' + Date.now().toString(36) + '-' + crypto.randomBytes(4).toString('hex') + '.' + IMAGE_EXT[real];
  ensureUploadDir();
  fs.writeFileSync(path.join(UPLOAD_DIR, name), dec.buf);
  return { name: name, url: UPLOADS_URL + name, size: dec.buf.length, mime: 'image/' + real };
}

/* 上傳檔名安全檢查（防路徑穿越） */
function safeUploadName(name) {
  var n = String(name == null ? '' : name).replace(/^.*[\\/]/, '');
  return /^[\w.-]+\.(png|jpe?g|gif|webp)$/i.test(n) ? n : null;
}

/* ---------- 上傳檔引用追蹤與清理 ---------- */
/* 目前所有資料中被引用的圖片 URL（成員照片 + 評價圖片） */
function referencedUrls() {
  var urls = [];
  load('members').forEach(function (m) {
    if (m.img) urls.push(m.img);
    if (m.avatar) urls.push(m.avatar);
    (m.images || []).forEach(function (u) { urls.push(u); });
  });
  load('reviews').forEach(function (r) {
    (r.images || []).forEach(function (u) { urls.push(u); });
  });
  return urls;
}

function isUrlReferenced(url) {
  return referencedUrls().indexOf(url) !== -1;
}

/* 只保留合法上傳 URL 並取出檔名 */
function uploadFileOf(url) {
  var u = String(url == null ? '' : url);
  if (u.indexOf(UPLOADS_URL) !== 0) return null;
  var name = safeUploadName(u.slice(UPLOADS_URL.length));
  return name;
}

/* 刪除一批上傳檔（僅限未被任何資料引用者）→ 回傳刪除數量 */
function cleanupUploads(urls) {
  var removed = 0;
  (urls || []).forEach(function (u) {
    var name = uploadFileOf(u);
    if (!name || isUrlReferenced(u)) return;
    try {
      var full = path.join(UPLOAD_DIR, name);
      if (fs.existsSync(full) && fs.statSync(full).isFile()) {
        fs.unlinkSync(full);
        removed++;
      }
    } catch (e) { /* 忽略個別檔案錯誤 */ }
  });
  return removed;
}

/* 清除 uploads/ 中沒有任何資料引用的檔案（重置示範資料時使用） */
function cleanupOrphanUploads() {
  ensureUploadDir();
  var refs = referencedUrls();
  var removed = 0;
  try {
    fs.readdirSync(UPLOAD_DIR).forEach(function (name) {
      if (!safeUploadName(name)) return;
      if (refs.indexOf(UPLOADS_URL + name) !== -1) return;
      try { fs.unlinkSync(path.join(UPLOAD_DIR, name)); removed++; } catch (e) { /* 忽略 */ }
    });
  } catch (e) { /* uploads 目錄不存在等情況，忽略 */ }
  return removed;
}

/* ---------- 上傳端點 ---------- */
function handleUploads(req, res, method, name) {
  /* GET /api/uploads — 列出已上傳檔案與引用狀態（後台用） */
  if (!name && method === 'GET') {
    if (!requireAuth(req, res)) return Promise.resolve();
    ensureUploadDir();
    var refs = referencedUrls();
    var list = fs.readdirSync(UPLOAD_DIR)
      .filter(function (n) { return safeUploadName(n); })
      .map(function (n) {
        var st = fs.statSync(path.join(UPLOAD_DIR, n));
        return { name: n, url: UPLOADS_URL + n, size: st.size, used: refs.indexOf(UPLOADS_URL + n) !== -1 };
      })
      .sort(function (a, b) { return String(b.name).localeCompare(String(a.name)); });
    return done(res, 200, { uploads: list, count: list.length, maxBytes: MAX_UPLOAD_BYTES });
  }

  /* POST /api/uploads — 上傳圖片（需登入）
     body: { data: 'data:image/png;base64,...' } 或 { data: [dataUrl, ...] }（單次最多 6 張） */
  if (!name && method === 'POST') {
    if (!requireAuth(req, res)) return Promise.resolve();
    return readBody(req, MAX_BODY_BYTES).then(function (body) {
      var items = Array.isArray(body.data) ? body.data : (body.data ? [body.data] : []);
      if (!items.length) { sendJSON(res, 400, { error: '缺少圖片內容（data 需為 base64 data URL）' }); return; }
      if (items.length > 6) { sendJSON(res, 400, { error: '單次最多上傳 6 張圖片' }); return; }

      var files = [];
      try {
        items.forEach(function (item) { files.push(saveImage(item)); });
      } catch (e) {
        /* 其中一張失敗時，清掉本次已寫入的檔案，避免留下孤兒 */
        files.forEach(function (f) {
          try { fs.unlinkSync(path.join(UPLOAD_DIR, f.name)); } catch (e2) { /* 忽略 */ }
        });
        throw e;
      }
      sendJSON(res, 201, {
        files: files, file: files[0], count: files.length,
        maxBytes: MAX_UPLOAD_BYTES, url: files[0].url
      });
    });
  }

  /* DELETE /api/uploads/:name — 刪除上傳檔（需登入；仍被引用時回 409） */
  if (name && method === 'DELETE') {
    if (!requireAuth(req, res)) return Promise.resolve();
    var safe = safeUploadName(name);
    if (!safe) return done(res, 400, { error: '檔名不合法' });
    var url = UPLOADS_URL + safe;
    if (isUrlReferenced(url)) {
      return done(res, 409, { error: '此圖片仍被成員或評價使用中，請先移除引用再刪除' });
    }
    var full = path.join(UPLOAD_DIR, safe);
    if (!fs.existsSync(full)) return done(res, 404, { error: '找不到檔案 ' + safe });
    try {
      fs.unlinkSync(full);
    } catch (e) {
      return done(res, 500, { error: '刪除檔案失敗：' + e.message });
    }
    return done(res, 200, { name: safe, removed: true });
  }

  return done(res, 404, { error: '找不到上傳 API 路由：' + method + ' /api/uploads/' + (name || '') });
}

/* ---------- 統計資料（後台數據總覽用） ---------- */
function countBy(list, key, value) {
  return list.filter(function (x) { return x[key] === value; }).length;
}

function statsPayload() {
  var members = load('members');
  var bookings = load('bookings');
  var messages = load('messages');
  var reviews = load('reviews');
  var reports = load('reports');
  var today = todayKey();

  var totalViews = members.reduce(function (sum, m) { return sum + (Number(m.views) || 0); }, 0);
  var top = members.slice().sort(function (a, b) { return (b.views || 0) - (a.views || 0); }).slice(0, 5)
    .map(function (m) { return { id: m.id, name: m.name, views: Number(m.views) || 0 }; });

  return {
    members: {
      total: members.length,
      on: countBy(members, 'status', 'on'),
      pending: countBy(members, 'status', 'pending'),
      off: countBy(members, 'status', 'off')
    },
    views: { total: totalViews, top: top },
    bookings: {
      total: bookings.length,
      today: bookings.filter(function (b) { return String(b.date || '').indexOf(today) === 0; }).length,
      pending: countBy(bookings, 'status', 'pending'),
      confirmed: countBy(bookings, 'status', 'confirmed'),
      done: countBy(bookings, 'status', 'done'),
      cancelled: countBy(bookings, 'status', 'cancelled')
    },
    messages: {
      total: messages.length,
      unread: countBy(messages, 'status', 'unread'),
      read: countBy(messages, 'status', 'read'),
      replied: countBy(messages, 'status', 'replied')
    },
    reviews: {
      total: reviews.length,
      pending: countBy(reviews, 'status', 'pending'),
      on: countBy(reviews, 'status', 'on'),
      off: countBy(reviews, 'status', 'off')
    },
    reports: {
      total: reports.length,
      open: countBy(reports, 'status', 'open'),
      resolved: countBy(reports, 'status', 'resolved'),
      dismissed: countBy(reports, 'status', 'dismissed')
    },
    updatedAt: stamp(0)
  };
}

/* ---------- 成員端點 ---------- */
function handleMembers(req, res, method, id, sub, q) {
  var list = load('members');
  var authed = isAuthed(req);

  /* GET /api/members — 公開僅回上架中；已登入回全部（可再篩選） */
  if (!id && method === 'GET') {
    var out = list;
    if (!authed) {
      out = out.filter(function (m) { return m.status === 'on'; });
    } else {
      var st = q.get('status');
      var city = q.get('city');
      var type = q.get('type');
      if (st && MEMBER_STATUSES.indexOf(st) !== -1) out = out.filter(function (m) { return m.status === st; });
      if (city) out = out.filter(function (m) { return m.city === city; });
      if (type) out = out.filter(function (m) { return m.type === type; });
    }
    return done(res, 200, { members: out, count: out.length });
  }

  /* POST /api/members/:id/view — 瀏覽次數 +1（前台詳情頁開啟時呼叫） */
  if (id && sub === 'view' && method === 'POST') {
    var vi = findById(list, id);
    if (vi === -1) return done(res, 404, { error: '查無成員 #' + id });
    list[vi].views = (Number(list[vi].views) || 0) + 1;
    save('members');
    return done(res, 200, { views: list[vi].views });
  }

  /* GET /api/members/:id */
  if (id && !sub && method === 'GET') {
    var idx = findById(list, id);
    if (idx === -1) return done(res, 404, { error: '查無成員 #' + id });
    return done(res, 200, { member: list[idx] });
  }

  /* POST /api/members（新增，需登入） */
  if (!id && method === 'POST') {
    if (!requireAuth(req, res)) return Promise.resolve();
    return readBody(req).then(function (body) {
      var v = validateMember(body);
      if (!v.ok) { sendJSON(res, 400, { error: v.errors.join('；') }); return; }
      var member = Object.assign({ id: nextId(list, 'A', 1000), updated: stamp(0), views: 0 }, v.data);
      /* 未上傳照片時，使用示範用 Placeholder（維持前台相片牆 4 格） */
      if (!member.images || !member.images.length) {
        member.images = [1, 2, 3, 4].map(function (n) { return imgFor(member.name, n); });
        member.img = imgFor(member.name);
        member.avatar = avatarFor(member.name);
      }
      member.services = rotate(SERVICE_OPTIONS, list.length, 8);
      member.addons = rotate(ADDON_OPTIONS, list.length * 2, 12);
      member.slots = buildSlots();
      list.push(member);
      save('members');
      sendJSON(res, 201, { member: member });
    });
  }

  /* PUT/PATCH /api/members/:id（更新，需登入） */
  if (id && !sub && (method === 'PUT' || method === 'PATCH')) {
    if (!requireAuth(req, res)) return Promise.resolve();
    var ui = findById(list, id);
    if (ui === -1) return done(res, 404, { error: '查無成員 #' + id });
    return readBody(req).then(function (body) {
      /* 只帶 status 時做快速上下架，不做整體驗證 */
      var keys = Object.keys(body || {});
      if (keys.length === 1 && keys[0] === 'status') {
        if (MEMBER_STATUSES.indexOf(body.status) === -1) { sendJSON(res, 400, { error: '狀態值不正確' }); return; }
        list[ui].status = body.status;
        list[ui].updated = stamp(0);
        save('members');
        sendJSON(res, 200, { member: list[ui] });
        return;
      }
      var before = (list[ui].images || []).slice();
      var beforeImg = list[ui].img;
      var v = validateMember(Object.assign({}, list[ui], body));
      if (!v.ok) { sendJSON(res, 400, { error: v.errors.join('；') }); return; }
      list[ui] = Object.assign({}, list[ui], v.data, { updated: stamp(0) });
      save('members');
      /* 被換掉的上傳照片若已無任何資料引用，就一併刪除檔案 */
      var dropped = before.filter(function (u) { return (list[ui].images || []).indexOf(u) === -1; });
      if (beforeImg && (list[ui].images || []).indexOf(beforeImg) === -1) dropped.push(beforeImg);
      cleanupUploads(dropped);
      sendJSON(res, 200, { member: list[ui] });
    });
  }

  /* DELETE /api/members/:id（需登入；同步清除該成員的評價與檢舉） */
  if (id && !sub && method === 'DELETE') {
    if (!requireAuth(req, res)) return Promise.resolve();
    var di = findById(list, id);
    if (di === -1) return done(res, 404, { error: '查無成員 #' + id });
    var removed = list.splice(di, 1)[0];
    save('members');
    /* 收集該成員及其評價用到的上傳圖，稍後清理未被引用者 */
    var orphans = (removed.images || []).slice();
    orphans.push(removed.img, removed.avatar);
    var goneReviews = load('reviews').filter(function (r) { return r.memberId === id; });
    goneReviews.forEach(function (r) {
      (r.images || []).forEach(function (u) { orphans.push(u); });
    });
    store.reviews = load('reviews').filter(function (r) { return r.memberId !== id; });
    save('reviews');
    store.reports = load('reports').filter(function (p) { return p.memberId !== id; });
    save('reports');
    cleanupUploads(orphans);
    return done(res, 200, { member: removed, cleaned: true });
  }

  return done(res, 404, { error: '找不到成員 API 路由：' + method + ' /api/members/' + id });
}

/* 同步回覆後回傳已解決的 Promise（讓路由統一以 Promise 串接） */
function done(res, code, obj, headers) {
  sendJSON(res, code, obj, headers);
  return Promise.resolve();
}

/* 依方案推算價格（以 500 為單位取整） */
function planPrice(base, plan) {
  var p = Number(base) || 0;
  var mult = String(plan).indexOf('方案 C') !== -1 ? 3 : String(plan).indexOf('方案 B') !== -1 ? 2 : 1;
  return Math.round(p * mult / 500) * 500;
}

/* ---------- 預約端點 ---------- */
function handleBookings(req, res, method, id, q) {
  var list = load('bookings');

  /* GET /api/bookings（後台，需登入） */
  if (!id && method === 'GET') {
    if (!requireAuth(req, res)) return Promise.resolve();
    var st = q.get('status');
    var out = sortByCreatedAtDesc(list);
    if (st && BOOKING_STATUSES.indexOf(st) !== -1) {
      out = out.filter(function (b) { return b.status === st; });
    }
    return done(res, 200, { bookings: out, count: out.length });
  }

  /* POST /api/bookings（前台送出預約，公開） */
  if (!id && method === 'POST') {
    return readBody(req).then(function (body) {
      var v = validateBooking(body);
      if (!v.ok) { sendJSON(res, 400, { error: v.errors.join('；') }); return; }
      var members = load('members');
      var mi = findById(members, v.data.memberId);
      if (mi === -1) { sendJSON(res, 404, { error: '查無預約對象 #' + v.data.memberId }); return; }
      var member = members[mi];
      var booking = Object.assign({
        id: nextId(list, 'B', 2000),
        memberName: member.name,
        price: planPrice(member.price, v.data.plan),
        status: 'pending',
        reply: '',
        createdAt: stamp(0)
      }, v.data);
      list.push(booking);
      save('bookings');
      /* 同時在訊息中心留下一則通知，方便客服追蹤 */
      var messages = load('messages');
      messages.push({
        id: nextId(messages, 'M', 3000),
        name: v.data.contact,
        contact: v.data.contact,
        memberId: member.id,
        memberName: member.name,
        body: '【預約通知】' + member.name + ' · ' + v.data.plan + ' · ' + v.data.date + ' ' + v.data.time,
        status: 'unread',
        reply: '',
        createdAt: stamp(0)
      });
      save('messages');
      sendJSON(res, 201, { booking: booking });
    });
  }

  /* PUT/PATCH /api/bookings/:id（後台更新狀態，需登入） */
  if (id && (method === 'PUT' || method === 'PATCH')) {
    if (!requireAuth(req, res)) return Promise.resolve();
    var bi = findById(list, id);
    if (bi === -1) return done(res, 404, { error: '查無預約 ' + id });
    return readBody(req).then(function (body) {
      if (body.status !== undefined) {
        if (BOOKING_STATUSES.indexOf(body.status) === -1) { sendJSON(res, 400, { error: '預約狀態不正確' }); return; }
        list[bi].status = body.status;
      }
      if (body.reply !== undefined) list[bi].reply = trimStr(body.reply, 160);
      list[bi].updated = stamp(0);
      save('bookings');
      sendJSON(res, 200, { booking: list[bi] });
    });
  }

  /* DELETE /api/bookings/:id（需登入） */
  if (id && method === 'DELETE') {
    if (!requireAuth(req, res)) return Promise.resolve();
    var di = findById(list, id);
    if (di === -1) return done(res, 404, { error: '查無預約 ' + id });
    var removedB = list.splice(di, 1)[0];
    save('bookings');
    return done(res, 200, { booking: removedB });
  }

  return done(res, 404, { error: '找不到預約 API 路由：' + method });
}

/* ---------- 客服訊息端點 ---------- */
function handleMessages(req, res, method, id, q) {
  var list = load('messages');

  /* GET /api/messages（後台，需登入） */
  if (!id && method === 'GET') {
    if (!requireAuth(req, res)) return Promise.resolve();
    var st = q.get('status');
    var out = sortByCreatedAtDesc(list);
    if (st && MESSAGE_STATUSES.indexOf(st) !== -1) {
      out = out.filter(function (m) { return m.status === st; });
    }
    return done(res, 200, { messages: out, count: out.length });
  }

  /* POST /api/messages（前台送出客服訊息，公開） */
  if (!id && method === 'POST') {
    return readBody(req).then(function (body) {
      var v = validateMessage(body);
      if (!v.ok) { sendJSON(res, 400, { error: v.errors.join('；') }); return; }
      var message = Object.assign({
        id: nextId(list, 'M', 3000),
        status: 'unread',
        reply: '',
        createdAt: stamp(0)
      }, v.data);
      list.push(message);
      save('messages');
      sendJSON(res, 201, { message: message });
    });
  }

  /* PUT/PATCH /api/messages/:id（後台標記已讀／回覆，需登入） */
  if (id && (method === 'PUT' || method === 'PATCH')) {
    if (!requireAuth(req, res)) return Promise.resolve();
    var mi = findById(list, id);
    if (mi === -1) return done(res, 404, { error: '查無訊息 ' + id });
    return readBody(req).then(function (body) {
      if (body.reply !== undefined) {
        list[mi].reply = trimStr(body.reply, 300);
        list[mi].status = list[mi].reply ? 'replied' : 'read';
      }
      if (body.status !== undefined) {
        if (MESSAGE_STATUSES.indexOf(body.status) === -1) { sendJSON(res, 400, { error: '訊息狀態不正確' }); return; }
        list[mi].status = body.status;
      }
      list[mi].updated = stamp(0);
      save('messages');
      sendJSON(res, 200, { message: list[mi] });
    });
  }

  /* DELETE /api/messages/:id（需登入） */
  if (id && method === 'DELETE') {
    if (!requireAuth(req, res)) return Promise.resolve();
    var di = findById(list, id);
    if (di === -1) return done(res, 404, { error: '查無訊息 ' + id });
    var removedM = list.splice(di, 1)[0];
    save('messages');
    return done(res, 200, { message: removedM });
  }

  return done(res, 404, { error: '找不到訊息 API 路由：' + method });
}

/* ---------- 顧客評價端點 ---------- */
function handleReviews(req, res, method, id, q) {
  var list = load('reviews');
  var authed = isAuthed(req);

  /* GET /api/reviews — 前台只取已通過（memberId 必填）；後台可全部 */
  if (!id && method === 'GET') {
    var memberId = q.get('memberId');
    var st = q.get('status');
    var out = sortByCreatedAtDesc(list);
    if (!authed) {
      if (!memberId) return done(res, 400, { error: '前台查詢評價需指定 memberId' });
      out = out.filter(function (r) { return r.memberId === memberId && r.status === 'on'; });
    } else {
      if (memberId) out = out.filter(function (r) { return r.memberId === memberId; });
      if (st && REVIEW_STATUSES.indexOf(st) !== -1) out = out.filter(function (r) { return r.status === st; });
    }
    return done(res, 200, { reviews: out, count: out.length });
  }

  /* POST /api/reviews（前台送出評價，公開，待審核） */
  if (!id && method === 'POST') {
    return readBody(req).then(function (body) {
      var v = validateReview(body);
      if (!v.ok) { sendJSON(res, 400, { error: v.errors.join('；') }); return; }
      var members = load('members');
      var mi = findById(members, v.data.memberId);
      if (mi === -1) { sendJSON(res, 404, { error: '查無評價對象 #' + v.data.memberId }); return; }
      var review = Object.assign({
        id: nextId(list, 'R', 4000),
        memberName: members[mi].name,
        status: 'pending',
        createdAt: stamp(0)
      }, v.data);
      list.push(review);
      save('reviews');
      sendJSON(res, 201, { review: review });
    });
  }

  /* PUT/PATCH /api/reviews/:id（後台審核，需登入） */
  if (id && (method === 'PUT' || method === 'PATCH')) {
    if (!requireAuth(req, res)) return Promise.resolve();
    var ri = findById(list, id);
    if (ri === -1) return done(res, 404, { error: '查無評價 ' + id });
    return readBody(req).then(function (body) {
      if (body.status !== undefined) {
        if (REVIEW_STATUSES.indexOf(body.status) === -1) { sendJSON(res, 400, { error: '評價狀態不正確' }); return; }
        list[ri].status = body.status;
      }
      if (body.text !== undefined) list[ri].text = trimStr(body.text, 300);
      /* 評價圖片（後台上傳；被移除的檔案若已無引用則刪除） */
      if (body.images !== undefined) {
        var imgs = Array.isArray(body.images)
          ? body.images.map(function (u) { return trimStr(u, 300); }).filter(Boolean).slice(0, MAX_REVIEW_IMAGES)
          : [];
        var droppedImgs = (list[ri].images || []).filter(function (u) { return imgs.indexOf(u) === -1; });
        list[ri].images = imgs;
        cleanupUploads(droppedImgs);
      }
      list[ri].updated = stamp(0);
      save('reviews');
      sendJSON(res, 200, { review: list[ri] });
    });
  }

  /* DELETE /api/reviews/:id（需登入） */
  if (id && method === 'DELETE') {
    if (!requireAuth(req, res)) return Promise.resolve();
    var di = findById(list, id);
    if (di === -1) return done(res, 404, { error: '查無評價 ' + id });
    var removedR = list.splice(di, 1)[0];
    save('reviews');
    cleanupUploads(removedR.images || []);
    return done(res, 200, { review: removedR });
  }

  return done(res, 404, { error: '找不到評價 API 路由：' + method });
}

/* ---------- 檢舉端點 ---------- */
function handleReports(req, res, method, id, q) {
  var list = load('reports');

  /* GET /api/reports（後台，需登入） */
  if (!id && method === 'GET') {
    if (!requireAuth(req, res)) return Promise.resolve();
    var st = q.get('status');
    var out = sortByCreatedAtDesc(list);
    if (st && REPORT_STATUSES.indexOf(st) !== -1) {
      out = out.filter(function (p) { return p.status === st; });
    }
    return done(res, 200, { reports: out, count: out.length });
  }

  /* POST /api/reports（前台送出檢舉，公開） */
  if (!id && method === 'POST') {
    return readBody(req).then(function (body) {
      var v = validateReport(body);
      if (!v.ok) { sendJSON(res, 400, { error: v.errors.join('；') }); return; }
      var members = load('members');
      var mi = findById(members, v.data.memberId);
      var report = Object.assign({
        id: nextId(list, 'P', 5000),
        memberName: mi === -1 ? '' : members[mi].name,
        status: 'open',
        createdAt: stamp(0)
      }, v.data);
      list.push(report);
      save('reports');
      sendJSON(res, 201, { report: report });
    });
  }

  /* PUT/PATCH /api/reports/:id（後台處理，需登入） */
  if (id && (method === 'PUT' || method === 'PATCH')) {
    if (!requireAuth(req, res)) return Promise.resolve();
    var pi = findById(list, id);
    if (pi === -1) return done(res, 404, { error: '查無檢舉 ' + id });
    return readBody(req).then(function (body) {
      if (body.status !== undefined) {
        if (REPORT_STATUSES.indexOf(body.status) === -1) { sendJSON(res, 400, { error: '檢舉狀態不正確' }); return; }
        list[pi].status = body.status;
      }
      if (body.note !== undefined) list[pi].handleNote = trimStr(body.note, 160);
      list[pi].updated = stamp(0);
      save('reports');
      sendJSON(res, 200, { report: list[pi] });
    });
  }

  /* DELETE /api/reports/:id（需登入） */
  if (id && method === 'DELETE') {
    if (!requireAuth(req, res)) return Promise.resolve();
    var di = findById(list, id);
    if (di === -1) return done(res, 404, { error: '查無檢舉 ' + id });
    var removedP = list.splice(di, 1)[0];
    save('reports');
    return done(res, 200, { report: removedP });
  }

  return done(res, 404, { error: '找不到檢舉 API 路由：' + method });
}

/* ---------- 系統設定端點 ---------- */
function handleSettings(req, res, method) {
  if (method === 'GET') {
    var payload = publicSettings();
    payload.authed = isAuthed(req);
    return done(res, 200, { settings: payload });
  }

  if (method === 'PUT' || method === 'PATCH') {
    if (!requireAuth(req, res)) return Promise.resolve();
    return readBody(req).then(function (body) {
      var s = loadSettings();
      if (body.siteName !== undefined) {
        var name = trimStr(body.siteName, 24);
        if (!name) { sendJSON(res, 400, { error: '站台名稱為必填' }); return; }
        s.siteName = name;
      }
      if (body.lineId !== undefined) s.lineId = trimStr(body.lineId, 40);
      if (body.notice !== undefined) s.notice = trimStr(body.notice, 120);
      if (body.defaultCity !== undefined) {
        s.defaultCity = CITIES.indexOf(body.defaultCity) !== -1 ? body.defaultCity : '全台縣市';
      }
      if (body.siteOpen !== undefined) s.siteOpen = !!body.siteOpen;
      if (body.adminPassword) {
        var pw = String(body.adminPassword);
        if (pw.length < 6) { sendJSON(res, 400, { error: '管理密碼至少 6 個字元' }); return; }
        s.adminPassword = pw;
      }
      s.updated = stamp(0);
      saveSettings();
      var out = publicSettings();
      out.authed = true;
      sendJSON(res, 200, { settings: out });
    });
  }

  return done(res, 405, { error: '設定 API 不支援 ' + method });
}

/* ---------- 分享模式守門：只放行前台需要的端點 ---------- */
function shareModeBlocked(resource, method, id, sub) {
  if (!SHARE_MODE) return false;
  /* 完全停用：登入登出、統計、重置、上傳管理 */
  if (resource === 'login' || resource === 'logout' || resource === 'stats'
      || resource === 'reset' || resource === 'uploads') return true;
  /* 站台設定改為唯讀（前台要讀公告與 LINE ID） */
  if (resource === 'settings') return method !== 'GET';
  /* 預約 / 訊息 / 檢舉：只允許前台送出（POST），不可讀取清單或修改刪除 */
  if (resource === 'bookings' || resource === 'messages' || resource === 'reports') return method !== 'POST';
  /* 評價：允許讀取已審核清單與送出，不可審核或刪除 */
  if (resource === 'reviews') return method !== 'GET' && method !== 'POST';
  /* 成員：允許公開讀取，以及前台瀏覽次數上報；其餘（新增／修改／刪除）停用 */
  if (resource === 'members') {
    if (method === 'GET') return false;
    return !(method === 'POST' && id && sub === 'view');
  }
  return false;
}

/* ---------- 主路由器 ---------- */
function handleApi(req, res, url) {
  var method = req.method;
  var seg = url.pathname.split('/').filter(Boolean);   /* ['api', 'members', 'A1024'] */
  var resource = seg[1] || '';
  var id = seg[2] ? decodeURIComponent(seg[2]) : '';
  var sub = seg[3] ? decodeURIComponent(seg[3]) : '';
  var q = url.searchParams;

  /* --- 分享模式：後台管理端點一律停用 --- */
  if (shareModeBlocked(resource, method, id, sub)) {
    return done(res, 403, { error: '此站台目前為分享模式（僅開放前台試用），後台管理功能已停用' });
  }

  /* --- 健康檢查 --- */
  if (resource === 'health' && method === 'GET') {
    return done(res, 200, { ok: true, stats: statsPayload() });
  }

  /* --- 登入狀態 --- */
  if (resource === 'session' && method === 'GET') {
    var s = publicSettings();
    return done(res, 200, {
      authed: isAuthed(req), siteName: s.siteName, siteOpen: s.siteOpen,
      shareMode: SHARE_MODE
    });
  }

  /* --- 登入 --- */
  if (resource === 'login' && method === 'POST') {
    return readBody(req).then(function (body) {
      var ip = clientIp(req);
      var blocked = loginBlockedMinutes(ip);
      if (blocked) {
        sendJSON(res, 429, { error: '登入嘗試次數過多，請於 ' + blocked + ' 分鐘後再試' });
        return;
      }
      var settings = loadSettings();
      if (String(body.password || '') !== settings.adminPassword) {
        recordLoginFail(ip);
        var left = LOGIN_MAX_FAILS - ((loginAttempts[ip] && loginAttempts[ip].count) || 0);
        sendJSON(res, 401, {
          error: left > 0 ? '管理密碼不正確（剩餘嘗試次數 ' + left + ' 次）' : '管理密碼不正確'
        });
        return;
      }
      clearLoginFails(ip);
      var token = createSession();
      sendJSON(res, 200, { authed: true }, {
        'Set-Cookie': COOKIE_NAME + '=' + token + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + Math.floor(SESSION_TTL / 1000)
      });
    });
  }

  /* --- 登出 --- */
  if (resource === 'logout' && method === 'POST') {
    destroySession(req);
    return done(res, 200, { authed: false }, {
      'Set-Cookie': COOKIE_NAME + '=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'
    });
  }

  /* --- 系統設定 --- */
  if (resource === 'settings') return handleSettings(req, res, method);

  /* --- 圖片上傳 --- */
  if (resource === 'uploads') return handleUploads(req, res, method, id);

  /* --- 統計（後台） --- */
  if (resource === 'stats' && method === 'GET') {
    if (!requireAuth(req, res)) return Promise.resolve();
    return done(res, 200, { stats: statsPayload() });
  }

  /* --- 重置全部示範資料（後台） --- */
  if (resource === 'reset' && method === 'POST') {
    if (!requireAuth(req, res)) return Promise.resolve();
    resetAll();
    var purged = cleanupOrphanUploads();   /* 重置後沒有任何資料引用上傳檔，一併清除 */
    return done(res, 200, { ok: true, purgedFiles: purged, stats: statsPayload() });
  }

  /* --- 各資源 --- */
  if (resource === 'members') return handleMembers(req, res, method, id, sub, q);
  if (resource === 'bookings') return handleBookings(req, res, method, id, q);
  if (resource === 'messages') return handleMessages(req, res, method, id, q);
  if (resource === 'reviews') return handleReviews(req, res, method, id, q);
  if (resource === 'reports') return handleReports(req, res, method, id, q);

  return done(res, 404, { error: '找不到 API 路由：' + method + ' ' + url.pathname });
}

/* ---------- 分享模式說明頁（取代 admin.html） ---------- */
function shareModePage() {
  return '<!DOCTYPE html><html lang="zh-Hant-TW"><head><meta charset="UTF-8" />' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0" />' +
    '<meta name="robots" content="noindex, nofollow" />' +
    '<title>後台已停用｜分享模式</title><style>' +
    '*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;' +
    'font-family:"Noto Sans TC","PingFang TC","Microsoft JhengHei",system-ui,sans-serif;background:#14141b;color:#f4f4f7}' +
    '.card{width:min(92vw,440px);padding:28px;border-radius:16px;background:#1d1d26;border:1px solid rgba(255,255,255,.1)}' +
    '.tag{display:inline-block;margin-bottom:14px;padding:4px 12px;border-radius:999px;background:#ffd23f;color:#17171c;' +
    'font-size:.72rem;font-weight:800;letter-spacing:.04em}h1{margin:0 0 10px;font-size:1.25rem}' +
    'p{margin:0 0 12px;font-size:.9rem;line-height:1.75;color:#a6a6b4}' +
    'a{display:inline-block;margin-top:6px;padding:11px 20px;border-radius:999px;background:#ffd23f;color:#17171c;' +
    'font-size:.88rem;font-weight:800;text-decoration:none}ul{margin:0 0 16px;padding-left:20px;font-size:.86rem;color:#a6a6b4;line-height:1.8}' +
    '</style></head><body><div class="card">' +
    '<span class="tag">分享模式</span>' +
    '<h1>後台管理已停用</h1>' +
    '<p>這個站台目前以「分享模式」對外開放，僅提供前台瀏覽與試用功能，管理後台不對外開放。</p>' +
    '<ul><li>可瀏覽列表與個人頁面</li><li>可送出預約、訊息、評價與檢舉</li><li>無法進入後台管理資料</li></ul>' +
    '<p>若你是站台管理者，請在本機關閉分享模式後再存取後台。</p>' +
    '<a href="index.html">← 回到前台首頁</a>' +
    '</div></body></html>';
}

/* ---------- 靜態檔案伺服 ---------- */
var MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8'
};

function serveStatic(req, res, url) {
  var pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch (e) {
    return sendText(res, 400, '400 Bad Request');
  }
  if (pathname === '/') pathname = '/index.html';

  /* 上傳檔可能位於自訂的 UPLOAD_DIR（掛載持久化磁碟時在專案目錄之外），
     因此 /uploads/ 需單獨對應到 UPLOAD_DIR。 */
  if (pathname.indexOf(UPLOADS_URL) === 0) {
    var uploadName = safeUploadName(pathname.slice(UPLOADS_URL.length));
    if (!uploadName) return sendText(res, 403, '403 Forbidden');
    var uploadPath = path.join(UPLOAD_DIR, uploadName);
    fs.stat(uploadPath, function (err, st) {
      if (err || !st.isFile()) return sendText(res, 404, '404 Not Found');
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(uploadPath).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-cache'
      });
      if (req.method === 'HEAD') { res.end(); return; }
      fs.createReadStream(uploadPath).on('error', function () { res.end(); }).pipe(res);
    });
    return;
  }

  var filePath = path.normalize(path.join(ROOT, pathname));
  var safeRoot = path.normalize(ROOT + path.sep);
  /* 路徑穿越防護：只允許存取專案資料夾內的檔案，且不開放資料檔 */
  if (filePath !== ROOT && filePath.indexOf(safeRoot) !== 0) {
    return sendText(res, 403, '403 Forbidden');
  }
  if (filePath.indexOf(path.normalize(DATA_DIR)) === 0) {
    return sendText(res, 403, '403 Forbidden（資料檔僅能透過 API 存取）');
  }

  fs.stat(filePath, function (err, st) {
    if (err || !st.isFile()) return sendText(res, 404, '404 Not Found');
    var ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    if (req.method === 'HEAD') { res.end(); return; }
    var stream = fs.createReadStream(filePath);
    stream.on('error', function () { res.end(); });
    stream.pipe(res);
  });
}

/* ---------- 伺服器組裝 ---------- */
var server = http.createServer(function (req, res) {
  var url;
  try {
    url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  } catch (e) {
    return sendText(res, 400, '400 Bad Request');
  }

  if (url.pathname === '/api' || url.pathname.indexOf('/api/') === 0) {
    handleApi(req, res, url).catch(function (err) {
      sendJSON(res, 400, { error: err && err.message ? err.message : '請求處理失敗' });
    });
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return sendText(res, 405, '405 Method Not Allowed');
  }

  /* 分享模式：後台頁面改顯示說明，避免對外開放管理介面 */
  if (SHARE_MODE && (url.pathname === '/admin.html' || url.pathname === '/admin')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(shareModePage());
    return;
  }

  serveStatic(req, res, url);
});

server.on('error', function (err) {
  if (err && err.code === 'EADDRINUSE') {
    console.error('✘ 連接埠 ' + PORT + ' 已被占用，請改用其他連接埠，例如：');
    console.error('   PowerShell：  $env:PORT=3001; node server.js');
    console.error('   CMD：         set PORT=3001 && node server.js');
    process.exit(1);
  }
  console.error('✘ 伺服器錯誤：', err);
  process.exit(1);
});

/* 取得區網 IP（同一個 WiFi / 網段的裝置可直接連線測試） */
function lanAddresses() {
  var out = [];
  try {
    var ifaces = os.networkInterfaces();
    Object.keys(ifaces).forEach(function (name) {
      (ifaces[name] || []).forEach(function (info) {
        if (info.family === 'IPv4' && !info.internal) out.push({ name: name, address: info.address });
      });
    });
  } catch (e) { /* 忽略 */ }
  return out;
}

server.listen(PORT, function () {
  var s = publicSettings();
  console.log('');
  console.log('  ✔ Escort 示範後端已啟動（純 Node.js，零依賴）');
  if (SHARE_MODE) {
    console.log('  ★ 分享模式已開啟：僅開放前台試用，後台管理與管理 API 全部停用');
  }
  console.log('  ├─ 前台首頁    http://localhost:' + PORT + '/');
  console.log('  ├─ 個人詳情頁  http://localhost:' + PORT + '/detail.html?id=A1024');
  console.log('  ├─ 新手指南    http://localhost:' + PORT + '/guide.html');
  if (SHARE_MODE) {
    console.log('  ├─ 後台管理    已停用（分享模式）');
  } else {
    console.log('  ├─ 後台管理    http://localhost:' + PORT + '/admin.html（示範密碼 ' + s.adminPassword + '）');
  }
  console.log('  ├─ REST API    http://localhost:' + PORT + '/api/members');
  console.log('  ├─ 圖片上傳    POST http://localhost:' + PORT + '/api/uploads（後台用，單張上限 '
    + Math.round(MAX_UPLOAD_BYTES / 1024 / 1024) + 'MB）');
  console.log('  └─ 資料檔案    ' + (process.env.DATA_DIR ? DATA_DIR + '（自訂路徑）' : 'data/*.json + uploads/（首次啟動自動建立）'));
  var lans = lanAddresses();
  if (lans.length && !isCloudEnv()) {
    console.log('');
    console.log('  同一網段裝置可直接連線（需允許 Windows 防火牆）：');
    lans.forEach(function (l) {
      console.log('    http://' + l.address + ':' + PORT + '/   （' + l.name + '）');
    });
  }

  /* 雲端部署的安全與資料提醒 */
  if (isCloudEnv()) {
    console.log('');
    if (usingDefaultPassword()) {
      console.log('  ⚠ 警告：管理密碼仍是預設值 admin1234！任何人只要開啟 /admin.html 就能登入。');
      console.log('     請在平台設定環境變數 ADMIN_PASSWORD=你的強密碼 後重新部署，');
      console.log('     或改用 SHARE_MODE=1 啟動（直接停用後台）。');
    }
    if (!process.env.DATA_DIR) {
      console.log('  ⚠ 提醒：未設定 DATA_DIR，資料存在服務本機（暫時性檔案系統）。');
      console.log('     服務重新啟動或重新部署後，成員／預約／上傳的照片都會還原成示範資料。');
      console.log('     需要保留資料請掛載持久化磁碟並設定 DATA_DIR 與 UPLOAD_DIR。');
    }
  }

  console.log('');
  console.log('  對外分享：見 README.md「分享給他人試用」與 DEPLOY.md「部署到免費雲端主機」');
  console.log('  按 Ctrl+C 可停止伺服器');
  console.log('');
});