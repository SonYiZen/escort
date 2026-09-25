/* ==================================================
   後台應用邏輯（js/admin.js）
   功能：登入登出、七個營運區塊、成員 CRUD、預約 / 訊息 /
         客評 / 檢舉處理、系統設定
   資料來源：後端 REST API（js/data.js 的 API 物件）
   ================================================== */
(function () {
  'use strict';

  var PAGE_SIZE = 8;

  var SECTIONS = {
    dashboard: { title: '數據總覽', sub: '營運即時數據（示範資料）' },
    members: { title: '上架管理', sub: '管理成員列表的上架、審核與下架（示範資料）', add: true },
    bookings: { title: '預約管理', sub: '處理前台送出的預約需求（確認 / 完成 / 取消）' },
    messages: { title: '訊息管理', sub: '回覆客服訊息（預約送出時也會自動通知）' },
    reviews: { title: '客評審核', sub: '通過的評價才會顯示在個人頁面' },
    reports: { title: '檢舉處理', sub: '處理檢舉案件，必要時可直接下架該成員' },
    settings: { title: '系統設定', sub: '站台名稱、公告、LINE ID 與管理密碼' }
  };

  var state = {
    section: 'dashboard',
    memberQ: '', memberTab: 'all', memberPage: 1,
    bookingTab: 'all', messageTab: 'all', reviewTab: 'pending', reportTab: 'open',
    settings: null, authed: false
  };

  var data = { members: [], bookings: [], messages: [], reviews: [], reports: [], stats: null };
  var editingId = null;
  var formImages = [];   /* 成員表單目前選用的照片（最多 4 張） */

  function panelOf(name) { return $('#panel-' + name); }

  /* 每次呼叫後端都處理 401：未登入就回到登入畫面 */
  function guarded(promise) {
    return promise.catch(function (err) {
      if (err && err.status === 401) {
        showLogin('登入狀態已過期，請重新登入');
      }
      throw err;
    });
  }

  /* ================= 認證 ================= */
  function showLogin(message) {
    state.authed = false;
    document.body.classList.add('is-guest');
    $('#login-screen').classList.add('show');
    if (message) {
      var el = $('#login-error');
      el.textContent = message;
      el.classList.add('show');
    }
    $('#login-password').focus();
  }

  function showAdmin() {
    state.authed = true;
    document.body.classList.remove('is-guest');
    $('#login-screen').classList.remove('show');
    $('#login-error').classList.remove('show');
    $('#login-password').value = '';
  }

  function doLogin() {
    var pw = $('#login-password').value;
    var btn = $('#login-btn');
    var errEl = $('#login-error');
    if (!pw) {
      errEl.textContent = '請輸入管理密碼';
      errEl.classList.add('show');
      return;
    }
    btn.disabled = true;
    btn.textContent = '登入中…';
    API.login(pw).then(function () {
      showAdmin();
      showToast('登入成功，歡迎回來');
      return loadAll();
    }).catch(function (err) {
      errEl.textContent = err.message;
      errEl.classList.add('show');
    }).then(function () {
      btn.disabled = false;
      btn.textContent = '登入後台';
    });
  }

  function doLogout() {
    API.logout().then(function () {
      data = { members: [], bookings: [], messages: [], reviews: [], reports: [], stats: null };
      showLogin('已登出後台');
    }).catch(function (err) {
      showToast(err.message);
    });
  }

  /* ================= 資料載入 ================= */
  function loadAll() {
    return Promise.all([
      guarded(API.members.list()),
      guarded(API.bookings.list()),
      guarded(API.messages.list()),
      guarded(API.reviews.list()),
      guarded(API.reports.list()),
      guarded(API.stats())
    ]).then(function (r) {
      data.members = r[0] || [];
      data.bookings = r[1] || [];
      data.messages = r[2] || [];
      data.reviews = r[3] || [];
      data.reports = r[4] || [];
      data.stats = r[5] || null;
      refreshBadges();
      renderSection();
      var t = $('#data-time');
      if (t) t.textContent = (data.stats && data.stats.updatedAt) || '—';
    }).catch(function (err) {
      if (err && err.status !== 401) showToast(err.message);
    });
  }

  /* 只重新載入某一種資源（後台操作後呼叫） */
  function reload(kind) {
    var jobs = {
      members: function () { return API.members.list().then(function (l) { data.members = l || []; }); },
      bookings: function () { return API.bookings.list().then(function (l) { data.bookings = l || []; }); },
      messages: function () { return API.messages.list().then(function (l) { data.messages = l || []; }); },
      reviews: function () { return API.reviews.list().then(function (l) { data.reviews = l || []; }); },
      reports: function () { return API.reports.list().then(function (l) { data.reports = l || []; }); }
    };
    var first = jobs[kind] ? jobs[kind]() : Promise.resolve();
    return guarded(first).then(function () {
      return guarded(API.stats()).then(function (s) { data.stats = s; });
    }).then(function () {
      refreshBadges();
      renderSection();
      var t = $('#data-time');
      if (t) t.textContent = (data.stats && data.stats.updatedAt) || '—';
    }).catch(function (err) {
      if (err && err.status !== 401) showToast(err.message);
    });
  }

  function countBy(list, key, value) {
    return list.filter(function (x) { return x[key] === value; }).length;
  }

  function setBadge(sel, n) {
    var el = $(sel);
    if (!el) return;
    el.textContent = n > 99 ? '99+' : String(n);
    el.hidden = n === 0;
  }

  /* 側欄數字：待審核 / 待確認 / 未讀 / 待審評價 / 待處理檢舉 */
  function refreshBadges() {
    setBadge('#badge-members', countBy(data.members, 'status', 'pending'));
    setBadge('#badge-bookings', countBy(data.bookings, 'status', 'pending'));
    setBadge('#badge-messages', countBy(data.messages, 'status', 'unread'));
    setBadge('#badge-reviews', countBy(data.reviews, 'status', 'pending'));
    setBadge('#badge-reports', countBy(data.reports, 'status', 'open'));
  }

  /* ================= 區塊路由 ================= */
  function go(section, fromHash) {
    if (!SECTIONS[section]) section = 'dashboard';
    state.section = section;

    $$('#side-nav .side-link').forEach(function (a) {
      a.classList.toggle('is-active', a.getAttribute('data-section') === section);
    });
    $$('.panel').forEach(function (p) {
      p.classList.toggle('is-active', p.id === 'panel-' + section);
    });
    $('#page-title').textContent = SECTIONS[section].title;
    $('#page-sub').textContent = SECTIONS[section].sub;
    $('#add-btn').hidden = !SECTIONS[section].add;

    /* 手機版：切換後自動收起側欄 */
    var toggle = $('#nav-toggle');
    if (toggle) toggle.checked = false;

    /* 深連結：#bookings 可直接開啟該區塊 */
    if (!fromHash && window.location.hash !== '#' + section) {
      window.location.hash = section;
    }
    renderSection();
  }

  function renderSection() {
    if (!state.authed) return;
    var renderers = {
      dashboard: renderDashboard,
      members: renderMembers,
      bookings: renderBookings,
      messages: renderMessages,
      reviews: renderReviews,
      reports: renderReports,
      settings: renderSettings
    };
    var fn = renderers[state.section];
    if (fn) fn();
  }

  /* ================= 1. 數據總覽 ================= */
  function statCard(label, num, note, tone) {
    return '<article class="stat-card">' +
      '<p class="stat-label">' + esc(label) + '</p>' +
      '<p class="stat-num">' + esc(num) + '</p>' +
      (note ? '<span class="trend' + (tone ? ' ' + tone : '') + '">' + esc(note) + '</span>' : '') +
      '</article>';
  }

  /* 最近動態：彙整預約 / 訊息 / 評價 / 檢舉 */
  function buildActivity() {
    var items = [];
    data.bookings.forEach(function (b) {
      items.push({ at: b.createdAt, tag: '預約', text: '#' + b.id + ' ' + b.memberName + ' · ' + b.plan + ' · ' + b.date });
    });
    data.messages.forEach(function (m) {
      items.push({ at: m.createdAt, tag: '訊息', text: m.name + '：' + m.body });
    });
    data.reviews.forEach(function (r) {
      items.push({ at: r.createdAt, tag: '評價', text: '#' + r.id + ' ' + r.memberName + ' · ' + r.nick + '：' + r.text });
    });
    data.reports.forEach(function (p) {
      items.push({ at: p.createdAt, tag: '檢舉', text: '#' + p.id + ' ' + (p.memberName || '未指定') + ' · ' + p.reason });
    });
    items.sort(function (a, b) { return String(b.at || '').localeCompare(String(a.at || '')); });
    items = items.slice(0, 8);
    if (!items.length) return '<p class="empty">目前沒有動態</p>';
    return items.map(function (it) {
      var text = it.text.length > 42 ? it.text.slice(0, 42) + '…' : it.text;
      return '<div class="list-item">' +
        '<div class="li-head">' +
        '<span class="li-name">' + esc(it.tag) + '</span>' +
        '<span class="li-meta">' + esc(it.at || '') + '</span>' +
        '</div>' +
        '<p class="li-body">' + esc(text) + '</p>' +
        '</div>';
    }).join('');
  }

  function renderDashboard() {
    var el = panelOf('dashboard');
    var s = data.stats;
    if (!s) { el.innerHTML = '<p class="empty">載入中…</p>'; return; }

    var cards = [
      statCard('累計瀏覽', fmtNum(s.views.total), '前台詳情頁開啟次數'),
      statCard('上架成員', s.members.on, '共有 ' + s.members.total + ' 位成員'),
      statCard('待審核成員', s.members.pending, s.members.pending ? '需盡快處理' : '目前無待審', s.members.pending ? 'warn' : ''),
      statCard('今日預約', s.bookings.today, '累計 ' + s.bookings.total + ' 筆'),
      statCard('待確認預約', s.bookings.pending, s.bookings.pending ? '等待客服確認' : '皆已處理', s.bookings.pending ? 'warn' : ''),
      statCard('未讀訊息', s.messages.unread, '共 ' + s.messages.total + ' 則'),
      statCard('待審評價', s.reviews.pending, '已顯示 ' + s.reviews.on + ' 則'),
      statCard('待處理檢舉', s.reports.open, '已處理 ' + s.reports.resolved + ' 件', s.reports.open ? 'warn' : '')
    ];

    var top = (s.views && s.views.top) || [];
    var max = top.reduce(function (m, x) { return Math.max(m, x.views || 0); }, 0) || 1;
    var bars = top.length ? top.map(function (x) {
      return '<div class="bar-row">' +
        '<span class="bar-label" title="' + esc(x.id + ' ' + x.name) + '">' + esc(x.name) + '</span>' +
        '<span class="bar-track"><span class="bar-fill" style="width:' + Math.max(4, Math.round((x.views || 0) / max * 100)) + '%"></span></span>' +
        '<span class="bar-value">' + fmtNum(x.views) + '</span>' +
        '</div>';
    }).join('') : '<p class="empty">尚無瀏覽資料</p>';

    el.innerHTML =
      '<section class="stat-cards" aria-label="營運統計">' + cards.join('') + '</section>' +
      '<div class="panel-grid">' +
      '<div class="panel-card"><h2>熱門瀏覽（前 5 名）</h2><div class="bar-list">' + bars + '</div></div>' +
      '<div class="panel-card"><h2>最近動態</h2><div class="list-stack">' + buildActivity() + '</div></div>' +
      '</div>';
  }

  /* ================= 2. 上架管理 ================= */
  function filteredMembers() {
    var list = data.members.slice();
    if (state.memberQ) {
      var q = state.memberQ.toLowerCase();
      list = list.filter(function (m) {
        return ((m.name || '') + ' ' + (m.id || '') + ' ' + (m.city || '')).toLowerCase().indexOf(q) !== -1;
      });
    }
    if (state.memberTab !== 'all') list = list.filter(function (m) { return m.status === state.memberTab; });
    return list;
  }

  function memberRow(m) {
    var action2 =
      m.status === 'on' ? '<button class="btn-mini danger" type="button" data-action="off" data-id="' + esc(m.id) + '">下架</button>' :
        m.status === 'pending' ? '<button class="btn-mini go" type="button" data-action="approve" data-id="' + esc(m.id) + '">通過</button>' :
          '<button class="btn-mini go" type="button" data-action="republish" data-id="' + esc(m.id) + '">重新上架</button>';
    return '<tr>' +
      '<td><div class="member">' +
      '<img src="' + memberAvatar(m) + '" alt="' + esc(m.name) + ' 頭像（Placeholder）" loading="lazy" />' +
      '<div><p class="n">' + esc(m.name) + ' ·' + esc(m.age) + '</p><p class="id">#' + esc(m.id) + '</p></div>' +
      '</div></td>' +
      '<td>' + esc(m.city) + '</td>' +
      '<td class="type-cell">' + esc(m.type) + '</td>' +
      '<td class="price-cell">' + fmtPrice(m.price) + ' <small>底</small></td>' +
      '<td class="views-cell">' + fmtNum(m.views) + '</td>' +
      '<td>' + statusBadge(m.status, 'member') + '</td>' +
      '<td class="updated">' + esc(m.updated || '—') + '</td>' +
      '<td><div class="actions">' +
      '<button class="btn-mini" type="button" data-action="edit" data-id="' + esc(m.id) + '">編輯</button>' +
      '<button class="btn-mini" type="button" data-action="preview" data-id="' + esc(m.id) + '">前台</button>' +
      action2 +
      '</div></td>' +
      '</tr>';
  }

  function renderMembers() {
    var el = panelOf('members');
    var counts = {
      all: data.members.length,
      on: countBy(data.members, 'status', 'on'),
      pending: countBy(data.members, 'status', 'pending'),
      off: countBy(data.members, 'status', 'off')
    };
    var tabs = [['all', '全部'], ['on', '上架中'], ['pending', '待審核'], ['off', '已下架']].map(function (t) {
      return '<button class="tab' + (state.memberTab === t[0] ? ' is-active' : '') + '" type="button" data-tab="' + t[0] + '">' +
        t[1] + ' ' + counts[t[0]] + '</button>';
    }).join('');

    var list = filteredMembers();
    var pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    if (state.memberPage > pages) state.memberPage = pages;
    if (state.memberPage < 1) state.memberPage = 1;
    var slice = list.slice((state.memberPage - 1) * PAGE_SIZE, state.memberPage * PAGE_SIZE);

    var rows = slice.length
      ? slice.map(memberRow).join('')
      : '<tr><td colspan="8" class="empty">沒有符合條件的成員資料</td></tr>';

    var pager = '<button class="page-btn" type="button" data-page="' + (state.memberPage - 1) + '"' + (state.memberPage === 1 ? ' disabled' : '') + ' aria-label="上一頁">‹</button>';
    for (var i = 1; i <= pages; i++) {
      pager += '<button class="page-btn' + (i === state.memberPage ? ' is-current' : '') + '" type="button" data-page="' + i + '">' + i + '</button>';
    }
    pager += '<button class="page-btn" type="button" data-page="' + (state.memberPage + 1) + '"' + (state.memberPage === pages ? ' disabled' : '') + ' aria-label="下一頁">›</button>';

    el.innerHTML =
      '<div class="tabs" aria-label="狀態篩選">' + tabs + '</div>' +
      '<section class="table-card" aria-label="成員列表">' +
      '<div class="table-scroll">' +
      '<table>' +
      '<thead><tr>' +
      '<th>成員</th><th>地區</th><th>類型</th><th>價格</th><th>瀏覽</th><th>狀態</th><th>更新時間</th><th>操作</th>' +
      '</tr></thead>' +
      '<tbody>' + rows + '</tbody>' +
      '</table>' +
      '</div>' +
      '</section>' +
      '<nav class="pagination" aria-label="分頁">' + pager + '</nav>' +
      '<p class="empty">共 ' + list.length + ' 筆・每頁 ' + PAGE_SIZE + ' 筆</p>';
  }

  /* ---------------- 成員新增 / 編輯 / 刪除 ---------------- */
  function findMember(id) {
    for (var i = 0; i < data.members.length; i++) {
      if (data.members[i].id === id) return data.members[i];
    }
    return null;
  }

  function openForm(id) {
    editingId = id;
    var m = id ? findMember(id) : null;
    var modal = $('#member-modal');
    $('#modal-title').textContent = m ? '編輯成員 #' + m.id : '新增成員';
    $('#f-name').value = m ? m.name : '';
    $('#f-age').value = m ? m.age : '';
    $('#f-city').value = m ? m.city : '台北市';
    $('#f-type').value = m ? m.type : '外送';
    $('#f-price').value = m ? m.price : '';
    $('#f-height').value = m ? m.height : '';
    $('#f-weight').value = m ? m.weight : '';
    $('#f-cup').value = m ? m.cup : '';
    $('#f-tags').value = m ? (m.tags || []).join('、') : '';
    $('#f-intro').value = m ? (m.intro || '') : '';
    /* 成員照片：預設帶入現有照片，可上傳 / 移除 */
    formImages = (m && Array.isArray(m.images)) ? m.images.slice(0, 4) : [];
    renderFormImages();
    $('#f-status').value = m ? m.status : 'pending';
    $('#f-delete').hidden = !m;
    openModal(modal);
    $('#f-name').focus();
  }

  /* ---------------- 成員照片：預覽 / 上傳 / 移除 ---------------- */
  var FORM_IMAGE_MAX = 4;

  function renderFormImages() {
    var grid = $('#f-images');
    if (!grid) return;
    var html = formImages.map(function (u, i) {
      return '<div class="upload-item">' +
        '<img src="' + esc(u) + '" alt="成員照片 ' + (i + 1) + '" />' +
        (i === 0 ? '<span class="cover-tag">主圖</span>' : '') +
        '<button class="rm" type="button" data-rm-image="' + i + '" aria-label="移除第 ' + (i + 1) + ' 張照片">✕</button>' +
      '</div>';
    }).join('');

    if (formImages.length < FORM_IMAGE_MAX) {
      html += '<label class="upload-drop" id="f-image-drop">' +
        '<span id="f-image-drop-text">＋<br />上傳照片</span>' +
        '<input type="file" id="f-image-input" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden />' +
      '</label>';
    }
    grid.innerHTML = html;

    var input = $('#f-image-input');
    if (input) input.addEventListener('change', function () { onPickFormImages(input); });
  }

  function setDropText(text) {
    var el = $('#f-image-drop-text');
    if (el) el.textContent = text;
  }

  function onPickFormImages(input) {
    if (!input || !input.files || !input.files.length) return;
    var room = FORM_IMAGE_MAX - formImages.length;
    if (room <= 0) { showToast('照片已達上限 ' + FORM_IMAGE_MAX + ' 張'); return; }

    var files = Array.prototype.slice.call(input.files);
    if (files.length > room) {
      showToast('最多再上傳 ' + room + ' 張，已取前 ' + room + ' 張');
      files = files.slice(0, room);
    }

    setDropText('上傳中…');
    var drop = $('#f-image-drop');
    if (drop && drop.classList) drop.classList.add('is-busy');

    uploadImages(files).then(function (infos) {
      infos.forEach(function (f) {
        if (formImages.length < FORM_IMAGE_MAX) formImages.push(f.url);
      });
      showToast('已上傳 ' + infos.length + ' 張照片');
      renderFormImages();
    }).catch(function (err) {
      renderFormImages();
      showToast(err.message);
    });
  }

  /* 從表單移除照片（未被任何資料引用者會直接刪檔，仍被引用時後端回 409，忽略即可） */
  function removeFormImage(index) {
    var url = formImages[index];
    formImages.splice(index, 1);
    renderFormImages();
    if (url && uploadNameOf(url)) {
      deleteUpload(url).catch(function () { /* 仍被既有資料引用，交由儲存時清理 */ });
    }
  }

  function saveMemberForm() {
    var name = $('#f-name').value.trim();
    var age = parseInt($('#f-age').value, 10);
    var price = parseInt($('#f-price').value, 10);
    if (!name) { showToast('請輸入成員暱稱'); return; }
    if (!age || age < 18) { showToast('年齡需為 18 歲以上的整數'); return; }
    if (!price || price <= 0) { showToast('請輸入有效的價格'); return; }

    var payload = {
      name: name,
      age: age,
      city: $('#f-city').value,
      type: $('#f-type').value,
      price: price,
      status: $('#f-status').value,
      height: parseInt($('#f-height').value, 10) || 160,
      weight: parseInt($('#f-weight').value, 10) || 45,
      cup: $('#f-cup').value.trim() || 'B',
      intro: $('#f-intro').value.trim(),
      tags: $('#f-tags').value.split(/[、,，]/).map(function (s) { return s.trim(); }).filter(Boolean).slice(0, 3),
      /* 照片：第一張同時作為列表主圖與頭像；未上傳時交給後端產生示範圖 */
      images: formImages.slice(0, FORM_IMAGE_MAX),
      img: formImages[0] || '',
      avatar: formImages[0] || ''
    };

    var btn = $('#f-save');
    btn.disabled = true;
    btn.textContent = '儲存中…';

    var req = editingId
      ? API.members.update(editingId, payload).then(function () { showToast('已儲存「' + name + '」的變更'); })
      : API.members.create(payload).then(function (m) { showToast('已新增成員 #' + m.id); });

    guarded(req).then(function () {
      closeModal($('#member-modal'));
      return reload('members');
    }).catch(function (err) {
      if (err && err.status !== 401) showToast(err.message);
    }).then(function () {
      btn.disabled = false;
      btn.textContent = '儲存';
    });
  }

  function deleteMember() {
    var m = findMember(editingId);
    if (!m) return;
    if (!window.confirm('確定要刪除「' + m.name + '」嗎？此操作會刪除後端資料，並同步清除該成員的評價與檢舉。')) return;
    guarded(API.members.remove(editingId)).then(function () {
      closeModal($('#member-modal'));
      showToast('已刪除「' + m.name + '」');
      return reload('members');
    }).catch(function (err) {
      if (err && err.status !== 401) showToast(err.message);
    });
  }

  /* 表格列操作（事件代理） */
  function handleMemberAction(btn) {
    var id = btn.getAttribute('data-id');
    var action = btn.getAttribute('data-action');
    var m = findMember(id);

    if (action === 'edit') { openForm(id); return; }
    if (action === 'preview') {
      window.open('detail.html?id=' + encodeURIComponent(id), '_blank');
      return;
    }
    var statuses = { off: 'off', approve: 'on', republish: 'on' };
    var notes = { off: ' 已下架', approve: ' 審核通過，已上架', republish: ' 已重新上架' };
    if (!statuses[action]) return;

    guarded(API.members.update(id, { status: statuses[action] })).then(function () {
      showToast((m ? m.name : '成員') + notes[action]);
      return reload('members');
    }).catch(function (err) {
      if (err && err.status !== 401) showToast(err.message);
    });
  }

  /* ================= 3. 預約管理 ================= */
  function renderBookings() {
    var el = panelOf('bookings');
    var counts = {
      all: data.bookings.length,
      pending: countBy(data.bookings, 'status', 'pending'),
      confirmed: countBy(data.bookings, 'status', 'confirmed'),
      done: countBy(data.bookings, 'status', 'done'),
      cancelled: countBy(data.bookings, 'status', 'cancelled')
    };
    var tabs = [['all', '全部'], ['pending', '待確認'], ['confirmed', '已確認'], ['done', '已完成'], ['cancelled', '已取消']]
      .map(function (t) {
        return '<button class="tab' + (state.bookingTab === t[0] ? ' is-active' : '') + '" type="button" data-tab="' + t[0] + '">' +
          t[1] + ' ' + counts[t[0]] + '</button>';
      }).join('');

    var list = data.bookings.slice();
    if (state.bookingTab !== 'all') list = list.filter(function (b) { return b.status === state.bookingTab; });

    var rows = list.length ? list.map(function (b) {
      var ops = '';
      if (b.status === 'pending') {
        ops = '<button class="btn-mini go" type="button" data-action="confirm" data-id="' + esc(b.id) + '">確認</button>';
      } else if (b.status === 'confirmed') {
        ops = '<button class="btn-mini go" type="button" data-action="done" data-id="' + esc(b.id) + '">完成</button>';
      }
      if (b.status === 'pending' || b.status === 'confirmed') {
        ops += '<button class="btn-mini danger" type="button" data-action="cancel" data-id="' + esc(b.id) + '">取消</button>';
      }
      ops += '<button class="btn-mini danger" type="button" data-action="remove" data-id="' + esc(b.id) + '">刪除</button>';

      return '<tr>' +
        '<td><p class="n">#' + esc(b.id) + '</p><p class="id">' + esc(b.createdAt || '') + '</p></td>' +
        '<td><div class="member"><div><p class="n">' + esc(b.memberName || '—') + '</p>' +
        '<p class="id">#' + esc(b.memberId || '') + '</p></div></div></td>' +
        '<td>' + esc(b.plan) + (b.note ? '<p class="id" title="' + esc(b.note) + '">備註：' + esc(b.note.length > 16 ? b.note.slice(0, 16) + '…' : b.note) + '</p>' : '') + '</td>' +
        '<td class="price-cell">' + fmtPrice(b.price) + '</td>' +
        '<td class="updated">' + esc(b.date) + '<br />' + esc(b.time) + '</td>' +
        '<td class="contact-cell">' + esc(b.contact) + '</td>' +
        '<td>' + statusBadge(b.status, 'booking') + '</td>' +
        '<td><div class="actions">' + ops + '</div></td>' +
        '</tr>';
    }).join('') : '<tr><td colspan="8" class="empty">沒有符合條件的預約資料</td></tr>';

    el.innerHTML =
      '<div class="tabs" aria-label="預約狀態篩選">' + tabs + '</div>' +
      '<section class="table-card" aria-label="預約列表">' +
      '<div class="table-scroll">' +
      '<table>' +
      '<thead><tr>' +
      '<th>單號</th><th>成員</th><th>方案 / 備註</th><th>金額</th><th>預約時間</th><th>聯絡方式</th><th>狀態</th><th>操作</th>' +
      '</tr></thead>' +
      '<tbody>' + rows + '</tbody>' +
      '</table>' +
      '</div>' +
      '</section>' +
      '<p class="empty">共 ' + list.length + ' 筆預約</p>';
  }

  function handleBookingAction(btn) {
    var id = btn.getAttribute('data-action');
    var bookingId = btn.getAttribute('data-id');
    var map = {
      confirm: ['confirmed', '預約已確認'],
      done: ['done', '預約已標記完成'],
      cancel: ['cancelled', '預約已取消']
    };

    if (id === 'remove') {
      if (!window.confirm('確定要刪除預約 ' + bookingId + ' 嗎？')) return;
      guarded(API.bookings.remove(bookingId)).then(function () {
        showToast('已刪除預約 ' + bookingId);
        return reload('bookings');
      }).catch(function (err) { if (err.status !== 401) showToast(err.message); });
      return;
    }

    if (!map[id]) return;
    guarded(API.bookings.update(bookingId, { status: map[id][0] })).then(function () {
      showToast(map[id][1] + '（' + bookingId + '）');
      return reload('bookings');
    }).catch(function (err) { if (err.status !== 401) showToast(err.message); });
  }

  /* ================= 4. 訊息管理 ================= */
  function renderMessages() {
    var el = panelOf('messages');
    var counts = {
      all: data.messages.length,
      unread: countBy(data.messages, 'status', 'unread'),
      read: countBy(data.messages, 'status', 'read'),
      replied: countBy(data.messages, 'status', 'replied')
    };
    var tabs = [['all', '全部'], ['unread', '未讀'], ['read', '已讀'], ['replied', '已回覆']].map(function (t) {
      return '<button class="tab' + (state.messageTab === t[0] ? ' is-active' : '') + '" type="button" data-tab="' + t[0] + '">' +
        t[1] + ' ' + counts[t[0]] + '</button>';
    }).join('');

    var list = data.messages.slice();
    if (state.messageTab !== 'all') list = list.filter(function (m) { return m.status === state.messageTab; });

    var items = list.length ? list.map(function (m) {
      var ops = '';
      if (m.status === 'unread') {
        ops += '<button class="btn-mini" type="button" data-action="read" data-id="' + esc(m.id) + '">標記已讀</button>';
      }
      ops += '<button class="btn-mini danger" type="button" data-action="remove" data-id="' + esc(m.id) + '">刪除</button>';

      return '<div class="list-item' + (m.status === 'unread' ? ' is-unread' : '') + '">' +
        '<div class="li-head">' +
        '<span class="li-name">' + esc(m.name) + '</span>' +
        statusBadge(m.status, 'message') +
        (m.memberName ? '<span class="li-meta">對象：' + esc(m.memberName) + ' #' + esc(m.memberId) + '</span>' : '') +
        '<span class="li-meta">' + esc(m.contact) + '</span>' +
        '<span class="li-meta">#' + esc(m.id) + ' · ' + esc(m.createdAt || '') + '</span>' +
        '</div>' +
        '<p class="li-body">' + esc(m.body) + '</p>' +
        (m.reply ? '<p class="li-reply">客服回覆：' + esc(m.reply) + '</p>' : '') +
        '<div class="li-reply-box">' +
        '<input type="text" maxlength="300" data-reply="' + esc(m.id) + '" placeholder="輸入回覆內容後按送出" />' +
        '<button class="btn-mini go" type="button" data-action="reply" data-id="' + esc(m.id) + '">送出回覆</button>' +
        '</div>' +
        '<div class="li-actions">' + ops + '</div>' +
        '</div>';
    }).join('') : '<p class="empty">沒有符合條件的訊息</p>';

    el.innerHTML =
      '<div class="tabs" aria-label="訊息狀態篩選">' + tabs + '</div>' +
      '<div class="list-stack">' + items + '</div>' +
      '<p class="empty">共 ' + list.length + ' 則訊息</p>';
  }

  function handleMessageAction(btn) {
    var action = btn.getAttribute('data-action');
    var id = btn.getAttribute('data-id');

    if (action === 'remove') {
      if (!window.confirm('確定要刪除訊息 ' + id + ' 嗎？')) return;
      guarded(API.messages.remove(id)).then(function () {
        showToast('已刪除訊息 ' + id);
        return reload('messages');
      }).catch(function (err) { if (err.status !== 401) showToast(err.message); });
      return;
    }

    if (action === 'read') {
      guarded(API.messages.update(id, { status: 'read' })).then(function () {
        showToast('已標記為已讀');
        return reload('messages');
      }).catch(function (err) { if (err.status !== 401) showToast(err.message); });
      return;
    }

    if (action === 'reply') {
      var input = $('[data-reply="' + id + '"]');
      var text = input ? input.value.trim() : '';
      if (!text) { showToast('請先輸入回覆內容'); return; }
      guarded(API.messages.update(id, { reply: text })).then(function () {
        showToast('已送出回覆');
        return reload('messages');
      }).catch(function (err) { if (err.status !== 401) showToast(err.message); });
    }
  }

  /* ================= 5. 客評審核 ================= */
  function renderReviews() {
    var el = panelOf('reviews');
    var counts = {
      all: data.reviews.length,
      pending: countBy(data.reviews, 'status', 'pending'),
      on: countBy(data.reviews, 'status', 'on'),
      off: countBy(data.reviews, 'status', 'off')
    };
    var tabs = [['pending', '待審核'], ['on', '已顯示'], ['off', '已退回'], ['all', '全部']].map(function (t) {
      return '<button class="tab' + (state.reviewTab === t[0] ? ' is-active' : '') + '" type="button" data-tab="' + t[0] + '">' +
        t[1] + ' ' + counts[t[0]] + '</button>';
    }).join('');

    var list = data.reviews.slice();
    if (state.reviewTab !== 'all') list = list.filter(function (r) { return r.status === state.reviewTab; });

    var items = list.length ? list.map(function (r) {
      var ops = '';
      if (r.status !== 'on') {
        ops += '<button class="btn-mini go" type="button" data-action="approve" data-id="' + esc(r.id) + '">通過顯示</button>';
      }
      if (r.status !== 'off') {
        ops += '<button class="btn-mini" type="button" data-action="reject" data-id="' + esc(r.id) + '">退回</button>';
      }
      ops += '<button class="btn-mini danger" type="button" data-action="remove" data-id="' + esc(r.id) + '">刪除</button>';

      /* 評價圖片（後台上傳的客評截圖） */
      var shots = (r.images || []).map(function (u, i) {
        return '<div class="upload-item">' +
          '<a href="' + esc(u) + '" target="_blank" rel="noopener" title="點擊看大圖">' +
            '<img src="' + esc(u) + '" alt="評價圖片 ' + (i + 1) + '" loading="lazy" />' +
          '</a>' +
          '<button class="rm" type="button" data-action="rmimage" data-id="' + esc(r.id) + '" data-url="' + esc(u) + '" aria-label="移除第 ' + (i + 1) + ' 張圖片">✕</button>' +
        '</div>';
      }).join('');
      var uploader = (r.images || []).length < 3
        ? '<label class="upload-drop"><span>＋<br />圖片</span>' +
            '<input type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden data-review-upload="' + esc(r.id) + '" />' +
          '</label>'
        : '';

      return '<div class="list-item">' +
        '<div class="li-head">' +
        '<span class="li-name">' + esc(r.nick) + '</span>' +
        statusBadge(r.status, 'review') +
        '<span class="li-meta">對象：' + esc(r.memberName || '') + ' #' + esc(r.memberId) + '</span>' +
        '<span class="li-meta">#' + esc(r.id) + ' · ' + esc(r.createdAt || '') + '</span>' +
        '</div>' +
        '<p class="li-body">' + esc(r.text) + '</p>' +
        '<div class="upload-grid">' + shots + uploader + '</div>' +
        '<div class="li-actions">' + ops + '</div>' +
        '</div>';
    }).join('') : '<p class="empty">沒有符合條件的評價</p>';

    el.innerHTML =
      '<div class="tabs" aria-label="評價狀態篩選">' + tabs + '</div>' +
      '<div class="list-stack">' + items + '</div>' +
      '<p class="empty">共 ' + list.length + ' 則評價</p>';
  }

  function handleReviewAction(btn) {
    var action = btn.getAttribute('data-action');
    var id = btn.getAttribute('data-id');

    /* 移除某張評價圖片（同步刪除未被其他資料引用的上傳檔） */
    if (action === 'rmimage') {
      var url = btn.getAttribute('data-url');
      var rv = null;
      data.reviews.forEach(function (x) { if (x.id === id) rv = x; });
      if (!rv) return;
      if (!window.confirm('確定要移除這張評價圖片嗎？')) return;
      var rest = (rv.images || []).filter(function (u) { return u !== url; });
      guarded(API.reviews.update(id, { images: rest })).then(function () {
        showToast('已移除評價圖片');
        return deleteUpload(url).catch(function () { /* 仍被其他地方引用時忽略 */ });
      }).then(function () {
        return reload('reviews');
      }).catch(function (err) { if (err.status !== 401) showToast(err.message); });
      return;
    }

    if (action === 'remove') {
      if (!window.confirm('確定要刪除評價 ' + id + ' 嗎？')) return;
      guarded(API.reviews.remove(id)).then(function () {
        showToast('已刪除評價 ' + id);
        return reload('reviews');
      }).catch(function (err) { if (err.status !== 401) showToast(err.message); });
      return;
    }

    var statuses = { approve: 'on', reject: 'off' };
    var notes = { approve: '評價已通過，將顯示在個人頁面', reject: '評價已退回，不會顯示' };
    if (!statuses[action]) return;

    guarded(API.reviews.update(id, { status: statuses[action] })).then(function () {
      showToast(notes[action]);
      return reload('reviews');
    }).catch(function (err) { if (err.status !== 401) showToast(err.message); });
  }

  /* 評價圖片上傳（後台）：上傳後直接更新該評價的 images（最多 3 張） */
  function onPickReviewImages(input) {
    var id = input.getAttribute('data-review-upload');
    if (!id || !input.files || !input.files.length) return;
    var rv = null;
    data.reviews.forEach(function (x) { if (x.id === id) rv = x; });
    if (!rv) return;

    var existing = (rv.images || []).slice();
    var room = 3 - existing.length;
    if (room <= 0) { showToast('此評價圖片已達上限 3 張'); return; }

    var files = Array.prototype.slice.call(input.files);
    if (files.length > room) {
      showToast('最多再上傳 ' + room + ' 張，已取前 ' + room + ' 張');
      files = files.slice(0, room);
    }

    showToast('圖片上傳中…');
    uploadImages(files).then(function (infos) {
      var urls = existing.concat(infos.map(function (f) { return f.url; })).slice(0, 3);
      return guarded(API.reviews.update(id, { images: urls }));
    }).then(function () {
      showToast('評價圖片已更新');
      return reload('reviews');
    }).catch(function (err) {
      if (err && err.status !== 401) showToast(err.message);
      return reload('reviews');
    });
  }

  /* ================= 6. 檢舉處理 ================= */
  function renderReports() {
    var el = panelOf('reports');
    var counts = {
      all: data.reports.length,
      open: countBy(data.reports, 'status', 'open'),
      resolved: countBy(data.reports, 'status', 'resolved'),
      dismissed: countBy(data.reports, 'status', 'dismissed')
    };
    var tabs = [['open', '待處理'], ['resolved', '已處理'], ['dismissed', '已駁回'], ['all', '全部']].map(function (t) {
      return '<button class="tab' + (state.reportTab === t[0] ? ' is-active' : '') + '" type="button" data-tab="' + t[0] + '">' +
        t[1] + ' ' + counts[t[0]] + '</button>';
    }).join('');

    var list = data.reports.slice();
    if (state.reportTab !== 'all') list = list.filter(function (p) { return p.status === state.reportTab; });

    var items = list.length ? list.map(function (p) {
      var ops = '';
      if (p.status !== 'resolved') {
        ops += '<button class="btn-mini go" type="button" data-action="resolve" data-id="' + esc(p.id) + '">標記已處理</button>';
      }
      if (p.status !== 'dismissed') {
        ops += '<button class="btn-mini" type="button" data-action="dismiss" data-id="' + esc(p.id) + '">駁回</button>';
      }
      if (p.memberId) {
        ops += '<button class="btn-mini danger" type="button" data-action="takedown" data-id="' + esc(p.id) +
          '" data-member="' + esc(p.memberId) + '">下架該成員</button>';
      }
      ops += '<button class="btn-mini danger" type="button" data-action="remove" data-id="' + esc(p.id) + '">刪除</button>';

      return '<div class="list-item' + (p.status === 'open' ? ' is-unread' : '') + '">' +
        '<div class="li-head">' +
        '<span class="li-name">' + esc(p.reason) + '</span>' +
        statusBadge(p.status, 'report') +
        '<span class="li-meta">對象：' + esc(p.memberName || '未指定') + (p.memberId ? ' #' + esc(p.memberId) : '') + '</span>' +
        '<span class="li-meta">檢舉人：' + esc(p.reporter || '匿名') + '</span>' +
        '<span class="li-meta">#' + esc(p.id) + ' · ' + esc(p.createdAt || '') + '</span>' +
        '</div>' +
        '<p class="li-body">' + esc(p.detail) + '</p>' +
        (p.handleNote ? '<p class="li-reply">處理備註：' + esc(p.handleNote) + '</p>' : '') +
        '<div class="li-actions">' + ops + '</div>' +
        '</div>';
    }).join('') : '<p class="empty">沒有符合條件的檢舉案件</p>';

    el.innerHTML =
      '<div class="tabs" aria-label="檢舉狀態篩選">' + tabs + '</div>' +
      '<div class="list-stack">' + items + '</div>' +
      '<p class="empty">共 ' + list.length + ' 件檢舉</p>';
  }

  function handleReportAction(btn) {
    var action = btn.getAttribute('data-action');
    var id = btn.getAttribute('data-id');

    if (action === 'remove') {
      if (!window.confirm('確定要刪除檢舉 ' + id + ' 嗎？')) return;
      guarded(API.reports.remove(id)).then(function () {
        showToast('已刪除檢舉 ' + id);
        return reload('reports');
      }).catch(function (err) { if (err.status !== 401) showToast(err.message); });
      return;
    }

    /* 一鍵下架被檢舉的成員（連動上架管理） */
    if (action === 'takedown') {
      var memberId = btn.getAttribute('data-member');
      if (!memberId) return;
      if (!window.confirm('確定要下架被檢舉的成員 #' + memberId + ' 嗎？該成員將不會出現在前台。')) return;
      guarded(API.members.update(memberId, { status: 'off' })).then(function () {
        return guarded(API.reports.update(id, { status: 'resolved', note: '已下架該成員 #' + memberId }));
      }).then(function () {
        showToast('已下架 #' + memberId + ' 並標記檢舉為已處理');
        return reload('reports').then(function () { return reload('members'); });
      }).catch(function (err) { if (err.status !== 401) showToast(err.message); });
      return;
    }

    var statuses = { resolve: 'resolved', dismiss: 'dismissed' };
    var notes = { resolve: '檢舉已標記為已處理', dismiss: '檢舉已駁回' };
    if (!statuses[action]) return;

    guarded(API.reports.update(id, { status: statuses[action] })).then(function () {
      showToast(notes[action]);
      return reload('reports');
    }).catch(function (err) { if (err.status !== 401) showToast(err.message); });
  }

  /* ================= 7. 系統設定 ================= */
  function renderSettings() {
    var el = panelOf('settings');
    if (!state.settings) {
      el.innerHTML = '<p class="empty">載入中…</p>';
      guarded(API.settings()).then(function (s) {
        state.settings = s;
        renderSettings();
      }).catch(function (err) { if (err.status !== 401) showToast(err.message); });
      return;
    }

    var s = state.settings;
    var cityOptions = ['全台縣市'].concat(CITIES).map(function (c) {
      return '<option' + (c === s.defaultCity ? ' selected' : '') + '>' + esc(c) + '</option>';
    }).join('');

    el.innerHTML =
      '<div class="panel-card">' +
      '<h2>站台設定</h2>' +
      '<div class="settings-grid">' +
      '<div>' +
      '<label for="set-site-name">站台名稱（前台品牌文字）</label>' +
      '<input id="set-site-name" type="text" maxlength="24" value="' + esc(s.siteName || '') + '" />' +
      '</div>' +
      '<div>' +
      '<label for="set-line-id">客服 LINE ID（個人頁洽詢彈窗顯示）</label>' +
      '<input id="set-line-id" type="text" maxlength="40" value="' + esc(s.lineId || '') + '" />' +
      '</div>' +
      '<div>' +
      '<label for="set-notice">站台公告（顯示於首頁與新手指南，可留白關閉）</label>' +
      '<textarea id="set-notice" maxlength="120">' + esc(s.notice || '') + '</textarea>' +
      '</div>' +
      '<div>' +
      '<label for="set-default-city">首頁預設縣市</label>' +
      '<select id="set-default-city">' + cityOptions + '</select>' +
      '</div>' +
      '<div>' +
      '<label for="set-password">管理密碼（留白表示不變更，至少 6 個字元）</label>' +
      '<input id="set-password" type="password" autocomplete="new-password" placeholder="••••••••" />' +
      '</div>' +
      '<label class="switch-row">' +
      '<input type="checkbox" id="set-open"' + (s.siteOpen ? ' checked' : '') + ' />' +
      '站台開放接單（取消勾選會在前台顯示暫停接單提示）' +
      '</label>' +
      '</div>' +
      '<div class="settings-actions">' +
      '<button class="btn-primary" id="set-save" type="button">儲存設定</button>' +
      '<button class="btn-ghost" id="set-reset" type="button">重置示範資料</button>' +
      '</div>' +
      '<p class="empty">設定更新時間：' + esc(s.updated || '—') + '（前台重新整理即可看到變更）</p>' +
      '</div>';

    $('#set-save').addEventListener('click', saveSettingsForm);
    $('#set-reset').addEventListener('click', resetDemo);
  }

  function saveSettingsForm() {
    var payload = {
      siteName: $('#set-site-name').value.trim(),
      lineId: $('#set-line-id').value.trim(),
      notice: $('#set-notice').value.trim(),
      defaultCity: $('#set-default-city').value,
      siteOpen: $('#set-open').checked
    };
    var pw = $('#set-password').value;
    if (pw) payload.adminPassword = pw;

    var btn = $('#set-save');
    btn.disabled = true;
    btn.textContent = '儲存中…';

    guarded(API.updateSettings(payload)).then(function (s) {
      state.settings = s;
      showToast('設定已儲存，前台重新整理即生效');
      renderSettings();
    }).catch(function (err) {
      if (err.status !== 401) showToast(err.message);
    }).then(function () {
      var b = $('#set-save');
      if (b) { b.disabled = false; b.textContent = '儲存設定'; }
    });
  }

  function resetDemo() {
    if (!window.confirm('確定要重置示範資料嗎？所有成員、預約、訊息、評價、檢舉與設定都會還原成種子資料。')) return;
    guarded(API.reset()).then(function () {
      state.settings = null;
      state.memberPage = 1;
      showToast('已重置為示範資料');
      return loadAll();
    }).catch(function (err) { if (err.status !== 401) showToast(err.message); });
  }

  /* ================= 初始化與事件綁定 ================= */
  function init() {
    /* 成員表單的地區下拉 */
    $('#f-city').innerHTML = CITIES.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');

    /* 登入 / 登出 */
    $('#login-btn').addEventListener('click', doLogin);
    $('#login-password').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') doLogin();
    });
    $('#logout-btn').addEventListener('click', function () {
      if (window.confirm('確定要登出後台嗎？')) doLogout();
    });

    /* 側欄區塊切換 */
    $('#side-nav').addEventListener('click', function (e) {
      var link = e.target.closest('[data-section]');
      if (!link) return;
      e.preventDefault();
      go(link.getAttribute('data-section'));
    });

    /* 頂欄搜尋：自動切換到上架管理並套用關鍵字 */
    $('#admin-search').addEventListener('input', function () {
      state.memberQ = this.value.trim();
      state.memberPage = 1;
      if (state.section !== 'members') go('members');
      else renderMembers();
    });

    /* 新增成員 / 成員彈窗 */
    $('#add-btn').addEventListener('click', function () { openForm(null); });
    $('#f-cancel').addEventListener('click', function () { closeModal($('#member-modal')); });
    $('#f-save').addEventListener('click', saveMemberForm);
    $('#f-delete').addEventListener('click', deleteMember);

    /* 成員照片：移除鈕（事件代理；上傳是 change 事件，於 renderFormImages 綁定） */
    $('#f-images').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-rm-image]');
      if (!btn) return;
      removeFormImage(parseInt(btn.getAttribute('data-rm-image'), 10));
    });

    /* 各區塊事件代理（內容為動態產生，綁在固定的 panel 容器上） */
    $('#panel-members').addEventListener('click', function (e) {
      var tab = e.target.closest('.tab');
      if (tab) { state.memberTab = tab.getAttribute('data-tab'); state.memberPage = 1; renderMembers(); return; }
      var page = e.target.closest('.page-btn');
      if (page && !page.disabled) {
        state.memberPage = parseInt(page.getAttribute('data-page'), 10) || 1;
        renderMembers();
        return;
      }
      var btn = e.target.closest('button[data-action]');
      if (btn) handleMemberAction(btn);
    });

    $('#panel-bookings').addEventListener('click', function (e) {
      var tab = e.target.closest('.tab');
      if (tab) { state.bookingTab = tab.getAttribute('data-tab'); renderBookings(); return; }
      var btn = e.target.closest('button[data-action]');
      if (btn) handleBookingAction(btn);
    });

    $('#panel-messages').addEventListener('click', function (e) {
      var tab = e.target.closest('.tab');
      if (tab) { state.messageTab = tab.getAttribute('data-tab'); renderMessages(); return; }
      var btn = e.target.closest('button[data-action]');
      if (btn) handleMessageAction(btn);
    });

    $('#panel-reviews').addEventListener('click', function (e) {
      var tab = e.target.closest('.tab');
      if (tab) { state.reviewTab = tab.getAttribute('data-tab'); renderReviews(); return; }
      var btn = e.target.closest('button[data-action]');
      if (btn) handleReviewAction(btn);
    });

    /* 評價圖片上傳（file input 為動態產生，使用事件代理的 change） */
    $('#panel-reviews').addEventListener('change', function (e) {
      var input = e.target.closest('input[data-review-upload]');
      if (input) onPickReviewImages(input);
    });

    $('#panel-reports').addEventListener('click', function (e) {
      var tab = e.target.closest('.tab');
      if (tab) { state.reportTab = tab.getAttribute('data-tab'); renderReports(); return; }
      var btn = e.target.closest('button[data-action]');
      if (btn) handleReportAction(btn);
    });

    /* 深連結與瀏覽器上一頁（admin.html#bookings 可直接開啟預約管理） */
    window.addEventListener('hashchange', function () {
      go(String(window.location.hash || '').replace('#', ''), true);
    });

    /* 檢查登入狀態後再決定顯示登入畫面或後台 */
    API.session().then(function (s) {
      if (s && s.siteName) $('#admin-name').textContent = s.siteName + ' Admin';

      /* 靜態示範版（Netlify 等純靜態空間）：無後端可登入，直接說明 */
      if (s && s.demo) {
        showLogin('此站台為靜態示範版（未連接後端），管理後台需在執行 node server.js 的環境使用');
        $('#login-btn').disabled = true;
        $('#login-btn').textContent = '後台需搭配後端';
        $('#login-password').disabled = true;
        $('#login-password').placeholder = '（靜態示範版無法登入）';
        var hint = $('.login-hint');
        if (hint) hint.textContent = '想體驗後台功能，請在本機執行 node server.js 後開啟 http://localhost:3000/admin.html';
        return;
      }

      if (s && s.authed) {
        showAdmin();
        go(String(window.location.hash || '').replace('#', '') || 'dashboard', true);
        return loadAll();
      }
      showLogin();
    }).catch(function (err) {
      showLogin(err.message);
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();