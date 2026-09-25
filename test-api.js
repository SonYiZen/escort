/* ==================================================
   自動化驗證腳本 — node test-api.js
   啟動 server.js 子程序 → 測試靜態伺服、認證、各資源 API → 自動關閉
   退出碼：0 = 全部通過；1 = 有測項失敗；2 = 環境錯誤
   ================================================== */
'use strict';

var spawn = require('child_process').spawn;
var http = require('http');
var fs = require('fs');
var path = require('path');

var ROOT = __dirname;
var PORT = 3000;
var DATA_DIR = path.join(ROOT, 'data');
var UPLOAD_DIR = path.join(ROOT, 'uploads');
var BACKUP_DIR = path.join(ROOT, '.test-backup');
var results = [];
var child = null;
var cookie = '';

/* 測試用圖片：含正確 PNG magic bytes 的假 PNG（供後端 magic bytes 檢查通過） */
var PNG_DATA_URL = 'data:image/png;base64,' + Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(160, 7)
]).toString('base64');

/* 讀取目前設定的管理密碼（後台可自行修改，因此不能寫死） */
function readAdminPassword() {
  try {
    var s = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'settings.json'), 'utf8'));
    if (s && s.adminPassword) return String(s.adminPassword);
  } catch (e) { /* 尚未建立設定檔時使用預設值 */ }
  return 'admin1234';
}
var ADMIN_PASSWORD = readAdminPassword();

/* 測試會呼叫「重置示範資料」等破壞性 API，因此先備份、結束後還原使用者資料 */
function backupData() {
  try {
    fs.rmSync(BACKUP_DIR, { recursive: true, force: true });
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    ['data', 'uploads'].forEach(function (dir) {
      var src = path.join(ROOT, dir);
      var dst = path.join(BACKUP_DIR, dir);
      if (!fs.existsSync(src)) return;
      fs.mkdirSync(dst, { recursive: true });
      fs.readdirSync(src).forEach(function (f) {
        var from = path.join(src, f);
        if (fs.statSync(from).isFile()) fs.copyFileSync(from, path.join(dst, f));
      });
    });
    return true;
  } catch (e) {
    console.log('⚠ 無法備份現有資料（' + e.message + '），測試仍會繼續');
    return false;
  }
}

function restoreData() {
  try {
    ['data', 'uploads'].forEach(function (dir) {
      var src = path.join(BACKUP_DIR, dir);
      var dst = path.join(ROOT, dir);
      if (!fs.existsSync(src)) return;
      fs.mkdirSync(dst, { recursive: true });
      fs.readdirSync(src).forEach(function (f) {
        fs.copyFileSync(path.join(src, f), path.join(dst, f));
      });
    });
    fs.rmSync(BACKUP_DIR, { recursive: true, force: true });
    return true;
  } catch (e) {
    console.log('⚠ 還原資料失敗：' + e.message + '（備份仍在 ' + BACKUP_DIR + '）');
    return false;
  }
}

function startServer() {
  return new Promise(function (resolve, reject) {
    child = spawn(process.execPath, [path.join(ROOT, 'server.js')], { cwd: ROOT });
    var out = '';
    function onData(d) { out += d.toString('utf8'); }
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    var timer = setTimeout(function () { reject(new Error('伺服器啟動逾時：' + out)); }, 8000);
    var poll = setInterval(function () {
      if (out.indexOf('已啟動') !== -1) {
        clearTimeout(timer);
        clearInterval(poll);
        resolve();
      }
    }, 50);
    child.on('exit', function (code) {
      clearInterval(poll);
      clearTimeout(timer);
      reject(new Error('伺服器提前結束（code ' + code + '）：' + out));
    });
  });
}

function req(method, p, body, opts) {
  opts = opts || {};
  return new Promise(function (resolve, reject) {
    var headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json; charset=utf-8';
    if (opts.cookie && cookie) headers.Cookie = cookie;

    var r = http.request({ host: 'localhost', port: PORT, path: p, method: method, headers: headers }, function (res) {
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        var setCookie = res.headers['set-cookie'];
        if (opts.capture && setCookie && setCookie[0]) {
          cookie = setCookie[0].split(';')[0];
        }
        resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8'), setCookie: setCookie });
      });
    });
    r.on('error', reject);
    if (body !== undefined) r.write(Buffer.from(JSON.stringify(body), 'utf8'));
    r.end();
  });
}

function json(res) {
  try { return JSON.parse(res.body); } catch (e) { return {}; }
}

function check(label, cond, extra) {
  results.push((cond ? 'PASS' : 'FAIL') + '  ' + label + (extra ? '  [' + extra + ']' : ''));
}

/* 斷言 HTTP 狀態碼 */
function expectStatus(label, want, method, p, body, opts) {
  return req(method, p, body, opts).then(function (res) {
    check(label, res.status === want, 'got ' + res.status);
    return res;
  }, function (err) {
    check(label, false, String(err && err.message));
    return {};
  });
}

/* 檢查 JSON 內容（斷言函式若丟出例外，視為失敗而非中斷整套測試） */
function expectJson(label, method, p, assertFn, opts) {
  return req(method, p, undefined, opts).then(function (res) {
    var data = json(res);
    var passed = false;
    try {
      passed = !!assertFn(data, res);
    } catch (e) {
      passed = false;
    }
    check(label, passed, 'status ' + res.status + ' ' + res.body.slice(0, 90));
    return data;
  }, function (err) {
    check(label, false, String(err && err.message));
    return {};
  });
}

function runSuite() {
  var p = Promise.resolve();

  /* ---------- 1. 靜態資產 ---------- */
  ['/', '/index.html', '/detail.html', '/admin.html', '/guide.html',
   '/css/index.css', '/css/detail.css', '/css/admin.css', '/css/common.css', '/css/guide.css',
   '/js/data.js', '/js/app.js', '/js/admin.js', '/js/guide.js'
  ].forEach(function (asset) {
    p = p.then(function () { return expectStatus('GET ' + asset, 200, 'GET', asset); });
  });

  /* ---------- 2. 錯誤路徑與防護 ---------- */
  p = p.then(function () { return expectStatus('404 不存在的靜態檔', 404, 'GET', '/no-such-file.html'); });
  p = p.then(function () { return expectStatus('405 對靜態路徑 POST', 405, 'POST', '/index.html'); });
  p = p.then(function () { return expectStatus('403 反斜線路徑穿越防護', 403, 'GET', '/%5C..%5C..%5Cserver.js'); });
  p = p.then(function () { return expectStatus('403 資料檔不可直接下載', 403, 'GET', '/data/settings.json'); });

  /* ---------- 3. 公開 API（未登入） ---------- */
  p = p.then(function () {
    return expectJson('GET /api/session 未登入回 authed:false', 'GET', '/api/session', function (d, r) {
      return r.status === 200 && d.authed === false;
    });
  });
  p = p.then(function () {
    return expectJson('GET /api/settings 不洩漏管理密碼', 'GET', '/api/settings', function (d, r) {
      return r.status === 200 && d.settings && d.settings.adminPassword === undefined && typeof d.settings.siteName === 'string';
    });
  });
  p = p.then(function () {
    return expectJson('GET /api/members 未登入只回上架中成員', 'GET', '/api/members', function (d, r) {
      return r.status === 200 && Array.isArray(d.members) &&
        d.members.length > 0 && d.members.every(function (m) { return m.status === 'on'; });
    });
  });
  p = p.then(function () { return expectStatus('401 GET /api/stats 未登入', 401, 'GET', '/api/stats'); });
  p = p.then(function () { return expectStatus('401 GET /api/bookings 未登入', 401, 'GET', '/api/bookings'); });
  p = p.then(function () { return expectStatus('401 GET /api/messages 未登入', 401, 'GET', '/api/messages'); });
  p = p.then(function () { return expectStatus('401 GET /api/reports 未登入', 401, 'GET', '/api/reports'); });
  p = p.then(function () { return expectStatus('401 POST /api/members 未登入（新增須登入）', 401, 'POST', '/api/members', { name: 'x', age: 20, price: 3000 }); });
  p = p.then(function () { return expectStatus('400 前台查評價未指定 memberId', 400, 'GET', '/api/reviews'); });

  /* ---------- 4. 登入 ---------- */
  p = p.then(function () {
    return expectStatus('401 密碼錯誤無法登入', 401, 'POST', '/api/login', { password: 'wrong-password' });
  });
  p = p.then(function () {
    return req('POST', '/api/login', { password: ADMIN_PASSWORD }, { capture: true }).then(function (res) {
      check('200 以目前設定的密碼可登入並取得 Cookie', res.status === 200 && !!res.setCookie, 'status ' + res.status + ' cookie=' + !!res.setCookie);
    });
  });
  p = p.then(function () {
    return expectJson('登入後 GET /api/session authed:true', 'GET', '/api/session', function (d, r) {
      return r.status === 200 && d.authed === true;
    }, { cookie: true });
  });
  p = p.then(function () {
    return expectJson('登入後 GET /api/members 可取得全部狀態', 'GET', '/api/members', function (d, r) {
      var st = d.members.map(function (m) { return m.status; });
      return r.status === 200 && st.indexOf('pending') !== -1 && st.indexOf('off') !== -1;
    }, { cookie: true });
  });
  /* ---------- 5. 前台預約流程（公開送出 → 後台處理） ---------- */
  var bookingId = null;
  var messageId = null;
  var reviewId = null;
  var reportId = null;

  p = p.then(function () {
    var body = {
      memberId: 'A1024', plan: '方案 B／100 分鐘',
      date: '01-01（測試）', time: '18:00~02:00', contact: 'line: test_user', note: '自動測試'
    };
    return req('POST', '/api/bookings', body).then(function (res) {
      var d = json(res);
      bookingId = d.booking && d.booking.id;
      check('201 前台送出預約（後端依方案計算金額 $8,000）',
        res.status === 201 && !!bookingId && d.booking.price === 8000 && d.booking.status === 'pending',
        'status ' + res.status + ' id=' + bookingId + ' price=' + (d.booking && d.booking.price));
    });
  });
  p = p.then(function () {
    return expectJson('後台可看到剛送出的預約', 'GET', '/api/bookings', function (d) {
      return Array.isArray(d.bookings) && d.bookings.some(function (b) { return b.id === bookingId; });
    }, { cookie: true });
  });
  p = p.then(function () {
    return expectJson('預約送出時同步建立客服通知訊息', 'GET', '/api/messages', function (d) {
      return d.messages.some(function (m) { return m.body.indexOf('【預約通知】') === 0 && m.memberId === 'A1024'; });
    }, { cookie: true });
  });
  p = p.then(function () {
    return expectStatus('400 預約缺少聯絡方式被拒', 400, 'POST', '/api/bookings',
      { memberId: 'A1024', plan: '方案 A／50 分鐘', date: 'x', contact: '' });
  });
  p = p.then(function () {
    return expectStatus('404 預約不存在的成員被拒', 404, 'POST', '/api/bookings',
      { memberId: 'A9999', plan: '方案 A／50 分鐘', date: 'x', contact: 'line: t' });
  });
  p = p.then(function () {
    return req('PUT', '/api/bookings/' + bookingId, { status: 'confirmed' }, { cookie: true }).then(function (res) {
      check('後台確認預約（狀態改為 confirmed）', res.status === 200 && json(res).booking.status === 'confirmed', 'status ' + res.status);
    });
  });

  /* ---------- 6. 客服訊息（公開送出 → 後台回覆） ---------- */
  p = p.then(function () {
    return req('POST', '/api/messages', { name: '測試訪客', contact: 'line: tester', body: '自動測試訊息內容' }).then(function (res) {
      var d = json(res);
      messageId = d.message && d.message.id;
      check('201 前台送出客服訊息（未讀）', res.status === 201 && !!messageId && d.message.status === 'unread',
        'status ' + res.status + ' id=' + messageId);
    });
  });
  p = p.then(function () {
    return expectStatus('400 訊息內容為空被拒', 400, 'POST', '/api/messages', { name: 'x', contact: 'y', body: '' });
  });
  p = p.then(function () {
    return req('PUT', '/api/messages/' + messageId, { reply: '已收到，將盡快回覆您' }, { cookie: true }).then(function (res) {
      check('後台回覆訊息（狀態轉為 replied）', res.status === 200 && json(res).message.status === 'replied', 'status ' + res.status);
    });
  });
  p = p.then(function () {
    return expectStatus('400 非法訊息狀態值被拒', 400, 'PUT', '/api/messages/' + messageId, { status: 'xxx' }, { cookie: true });
  });

  /* ---------- 7. 客評審核（公開送出 → 審核後才顯示） ---------- */
  p = p.then(function () {
    return req('POST', '/api/reviews', { memberId: 'A1024', nick: '測試客', text: '自動測試評價內容' }).then(function (res) {
      var d = json(res);
      reviewId = d.review && d.review.id;
      check('201 前台送出評價（預設待審核）', res.status === 201 && !!reviewId && d.review.status === 'pending',
        'status ' + res.status + ' id=' + reviewId);
    });
  });
  p = p.then(function () {
    return expectJson('未審核的評價不會出現在前台', 'GET', '/api/reviews?memberId=A1024', function (d) {
      return Array.isArray(d.reviews) && d.reviews.every(function (r) { return r.id !== reviewId; });
    });
  });
  p = p.then(function () {
    return req('PUT', '/api/reviews/' + reviewId, { status: 'on' }, { cookie: true }).then(function (res) {
      check('後台審核通過評價', res.status === 200 && json(res).review.status === 'on', 'status ' + res.status);
    });
  });
  p = p.then(function () {
    return expectJson('審核通過後前台即可看到該評價', 'GET', '/api/reviews?memberId=A1024', function (d) {
      return d.reviews.some(function (r) { return r.id === reviewId; });
    });
  });
  p = p.then(function () {
    return expectStatus('400 評價內容為空被拒', 400, 'POST', '/api/reviews', { memberId: 'A1024', text: '' });
  });

  /* ---------- 8. 檢舉處理 ---------- */
  p = p.then(function () {
    return req('POST', '/api/reports', { memberId: 'A1024', reason: '自動測試原因', detail: '自動測試檢舉內容' }).then(function (res) {
      var d = json(res);
      reportId = d.report && d.report.id;
      check('201 前台送出檢舉（狀態 open 且帶出成員名稱）',
        res.status === 201 && !!reportId && d.report.status === 'open' &&
        typeof d.report.memberName === 'string' && d.report.memberName.length > 0,
        'status ' + res.status + ' id=' + reportId + ' memberName=' + (d.report && d.report.memberName));
    });
  });
  p = p.then(function () {
    return req('PUT', '/api/reports/' + reportId, { status: 'resolved', note: '自動測試處理完成' }, { cookie: true }).then(function (res) {
      var d = json(res);
      check('後台處理檢舉（狀態 resolved 並寫入備註）',
        res.status === 200 && d.report.status === 'resolved' && d.report.handleNote === '自動測試處理完成', 'status ' + res.status);
    });
  });
  p = p.then(function () {
    return expectStatus('400 檢舉缺少說明被拒', 400, 'POST', '/api/reports', { reason: 'x', detail: '' });
  });

  /* ---------- 9. 瀏覽次數（前台開啟詳情頁時上報） ---------- */
  p = p.then(function () {
    return req('GET', '/api/members/A1024').then(function (res) {
      var before = json(res).member.views;
      return req('POST', '/api/members/A1024/view').then(function (res2) {
        var after = json(res2).views;
        check('前台瀏覽上報使瀏覽次數 +1', res2.status === 200 && after === before + 1, before + ' → ' + after);
      });
    });
  });
  p = p.then(function () {
    return expectJson('統計端點包含瀏覽數與熱門排行', 'GET', '/api/stats', function (d) {
      return d.stats && d.stats.views.total > 0 && d.stats.views.top.length > 0 && d.stats.members.total > 0;
    }, { cookie: true });
  });

  /* ---------- 10. 成員 CRUD（需登入） ---------- */
  var newMemberId = null;
  p = p.then(function () {
    var body = { name: '自動測試', age: 24, price: 3600, city: '台中市', type: '定點', status: 'on', height: 165, weight: 48, cup: 'D', tags: ['測試', '中文'] };
    return req('POST', '/api/members', body, { cookie: true }).then(function (res) {
      var d = json(res);
      newMemberId = d.member && d.member.id;
      check('201 後台新增成員（中文資料 round-trip）',
        res.status === 201 && !!newMemberId && d.member.name === '自動測試' && d.member.city === '台中市' && d.member.images.length === 4,
        'status ' + res.status + ' id=' + newMemberId);
    });
  });
  p = p.then(function () {
    return expectJson('新增的上架成員出現在前台列表', 'GET', '/api/members', function (d) {
      return d.members.some(function (m) { return m.id === newMemberId; });
    });
  });
  p = p.then(function () {
    return req('PUT', '/api/members/' + newMemberId, { status: 'off' }, { cookie: true }).then(function (res) {
      check('後台快速下架（只帶 status 的部分更新）', res.status === 200 && json(res).member.status === 'off', 'status ' + res.status);
    });
  });
  p = p.then(function () {
    return expectJson('下架後不再出現於前台列表', 'GET', '/api/members', function (d) {
      return d.members.every(function (m) { return m.id !== newMemberId; });
    });
  });
  p = p.then(function () {
    return expectStatus('400 新增成員資料不合法被拒', 400, 'POST', '/api/members', { name: '', age: 12, price: 0 }, { cookie: true });
  });
  p = p.then(function () {
    return expectStatus('404 更新不存在的成員', 404, 'PUT', '/api/members/A9999', { status: 'on' }, { cookie: true });
  });
  p = p.then(function () {
    return expectStatus('200 刪除測試成員', 200, 'DELETE', '/api/members/' + newMemberId, undefined, { cookie: true });
  });
  p = p.then(function () {
    return expectStatus('404 已刪除的成員查不到', 404, 'GET', '/api/members/' + newMemberId);
  });

  /* ---------- 11. 系統設定（後台） ---------- */
  p = p.then(function () {
    return req('PUT', '/api/settings', {
      siteName: '測試站台', lineId: '@test_line', notice: '自動測試公告',
      defaultCity: '台中市', siteOpen: false
    }, { cookie: true }).then(function (res) {
      var d = json(res);
      check('後台更新站台設定（名稱 / LINE ID / 公告 / 預設縣市 / 接單開關）',
        res.status === 200 && d.settings.siteName === '測試站台' && d.settings.lineId === '@test_line' &&
        d.settings.siteOpen === false && d.settings.defaultCity === '台中市',
        'status ' + res.status);
    });
  });
  p = p.then(function () {
    return expectJson('前台可讀到更新後的設定（且不含密碼）', 'GET', '/api/settings', function (d) {
      return d.settings.siteName === '測試站台' && d.settings.lineId === '@test_line' && d.settings.adminPassword === undefined;
    });
  });
  p = p.then(function () {
    return expectStatus('400 管理密碼太短被拒', 400, 'PUT', '/api/settings', { adminPassword: '123' }, { cookie: true });
  });
  p = p.then(function () {
    return expectStatus('401 未登入不可修改設定', 401, 'PUT', '/api/settings', { siteName: 'x' });
  });

  /* ---------- 11b. 圖片上傳（後台新增成員照片 / 客評圖片） ---------- */
  var uploadUrl = null;
  var uploadName = null;

  p = p.then(function () { return expectStatus('401 未登入不可上傳圖片', 401, 'POST', '/api/uploads', { data: PNG_DATA_URL }); });
  p = p.then(function () { return expectStatus('401 未登入不可列出上傳檔', 401, 'GET', '/api/uploads'); });
  p = p.then(function () { return expectStatus('401 未登入不可刪除上傳檔', 401, 'DELETE', '/api/uploads/img-x.png'); });

  p = p.then(function () {
    return expectStatus('400 缺少圖片內容被拒', 400, 'POST', '/api/uploads', {}, { cookie: true });
  });
  p = p.then(function () {
    return expectStatus('400 非圖片 data URL 被拒', 400, 'POST', '/api/uploads',
      { data: 'data:text/plain;base64,aGVsbG8=' }, { cookie: true });
  });
  p = p.then(function () {
    return expectStatus('400 內容非圖片（magic bytes 不符）被拒', 400, 'POST', '/api/uploads',
      { data: 'data:image/png;base64,' + Buffer.from('this is not an image').toString('base64') }, { cookie: true });
  });
  p = p.then(function () {
    var big = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(3.5 * 1024 * 1024, 1)]);
    return expectStatus('400 超過 3MB 的圖片被拒', 400, 'POST', '/api/uploads',
      { data: 'data:image/png;base64,' + big.toString('base64') }, { cookie: true });
  });

  p = p.then(function () {
    return req('POST', '/api/uploads', { data: PNG_DATA_URL }, { cookie: true }).then(function (res) {
      var d = json(res);
      uploadUrl = d.file && d.file.url;
      uploadName = d.file && d.file.name;
      check('201 上傳圖片成功（回傳 /uploads/ 路徑與檔名）',
        res.status === 201 && !!uploadUrl && /^\/uploads\/img-[\w-]+\.png$/.test(uploadUrl) && d.count === 1,
        'status ' + res.status + ' url=' + uploadUrl);
    });
  });
  p = p.then(function () {
    return req('GET', uploadUrl).then(function (res) {
      check('200 上傳後的圖片可透過 URL 取得（image/png）',
        res.status === 200 && res.body.length > 0, 'status ' + res.status);
    });
  });
  p = p.then(function () {
    return expectJson('後台可列出上傳檔與引用狀態', 'GET', '/api/uploads', function (d) {
      return d.uploads.some(function (u) { return u.name === uploadName && u.used === false; });
    }, { cookie: true });
  });

  /* 新增成員時帶入上傳照片 → 前台列表主圖即為上傳檔 */
  var photoMemberId = null;
  p = p.then(function () {
    var body = {
      name: '照片測試', age: 25, price: 3900, city: '台北市', type: '定點', status: 'on',
      images: [uploadUrl, 'https://placehold.co/600x800/2b2b36/565660/png?text=Extra']
    };
    return req('POST', '/api/members', body, { cookie: true }).then(function (res) {
      var d = json(res);
      photoMemberId = d.member && d.member.id;
      check('201 新增成員時帶入上傳照片（第一張成為主圖與頭像）',
        res.status === 201 && d.member.images[0] === uploadUrl && d.member.img === uploadUrl && d.member.avatar === uploadUrl,
        'status ' + res.status + ' img=' + (d.member && d.member.img));
    });
  });
  p = p.then(function () {
    return expectJson('前台列表的主圖即為上傳的照片', 'GET', '/api/members', function (d) {
      var m = d.members.filter(function (x) { return x.id === photoMemberId; })[0];
      return !!m && m.img === uploadUrl && m.images.length === 2;
    });
  });
  p = p.then(function () {
    return expectStatus('409 仍被成員引用的圖片不可刪除', 409, 'DELETE', '/api/uploads/' + uploadName, undefined, { cookie: true });
  });
  p = p.then(function () {
    return expectStatus('200 刪除成員（連動清除其未被引用的上傳照片）',
      200, 'DELETE', '/api/members/' + photoMemberId, undefined, { cookie: true });
  });
  p = p.then(function () {
    return expectStatus('404 成員刪除後，其專屬照片檔案已被清除', 404, 'GET', uploadUrl);
  });

  /* 客評圖片：後台上傳 → 前台顯示 */
  p = p.then(function () {
    return req('POST', '/api/uploads', { data: PNG_DATA_URL }, { cookie: true }).then(function (res) {
      var d = json(res);
      check('201 再上傳一張圖片供客評使用', res.status === 201 && !!d.file, 'status ' + res.status);
      if (!d.file) return;
      return req('PUT', '/api/reviews/' + reviewId, { images: [d.file.url] }, { cookie: true }).then(function (res2) {
        var r = json(res2).review;
        check('後台為評價上傳圖片（寫入 images）',
          res2.status === 200 && r.images.length === 1 && r.images[0] === d.file.url, 'status ' + res2.status);
        uploadUrl = d.file.url;
        uploadName = d.file.name;
      });
    });
  });
  p = p.then(function () {
    return expectJson('前台可讀到含圖片的評價', 'GET', '/api/reviews?memberId=A1024', function (d) {
      var r = d.reviews.filter(function (x) { return x.id === reviewId; })[0];
      return !!r && r.images.length === 1 && r.images[0] === uploadUrl;
    });
  });
  p = p.then(function () {
    return expectStatus('409 客評引用中的圖片不可刪除', 409, 'DELETE', '/api/uploads/' + uploadName, undefined, { cookie: true });
  });
  p = p.then(function () {
    return req('PUT', '/api/reviews/' + reviewId, { images: [] }, { cookie: true }).then(function (res) {
      check('後台移除評價圖片（images 清空）', res.status === 200 && json(res).review.images.length === 0, 'status ' + res.status);
      return req('GET', uploadUrl).then(function (res2) {
        check('移除引用後檔案即被自動清除', res2.status === 404, 'status ' + res2.status);
      });
    });
  });
  p = p.then(function () {
    return req('POST', '/api/uploads', { data: PNG_DATA_URL }, { cookie: true }).then(function (res) {
      var name = json(res).file.name;
      return req('DELETE', '/api/uploads/' + name, undefined, { cookie: true }).then(function (res2) {
        check('200 刪除未被引用的上傳檔', res2.status === 200 && json(res2).removed === true, 'status ' + res2.status);
      });
    });
  });
  p = p.then(function () {
    return expectStatus('400 不合法的上傳檔名被拒', 400, 'DELETE', '/api/uploads/' + encodeURIComponent('../settings.json'), undefined, { cookie: true });
  });

  /* ---------- 12. 重置示範資料 ---------- */
  p = p.then(function () { return expectStatus('401 未登入不可重置資料', 401, 'POST', '/api/reset'); });
  p = p.then(function () {
    return req('POST', '/api/reset', undefined, { cookie: true }).then(function (res) {
      var d = json(res);
      check('後台重置示範資料（成員回到 8 位、預約回到 5 筆）',
        res.status === 200 && d.stats && d.stats.members.total === 8 && d.stats.bookings.total === 5,
        'status ' + res.status + ' members=' + (d.stats && d.stats.members.total));
    });
  });
  p = p.then(function () {
    return expectJson('重置後設定還原為 Escort 且恢復接單', 'GET', '/api/settings', function (d) {
      return d.settings.siteName === 'Escort' && d.settings.siteOpen === true && d.settings.defaultCity === '全台縣市';
    });
  });

  /* ---------- 13. 登出 ---------- */
  p = p.then(function () {
    return req('POST', '/api/logout', undefined, { cookie: true }).then(function (res) {
      check('200 登出成功並清除 Session', res.status === 200 && json(res).authed === false, 'status ' + res.status);
      cookie = '';
    });
  });
  p = p.then(function () { return expectStatus('401 登出後不可讀取統計', 401, 'GET', '/api/stats'); });
  p = p.then(function () { return expectStatus('401 登出後不可新增成員', 401, 'POST', '/api/members', { name: 'x', age: 20, price: 3000 }); });

  /* ---------- 14. 登入頻率限制（防暴力嘗試） ---------- */
  p = p.then(function () {
    var tries = [0, 1, 2, 3, 4];
    return tries.reduce(function (chain, i) {
      return chain.then(function () { return req('POST', '/api/login', { password: 'wrong-' + i }); });
    }, Promise.resolve());
  });
  p = p.then(function () {
    return req('POST', '/api/login', { password: 'wrong-final' }).then(function (res) {
      check('429 連續錯誤密碼後登入被暫時封鎖', res.status === 429, 'status ' + res.status + ' ' + res.body.slice(0, 60));
    });
  });
  p = p.then(function () {
    return req('POST', '/api/login', { password: ADMIN_PASSWORD }).then(function (res) {
      check('429 封鎖期間即使密碼正確也無法登入', res.status === 429, 'status ' + res.status);
    });
  });

  /* ---------- 15. 頁面內容斷言（確認前端骨架與掛載點都在） ---------- */
  p = p.then(function () {
    return req('GET', '/index.html').then(function (res) {
      var c = res.body;
      check('首頁含卡片容器 / 公告 / 客服入口',
        c.indexOf('id="member-grid"') !== -1 && c.indexOf('id="site-notice"') !== -1 &&
        c.indexOf('id="contact-btn"') !== -1 && c.indexOf('href="guide.html"') !== -1,
        'len ' + c.length);
    });
  });
  p = p.then(function () {
    return req('GET', '/detail.html').then(function (res) {
      var c = res.body;
      check('詳情頁含預約 / 檢舉 / 評價 / 相片牆掛載點',
        c.indexOf('id="booking-modal"') !== -1 && c.indexOf('id="report-modal"') !== -1 &&
        c.indexOf('id="review-row"') !== -1 && c.indexOf('id="shot-img-4"') !== -1 &&
        c.indexOf('id="slot-row"') !== -1 && c.indexOf('data-line-id') !== -1,
        'len ' + c.length);
    });
  });
  p = p.then(function () {
    return req('GET', '/admin.html').then(function (res) {
      var c = res.body;
      check('後台含登入畫面 / 七個區塊 / 側欄掛載點',
        c.indexOf('id="login-screen"') !== -1 && c.indexOf('id="panel-dashboard"') !== -1 &&
        c.indexOf('id="panel-settings"') !== -1 && c.indexOf('data-section="bookings"') !== -1 &&
        c.indexOf('id="logout-btn"') !== -1 && c.indexOf('id="member-modal"') !== -1,
        'len ' + c.length);
    });
  });
  p = p.then(function () {
    return req('GET', '/guide.html').then(function (res) {
      var c = res.body;
      check('新手指南含 FAQ 手風琴與客服入口',
        c.indexOf('<details class="faq">') !== -1 && c.indexOf('id="contact-btn"') !== -1,
        'len ' + c.length);
    });
  });

  return p;
}

function finish() {
  results.forEach(function (r) { console.log(r); });
  var fails = results.filter(function (r) { return r.indexOf('FAIL') === 0; }).length;
  console.log('----');
  console.log('total=' + results.length + ', fail=' + fails + (fails === 0 ? '  全部通過' : '  有測項失敗'));
  process.exit(fails === 0 ? 0 : 1);
}

function killServer() {
  return new Promise(function (resolve) {
    if (!child || child.killed) { resolve(); return; }
    child.kill();
    child.on('exit', function () { resolve(); });
    setTimeout(resolve, 1500);   /* 保險：避免等待過久 */
  });
}

console.log('Escort API 驗證（使用目前設定的管理密碼登入；測試後會自動還原你的資料）');
backupData();

startServer().then(function () {
  return runSuite();
}).then(function () {
  return killServer();
}).then(function () {
  restoreData();
  finish();
}).catch(function (e) {
  console.log('FATAL: ' + (e && e.message ? e.message : e));
  console.log('---- 中斷前的測試結果 ----');
  results.forEach(function (r) { console.log(r); });
  return killServer().then(function () {
    restoreData();
    process.exit(2);
  });
});