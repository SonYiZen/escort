/* ==================================================
   本機預覽靜態版 — node tools/serve-static.js
   把 public/ 以靜態檔案伺服（模擬 Netlify 的靜態環境，沒有後端 API）
   用途：部署前先確認靜態示範版畫面正常
   ================================================== */
'use strict';

var http = require('http');
var fs = require('fs');
var path = require('path');

var PORT = Number(process.env.PORT) || 4000;
var PUBLIC = path.join(__dirname, '..', 'public');

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
  '.txt': 'text/plain; charset=utf-8'
};

if (!fs.existsSync(PUBLIC)) {
  console.error('✘ 找不到 public/ 目錄，請先執行：node tools/build-netlify.js');
  process.exit(1);
}

http.createServer(function (req, res) {
  var pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch (e) {
    res.writeHead(400); res.end('400 Bad Request'); return;
  }
  if (pathname === '/') pathname = '/index.html';

  var filePath = path.normalize(path.join(PUBLIC, pathname));
  if (filePath.indexOf(PUBLIC) !== 0) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403 Forbidden');
    return;
  }

  fs.stat(filePath, function (err, st) {
    if (err || !st.isFile()) {
      /* 模擬 Netlify 的 404 行為（API 路徑也會落在這裡，讓前端判定為靜態環境） */
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<!DOCTYPE html><html lang="zh-Hant-TW"><head><meta charset="UTF-8" />' +
        '<title>404</title></head><body style="font-family:sans-serif;padding:40px;text-align:center">' +
        '<h1>404</h1><p>找不到頁面</p><p><a href="/">回到首頁</a></p></body></html>');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    fs.createReadStream(filePath).pipe(res);
  });
}).listen(PORT, function () {
  console.log('');
  console.log('  ✔ 靜態版預覽已啟動（模擬 Netlify：沒有後端 API）');
  console.log('  └─ http://localhost:' + PORT + '/');
  console.log('  按 Ctrl+C 可停止');
  console.log('');
});