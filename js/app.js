/* ==================================================
   前台應用邏輯 — 首頁列表 + 個人詳情頁（js/app.js）
   資料來源：後端 REST API（js/data.js 的 API 物件）
   ================================================== */
(function () {
  'use strict';

  var settings = null;

  document.addEventListener('DOMContentLoaded', function () {
    var page = document.body.getAttribute('data-page');
    if (page === 'index') initIndex();
    else if (page === 'detail') initDetail();
  });

  /* 載入站台設定（失敗時不影響頁面） */
  function loadSettings() {
    return API.settings().then(function (s) {
      settings = s;
      applySiteSettings(s);
      return s;
    }).catch(function () { return null; });
  }

  /* ================= 首頁 ================= */
  function initIndex() {
    var grid = $('#member-grid');
    var countEl = $('#list-count');
    if (!grid) return;

    var all = [];
    var state = { mode: '外送', city: '全台縣市', kw: '', min: 0, max: Infinity, sort: 'default' };

    /* 縣市下拉（由 CITIES 產生，並套用後台設定的預設縣市） */
    var citySel = $('#city');
    citySel.innerHTML = ['全台縣市'].concat(CITIES).map(function (c) {
      return '<option>' + esc(c) + '</option>';
    }).join('');
    loadSettings().then(function (s) {
      if (s && s.defaultCity) {
        citySel.value = s.defaultCity;
        state.city = s.defaultCity;
        render();
      }
    });

    /* 外送 / 定點切換 */
    $$('input[name="service-mode"]').forEach(function (radio) {
      radio.addEventListener('change', function () {
        var checked = $('input[name="service-mode"]:checked');
        state.mode = checked ? checked.value : '';
        render();
      });
    });

    /* 縣市篩選 */
    citySel.addEventListener('change', function () {
      state.city = this.value;
      render();
    });

    /* 進階搜尋彈窗 */
    var modal = $('#adv-modal');
    $('#adv-btn').addEventListener('click', function () { openModal(modal); });

    $('#f-apply').addEventListener('click', function () {
      state.kw = $('#f-kw').value.trim();
      state.min = parseFloat($('#f-min').value) || 0;
      state.max = parseFloat($('#f-max').value) || Infinity;
      state.sort = $('#f-sort').value;
      closeModal(modal);
      render();
      showToast('已套用搜尋條件');
    });

    $('#f-reset').addEventListener('click', function () {
      ['#f-kw', '#f-min', '#f-max'].forEach(function (sel) { $(sel).value = ''; });
      $('#f-sort').value = 'default';
      state.kw = '';
      state.min = 0;
      state.max = Infinity;
      state.sort = 'default';
      closeModal(modal);
      render();
      showToast('已重設搜尋條件');
    });

    /* 目前條件下的成員清單（後端已只回上架中，這裡再套用條件） */
    function currentList() {
      var list = all.slice();
      if (state.mode) list = list.filter(function (m) { return m.type === state.mode; });
      if (state.city !== '全台縣市') list = list.filter(function (m) { return m.city === state.city; });
      if (state.kw) {
        var kw = state.kw.toLowerCase();
        list = list.filter(function (m) {
          return ((m.name || '') + ' ' + (m.id || '')).toLowerCase().indexOf(kw) !== -1;
        });
      }
      if (state.min > 0) list = list.filter(function (m) { return m.price >= state.min; });
      if (state.max !== Infinity) list = list.filter(function (m) { return m.price <= state.max; });
      if (state.sort === 'asc') list.sort(function (a, b) { return a.price - b.price; });
      if (state.sort === 'desc') list.sort(function (a, b) { return b.price - a.price; });
      return list;
    }

    /* 單張卡片 HTML */
    function cardHTML(m) {
      var tags = (m.tags || []).map(function (t) {
        return '<li class="tag-chip">' + esc(t) + '</li>';
      }).join('');
      return '<li>' +
        '<article class="card">' +
          '<a class="card-media media-link" href="detail.html?id=' + encodeURIComponent(m.id) + '" aria-label="查看 ' + esc(m.name) + ' 的詳細頁面">' +
            '<img src="' + memberImg(m) + '" alt="' + esc(m.name) + ' 個人照片（Placeholder）" loading="lazy" />' +
            (tags ? '<ul class="tag-stack">' + tags + '</ul>' : '') +
            (m.flag ? '<span class="flag-chip" title="' + esc(m.flagName || '') + '">' + esc(m.flag) + '</span>' : '') +
            '<p class="media-bar">' + esc(m.height) + 'cm / ' + esc(m.weight) + 'kg · ' + esc(m.cup) + '杯</p>' +
          '</a>' +
          '<div class="card-body">' +
            '<div class="card-top">' +
              '<h3 class="card-name">' + esc(m.name) + '<span class="card-age">' + esc(m.age) + '</span></h3>' +
              '<span class="type-tag">' + esc(m.type) + '</span>' +
            '</div>' +
            '<p class="card-price"><span>' + fmtPrice(m.price) + '</span><span class="unit">底</span>' +
              '<span class="card-views" title="瀏覽次數">👁 ' + fmtNum(m.views) + '</span>' +
            '</p>' +
          '</div>' +
        '</article>' +
      '</li>';
    }

    function render() {
      var list = currentList();
      var parts = ['共 ' + list.length + ' 位'];
      if (state.mode) parts.push(state.mode + '模式');
      if (state.city !== '全台縣市') parts.push(state.city);
      if (state.kw) parts.push('關鍵字「' + state.kw + '」');
      if (state.min > 0 || state.max !== Infinity) parts.push('價格篩選中');
      countEl.textContent = parts.join(' · ');
      grid.innerHTML = list.length
        ? list.map(cardHTML).join('')
        : '<li class="empty">目前沒有符合條件的成員，試著切換模式或清除篩選條件</li>';
    }

    /* 聯絡客服 */
    var fab = $('#contact-btn');
    if (fab) fab.addEventListener('click', function () { openContactModal('首頁列表'); });

    /* 從後端載入成員資料 */
    API.members.list().then(function (members) {
      all = members || [];
      render();
    }).catch(function (err) {
      countEl.textContent = '載入失敗';
      grid.innerHTML = '<li class="empty">' + esc(err.message) + '</li>';
      showToast(err.message);
    });
  }

  /* ================= 個人詳情頁 ================= */
  function initDetail() {
    var id = queryParam('id');
    var load = id
      ? API.members.get(id).catch(function () {
          /* 查無此 id（可能已被刪除）→ 退回列表第一位成員 */
          return API.members.list().then(function (l) { return l[0] || null; });
        })
      : API.members.list().then(function (l) { return l[0] || null; });

    loadSettings();

    load.then(function (m) {
      if (!m) { showToast('查無成員資料'); return; }
      renderProfile(m);
      renderLists(m);
      wireBooking(m);
      wireVoice(m);
      wireLine(m);
      wireReviews(m);
      wireReport(m);
      wireContact(m);
      /* 瀏覽次數 +1（真實統計，後台數據總覽可見） */
      API.members.view(m.id).then(function (views) {
        var vEl = $('#profile-views');
        if (vEl) vEl.textContent = fmtNum(views);
      }).catch(function () { /* 上報失敗不影響瀏覽 */ });
    }).catch(function (err) {
      showToast(err.message);
    });
  }

  /* --- 個人檔案 / 相片牆 / 基本資料 --- */
  function renderProfile(m) {
    document.title = m.name + '｜個人頁面';

    var nameEl = $('#profile-name');
    if (nameEl) nameEl.textContent = m.name;

    var flagEl = $('#profile-flag');
    if (flagEl) {
      flagEl.textContent = m.flag || '';
      flagEl.title = m.flagName || '';
    }

    var locEl = $('#loc-city');
    if (locEl) locEl.textContent = m.city || '—';

    var viewsEl = $('#profile-views');
    if (viewsEl) viewsEl.textContent = fmtNum(m.views);

    /* 數據條：歲 / 公分 / 公斤 / 罩杯 */
    var stats = $('#profile-stats');
    if (stats) {
      stats.innerHTML =
        '<li class="stat"><b>' + esc(m.age) + '</b><small>歲</small></li>' +
        '<li class="stat"><b>' + esc(m.height) + '</b><small>公分</small></li>' +
        '<li class="stat"><b>' + esc(m.weight) + '</b><small>公斤</small></li>' +
        '<li class="stat"><b>' + esc(m.cup) + '</b><small>罩杯</small></li>';
    }

    /* 自我介紹 */
    var introEl = $('#profile-intro');
    if (introEl) {
      introEl.textContent = m.intro || ('你好，我是 ' + m.name + '，歡迎聊聊你想安排的行程。');
    }

    /* 相片牆：四張圖與縮圖皆來自該成員資料 */
    var alts = ['相片 1', '相片 2', '相片 3', '影片封面'];
    for (var n = 1; n <= 4; n++) {
      var shot = $('#shot-img-' + n);
      if (shot) {
        shot.src = memberImg(m, n);
        shot.alt = m.name + ' ' + alts[n - 1] + '（Placeholder）';
      }
      var thumb = $('#thumb-img-' + n);
      if (thumb) {
        thumb.src = memberImg(m, n);
        thumb.alt = m.name + ' 縮圖 ' + n;
      }
      var s3 = $('.thumbs .thumb:nth-child(' + n + ') img');
      if (s3) s3.src = memberImg(m, n);
    }

    /* 浮水印改為成員編號（避免整頁都是模板字樣） */
    var wm = $('#watermark');
    if (wm) {
      var line = m.id + ' · ' + m.name + ' · 示範站台';
      var spans = '';
      for (var i = 0; i < 8; i++) spans += '<span>' + esc(line) + '</span>';
      wm.innerHTML = spans;
    }

    /* 標籤也顯示在個人區 */
    var tagRow = $('#profile-tags');
    if (tagRow) {
      tagRow.innerHTML = (m.tags || []).map(function (t) {
        return '<li class="pill">' + esc(t) + '</li>';
      }).join('');
    }
  }

  /* --- 方案 / 服務項目 / 加值服務 / 可約時間 --- */
  var ICONS = {
    '陪伴用餐': '🍽', '聊天談心': '💬', '唱歌同樂': '🎤', '追劇時光': '🎬', '出遊同行': '🚗',
    '拍照留念': '📸', '咖啡小酌': '☕', '桌遊互動': '🎲', '夜間陪伴': '🌙', '旅遊規劃': '✈️',
    '按摩舒壓': '💆', '電玩同樂': '🎮', '逛街陪同': '🛍', '逛展同遊': '🎨', '角色扮演': '🎭',
    '造型建議': '👗', '語言練習': '🗣', '運動同樂': '🏸', '深夜談心': '🌙', '節日驚喜': '🎁',
    '深夜食堂': '🍜', '小酌聊天': '🍺', '假期出遊': '🏖', '旅拍跟拍': '📷', '活動陪伴': '🎪',
    '演唱會同行': '🎶'
  };

  function iconOf(name) { return ICONS[name] || '✨'; }

  /* 依底價產生三個方案（與後端 planPrice 一致） */
  function buildPlans(base) {
    return [
      { name: '方案 A／50 分鐘', price: Number(base) || 0 },
      { name: '方案 B／100 分鐘', price: planPrice(base, '方案 B') },
      { name: '方案 C／200 分鐘（加贈優惠）', price: planPrice(base, '方案 C') }
    ];
  }

  function renderLists(m) {
    /* 基礎消費 */
    var priceList = $('#price-list');
    if (priceList) {
      priceList.innerHTML = buildPlans(m.price).map(function (p) {
        return '<li class="price-row" title="點選可直接預約此方案">' +
          '<span class="price-label">' + esc(p.name) + '</span>' +
          '<span class="price-leader" aria-hidden="true"></span>' +
          '<span class="price-value">' + fmtPrice(p.price) + '</span>' +
        '</li>';
      }).join('');
    }

    /* 服務項目 */
    var serviceList = $('#service-list');
    if (serviceList) {
      serviceList.innerHTML = (m.services || []).map(function (s) {
        return '<li class="service-item"><span class="ico" aria-hidden="true">' + iconOf(s) + '</span>' + esc(s) + '</li>';
      }).join('') || '<li class="empty">尚無服務項目</li>';
    }

    /* 可加值服務 */
    var addonList = $('#addon-list');
    if (addonList) {
      addonList.innerHTML = (m.addons || []).map(function (a) {
        return '<li class="chip"><span aria-hidden="true">' + iconOf(a) + '</span>' + esc(a) + '</li>';
      }).join('') || '<li class="empty">尚無加值服務</li>';
    }

    /* 可約時間（由後端資料產生；已滿的時段自動停用） */
    var slotRow = $('#slot-row');
    if (slotRow) {
      var slots = m.slots || [];
      slotRow.innerHTML = slots.map(function (s, i) {
        var disabled = s.open === false;
        return '<label class="time-card' + (disabled ? ' is-full' : '') + '">' +
          '<input type="radio" name="slot" data-index="' + i + '"' +
            (disabled ? ' disabled' : (i === 0 ? ' checked' : '')) + ' />' +
          '<span class="d">' + esc(s.date) + '</span>' +
          '<span class="t">' + esc(s.time) + (disabled ? ' · 已滿' : '') + '</span>' +
        '</label>';
      }).join('') + '<p class="time-note">其他時間<br />請聯絡客服哦！</p>';
    }
  }

  /* --- 語音自我介紹：使用瀏覽器語音合成實際朗讀（無音檔也能真的播放） --- */
  function wireVoice(m) {
    var voice = $('#voice-btn');
    if (!voice) return;
    var speaking = false;
    var supported = 'speechSynthesis' in window;

    voice.addEventListener('click', function () {
      if (speaking) {
        if (supported) window.speechSynthesis.cancel();
        stop();
        return;
      }
      var text = (m.intro || ('你好，我是 ' + m.name + '。')) ;
      if (supported) {
        var u = new SpeechSynthesisUtterance(text);
        u.lang = 'zh-TW';
        u.rate = 1;
        u.pitch = 1.1;
        u.onend = stop;
        u.onerror = function () { stop(); showToast('語音朗讀失敗，請確認瀏覽器支援'); };
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(u);
      } else {
        /* 不支援語音合成時，仍提供示範動畫與文字 */
        showToast('此瀏覽器不支援語音朗讀，以下為自我介紹文字：' + text);
      }
      start();
    });

    function start() {
      speaking = true;
      voice.classList.add('playing');
      voice.setAttribute('aria-pressed', 'true');
      voice.setAttribute('aria-label', '停止播放語音自我介紹');
      showToast('正在朗讀自我介紹（' + m.name + '）');
      voice._timer = setTimeout(stop, 15000);   /* 保險：最長 15 秒 */
    }

    function stop() {
      speaking = false;
      voice.classList.remove('playing');
      voice.setAttribute('aria-pressed', 'false');
      voice.setAttribute('aria-label', '播放語音自我介紹');
      clearTimeout(voice._timer);
    }
  }

  /* --- 立即預約：選方案 / 選時段 / 留聯絡方式 → 寫入後端預約管理 --- */
  function wireBooking(m) {
    var modal = $('#booking-modal');
    var btn = $('#book-btn');
    if (!modal || !btn) return;

    var plans = buildPlans(m.price);
    var planSel = $('#bm-plan');
    planSel.innerHTML = plans.map(function (p, i) {
      return '<option value="' + esc(p.name) + '"' + (i === 0 ? ' selected' : '') + '>' +
        esc(p.name) + ' — ' + fmtPrice(p.price) + '</option>';
    }).join('');

    var slotSel = $('#bm-slot');
    var openSlots = (m.slots || []).filter(function (s) { return s.open !== false; });
    slotSel.innerHTML = openSlots.length
      ? openSlots.map(function (s) {
          return '<option value="' + esc(s.date) + '|' + esc(s.time) + '">' + esc(s.date) + ' ' + esc(s.time) + '</option>';
        }).join('')
      : '<option value="">（目前無可約時段，請聯絡客服）</option>';

    function syncPrice() {
      var el = $('#bm-price');
      if (el) el.textContent = fmtPrice(planPrice(m.price, planSel.value));
    }
    planSel.addEventListener('change', syncPrice);
    syncPrice();

    /* 點方案列、或點「立即預約」都會開啟彈窗 */
    btn.addEventListener('click', function () { openFor(null); });
    $$('#price-list .price-row').forEach(function (row) {
      row.addEventListener('click', function () {
        var label = $('.price-label', row);
        openFor(label ? label.textContent : null);
      });
    });

    function openFor(planName) {
      var checked = $('input[name="slot"]:checked');
      if (checked) {
        var s = (m.slots || [])[parseInt(checked.getAttribute('data-index'), 10)];
        if (s) slotSel.value = s.date + '|' + s.time;
      }
      if (planName) planSel.value = planName;
      syncPrice();
      openModal(modal);
      $('#bm-contact').focus();
    }

    $('#bm-cancel').addEventListener('click', function () { closeModal(modal); });

    $('#bm-send').addEventListener('click', function () {
      var contact = $('#bm-contact').value.trim();
      if (!contact) { showToast('請留下聯絡方式（LINE 或手機）'); return; }
      var sv = String(slotSel.value || '|').split('|');
      var sendBtn = $('#bm-send');
      sendBtn.disabled = true;
      sendBtn.textContent = '送出中…';

      API.bookings.create({
        memberId: m.id,
        plan: planSel.value,
        date: sv[0] || '',
        time: sv[1] || '',
        contact: contact,
        note: $('#bm-note').value.trim()
      }).then(function (b) {
        closeModal(modal);
        $('#bm-contact').value = '';
        $('#bm-note').value = '';
        showToast('預約已送出（單號 ' + b.id + '），客服會盡快確認');
      }).catch(function (err) {
        showToast(err.message);
      }).then(function () {
        sendBtn.disabled = false;
        sendBtn.textContent = '送出預約';
      });
    });
  }

  /* --- LINE 洽詢：顯示後台設定的 LINE ID，可複製或改送客服訊息 --- */
  function wireLine(m) {
    var modal = $('#line-modal');
    var cta = $('#line-cta');
    if (!modal || !cta) return;

    cta.addEventListener('click', function (e) {
      e.preventDefault();
      openModal(modal);
    });
    $('#line-close').addEventListener('click', function () { closeModal(modal); });
    $('#line-copy').addEventListener('click', function () {
      copyText(settings && settings.lineId ? settings.lineId : '@escort.demo');
    });

    var ask = $('#line-ask');
    if (ask) {
      ask.addEventListener('click', function () {
        closeModal(modal);
        openContactModal('LINE 洽詢', m);
      });
    }
  }

  /* 複製文字（含不支援 clipboard API 的備援） */
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () { showToast('已複製：' + text); },
        function () { fallbackCopy(text); }
      );
    } else {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-999px';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      showToast('已複製：' + text);
    } catch (err) { /* 忽略 */ }
    document.body.removeChild(ta);
  }

  /* --- 顧客評價：讀取後台審核通過的評價，並可即時送出新的評價 --- */
  function wireReviews(m) {
    var row = $('#review-row');
    if (!row) return;

    loadReviews();

    function loadReviews() {
      API.reviews.list('memberId=' + encodeURIComponent(m.id)).then(function (list) {
        var countEl = $('#review-count');
        if (countEl) countEl.textContent = list.length ? '共 ' + list.length + ' 則' : '尚無評價';
        if (!list.length) {
          row.innerHTML = '<p class="empty">目前還沒有評價，歡迎成為第一位留言的人</p>';
          return;
        }
        var tones = ['chat-a', 'chat-b', 'chat-c'];
        row.innerHTML = list.map(function (r, i) {
          var shots = (r.images || []).map(function (u, n) {
            return '<a class="review-shot" href="' + esc(u) + '" target="_blank" rel="noopener" title="點擊看大圖">' +
              '<img src="' + esc(u) + '" alt="' + esc(r.nick) + ' 的評價圖片 ' + (n + 1) + '" loading="lazy" />' +
            '</a>';
          }).join('');
          return '<figure class="chat-card ' + tones[i % tones.length] + '">' +
            '<div class="msg left">' +
              '<span class="meta">' + esc(r.nick) + ' · ' + esc(r.createdAt || '') + '</span>' +
              '<span class="txt">' + esc(r.text) + '</span>' +
            '</div>' +
            (shots ? '<div class="review-shots">' + shots + '</div>' : '') +
          '</figure>';
        }).join('');
      }).catch(function (err) {
        row.innerHTML = '<p class="empty">' + esc(err.message) + '</p>';
      });
    }

    /* 送出評價（進後台客評審核，通過後才會顯示） */
    var sendBtn = $('#rw-send');
    if (sendBtn) {
      sendBtn.addEventListener('click', function () {
        var text = $('#rw-text').value.trim();
        if (!text) { showToast('請填寫評價內容'); return; }
        sendBtn.disabled = true;
        sendBtn.textContent = '送出中…';
        API.reviews.create({
          memberId: m.id,
          nick: $('#rw-nick').value.trim() || '匿名',
          text: text
        }).then(function () {
          $('#rw-text').value = '';
          $('#rw-nick').value = '';
          showToast('評價已送出，經審核通過後就會顯示');
        }).catch(function (err) {
          showToast(err.message);
        }).then(function () {
          sendBtn.disabled = false;
          sendBtn.textContent = '送出評價';
        });
      });
    }
  }

  /* --- 檢舉此頁面：寫入後台檢舉處理 --- */
  function wireReport(m) {
    var modal = $('#report-modal');
    var btn = $('#report-btn');
    if (!modal || !btn) return;

    btn.addEventListener('click', function () { openModal(modal); });
    $('#rp-cancel').addEventListener('click', function () { closeModal(modal); });

    $('#rp-send').addEventListener('click', function () {
      var reason = $('#rp-reason').value;
      var detail = $('#rp-detail').value.trim();
      if (!detail) { showToast('請簡述檢舉內容'); return; }
      var sendBtn = $('#rp-send');
      sendBtn.disabled = true;
      sendBtn.textContent = '送出中…';
      API.reports.create({
        memberId: m.id,
        reason: reason,
        detail: detail,
        reporter: $('#rp-reporter').value.trim() || '匿名使用者'
      }).then(function (p) {
        closeModal(modal);
        $('#rp-detail').value = '';
        $('#rp-reporter').value = '';
        showToast('檢舉已送出（編號 ' + p.id + '），客服會盡快處理');
      }).catch(function (err) {
        showToast(err.message);
      }).then(function () {
        sendBtn.disabled = false;
        sendBtn.textContent = '送出檢舉';
      });
    });
  }

  /* --- 聯絡客服（詳情頁；首頁於 initIndex 內綁定，避免重複） --- */
  function wireContact(m) {
    var fab = $('#contact-btn');
    if (fab) {
      fab.addEventListener('click', function () {
        openContactModal('個人頁面', m);
      });
    }
  }
})();