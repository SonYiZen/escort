/* ==================================================
   產生可部署到 Netlify 的靜態版本 — node tools/build-netlify.js
   輸出到 public/，內容僅包含前端檔案與「去識別化」的示範資料：
     ✔ 前台四頁（index / detail / guide / admin）+ css/ + js/
     ✔ js/demo-data.js：由 data/*.json 產生，只含上架中成員與已通過評價
     ✘ 不含 server.js、test-*.js、data/、uploads/、任何密碼或真實聯絡資訊
   內建安全檢查：輸出中若出現管理密碼或敏感檔案，建置會直接失敗。
   ================================================== */
'use strict';

var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var OUT = path.join(ROOT, 'public');

/* 要複製到 public/ 的前端檔案（白名單，避免誤傳後端程式與資料） */
var FILES = ['index.html', 'detail.html', 'guide.html', 'admin.html'];
var DIRS = ['css', 'js'];
/* js/ 內只放這幾個前端執行檔（不含測試與建置工具） */
var JS_ALLOW = ['data.js', 'app.js', 'admin.js', 'guide.js'];

function log(msg) { console.log('  ' + msg); }
function rmrf(p) { fs.rmSync(p, { recursive: true, force: true }); }

function copyFile(rel) {
  var src = path.join(ROOT, rel);
  var dst = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  return fs.statSync(dst).size;
}

/* 示範用圖片：把上傳檔或外部 URL 換成固定的 Placeholder，避免外洩真實照片 */
function demoImage(name, n) {
  var label = encodeURIComponent(String(name || 'Photo')) + (n ? '+' + n : '');
  return 'https://placehold.co/600x800/2b2b36/565660/png?text=' + label;
}
function demoAvatar(name) {
  return 'https://placehold.co/72x72/2b2b36/f4f4f7/png?text=' + encodeURIComponent(String(name || '?').charAt(0));
}
function demoChatShot(n) {
  return 'https://placehold.co/360x640/2b2b36/9a9aa6/png?text=Chat+' + n;
}

function readJSON(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'data', name + '.json'), 'utf8'));
  } catch (e) {
    return fallback;
  }
}

/* ---------- 產生去識別化的示範資料 ---------- */
function buildDemoData() {
  var members = readJSON('members', []);
  var reviews = readJSON('reviews', []);
  var settings = readJSON('settings', {});

  /* 只保留上架中成員，並把照片換成 Placeholder */
  var demoMembers = members
    .filter(function (m) { return m.status === 'on'; })
    .map(function (m) {
      var imgs = (m.images && m.images.length ? m.images : [1, 2, 3, 4])
        .slice(0, 4)
        .map(function (u, i) { return demoImage(m.name, i + 1); });
      return {
        id: m.id, name: m.name, age: m.age, city: m.city, type: m.type,
        price: m.price, status: 'on', updated: m.updated,
        tags: m.tags || [], flag: m.flag, flagName: m.flagName,
        height: m.height, weight: m.weight, cup: m.cup, intro: m.intro || '',
        views: Number(m.views) || 0,
        avatar: demoAvatar(m.name), img: imgs[0], images: imgs,
        services: m.services || [], addons: m.addons || [], slots: m.slots || []
      };
    });

  /* 只保留已審核通過的評價（圖片同樣換成 Placeholder） */
  var demoReviews = reviews
    .filter(function (r) { return r.status === 'on'; })
    .map(function (r) {
      return {
        id: r.id, memberId: r.memberId, memberName: r.memberName, nick: r.nick,
        text: r.text, status: 'on', createdAt: r.createdAt,
        images: (r.images || []).slice(0, 3).map(function (u, i) { return demoChatShot(i + 1); })
      };
    });

  /* 站台設定：僅保留前台會用到的欄位（不含管理密碼） */
  var demoSettings = {
    siteName: settings.siteName || 'Escort',
    lineId: settings.lineId || '@escort.demo',
    notice: settings.notice || '',
    defaultCity: settings.defaultCity || '全台縣市',
    siteOpen: settings.siteOpen !== false,
    updated: settings.updated || ''
  };

  /* 預約 / 訊息 / 檢舉屬後台資料（含真實聯絡方式），靜態版一律不輸出 */
  return {
    members: demoMembers,
    reviews: demoReviews,
    bookings: [],
    messages: [],
    reports: [],
    settings: demoSettings,
    generatedAt: new Date().toISOString().slice(0, 16).replace('T', ' ')
  };
}

/* ---------- 安全檢查：輸出不得包含敏感資訊 ---------- */
function safetyChecks(demo, settingsRaw) {
  var problems = [];
  var outFiles = [];
  (function walk(dir) {
    fs.readdirSync(dir).forEach(function (f) {
      var full = path.join(dir, f);
      if (fs.statSync(full).isDirectory()) walk(full);
      else outFiles.push(full);
    });
  })(OUT);

  /* 1. 不得有資料檔或後端程式被複製出去 */
  outFiles.forEach(function (f) {
    var rel = path.relative(OUT, f).replace(/\\/g, '/');
    if (/\.json$/.test(rel) && rel !== 'js/demo-data.js') problems.push('輸出含資料檔：' + rel);
    if (/^(server|test-api|test-share|e2e-check)\.js$/.test(rel)) problems.push('輸出含後端／測試程式：' + rel);
    if (rel.indexOf('data/') === 0 || rel.indexOf('uploads/') === 0) problems.push('輸出含資料或上傳目錄：' + rel);
  });

  /* 2. 不得出現管理密碼 */
  var pw = settingsRaw && settingsRaw.adminPassword;
  if (pw) {
    outFiles.forEach(function (f) {
      var text = fs.readFileSync(f, 'utf8');
      if (text.indexOf(pw) !== -1) problems.push('輸出檔內含管理密碼：' + path.relative(OUT, f));
    });
  }

  /* 3. 不得殘留 /uploads/ 或 /api/ 以外的本機路徑引用（示意圖需為外部 URL） */
  var demoText = fs.readFileSync(path.join(OUT, 'js', 'demo-data.js'), 'utf8');
  if (demoText.indexOf('/uploads/') !== -1) problems.push('示範資料仍引用上傳檔路徑');
  if (demoText.indexOf('adminPassword') !== -1) problems.push('示範資料仍含 adminPassword 欄位');

  return problems;
}

/* ---------- 主流程 ---------- */
function main() {
  console.log('\n=== 建置 Netlify 靜態版本 ===\n');

  /* 1. 清空並重建 public/ */
  rmrf(OUT);
  fs.mkdirSync(OUT, { recursive: true });

  /* 2. 複製前端檔案 */
  var copied = [];
  FILES.forEach(function (f) {
    if (!fs.existsSync(path.join(ROOT, f))) return;
    copyFile(f);
    copied.push(f);
  });
  DIRS.forEach(function (dir) {
    var src = path.join(ROOT, dir);
    if (!fs.existsSync(src)) return;
    fs.readdirSync(src).forEach(function (f) {
      if (dir === 'js' && JS_ALLOW.indexOf(f) === -1) return;   /* js/ 只複製前端執行檔 */
      if (/\.(css|js)$/.test(f)) {
        copyFile(path.join(dir, f));
        copied.push(dir + '/' + f);
      }
    });
  });
  log('已複製 ' + copied.length + ' 個前端檔案：' + copied.join(', '));

  /* 3. 產生示範資料 */
  var demo = buildDemoData();
  var settingsRaw = readJSON('settings', {});
  var banner = '/* 由 tools/build-netlify.js 自動產生 — 靜態示範資料（已去識別化）\n' +
    '   產生時間：' + demo.generatedAt + '\n' +
    '   僅含上架中成員與已通過評價；照片一律使用 Placeholder\n' +
    '   本檔不含管理密碼、預約、訊息與檢舉等後台資料 */\n';
  fs.writeFileSync(path.join(OUT, 'js', 'demo-data.js'),
    banner + 'window.DEMO_DATA = ' + JSON.stringify(demo, null, 2) + ';\n', 'utf8');
  log('已產生 js/demo-data.js（成員 ' + demo.members.length + ' 位、評價 ' + demo.reviews.length + ' 則）');

  /* 4. 加上 _redirects 與 robots.txt */
  fs.writeFileSync(path.join(OUT, '_redirects'), '/*    /404.html  404\n', 'utf8');
  fs.writeFileSync(path.join(OUT, 'robots.txt'), 'User-agent: *\nDisallow: /admin.html\n', 'utf8');

  /* 5. 安全檢查 */
  var problems = safetyChecks(demo, settingsRaw);
  if (problems.length) {
    console.log('\n✘ 安全檢查失敗，請修正後再部署：');
    problems.forEach(function (p) { console.log('   - ' + p); });
    rmrf(OUT);
    process.exit(1);
  }
  log('安全檢查通過：未包含伺服器程式、資料檔、上傳檔或管理密碼');

  /* 6. 摘要 */
  var total = 0;
  (function walk(dir) {
    fs.readdirSync(dir).forEach(function (f) {
      var full = path.join(dir, f);
      if (fs.statSync(full).isDirectory()) walk(full);
      else total += fs.statSync(full).size;
    });
  })(OUT);
  console.log('\n✔ 完成！輸出目錄：public/（共 ' + Math.round(total / 1024) + ' KB）');
  console.log('  本機預覽：node tools/serve-static.js');
  console.log('  部署方式：見 README.md「部署到 Netlify」\n');
}

main();