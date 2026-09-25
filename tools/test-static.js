/* ==================================================
   驗證 Netlify 靜態版 — node tools/test-static.js
   以 tools/serve-static.js 模擬 Netlify 的靜態環境並檢查：
     ✔ public/ 只有前端檔案，不含 server.js / data/ / uploads/
     ✔ 示範資料僅含上架中成員與已通過評價，且圖片皆為 Placeholder
     ✔ 不含管理密碼、預約 / 訊息 / 檢舉等後台資料
     ✔ 頁面可正常取得，且 /api/* 不存在（前端會據此判定為靜態示範版）
   ================================================== */
'use strict';

var spawn = require('child_process').spawn;
var http = require('http');
var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var PUBLIC = path.join(ROOT, 'public');
var PORT = 4500 + Math.floor(Math.random() * 300);
var results = [];
var child = null;

function check(label, cond, extra) {
  results.push((cond ? 'PASS' : 'FAIL') + '  ' + label + (extra ? '  [' + extra + ']' : ''));
}

function walk(dir, out) {
  out = out || [];
  fs.readdirSync(dir).forEach(function (f) {
    var full = path.join(dir, f);
    if (fs.statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  });
  return out;
}

function req(p) {
  return new Promise(function (resolve, reject) {
    var r = http.request({ host: '127.0.0.1', port: PORT, path: p, method: 'GET' }, function (res) {
      var ch = [];
      res.on('data', function (c) { ch.push(c); });
      res.on('end', function () { resolve({ status: res.statusCode, body: Buffer.concat(ch).toString('utf8') }); });
    });
    r.on('error', reject);
    r.end();
  });
}

function probe(tryCount) {
  return new Promise(function (resolve, reject) {
    var r = http.request({ host: '127.0.0.1', port: PORT, path: '/index.html', method: 'GET' }, function (res) {
      res.resume(); resolve();
    });
    r.on('error', function () {
      if (tryCount >= 20) return reject(new Error('靜態伺服器連不上'));
      setTimeout(function () { probe(tryCount + 1).then(resolve, reject); }, 150);
    });
    r.end();
  });
}

function finish() {
  results.forEach(function (r) { console.log(r); });
  var fails = results.filter(function (r) { return r.indexOf('FAIL') === 0; }).length;
  console.log('----');
  console.log('total=' + results.length + ', fail=' + fails + (fails === 0 ? '  靜態版可以部署' : '  有測項失敗'));
  process.exit(fails === 0 ? 0 : 1);
}

function runChecks() {
  /* --- 1. 檔案組成檢查 --- */
  var files = walk(PUBLIC);
  var rel = files.map(function (f) { return path.relative(PUBLIC, f).replace(/\\/g, '/'); });

  check('輸出只有前端檔案（' + files.length + ' 個）',
    rel.every(function (r) { return /\.(html|css|js|txt)$/.test(r) || r === '_redirects'; }),
    rel.join(', '));
  check('不含後端程式 server.js', rel.indexOf('server.js') === -1);
  check('不含測試腳本', !rel.some(function (r) { return /^test-|^e2e-/.test(r); }));
  check('不含 data/ 與 uploads/', !rel.some(function (r) { return r.indexOf('data/') === 0 || r.indexOf('uploads/') === 0; }));
  check('不含任何 .json 資料檔', !rel.some(function (r) { return /\.json$/.test(r); }));
  check('四頁與樣式、程式都在',
    ['index.html', 'detail.html', 'guide.html', 'admin.html', 'css/index.css', 'css/common.css',
     'css/detail.css', 'css/admin.css', 'css/guide.css', 'js/data.js', 'js/app.js', 'js/admin.js',
     'js/guide.js', 'js/demo-data.js'].every(function (f) { return rel.indexOf(f) !== -1; }));

  /* --- 2. 示範資料內容檢查 --- */
  var demoText = fs.readFileSync(path.join(PUBLIC, 'js', 'demo-data.js'), 'utf8');
  var json = demoText.slice(demoText.indexOf('{'), demoText.lastIndexOf('}') + 1);
  var demo = null;
  try { demo = JSON.parse(json); } catch (e) { /* 解析失敗下面會判定 */ }

  check('示範資料可被解析', !!demo);
  if (demo) {
    check('只含上架中成員（' + demo.members.length + ' 位）',
      demo.members.length > 0 && demo.members.every(function (m) { return m.status === 'on'; }));
    check('只含已通過評價（' + demo.reviews.length + ' 則）',
      demo.reviews.every(function (r) { return r.status === 'on'; }));
    check('預約 / 訊息 / 檢舉一律為空（避免外洩聯絡資訊）',
      demo.bookings.length === 0 && demo.messages.length === 0 && demo.reports.length === 0);
    var allImgs = [];
    demo.members.forEach(function (m) { allImgs = allImgs.concat(m.images || [], [m.img, m.avatar]); });
    demo.reviews.forEach(function (r) { allImgs = allImgs.concat(r.images || []); });
    check('所有圖片皆為外部 Placeholder（不含 /uploads/）',
      allImgs.length > 0 && allImgs.every(function (u) { return /^https:\/\/placehold\.co\//.test(u); }),
      '共 ' + allImgs.length + ' 張');
    check('設定不含管理密碼', demo.settings.adminPassword === undefined);
  }

  /* --- 3. 原始碼掃描：不得含管理密碼 --- */
  var settings = {};
  try { settings = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'settings.json'), 'utf8')); }
  catch (e) { /* 無資料檔時略過 */ }
  if (settings.adminPassword) {
    var leaked = files.filter(function (f) {
      return fs.readFileSync(f, 'utf8').indexOf(settings.adminPassword) !== -1;
    }).map(function (f) { return path.relative(PUBLIC, f); });
    check('輸出檔內沒有管理密碼', leaked.length === 0, leaked.join(', '));
  } else {
    check('輸出檔內沒有管理密碼', true, '（尚無設定檔，略過比對）');
  }
}

/* --- 4. 模擬 Netlify 靜態環境 --- */
function runLive() {
  child = spawn(process.execPath, [path.join(__dirname, 'serve-static.js')], {
    cwd: ROOT, env: Object.assign({}, process.env, { PORT: String(PORT) })
  });
  var out = '';
  child.stdout.on('data', function (d) { out += d.toString('utf8'); });
  child.stderr.on('data', function (d) { out += d.toString('utf8'); });

  var waited = 0;
  var timer = setInterval(function () {
    waited += 100;
    if (out.indexOf('已啟動') === -1) {
      if (waited >= 8000) { clearInterval(timer); check('靜態伺服器啟動', false, out.slice(0, 120)); finish(); }
      return;
    }
    clearInterval(timer);
    probe(0).then(function () {
      var p = Promise.resolve();
      ['/index.html', '/detail.html', '/guide.html', '/admin.html',
       '/css/common.css', '/js/data.js', '/js/demo-data.js'].forEach(function (f) {
        p = p.then(function () {
          return req(f).then(function (res) {
            check('靜態版可取得 ' + f, res.status === 200, 'HTTP ' + res.status);
          }, function (e) { check('靜態版可取得 ' + f, false, String(e && e.message)); });
        });
      });
      p = p.then(function () {
        return req('/api/health').then(function (res) {
          check('模擬環境中 /api/health 不存在（前端會判定為靜態示範版）',
            res.status === 404, 'HTTP ' + res.status);
        }, function (e) { check('模擬環境中 /api/health 不存在', false, String(e && e.message)); });
      });
      p = p.then(function () {
        return req('/index.html').then(function (res) {
          check('首頁含卡片容器與客服入口',
            res.body.indexOf('id="member-grid"') !== -1 && res.body.indexOf('id="contact-btn"') !== -1);
        });
      });
      p = p.then(function () {
        return req('/admin.html').then(function (res) {
          check('後台頁面存在（前端會顯示「需搭配後端」說明）',
            res.body.indexOf('id="login-screen"') !== -1);
        });
      });
      return p;
    }).then(function () {
      child.kill();
      finish();
    }).catch(function (e) {
      check('靜態伺服器連線', false, String(e && e.message));
      child.kill();
      finish();
    });
  }, 100);
}

console.log('=== 驗證 Netlify 靜態建置 ===\n');
if (!fs.existsSync(PUBLIC)) {
  console.error('✘ 找不到 public/，請先執行：node tools/build-netlify.js');
  process.exit(1);
}
runChecks();
runLive();