/* ==================================================
   共用工具與 API 層 — 所有頁面共用（js/data.js）
   資料來源：Node.js 後端 REST API（server.js）
   使用方式：先執行 node server.js，再開啟 http://localhost:3000
   ================================================== */

/* 縣市清單（與首頁下拉、後台表單一致） */
var CITIES = ['台北市', '新北市', '桃園市', '新竹市', '台中市', '台南市', '高雄市', '宜蘭縣', '花蓮縣'];

/* 各種狀態的顯示文字（前台／後台共用） */
var LABELS = {
  member: { on: '上架中', pending: '待審核', off: '已下架' },
  booking: { pending: '待確認', confirmed: '已確認', done: '已完成', cancelled: '已取消' },
  message: { unread: '未讀', read: '已讀', replied: '已回覆' },
  review: { pending: '待審核', on: '已顯示', off: '已退回' },
  report: { open: '待處理', resolved: '已處理', dismissed: '已駁回' }
};

/* ---------- REST API 包裝 ---------- */
/* ---------- 靜態示範模式 ----------
   部署到純靜態空間（如 Netlify）時沒有後端，此時前台自動改用 js/demo-data.js
   的示範資料，讓瀏覽體驗完整；送出類操作會提示需具備後端的環境。 */
var STATIC_DEMO = null;         /* null = 尚未偵測, true = 靜態示範, false = 有後端 */
var backendProbe = null;

function detectBackend() {
  if (backendProbe) return backendProbe;
  backendProbe = fetch('/api/health', { method: 'GET', credentials: 'same-origin' })
    .then(function (res) { return !!res.ok; })
    .catch(function () { return false; })          /* 連線失敗 → 判定為靜態環境 */
    .then(function (hasBackend) {
      if (hasBackend) { STATIC_DEMO = false; return false; }
      /* 靜態環境：動態載入示範資料（有後端時完全不會載入，避免 404） */
      return loadDemoData().then(function () {
        STATIC_DEMO = true;
        if (document.documentElement) document.documentElement.classList.add('is-static-demo');
        showDemoBanner();
        return true;
      });
    });
  return backendProbe;
}

/* 動態載入 js/demo-data.js（載入失敗時仍以空資料繼續，不讓畫面掛掉） */
function loadDemoData() {
  if (window.DEMO_DATA) return Promise.resolve(window.DEMO_DATA);
  return new Promise(function (resolve) {
    var s = document.createElement('script');
    s.src = 'js/demo-data.js';
    s.onload = function () { resolve(window.DEMO_DATA || {}); };
    s.onerror = function () { resolve(window.DEMO_DATA || {}); };
    document.head.appendChild(s);
  });
}

function isStaticDemo() { return STATIC_DEMO === true; }

/* ---------- 示範沙盒（存在瀏覽器）----------
   偵測不到後端時，所有資料改用 localStorage 儲存，因此靜態版也能真的操作：
     ✔ 訪客可以送出預約、評價、檢舉、客服訊息，並立刻看到結果
     ✔ 後台可以登入（示範密碼 demo1234）、新增／編輯／刪除成員、審核評價、處理檢舉、修改設定
     ✔ 每位訪客各自擁有獨立沙盒，互不干擾；重新整理仍保留
     ✘ 資料只存在該訪客的瀏覽器，清除瀏覽資料即重置
   ============================================================ */
var DEMO_KEY = 'escort_demo_store_v1';
var DEMO_PASSWORD = 'demo1234';         /* 公開沙盒用的示範密碼 */
var DEMO_IMG_MAX_BYTES = 300 * 1024;    /* 沙盒單張圖片上限（localStorage 容量有限） */
var DEMO_IMG_MAX_COUNT = 4;             /* 每筆資料最多幾張圖 */
var demoImgSeq = 0;

function demoClone(v) { return JSON.parse(JSON.stringify(v === undefined ? null : v)); }

function demoStamp() {
  var d = new Date();
  function p(n) { return (n < 10 ? '0' : '') + n; }
  return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

/* 出廠示範資料 */
function demoSeed() {
  var seed = window.DEMO_DATA || {};
  return {
    members: demoClone(seed.members || []),
    reviews: demoClone(seed.reviews || []),
    bookings: [],
    messages: [],
    reports: [],
    settings: demoClone(seed.settings || {}),
    authed: false,
    counter: 9000
  };
}

/* 讀取沙盒（首次使用時自動建立） */
function demoStore() {
  var store = null;
  try { store = JSON.parse(localStorage.getItem(DEMO_KEY) || 'null'); } catch (e) { store = null; }
  if (!store || !Array.isArray(store.members)) {
    store = demoSeed();
    demoSave(store);
  }
  return store;
}

function demoSave(store) {
  try { localStorage.setItem(DEMO_KEY, JSON.stringify(store)); return true; }
  catch (e) { return false; }   /* 容量不足時回報失敗，不讓流程中斷 */
}

function demoNextId(store, prefix) {
  store.counter = (store.counter || 9000) + 1;
  return prefix + store.counter;
}

/* 沙盒的請求處理（回應格式與後端一致，前端完全不用改） */
function demoResolve(method, url, body) {
  var store = demoStore();
  var pathname = String(url).split('?')[0];
  var qs = String(url).indexOf('?') > -1 ? String(url).split('?')[1] : '';
  var seg = pathname.split('/').filter(Boolean);

  var ctx = {
    store: store,
    method: method,
    resource: seg[1] || '',
    id: seg[2] ? decodeURIComponent(seg[2]) : '',
    sub: seg[3] ? decodeURIComponent(seg[3]) : '',
    query: new URLSearchParams(qs),
    body: body || {}
  };

  ctx.ok = function (obj) { return Promise.resolve(obj); };
  ctx.fail = function (status, msg) { var e = new Error(msg); e.status = status; return Promise.reject(e); };
  ctx.guard = function () {
    return store.authed ? null : ctx.fail(401, '請先登入後台（沙盒示範密碼 ' + DEMO_PASSWORD + '）');
  };
  ctx.find = function (arr, key) {
    for (var i = 0; i < arr.length; i++) { if (arr[i].id === key) return arr[i]; }
    return null;
  };
  ctx.trim = function (v, n) { var s = String(v == null ? '' : v).trim(); return n && s.length > n ? s.slice(0, n) : s; };
  ctx.stamp = demoStamp;
  ctx.nextId = function (p) { return demoNextId(store, p); };
  ctx.save = function () { return demoSave(store); };

  var r = ctx.resource;
  if (r === 'health') return ctx.ok({ ok: true, demo: true, count: store.members.length });
  if (r === 'session') return demoSession(ctx);
  if (r === 'login' || r === 'logout') return demoAuth(ctx);
  if (r === 'settings') return demoSettings(ctx);
  if (r === 'reset') return demoResetApi(ctx);
  if (r === 'stats') return demoStatsApi(ctx);
  if (r === 'members') return demoMembers(ctx);
  if (r === 'reviews') return demoReviews(ctx);
  if (r === 'bookings' || r === 'messages' || r === 'reports') return demoCollection(ctx);
  if (r === 'uploads') return demoUploads(ctx);

  return ctx.fail(404, '沙盒未支援此功能：' + method + ' ' + pathname);
}

/* --- 登入狀態 --- */
function demoSession(ctx) {
  var s = ctx.store.settings;
  return ctx.ok({
    authed: !!ctx.store.authed,
    demo: true,
    siteName: s.siteName || 'Escort',
    siteOpen: s.siteOpen !== false
  });
}

/* --- 登入 / 登出（沙盒密碼公開，方便任何人試玩後台） --- */
function demoAuth(ctx) {
  var store = ctx.store;
  if (ctx.resource === 'logout') {
    store.authed = false;
    ctx.save();
    return ctx.ok({ authed: false });
  }
  if (String(ctx.body.password) !== DEMO_PASSWORD) {
    return ctx.fail(401, '沙盒示範密碼是 ' + DEMO_PASSWORD);
  }
  store.authed = true;
  ctx.save();
  return ctx.ok({ authed: true });
}

/* --- 站台設定 --- */
function demoSettings(ctx) {
  if (ctx.method === 'GET') return ctx.ok({ settings: demoClone(ctx.store.settings) });
  var g = ctx.guard();
  if (g) return g;
  var s = ctx.store.settings;
  ['siteName', 'lineId', 'notice', 'defaultCity'].forEach(function (k) {
    if (ctx.body[k] !== undefined) s[k] = ctx.trim(ctx.body[k], 120);
  });
  if (ctx.body.siteOpen !== undefined) s.siteOpen = !!ctx.body.siteOpen;
  s.updated = ctx.stamp();
  ctx.save();
  return ctx.ok({ settings: demoClone(s) });
}

/* --- 重置沙盒（還原成出廠示範資料） --- */
function demoResetApi(ctx) {
  var g = ctx.guard();
  if (g) return g;
  var fresh = demoReset();
  fresh.authed = true;      /* 重置後保持登入，方便繼續操作 */
  demoSave(fresh);
  return ctx.ok({ ok: true, demo: true });
}

/* --- 統計（由沙盒資料即時計算） --- */
function demoStatsApi(ctx) {
  var g = ctx.guard();
  if (g) return g;
  return ctx.ok({ stats: demoStats(ctx.store) });
}

function demoStats(store) {
  var today = demoStamp().slice(0, 5);
  function count(arr, k, v) { return arr.filter(function (x) { return x[k] === v; }).length; }
  var views = store.members.reduce(function (a, m) { return a + (Number(m.views) || 0); }, 0);
  var top = store.members.slice().sort(function (a, b) { return (b.views || 0) - (a.views || 0); })
    .slice(0, 5).map(function (m) { return { id: m.id, name: m.name, views: Number(m.views) || 0 }; });
  return {
    members: {
      total: store.members.length,
      on: count(store.members, 'status', 'on'),
      pending: count(store.members, 'status', 'pending'),
      off: count(store.members, 'status', 'off')
    },
    views: { total: views, top: top },
    bookings: {
      total: store.bookings.length,
      today: store.bookings.filter(function (b) { return String(b.date || '').indexOf(today) === 0; }).length,
      pending: count(store.bookings, 'status', 'pending'),
      confirmed: count(store.bookings, 'status', 'confirmed'),
      done: count(store.bookings, 'status', 'done'),
      cancelled: count(store.bookings, 'status', 'cancelled')
    },
    messages: {
      total: store.messages.length,
      unread: count(store.messages, 'status', 'unread'),
      read: count(store.messages, 'status', 'read'),
      replied: count(store.messages, 'status', 'replied')
    },
    reviews: {
      total: store.reviews.length,
      pending: count(store.reviews, 'status', 'pending'),
      on: count(store.reviews, 'status', 'on'),
      off: count(store.reviews, 'status', 'off')
    },
    reports: {
      total: store.reports.length,
      open: count(store.reports, 'status', 'open'),
      resolved: count(store.reports, 'status', 'resolved'),
      dismissed: count(store.reports, 'status', 'dismissed')
    },
    updatedAt: demoStamp()
  };
}

/* --- 成員（讀取公開；寫入需登入，與後端權限一致） --- */
function demoMembers(ctx) {
  var store = ctx.store;
  var list = store.members;

  if (!ctx.id && ctx.method === 'GET') {
    var out = store.authed ? list : list.filter(function (m) { return m.status === 'on'; });
    return ctx.ok({ members: demoClone(out), count: out.length });
  }

  if (ctx.id && ctx.sub === 'view' && ctx.method === 'POST') {
    var mv = ctx.find(list, ctx.id);
    if (!mv) return ctx.fail(404, '查無成員 #' + ctx.id);
    mv.views = (Number(mv.views) || 0) + 1;
    ctx.save();
    return ctx.ok({ views: mv.views });
  }

  if (ctx.id && !ctx.sub && ctx.method === 'GET') {
    var one = ctx.find(list, ctx.id);
    if (!one) return ctx.fail(404, '查無成員 #' + ctx.id);
    return ctx.ok({ member: demoClone(one) });
  }

  var g = ctx.guard();
  if (g) return g;

  /* 新增成員 */
  if (!ctx.id && ctx.method === 'POST') {
    var name = ctx.trim(ctx.body.name, 20);
    var age = parseInt(ctx.body.age, 10);
    var price = parseInt(ctx.body.price, 10);
    if (!name) return ctx.fail(400, '暱稱為必填欄位');
    if (!age || age < 18) return ctx.fail(400, '年齡需為 18 歲以上的整數');
    if (!price || price <= 0) return ctx.fail(400, '價格需為正整數');

    var imgs = Array.isArray(ctx.body.images) ? ctx.body.images.slice(0, DEMO_IMG_MAX_COUNT) : [];
    var member = {
      id: ctx.nextId('A'),
      name: name, age: age, price: price,
      city: ctx.body.city || '台北市',
      type: ctx.body.type === '定點' ? '定點' : '外送',
      status: ['on', 'pending', 'off'].indexOf(ctx.body.status) !== -1 ? ctx.body.status : 'pending',
      updated: ctx.stamp(), views: 0,
      tags: Array.isArray(ctx.body.tags) ? ctx.body.tags.slice(0, 3) : [],
      flag: ctx.body.flag || '🇹🇼', flagName: ctx.body.flagName || '台灣',
      height: parseInt(ctx.body.height, 10) || 160,
      weight: parseInt(ctx.body.weight, 10) || 45,
      cup: ctx.trim(ctx.body.cup, 4) || 'B',
      intro: ctx.trim(ctx.body.intro, 120),
      images: imgs, img: '', avatar: '',
      services: [], addons: [], slots: []
    };
    if (imgs.length) {
      member.img = imgs[0];
      member.avatar = imgs[0];
    } else {
      member.images = [1, 2, 3, 4].map(function (n) {
        return 'https://placehold.co/600x800/2b2b36/565660/png?text=' + encodeURIComponent(name) + '+' + n;
      });
      member.img = member.images[0];
      member.avatar = 'https://placehold.co/72x72/2b2b36/f4f4f7/png?text=' + encodeURIComponent(name.charAt(0));
    }
    list.push(member);
    if (!ctx.save()) {
      list.pop();
      return ctx.fail(400, '沙盒儲存空間已滿，請先移除部分照片或重置示範資料');
    }
    return ctx.ok({ member: demoClone(member) });
  }

  /* 更新成員（只帶 status 時為快速上下架） */
  if (ctx.id && (ctx.method === 'PUT' || ctx.method === 'PATCH')) {
    var t = ctx.find(list, ctx.id);
    if (!t) return ctx.fail(404, '查無成員 #' + ctx.id);
    if (Object.keys(ctx.body).length === 1 && ctx.body.status !== undefined) {
      if (['on', 'pending', 'off'].indexOf(ctx.body.status) === -1) return ctx.fail(400, '狀態值不正確');
      t.status = ctx.body.status;
      t.updated = ctx.stamp();
      ctx.save();
      return ctx.ok({ member: demoClone(t) });
    }
    ['name', 'city', 'type', 'status', 'flag', 'flagName'].forEach(function (f) {
      if (ctx.body[f] !== undefined) {
        var v = ctx.trim(ctx.body[f], 40);
        if (v) t[f] = v;
      }
    });
    if (ctx.body.age !== undefined) t.age = parseInt(ctx.body.age, 10) || t.age;
    if (ctx.body.price !== undefined) t.price = parseInt(ctx.body.price, 10) || t.price;
    if (ctx.body.height !== undefined) t.height = parseInt(ctx.body.height, 10) || t.height;
    if (ctx.body.weight !== undefined) t.weight = parseInt(ctx.body.weight, 10) || t.weight;
    if (ctx.body.cup !== undefined) t.cup = ctx.trim(ctx.body.cup, 4) || t.cup;
    if (ctx.body.intro !== undefined) t.intro = ctx.trim(ctx.body.intro, 120);
    if (Array.isArray(ctx.body.tags)) t.tags = ctx.body.tags.slice(0, 3);
    if (Array.isArray(ctx.body.images)) {
      t.images = ctx.body.images.slice(0, DEMO_IMG_MAX_COUNT);
      if (t.images.length) { t.img = t.images[0]; t.avatar = t.images[0]; }
    }
    t.updated = ctx.stamp();
    if (!ctx.save()) return ctx.fail(400, '沙盒儲存空間已滿，請先移除部分照片');
    return ctx.ok({ member: demoClone(t) });
  }

  /* 刪除成員（連動清除該成員的評價與檢舉，與後端一致） */
  if (ctx.id && ctx.method === 'DELETE') {
    var idx = -1;
    for (var d = 0; d < list.length; d++) { if (list[d].id === ctx.id) { idx = d; break; } }
    if (idx === -1) return ctx.fail(404, '查無成員 #' + ctx.id);
    var removed = list.splice(idx, 1)[0];
    store.reviews = store.reviews.filter(function (r) { return r.memberId !== ctx.id; });
    store.reports = store.reports.filter(function (p) { return p.memberId !== ctx.id; });
    ctx.save();
    return ctx.ok({ member: demoClone(removed), cleaned: true });
  }

  return ctx.fail(404, '沙盒未支援此成員操作：' + ctx.method);
}

/* --- 顧客評價（讀取與送出公開；審核需登入） --- */
function demoReviews(ctx) {
  var store = ctx.store;

  if (ctx.method === 'GET') {
    var out = store.reviews.slice().sort(function (a, b) {
      return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    });
    var mid = ctx.query.get('memberId');
    if (store.authed) {
      if (mid) out = out.filter(function (r) { return r.memberId === mid; });
    } else {
      if (!mid) return ctx.fail(400, '前台查詢評價需指定 memberId');
      out = out.filter(function (r) { return r.memberId === mid && r.status === 'on'; });
    }
    return ctx.ok({ reviews: demoClone(out), count: out.length });
  }

  if (ctx.method === 'POST') {
    var memberId = ctx.trim(ctx.body.memberId, 16);
    var text = ctx.trim(ctx.body.text, 300);
    if (!memberId) return ctx.fail(400, '缺少評價對象');
    if (!text) return ctx.fail(400, '請填寫評價內容');
    var mb = ctx.find(store.members, memberId);
    if (!mb) return ctx.fail(404, '查無評價對象 #' + memberId);
    var review = {
      id: ctx.nextId('R'), memberId: memberId, memberName: mb.name,
      nick: ctx.trim(ctx.body.nick, 20) || '匿名',
      text: text,
      images: Array.isArray(ctx.body.images) ? ctx.body.images.slice(0, 3) : [],
      /* 沙盒裡沒有其他人能審核，直接顯示才能讓訪客立刻看到成果 */
      status: 'on',
      createdAt: ctx.stamp()
    };
    store.reviews.push(review);
    if (!ctx.save()) {
      store.reviews.pop();
      return ctx.fail(400, '沙盒儲存空間已滿，請先移除部分圖片');
    }
    return ctx.ok({ review: demoClone(review) });
  }

  var g = ctx.guard();
  if (g) return g;
  var target = ctx.find(store.reviews, ctx.id);
  if (!target) return ctx.fail(404, '查無評價 ' + ctx.id);

  if (ctx.method === 'PUT' || ctx.method === 'PATCH') {
    if (ctx.body.status !== undefined) {
      if (['pending', 'on', 'off'].indexOf(ctx.body.status) === -1) return ctx.fail(400, '評價狀態不正確');
      target.status = ctx.body.status;
    }
    if (ctx.body.text !== undefined) target.text = ctx.trim(ctx.body.text, 300);
    if (Array.isArray(ctx.body.images)) target.images = ctx.body.images.slice(0, 3);
    target.updated = ctx.stamp();
    ctx.save();
    return ctx.ok({ review: demoClone(target) });
  }

  if (ctx.method === 'DELETE') {
    store.reviews = store.reviews.filter(function (r) { return r.id !== ctx.id; });
    ctx.save();
    return ctx.ok({ review: demoClone(target) });
  }

  return ctx.fail(404, '沙盒未支援此評價操作：' + ctx.method);
}

/* --- 預約 / 客服訊息 / 檢舉（結構相似，共用處理） --- */
function demoCollection(ctx) {
  var store = ctx.store;
  var CFG = {
    bookings: { key: 'bookings', one: 'booking', prefix: 'B', noun: '預約' },
    messages: { key: 'messages', one: 'message', prefix: 'M', noun: '訊息' },
    reports: { key: 'reports', one: 'report', prefix: 'P', noun: '檢舉' }
  };
  var cfg = CFG[ctx.resource];
  var list = store[cfg.key];

  /* 讀取清單（需登入，與後端權限一致） */
  if (ctx.method === 'GET') {
    var g = ctx.guard();
    if (g) return g;
    var out = list.slice().sort(function (a, b) {
      return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    });
    var payload = { count: out.length, demo: true };
    payload[cfg.key] = demoClone(out);
    return ctx.ok(payload);
  }

  /* 送出（前台公開，任何人都能操作） */
  if (ctx.method === 'POST') {
    var item = { id: ctx.nextId(cfg.prefix), createdAt: ctx.stamp() };

    if (ctx.resource === 'bookings') {
      var mid = ctx.trim(ctx.body.memberId, 16);
      var contact = ctx.trim(ctx.body.contact, 60);
      if (!mid) return ctx.fail(400, '缺少預約對象');
      if (!ctx.body.plan) return ctx.fail(400, '請選擇方案');
      if (!ctx.body.date) return ctx.fail(400, '請選擇可約時間');
      if (!contact) return ctx.fail(400, '請留下聯絡方式（LINE 或手機）');
      var mb = ctx.find(store.members, mid);
      if (!mb) return ctx.fail(404, '查無預約對象 #' + mid);
      var mult = String(ctx.body.plan).indexOf('方案 C') !== -1 ? 3
        : String(ctx.body.plan).indexOf('方案 B') !== -1 ? 2 : 1;
      var plan = ctx.trim(ctx.body.plan, 40);
      var date = ctx.trim(ctx.body.date, 20);
      var time = ctx.trim(ctx.body.time, 20);
      item.memberId = mid;
      item.memberName = mb.name;
      item.plan = plan;
      item.price = Math.round((Number(mb.price) || 0) * mult / 500) * 500;
      item.date = date;
      item.time = time;
      item.contact = contact;
      item.note = ctx.trim(ctx.body.note, 120);
      item.status = 'pending';
      item.reply = '';
      /* 與後端行為一致：同時建立一則客服通知 */
      store.messages.push({
        id: ctx.nextId('M'), name: contact, contact: contact,
        memberId: mid, memberName: mb.name,
        body: '【預約通知】' + mb.name + ' · ' + plan + ' · ' + date + ' ' + time,
        status: 'unread', reply: '', createdAt: ctx.stamp()
      });
    } else if (ctx.resource === 'messages') {
      var nm = ctx.trim(ctx.body.name, 20);
      var text = ctx.trim(ctx.body.body, 300);
      if (!nm) return ctx.fail(400, '請填寫稱呼');
      if (!text) return ctx.fail(400, '請填寫訊息內容');
      if (!ctx.trim(ctx.body.contact, 60)) return ctx.fail(400, '請留下聯絡方式（LINE 或手機）');
      item.name = nm;
      item.contact = ctx.trim(ctx.body.contact, 60);
      item.body = text;
      item.memberId = ctx.trim(ctx.body.memberId, 16);
      item.memberName = ctx.trim(ctx.body.memberName, 20);
      item.status = 'unread';
      item.reply = '';
    } else {
      var reason = ctx.trim(ctx.body.reason, 40);
      var detail = ctx.trim(ctx.body.detail, 300);
      if (!reason) return ctx.fail(400, '請選擇檢舉原因');
      if (!detail) return ctx.fail(400, '請簡述檢舉內容');
      var tgt = ctx.find(store.members, ctx.trim(ctx.body.memberId, 16));
      item.memberId = ctx.trim(ctx.body.memberId, 16);
      item.memberName = tgt ? tgt.name : '';
      item.reason = reason;
      item.detail = detail;
      item.reporter = ctx.trim(ctx.body.reporter, 30) || '匿名使用者';
      item.status = 'open';
    }

    list.push(item);
    if (!ctx.save()) {
      list.pop();
      return ctx.fail(400, '沙盒儲存空間已滿');
    }
    var done = { demo: true };
    done[cfg.one] = demoClone(item);
    return ctx.ok(done);
  }

  /* 更新 / 刪除（需登入，對應後台的確認、完成、回覆、處理等操作） */
  var g2 = ctx.guard();
  if (g2) return g2;
  var t = ctx.find(list, ctx.id);
  if (!t) return ctx.fail(404, '查無' + cfg.noun + ' ' + ctx.id);

  if (ctx.method === 'PUT' || ctx.method === 'PATCH') {
    if (ctx.body.status !== undefined) t.status = ctx.body.status;
    if (ctx.body.reply !== undefined) {
      t.reply = ctx.trim(ctx.body.reply, 300);
      if (ctx.resource === 'messages') t.status = t.reply ? 'replied' : 'read';
    }
    if (ctx.body.note !== undefined) t.handleNote = ctx.trim(ctx.body.note, 160);
    t.updated = ctx.stamp();
    ctx.save();
    var r1 = { demo: true };
    r1[cfg.one] = demoClone(t);
    return ctx.ok(r1);
  }

  if (ctx.method === 'DELETE') {
    store[cfg.key] = list.filter(function (x) { return x.id !== ctx.id; });
    ctx.save();
    var r2 = { demo: true };
    r2[cfg.one] = demoClone(t);
    return ctx.ok(r2);
  }

  return ctx.fail(404, '沙盒未支援此操作：' + ctx.method);
}

//__DEMO_F__

function apiRequest(method, url, body) {
  return detectBackend().then(function (demo) {
    if (demo) return demoResolve(method, url, body);
    return realRequest(method, url, body);
  });
}

function realRequest(method, url, body) {
  var opt = { method: method, credentials: 'same-origin' };
  if (body !== undefined) {
    opt.headers = { 'Content-Type': 'application/json; charset=utf-8' };
    opt.body = JSON.stringify(body);
  }
  return fetch(url, opt).then(function (res) {
    return res.json().catch(function () { return {}; }).then(function (data) {
      if (!res.ok) {
        var err = new Error(data && data.error ? data.error : 'API 請求失敗（HTTP ' + res.status + '）');
        err.status = res.status;
        throw err;
      }
      return data;
    });
  }).catch(function (err) {
    if (err instanceof TypeError) {
      /* fetch 網路層失敗（伺服器未啟動或以 file:// 開啟頁面） */
      throw new Error('無法連線到後端伺服器，請先在專案資料夾執行 node server.js，並從 http://localhost:3000 開啟頁面');
    }
    throw err;
  });
}

/* 產生單一資源的標準 CRUD 介面 */
function resourceApi(name, key) {
  return {
    list: function (query) {
      return apiRequest('GET', '/api/' + name + (query ? '?' + query : '')).then(function (d) { return d[key]; });
    },
    create: function (data) {
      return apiRequest('POST', '/api/' + name, data).then(function (d) { return d[key.replace(/s$/, '')] || d[key]; });
    },
    update: function (id, data) {
      return apiRequest('PUT', '/api/' + name + '/' + encodeURIComponent(id), data)
        .then(function (d) { return d[key.replace(/s$/, '')] || d[key]; });
    },
    remove: function (id) {
      return apiRequest('DELETE', '/api/' + name + '/' + encodeURIComponent(id))
        .then(function (d) { return d[key.replace(/s$/, '')] || d[key]; });
    }
  };
}

var API = {
  /* Session */
  session: function () { return apiRequest('GET', '/api/session'); },
  login:   function (password) { return apiRequest('POST', '/api/login', { password: password }); },
  logout:  function () { return apiRequest('POST', '/api/logout'); },

  /* 站台設定 */
  settings:       function () { return apiRequest('GET', '/api/settings').then(function (d) { return d.settings; }); },
  updateSettings: function (data) { return apiRequest('PUT', '/api/settings', data).then(function (d) { return d.settings; }); },

  /* 統計與重置 */
  stats: function () { return apiRequest('GET', '/api/stats').then(function (d) { return d.stats; }); },
  reset: function () { return apiRequest('POST', '/api/reset'); },

  /* 成員（含瀏覽次數上報） */
  members: Object.assign(resourceApi('members', 'members'), {
    get:  function (id) { return apiRequest('GET', '/api/members/' + encodeURIComponent(id)).then(function (d) { return d.member; }); },
    view: function (id) { return apiRequest('POST', '/api/members/' + encodeURIComponent(id) + '/view').then(function (d) { return d.views; }); }
  }),

  bookings: resourceApi('bookings', 'bookings'),
  messages: resourceApi('messages', 'messages'),
  reviews:  resourceApi('reviews', 'reviews'),
  reports:  resourceApi('reports', 'reports'),

  /* 圖片上傳（後台用；檔案實際由後端寫入 uploads/） */
  upload:       uploadImage,
  uploadMany:   uploadImages,
  deleteUpload: deleteUpload,
  listUploads:  function () { return apiRequest('GET', '/api/uploads').then(function (d) { return d.uploads; }); }
};

/* ---------- DOM 與格式化工具 ---------- */
function $(sel, el) { return (el || document).querySelector(sel); }
function $$(sel, el) { return Array.prototype.slice.call((el || document).querySelectorAll(sel)); }

/* HTML 跳脫（防 XSS，所有動態內容都經此處理） */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

/* 圖片備援（防止資料缺欄位時破版） */
function memberImg(m, n) {
  if (m && Array.isArray(m.images) && m.images.length && n !== undefined) {
    return m.images[n - 1] || m.img || '';
  }
  return (m && m.img) || 'https://placehold.co/600x800/2b2b36/565660/png?text=Photo';
}

function memberAvatar(m) {
  return (m && m.avatar) || ('https://placehold.co/72x72/2b2b36/f4f4f7/png?text=' + encodeURIComponent((m && m.name ? m.name : '?').charAt(0)));
}

/* 價格格式化 → $4,000 */
function fmtPrice(n) {
  return '$' + Number(n || 0).toLocaleString('en-US');
}

/* 數字千分位 → 12,480 */
function fmtNum(n) {
  return Number(n || 0).toLocaleString('en-US');
}

/* 依方案推算價格（與後端 planPrice 一致，供前台即時顯示） */
function planPrice(base, plan) {
  var p = Number(base) || 0;
  var mult = String(plan).indexOf('方案 C') !== -1 ? 3 : String(plan).indexOf('方案 B') !== -1 ? 2 : 1;
  return Math.round(p * mult / 500) * 500;
}

/* 狀態徽章 HTML */
function statusBadge(status, kind) {
  var text = (LABELS[kind] && LABELS[kind][status]) || status || '—';
  return '<span class="badge ' + esc(status) + '">' + esc(text) + '</span>';
}

/* 讀取網址查詢參數 */
function queryParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

/* ---------- Toast 提示 ---------- */
function showToast(msg) {
  var t = $('.toast');
  if (!t) {
    t = document.createElement('div');
    t.className = 'toast';
    t.setAttribute('role', 'status');
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(function () { t.classList.remove('show'); }, 2400);
}

/* ---------- Modal 開關 ---------- */
function openModal(el) { if (el) el.classList.add('open'); }
function closeModal(el) { if (el) el.classList.remove('open'); }

document.addEventListener('click', function (e) {
  if (e.target.classList && e.target.classList.contains('backdrop')) {
    closeModal(e.target.closest('.modal'));
  }
});

document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') {
    $$('.modal.open').forEach(function (m) { closeModal(m); });
  }
});

/* ---------- 客服訊息彈窗（動態產生，三個前台頁面共用） ---------- */
function ensureContactModal() {
  var modal = $('#contact-modal');
  if (modal) return modal;

  modal = document.createElement('div');
  modal.className = 'modal';
  modal.id = 'contact-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'contact-title');
  modal.innerHTML =
    '<div class="backdrop"></div>' +
    '<div class="dialog">' +
      '<h2 class="modal-title" id="contact-title">聯絡客服</h2>' +
      '<p class="dialog-sub" id="cm-from-label"></p>' +
      '<div class="field">' +
        '<label for="cm-name">你的稱呼</label>' +
        '<input id="cm-name" type="text" maxlength="20" placeholder="例如：小林" />' +
      '</div>' +
      '<div class="field">' +
        '<label for="cm-contact">聯絡方式（LINE ID 或手機）</label>' +
        '<input id="cm-contact" type="text" maxlength="60" placeholder="例如：line: xiaolin88" />' +
      '</div>' +
      '<div class="field">' +
        '<label for="cm-body">想詢問的內容</label>' +
        '<textarea id="cm-body" rows="4" maxlength="300" placeholder="請描述你的需求或問題"></textarea>' +
      '</div>' +
      '<input type="hidden" id="cm-member" />' +
      '<div class="modal-actions">' +
        '<button class="btn" id="cm-cancel" type="button">取消</button>' +
        '<button class="btn primary" id="cm-send" type="button">送出訊息</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(modal);

  $('#cm-cancel', modal).addEventListener('click', function () { closeModal(modal); });
  $('#cm-send', modal).addEventListener('click', function () { submitContact(); });
  return modal;
}

/* 開啟客服彈窗；from 為來源頁面說明，member 為相關成員（可省略） */
function openContactModal(from, member) {
  var modal = ensureContactModal();
  $('#cm-from-label').textContent = (from ? from + ' · ' : '') + '客服將透過你留下的聯絡方式回覆（示範站台）';
  $('#cm-name').value = '';
  $('#cm-contact').value = '';
  $('#cm-body').value = '';
  if (member) {
    $('#cm-body').value = '我想詢問 ' + member.name + '（#' + member.id + '）的方案與時間安排。';
  }
  $('#cm-member').value = member ? member.id + '|' + member.name : '|';
  openModal(modal);
  $('#cm-name').focus();
}

function submitContact() {
  var name = $('#cm-name').value.trim();
  var contact = $('#cm-contact').value.trim();
  var body = $('#cm-body').value.trim();
  if (!name) { showToast('請填寫稱呼'); return; }
  if (!contact) { showToast('請留下聯絡方式'); return; }
  if (!body) { showToast('請填寫想詢問的內容'); return; }

  var parts = ($('#cm-member').value || '|').split('|');
  var btn = $('#cm-send');
  btn.disabled = true;
  btn.textContent = '送出中…';

  API.messages.create({
    name: name, contact: contact, body: body,
    memberId: parts[0] || '', memberName: parts[1] || ''
  }).then(function () {
    closeModal($('#contact-modal'));
    showToast('訊息已送出，客服會盡快回覆你');
  }).catch(function (err) {
    showToast(err.message);
  }).then(function () {
    btn.disabled = false;
    btn.textContent = '送出訊息';
  });
}

/* ---------- 靜態示範版提示橫幅 ---------- */
function showDemoBanner() {
  if (document.getElementById('demo-banner')) return;
  var el = document.createElement('div');
  el.id = 'demo-banner';
  el.className = 'demo-banner';
  el.setAttribute('role', 'status');
  var text = document.createElement('span');
  text.textContent = '示範沙盒：資料存在你的瀏覽器，可以自由操作（送出預約／評價／檢舉、進入後台試玩）。重新整理仍會保留，清除瀏覽資料則會重置。';
  var close = document.createElement('button');
  close.type = 'button';
  close.className = 'close';
  close.setAttribute('aria-label', '關閉提示');
  close.textContent = '✕';
  close.addEventListener('click', function () { el.remove(); });
  el.appendChild(text);
  el.appendChild(close);
  document.body.insertBefore(el, document.body.firstChild);
}

/* ---------- 站台設定（公告 / LINE ID / 站台名稱） ---------- */
function applySiteSettings(s) {
  if (!s) return;
  /* 站台名稱 */
  $$('[data-site-name]').forEach(function (el) { el.textContent = s.siteName || 'Escort'; });
  /* LINE ID（詳情頁彈窗與各處文字） */
  $$('[data-line-id]').forEach(function (el) { el.textContent = s.lineId || ''; });
  /* 公告（使用 localStorage 記住已關閉） */
  var notice = $('#site-notice');
  if (notice) {
    var textEl = $('#site-notice-text');
    if (s.notice && !localStorage.getItem('notice_closed')) {
      if (textEl) textEl.textContent = s.notice;
      notice.classList.add('show');
    }
    var closeBtn = $('#notice-close');
    if (closeBtn && !closeBtn._wired) {
      closeBtn._wired = true;
      closeBtn.addEventListener('click', function () {
        notice.classList.remove('show');
        try { localStorage.setItem('notice_closed', '1'); } catch (e) { /* 忽略 */ }
      });
    }
  }
  /* 站台暫停接單提示 */
  var closed = $('#site-closed');
  if (closed && !s.siteOpen) closed.classList.add('show');
}

/* ---------- 圖片上傳工具（後台新增成員 / 上傳客評圖片共用） ---------- */
var IMG_MAX_BYTES = 3 * 1024 * 1024;        /* 與後端一致：單張上限 3MB（解碼後） */
var IMG_FILE_LIMIT = 12 * 1024 * 1024;      /* 允許選擇的來源檔案上限（會先縮圖再上傳） */

/* 將檔案讀成 data URL；過大的圖片會先用 canvas 縮圖壓縮，失敗則回傳原圖 */
function readImageFile(file) {
  return new Promise(function (resolve, reject) {
    if (!file) { reject(new Error('沒有選擇檔案')); return; }
    if (!/^image\//.test(file.type)) { reject(new Error('請選擇圖片檔案（PNG / JPEG / GIF / WebP）')); return; }
    if (file.size > IMG_FILE_LIMIT) {
      reject(new Error('檔案過大（上限 ' + Math.round(IMG_FILE_LIMIT / 1024 / 1024) + 'MB）'));
      return;
    }
    var reader = new FileReader();
    reader.onerror = function () { reject(new Error('讀取檔案失敗')); };
    reader.onload = function () {
      var raw = String(reader.result || '');
      /* 小檔或 GIF 直接使用原圖（避免失去動畫 / 不必要的重新編碼） */
      if (file.size <= 1.2 * 1024 * 1024 || file.type === 'image/gif') {
        resolve(raw);
        return;
      }
      downscaleImage(raw, 1400, 0.85).then(resolve, function () { resolve(raw); });
    };
    reader.readAsDataURL(file);
  });
}

/* 以 canvas 等比縮圖為 JPEG data URL（不放大既有小圖） */
function downscaleImage(dataUrl, maxDim, quality) {
  return new Promise(function (resolve, reject) {
    var img = new Image();
    img.onerror = function () { reject(new Error('圖片解析失敗')); };
    img.onload = function () {
      try {
        if (img.width <= maxDim && img.height <= maxDim) { resolve(dataUrl); return; }
        var scale = Math.min(maxDim / img.width, maxDim / img.height);
        var w = Math.max(1, Math.round(img.width * scale));
        var h = Math.max(1, Math.round(img.height * scale));
        var cv = document.createElement('canvas');
        cv.width = w;
        cv.height = h;
        var ctx = cv.getContext('2d');
        /* 白底，避免透明 PNG 轉 JPEG 後變黑 */
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        resolve(cv.toDataURL('image/jpeg', quality || 0.85));
      } catch (e) {
        reject(e);
      }
    };
    img.src = dataUrl;
  });
}

/* 上傳單張圖片（接受 File 或 data URL）→ { name, url, size, mime } */
function uploadImage(input) {
  var prep = (typeof input === 'string') ? Promise.resolve(input) : readImageFile(input);
  return prep.then(function (dataUrl) {
    return apiRequest('POST', '/api/uploads', { data: dataUrl });
  }).then(function (d) { return d.file; });
}

/* 批次上傳（逐一送出，避免單次請求過大） */
function uploadImages(files) {
  var list = Array.prototype.slice.call(files || []);
  var out = [];
  return list.reduce(function (chain, f) {
    return chain.then(function () {
      return uploadImage(f).then(function (info) { out.push(info); });
    });
  }, Promise.resolve()).then(function () { return out; });
}

/* 由 URL 取出上傳檔名（非上傳檔則回 null） */
function uploadNameOf(url) {
  var m = /^\/uploads\/([\w.-]+)$/.exec(String(url || ''));
  return m ? m[1] : null;
}

/* 刪除未被引用的上傳檔（仍被引用時後端會回 409，呼叫端可忽略） */
function deleteUpload(url) {
  var name = uploadNameOf(url);
  if (!name) return Promise.resolve({ skipped: true });
  return apiRequest('DELETE', '/api/uploads/' + encodeURIComponent(name));
}