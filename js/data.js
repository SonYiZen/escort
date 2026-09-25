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

/* 示範資料查詢（回應格式與後端一致；寫入類一律回 403 提示） */
function demoResolve(method, url) {
  var d = window.DEMO_DATA || {};
  var members = d.members || [];
  var reviews = d.reviews || [];
  var pathname = String(url).split('?')[0];
  var qs = String(url).indexOf('?') > -1 ? String(url).split('?')[1] : '';
  var query = new URLSearchParams(qs);
  var seg = pathname.split('/').filter(Boolean);
  var resource = seg[1] || '';
  var id = seg[2] ? decodeURIComponent(seg[2]) : '';
  var sub = seg[3] ? decodeURIComponent(seg[3]) : '';

  function ok(obj) { return Promise.resolve(obj); }
  function refuse(what) {
    var err = new Error('這是靜態示範版（未連接後端），「' + what + '」僅在執行 node server.js 的環境可用');
    err.status = 403;
    return Promise.reject(err);
  }

  if (resource === 'health') return ok({ ok: true, demo: true, count: members.length });
  if (resource === 'session') {
    return ok({
      authed: false, shareMode: true, demo: true,
      siteName: (d.settings || {}).siteName || 'Escort',
      siteOpen: (d.settings || {}).siteOpen !== false
    });
  }
  if (resource === 'settings') {
    if (method === 'GET') return ok(d.settings || {});
    return refuse('修改站台設定');
  }
  if (resource === 'members') {
    if (!id && method === 'GET') return ok({ members: members, count: members.length });
    if (id && sub === 'view' && method === 'POST') {
      var mv = members.filter(function (x) { return x.id === id; })[0];
      return ok({ views: mv ? (Number(mv.views) || 0) + 1 : 0 });   /* 示範版不寫檔，僅供畫面顯示 */
    }
    if (id && !sub && method === 'GET') {
      var hit = members.filter(function (x) { return x.id === id; })[0];
      if (!hit) {
        var e404 = new Error('查無成員 #' + id);
        e404.status = 404;
        return Promise.reject(e404);
      }
      return ok({ member: hit });
    }
    return refuse('管理成員資料');
  }
  if (resource === 'reviews') {
    if (method === 'GET') {
      var mid = query.get('memberId');
      if (!mid) {
        var e400 = new Error('前台查詢評價需指定 memberId');
        e400.status = 400;
        return Promise.reject(e400);
      }
      var list = reviews.filter(function (r) { return r.memberId === mid; });
      return ok({ reviews: list, count: list.length });
    }
    return refuse('送出評價');
  }
  if (resource === 'bookings') return refuse('送出預約');
  if (resource === 'messages') return refuse('送出客服訊息');
  if (resource === 'reports') return refuse('送出檢舉');
  if (resource === 'login') return refuse('登入後台');
  if (resource === 'logout') return refuse('登出後台');
  if (resource === 'stats') return refuse('瀏覽後台統計');
  if (resource === 'reset') return refuse('重置示範資料');
  if (resource === 'uploads') return refuse('上傳圖片');

  return refuse('此功能');
}

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
  text.textContent = '靜態示範版：可自由瀏覽列表與個人頁面；預約、訊息、評價等送出功能需搭配後端（node server.js）才能使用。';
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