/* ==================================================
   新手指南頁邏輯（js/guide.js）
   讀取站台設定（公告 / LINE ID）並提供聯絡客服入口
   ================================================== */
(function () {
  'use strict';

  function $(sel) { return document.querySelector(sel); }

  document.addEventListener('DOMContentLoaded', function () {
    /* 站台設定（公告 / 站台名稱；關閉公告會記錄在 localStorage） */
    API.settings().then(function (s) {
      applySiteSettings(s);
      if (s && s.siteName) document.title = '新手指南｜' + s.siteName;
    }).catch(function () { /* 設定載入失敗時不影響閱讀 */ });

    /* 聯絡客服（彈窗由 js/data.js 動態產生） */
    var fab = $('#contact-btn');
    if (fab) {
      fab.addEventListener('click', function () {
        openContactModal('新手指南頁');
      });
    }
  });
})();