/* 最終端到端整合驗證：模擬瀏覽器完整流程（執行後自動還原資料） */
'use strict';
var spawn = require('child_process').spawn;
var http = require('http');
var fs = require('fs');
var path = require('path');

var ROOT = __dirname;
var PORT = 3000;
var child = null;
var cookie = '';
var BACKUP = path.join(ROOT, '.e2e-backup');

var PNG = 'data:image/png;base64,' + Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 3)
]).toString('base64');
var PNG2 = 'data:image/png;base64,' + Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(220, 9)
]).toString('base64');

function pw() {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'data/settings.json'), 'utf8')).adminPassword; }
  catch (e) { return 'admin1234'; }
}

function backup() {
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
}
function restore() {
  ['data', 'uploads'].forEach(function (d) {
    var src = path.join(BACKUP, d), dst = path.join(ROOT, d);
    if (!fs.existsSync(src)) return;
    fs.mkdirSync(dst, { recursive: true });
    fs.readdirSync(src).forEach(function (f) { fs.copyFileSync(path.join(src, f), path.join(dst, f)); });
  });
  fs.rmSync(BACKUP, { recursive: true, force: true });
}

function req(method, p, body, opts) {
  opts = opts || {};
  return new Promise(function (resolve, reject) {
    var headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json; charset=utf-8';
    if (opts.useCookie && cookie) headers.Cookie = cookie;
    var r = http.request({ host: 'localhost', port: PORT, path: p, method: method, headers: headers }, function (res) {
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

function start() {
  return new Promise(function (resolve, reject) {
    child = spawn(process.execPath, [path.join(ROOT, 'server.js')], { cwd: ROOT });
    var out = '';
    child.stdout.on('data', function (d) { out += d; });
    child.stderr.on('data', function (d) { out += d; });
    var t = setInterval(function () {
      if (out.indexOf('已啟動') !== -1) { clearInterval(t); resolve(); }
    }, 50);
    setTimeout(function () { clearInterval(t); reject(new Error('啟動逾時')); }, 8000);
  });
}

console.log('=== 端到端整合驗證（瀏覽器流程模擬）===\n');
backup();
start().then(function () {
  return req('POST', '/api/login', { password: pw() }, { capture: true });
}).then(function () {
  /* 1. 上傳兩張成員照片 */
  return req('POST', '/api/uploads', { data: [PNG, PNG2] }, { useCookie: true });
}).then(function (res) {
  var files = j(res).files || [];
  console.log('1. 後台上傳 2 張成員照片：HTTP ' + res.status + ' → ' + (files.length ? files.map(function (f) { return f.name; }).join(', ') : '無檔案，回應=' + res.body.slice(0, 160)));
  if (!files.length) throw new Error('上傳步驟失敗');
  var urls = files.map(function (f) { return f.url; });

  /* 2. 後台新增成員並帶入照片 */
  return req('POST', '/api/members', {
    name: 'E2E測試員', age: 26, price: 4600, city: '高雄市', type: '外送', status: 'on',
    height: 168, weight: 49, cup: 'C', tags: ['E2E'], intro: '端到端測試用',
    images: urls, img: urls[0], avatar: urls[0]
  }, { useCookie: true }).then(function (r2) {
    var m = j(r2).member;
    console.log('2. 新增成員（含上傳照片）：HTTP ' + r2.status + ' → #' + m.id + ' images=' + m.images.length + ' img=' + m.img);
    return m.id;
  });
}).then(function (memberId) {
  /* 3. 前台列表：主圖應為上傳檔 */
  return req('GET', '/api/members').then(function (res) {
    var m = j(res).members.filter(function (x) { return x.id === memberId; })[0];
    console.log('3. 前台列表主圖：' + (m && m.img.indexOf('/uploads/') === 0 ? '✔ 為上傳檔 ' + m.img : '✘ ' + (m && m.img)));
    return memberId;
  });
}).then(function (memberId) {
  /* 4. 詳情頁相片牆資料 */
  return req('GET', '/api/members/' + memberId).then(function (res) {
    var m = j(res).member;
    var up = m.images.filter(function (u) { return u.indexOf('/uploads/') === 0; }).length;
    console.log('4. 詳情頁相片牆：4 格中 ' + up + ' 格為上傳檔（其餘為 Placeholder）');
    return memberId;
  });
}).then(function (memberId) {
  /* 5. 建立評價並由後台上傳評價圖片 */
  return req('POST', '/api/reviews', { memberId: memberId, nick: 'E2E客人', text: '端到端評價' }).then(function (res) {
    var rid = j(res).review.id;
    return req('POST', '/api/uploads', { data: PNG }, { useCookie: true }).then(function (r2) {
      var img = j(r2).file;
      return req('PUT', '/api/reviews/' + rid, { status: 'on', images: [img.url] }, { useCookie: true }).then(function (r3) {
        console.log('5. 後台為評價上傳圖片並通過審核：HTTP ' + r3.status + ' → ' + img.name);
        return { memberId: memberId, imgName: img.name };
      });
    });
  });
}).then(function (ctx) {
  /* 6. 前台評價 API 應含圖片 */
  return req('GET', '/api/reviews?memberId=' + ctx.memberId).then(function (res) {
    var r = j(res).reviews[0];
    console.log('6. 前台評價含圖片：' + (r && r.images.length === 1 ? '✔ ' + r.images[0] : '✘'));
    return ctx;
  });
}).then(function (ctx) {
  /* 7. 圖片可實際取得 */
  return req('GET', '/uploads/' + ctx.imgName).then(function (res) {
    console.log('7. 上傳圖片可透過 URL 取得：HTTP ' + res.status);
    return ctx;
  });
}).then(function (ctx) {
  /* 8+9. 刪除成員 → 專屬圖片自動清除 */
  return req('DELETE', '/api/members/' + ctx.memberId, undefined, { useCookie: true }).then(function (res) {
    console.log('8. 刪除成員（連動清除其照片與評價）：HTTP ' + res.status);
    return req('GET', '/uploads/' + ctx.imgName).then(function (r2) {
      console.log('9. 該成員專屬圖片已自動清除：HTTP ' + r2.status + (r2.status === 404 ? ' ✔' : ' ✘'));
    });
  });
}).then(function () {
  return new Promise(function (resolve) { child.kill(); child.on('exit', resolve); setTimeout(resolve, 1500); });
}).then(function () {
  restore();
  console.log('\n✔ 全流程驗證完成，資料已還原');
  process.exit(0);
}).catch(function (e) {
  console.log('FATAL: ' + (e && e.message ? e.message : e));
  if (child) child.kill();
  restore();
  process.exit(1);
});