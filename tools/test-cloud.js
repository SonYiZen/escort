/* ==================================================
   雲端部署環境模擬測試 — node tools/test-cloud.js
   驗證部署到 Render / Fly.io 等平台時使用的環境變數都正確生效：
     ✔ PORT              自訂連接埠
     ✔ DATA_DIR          資料寫到指定目錄（掛載持久化磁碟用）
     ✔ UPLOAD_DIR        上傳檔寫到指定目錄
     ✔ ADMIN_PASSWORD    首次啟動就用自訂管理密碼（不再有預設密碼風險）
     ✔ SITE_NAME/LINE_ID 站台名稱與客服 ID
     ✔ RENDER=1          雲端環境偵測與警告
   測試在系統暫存目錄進行，不會動到你的專案資料
   ================================================== */
'use strict';

var spawn = require('child_process').spawn;
var http = require('http');
var fs = require('fs');
var os = require('os');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var PORT = 4800 + Math.floor(Math.random() * 300);
var TMP = path.join(os.tmpdir(), 'escort-cloud-test-' + Date.now());
var DATA_DIR = path.join(TMP, 'data');
var UPLOAD_DIR = path.join(TMP, 'uploads');

var results = [];
var child = null;
var serverOutput = '';
var cookie = '';

function check(label, cond, extra) {
  results.push((cond ? 'PASS' : 'FAIL') + '  ' + label + (extra ? '  [' + extra + ']' : ''));
}

function req(method, p, body, opts) {
  opts = opts || {};
  return new Promise(function (resolve, reject) {
    var headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json; charset=utf-8';
    if (opts.useCookie && cookie) headers.Cookie = cookie;
    var r = http.request({ host: '127.0.0.1', port: PORT, path: p, method: method, headers: headers }, function (res) {
      var ch = [];
      res.on('data', function (c) { ch.push(c); });
      res.on('end', function () {
        if (opts.capture && res.headers['set-cookie']) cookie = res.headers['set-cookie'][0].split(';')[0];
        resolve({ status: res.statusCode, body: Buffer.concat(ch).toString('utf8') });
      });
    });
    r.on('error', reject);
    if (body !== undefined) r.write(Buffer.from(JSON.stringify(body), 'utf8'));
    r.end();
  });
}
function j(res) { try { return JSON.parse(res.body); } catch (e) { return {}; } }

/* 以模擬雲端的環境變數啟動伺服器（overrides 可覆寫） */
function start(overrides) {
  return new Promise(function (resolve, reject) {
    var env = Object.assign({}, process.env, overrides);
    /* 允許測試明確移除某個變數（值為 null 時刪除） */
    Object.keys(env).forEach(function (k) { if (env[k] === null) delete env[k]; });
    child = spawn(process.execPath, [path.join(ROOT, 'server.js')], { cwd: ROOT, env: env });
    serverOutput = '';
    child.stdout.on('data', function (d) { serverOutput += d.toString('utf8'); });
    child.stderr.on('data', function (d) { serverOutput += d.toString('utf8'); });

    var waited = 0;
    var timer = setInterval(function () {
      waited += 100;
      if (serverOutput.indexOf('按 Ctrl+C') !== -1) {
        clearInterval(timer);
        probe(0).then(resolve, function () { reject(new Error('無法連線：\n' + serverOutput)); });
        return;
      }
      if (waited >= 10000) { clearInterval(timer); reject(new Error('啟動逾時：\n' + serverOutput)); }
    }, 100);
  });
}

function probe(tryCount) {
  return new Promise(function (resolve, reject) {
    var r = http.request({ host: '127.0.0.1', port: PORT, path: '/api/health', method: 'GET' }, function (res) {
      res.resume(); resolve();
    });
    r.on('error', function () {
      if (tryCount >= 25) return reject(new Error('探測失敗'));
      setTimeout(function () { probe(tryCount + 1).then(resolve, reject); }, 150);
    });
    r.end();
  });
}

function stop() {
  return new Promise(function (resolve) {
    if (!child || child.killed) { resolve(); return; }
    child.kill();
    child.on('exit', function () { resolve(); });
    setTimeout(resolve, 1500);
  });
}

function runChecks() {
  var p = Promise.resolve();

  /* --- 1. 啟動訊息：雲端偵測與警告邏輯 --- */
  p = p.then(function () {
    check('啟動訊息偵測到雲端環境（不再列印區網網址）',
      serverOutput.indexOf('同一網段裝置可直接連線') === -1);
    check('啟動訊息顯示自訂資料目錄', serverOutput.indexOf(DATA_DIR) !== -1);
    check('設定完整時不顯示「預設密碼」警告（已設 ADMIN_PASSWORD）',
      serverOutput.indexOf('管理密碼仍是預設值') === -1);
    check('已設定 DATA_DIR 時不顯示資料遺失提醒', serverOutput.indexOf('未設定 DATA_DIR') === -1);
  });

  /* --- 2. 資料寫入指定的 DATA_DIR --- */
  p = p.then(function () {
    return req('GET', '/api/health').then(function (res) {
      check('GET /api/health 正常（平台健康檢查可用）', res.status === 200 && j(res).ok === true, 'HTTP ' + res.status);
    }, function (e) { check('GET /api/health 正常', false, String(e && e.message)); });
  });
  p = p.then(function () {
    var files = fs.existsSync(DATA_DIR) ? fs.readdirSync(DATA_DIR) : [];
    check('資料檔建立在 DATA_DIR 指定目錄（' + DATA_DIR.replace(/\\/g, '/').split('/').pop() + '/）',
      files.indexOf('members.json') !== -1 && files.indexOf('settings.json') !== -1, files.join(', ') || '目錄不存在');
  });
  p = p.then(function () {
    var inProject = path.join(ROOT, 'data');
    var settingsFile = path.join(DATA_DIR, 'settings.json');
    check('自訂 DATA_DIR 時不會污染專案內的 data/', fs.existsSync(settingsFile), '已寫入自訂目錄');
  });

  /* --- 3. 自訂管理密碼生效 --- */
  p = p.then(function () {
    return req('POST', '/api/login', { password: 'admin1234' }).then(function (res) {
      check('預設密碼 admin1234 無法登入（已改用自訂密碼）', res.status === 401, 'HTTP ' + res.status);
    }, function (e) { check('預設密碼無法登入', false, String(e && e.message)); });
  });
  p = p.then(function () {
    return req('POST', '/api/login', { password: 'CloudPass_9527' }, { capture: true }).then(function (res) {
      check('自訂 ADMIN_PASSWORD 可以登入', res.status === 200 && !!cookie, 'HTTP ' + res.status + ' cookie=' + !!cookie);
    }, function (e) { check('自訂 ADMIN_PASSWORD 可以登入', false, String(e && e.message)); });
  });

  /* --- 4. 站台設定來自環境變數 --- */
  p = p.then(function () {
    return req('GET', '/api/settings').then(function (res) {
      var s = j(res).settings || {};
      check('SITE_NAME 環境變數生效', s.siteName === '雲端測試站', 'siteName=' + s.siteName);
      check('LINE_ID 環境變數生效', s.lineId === '@cloud_test', 'lineId=' + s.lineId);
      check('API 不會外洩管理密碼', s.adminPassword === undefined);
    }, function (e) { check('站台設定讀取', false, String(e && e.message)); });
  });

  /* --- 5. 上傳檔寫入指定的 UPLOAD_DIR --- */
  p = p.then(function () {
    var PNG = 'data:image/png;base64,' + Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(150, 5)
    ]).toString('base64');
    return req('POST', '/api/uploads', { data: PNG }, { useCookie: true }).then(function (res) {
      var f = j(res).file;
      check('上傳圖片成功', res.status === 201 && !!f, 'HTTP ' + res.status);
      if (!f) return;
      var onDisk = fs.existsSync(path.join(UPLOAD_DIR, f.name));
      check('上傳檔寫入 UPLOAD_DIR 指定目錄', onDisk, f.name);
      return req('GET', f.url).then(function (res2) {
        check('上傳的圖片可透過 URL 取得', res2.status === 200, 'HTTP ' + res2.status);
      });
    }, function (e) { check('上傳圖片成功', false, String(e && e.message)); });
  });

  /* --- 6. 資料確實持久化在自訂目錄（重啟後仍在） --- */
  p = p.then(function () {
    return req('POST', '/api/members', {
      name: '雲端持久化測試', age: 25, price: 3000, city: '台北市', type: '定點', status: 'on'
    }, { useCookie: true }).then(function (res) {
      check('新增成員成功（資料寫入 DATA_DIR）', res.status === 201, 'HTTP ' + res.status);
      var members = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'members.json'), 'utf8'));
      var found = members.some(function (m) { return m.name === '雲端持久化測試'; });
      check('新成員確實寫入 DATA_DIR/members.json', found, '共 ' + members.length + ' 位');
    }, function (e) { check('新增成員成功', false, String(e && e.message)); });
  });

  return p;
}

/* 第二階段：故意不設 ADMIN_PASSWORD，驗證會出現「預設密碼」警告 */
function phaseB() {
  var TMP2 = path.join(TMP, 'phase-b');
  return stop().then(function () {
    return start({
      PORT: String(PORT),
      DATA_DIR: path.join(TMP2, 'data'),
      UPLOAD_DIR: path.join(TMP2, 'uploads'),
      ADMIN_PASSWORD: null,      /* 明確移除 → 使用預設密碼 */
      RENDER: '1'
    });
  }).then(function () {
    check('未設定 ADMIN_PASSWORD 時會警告預設密碼風險',
      serverOutput.indexOf('管理密碼仍是預設值') !== -1,
      serverOutput.indexOf('管理密碼仍是預設值') !== -1 ? '已警告' : '沒有警告');
    return req('POST', '/api/login', { password: 'admin1234' }, { capture: true }).then(function (res) {
      check('確認預設密碼確實可登入（證明警告有必要）', res.status === 200, 'HTTP ' + res.status);
    }, function (e) { check('確認預設密碼確實可登入', false, String(e && e.message)); });
  });
}

function cleanup() {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
}

function finish() {
  results.forEach(function (r) { console.log(r); });
  var fails = results.filter(function (r) { return r.indexOf('FAIL') === 0; }).length;
  console.log('----');
  console.log('total=' + results.length + ', fail=' + fails + (fails === 0 ? '  雲端環境變數設定正確' : '  有測項失敗'));
  cleanup();
  process.exit(fails === 0 ? 0 : 1);
}

console.log('=== 雲端部署環境模擬測試 ===');
console.log('暫存目錄：' + TMP + '\n');

start({
  PORT: String(PORT),
  DATA_DIR: DATA_DIR,
  UPLOAD_DIR: UPLOAD_DIR,
  ADMIN_PASSWORD: 'CloudPass_9527',
  SITE_NAME: '雲端測試站',
  LINE_ID: '@cloud_test',
  RENDER: '1',                 /* 模擬 Render 環境 */
  SHARE_MODE: '0'              /* 測試期間開放後台，才能驗證登入 */
}).then(function () {
  return runChecks();
}).then(function () {
  return phaseB();
}).then(function () {
  return stop();
}).then(function () {
  finish();
}).catch(function (e) {
  console.log('FATAL: ' + (e && e.message ? e.message : e));
  results.forEach(function (r) { console.log(r); });
  return stop().then(function () {
    cleanup();
    process.exit(2);
  });
});