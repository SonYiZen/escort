/* ==================================================
   分享模式驗證 — node test-share.js
   以 SHARE_MODE=1 啟動伺服器，確認：
     ✔ 前台功能（瀏覽、詳情、預約、訊息、評價、檢舉、瀏覽統計）正常
     ✘ 後台管理（登入、統計、清單、新增修改刪除、上傳、重置、設定）全部停用
   測試後自動關閉伺服器並還原資料
   ================================================== */
'use strict';

var spawn = require('child_process').spawn;
var http = require('http');
var fs = require('fs');
var path = require('path');

var ROOT = __dirname;
/* 每次執行使用不同連接埠，避免與殘留程序衝突 */
var PORT = 3400 + Math.floor(Math.random() * 500);
var BACKUP = path.join(ROOT, '.share-backup');
var results = [];
var child = null;
var serverOutput = '';

function check(label, cond, extra) {
  results.push((cond ? 'PASS' : 'FAIL') + '  ' + label + (extra ? '  [' + extra + ']' : ''));
}

function backup() {
  try {
    fs.rmSync(BACKUP, { recursive: true, force: true });
    fs.mkdirSync(BACKUP, { recursive: true });
    ['data', 'uploads'].forEach(function (d) {
      var src = path.join(ROOT, d), dst = path.join(BACKUP, d);
      if (!fs.existsSync(src)) return;
      fs.mkdirSync(dst, { recursive: true });
      fs.readdirSync(src).forEach(function (f) {
        if (fs.statSync(path.join(src, f)).isFile()) fs.copyFileSync(path.join(src, f), path.join(dst, f));
      });
    });
  } catch (e) { console.log('⚠ 備份失敗：' + e.message); }
}

function restore() {
  try {
    ['data', 'uploads'].forEach(function (d) {
      var src = path.join(BACKUP, d), dst = path.join(ROOT, d);
      if (!fs.existsSync(src)) return;
      fs.mkdirSync(dst, { recursive: true });
      fs.readdirSync(src).forEach(function (f) { fs.copyFileSync(path.join(src, f), path.join(dst, f)); });
    });
    fs.rmSync(BACKUP, { recursive: true, force: true });
  } catch (e) { console.log('⚠ 還原失敗：' + e.message + '（備份在 ' + BACKUP + '）'); }
}

function start() {
  return new Promise(function (resolve, reject) {
    child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
      cwd: ROOT,
      env: Object.assign({}, process.env, { PORT: String(PORT), SHARE_MODE: '1' })
    });
    serverOutput = '';
    child.stdout.on('data', function (d) { serverOutput += d.toString('utf8'); });
    child.stderr.on('data', function (d) { serverOutput += d.toString('utf8'); });
    child.on('exit', function (code) { serverOutput += '\n[child exit code=' + code + ']'; });

    /* 先等啟動訊息，再實際探測連線（確認真的可以收發請求） */
    var waited = 0;
    var timer = setInterval(function () {
      waited += 100;
      if (serverOutput.indexOf('已啟動') !== -1) {
        clearInterval(timer);
        probe(0).then(resolve, function () {
          reject(new Error('伺服器已啟動但無法連線：\n' + serverOutput));
        });
        return;
      }
      if (waited >= 8000) {
        clearInterval(timer);
        reject(new Error('啟動逾時：\n' + serverOutput));
      }
    }, 100);
  });
}

/* 連線探測：最多重試 20 次（每次間隔 150ms） */
function probe(tryCount) {
  return new Promise(function (resolve, reject) {
    var r = http.request({ host: '127.0.0.1', port: PORT, path: '/api/session', method: 'GET' }, function (res) {
      res.resume();
      resolve();
    });
    r.on('error', function () {
      if (tryCount >= 20) { reject(new Error('探測失敗')); return; }
      setTimeout(function () { probe(tryCount + 1).then(resolve, reject); }, 150);
    });
    r.end();
  });
}

function req(method, p, body) {
  return new Promise(function (resolve, reject) {
    var headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json; charset=utf-8';
    var r = http.request({ host: '127.0.0.1', port: PORT, path: p, method: method, headers: headers }, function (res) {
      var ch = [];
      res.on('data', function (c) { ch.push(c); });
      res.on('end', function () { resolve({ status: res.statusCode, body: Buffer.concat(ch).toString('utf8') }); });
    });
    r.on('error', reject);
    if (body !== undefined) r.write(Buffer.from(JSON.stringify(body), 'utf8'));
    r.end();
  });
}

function expectStatus(label, want, method, p, body) {
  return req(method, p, body).then(function (res) {
    check(label, res.status === want, 'got ' + res.status);
  }, function (e) { check(label, false, String(e && e.message)); });
}

function mustAllow(label, method, p, body) {
  return req(method, p, body).then(function (res) {
    check(label, res.status >= 200 && res.status < 300, 'got ' + res.status + ' ' + res.body.slice(0, 70));
    return res;
  }, function (e) { check(label, false, String(e && e.message)); return {}; });
}

function mustBlock(label, method, p, body) {
  return req(method, p, body).then(function (res) {
    check(label, res.status === 403, 'got ' + res.status + ' ' + res.body.slice(0, 70));
    return res;
  }, function (e) { check(label, false, String(e && e.message)); return {}; });
}

function finish() {
  results.forEach(function (r) { console.log(r); });
  var fails = results.filter(function (r) { return r.indexOf('FAIL') === 0; }).length;
  console.log('----');
  console.log('total=' + results.length + ', fail=' + fails + (fails === 0 ? '  分享模式防護正常' : '  有測項失敗'));
  process.exit(fails === 0 ? 0 : 1);
}

console.log('=== 分享模式驗證（SHARE_MODE=1，port ' + PORT + '）===\n');
backup();

/* 閘門：測試鏈必須等伺服器就緒後才開始（避免與啟動競速） */
var releaseGate;
var gate = new Promise(function (resolve) { releaseGate = resolve; });
var p = gate;

/* 1. 前台頁面與資源應正常 */
['/index.html', '/detail.html', '/guide.html',
 '/css/index.css', '/css/common.css', '/css/detail.css', '/css/admin.css', '/css/guide.css',
 '/js/data.js', '/js/app.js', '/js/admin.js', '/js/guide.js'
].forEach(function (asset) {
  p = p.then(function () { return expectStatus('前台資源可用 ' + asset, 200, 'GET', asset); });
});

/* 2. 後台頁面應被取代為說明頁 */
p = p.then(function () {
  return req('GET', '/admin.html').then(function (res) {
    var ok = res.status === 200 && res.body.indexOf('分享模式') !== -1 && res.body.indexOf('login-screen') === -1;
    check('後台頁面被取代為「分享模式」說明頁', ok, 'status ' + res.status);
  });
});

/* 3. 前台 API 應正常 */
p = p.then(function () { return mustAllow('允許 GET /api/settings（唯讀）', 'GET', '/api/settings'); });
p = p.then(function () {
  return req('GET', '/api/session').then(function (res) {
    var d = {}; try { d = JSON.parse(res.body); } catch (e) { /* 忽略 */ }
    check('GET /api/session 回報 shareMode=true 且未登入',
      res.status === 200 && d.shareMode === true && d.authed === false, JSON.stringify(d).slice(0, 80));
  }, function (e) { check('GET /api/session 回報 shareMode=true 且未登入', false, String(e && e.message)); });
});
p = p.then(function () {
  return req('GET', '/api/members').then(function (res) {
    var d = {}; try { d = JSON.parse(res.body); } catch (e) { /* 忽略 */ }
    var onlyOn = Array.isArray(d.members) && d.members.length > 0 &&
      d.members.every(function (m) { return m.status === 'on'; });
    check('GET /api/members 只回上架中成員', onlyOn, 'count=' + (d.members ? d.members.length : 0));
  }, function (e) { check('GET /api/members 只回上架中成員', false, String(e && e.message)); });
});
p = p.then(function () {
  return mustAllow('允許 POST /api/members/:id/view（瀏覽統計）', 'POST', '/api/members/A1024/view');
});
p = p.then(function () {
  return mustAllow('允許 POST /api/bookings（前台送出預約）', 'POST', '/api/bookings',
    { memberId: 'A1024', plan: '方案 A／50 分鐘', date: '01-01', time: '18:00~02:00', contact: 'line: share_test' });
});
p = p.then(function () {
  return mustAllow('允許 POST /api/messages（前台客服訊息）', 'POST', '/api/messages',
    { name: '分享測試', contact: 'line: share_test', body: '分享模式測試訊息' });
});
p = p.then(function () { return mustAllow('允許 GET /api/reviews?memberId=（已審核評價）', 'GET', '/api/reviews?memberId=A1024'); });
p = p.then(function () {
  return mustAllow('允許 POST /api/reviews（前台送出評價）', 'POST', '/api/reviews',
    { memberId: 'A1024', nick: '分享測試', text: '分享模式測試評價' });
});
p = p.then(function () {
  return mustAllow('允許 POST /api/reports（前台檢舉）', 'POST', '/api/reports',
    { memberId: 'A1024', reason: '測試', detail: '分享模式測試檢舉' });
});

/* 4. 後台管理應全部停用 */
p = p.then(function () { return mustBlock('停用 POST /api/login（不可登入後台）', 'POST', '/api/login', { password: 'x' }); });
p = p.then(function () { return mustBlock('停用 POST /api/logout', 'POST', '/api/logout'); });
p = p.then(function () { return mustBlock('停用 GET /api/stats（數據總覽）', 'GET', '/api/stats'); });
p = p.then(function () { return mustBlock('停用 GET /api/bookings（預約清單）', 'GET', '/api/bookings'); });
p = p.then(function () { return mustBlock('停用 GET /api/messages（訊息清單）', 'GET', '/api/messages'); });
p = p.then(function () { return mustBlock('停用 GET /api/reports（檢舉清單）', 'GET', '/api/reports'); });
p = p.then(function () { return mustBlock('停用 GET /api/uploads（上傳檔清單）', 'GET', '/api/uploads'); });
p = p.then(function () { return mustBlock('停用 POST /api/uploads（上傳圖片）', 'POST', '/api/uploads', { data: 'x' }); });
p = p.then(function () { return mustBlock('停用 DELETE /api/uploads/:name', 'DELETE', '/api/uploads/img-x.png'); });
p = p.then(function () { return mustBlock('停用 POST /api/members（新增成員）', 'POST', '/api/members', { name: 'x', age: 20, price: 3000 }); });
p = p.then(function () { return mustBlock('停用 PUT /api/members/:id（修改成員）', 'PUT', '/api/members/A1024', { status: 'off' }); });
p = p.then(function () { return mustBlock('停用 DELETE /api/members/:id（刪除成員）', 'DELETE', '/api/members/A1024'); });
p = p.then(function () { return mustBlock('停用 PUT /api/reviews/:id（審核評價）', 'PUT', '/api/reviews/R4001', { status: 'off' }); });
p = p.then(function () { return mustBlock('停用 PUT /api/settings（修改設定）', 'PUT', '/api/settings', { siteName: 'x' }); });
p = p.then(function () { return mustBlock('停用 POST /api/reset（重置資料）', 'POST', '/api/reset'); });

start().then(function () {
  releaseGate();         /* 伺服器就緒，放行測試鏈 */
  return p;
}).then(function () {
  return new Promise(function (resolve) { child.kill(); child.on('exit', resolve); setTimeout(resolve, 1500); });
}).then(function () {
  restore();
  finish();
}).catch(function (e) {
  console.log('FATAL: ' + (e && e.message ? e.message : e));
  results.forEach(function (r) { console.log(r); });
  if (child) child.kill();
  restore();
  process.exit(2);
});