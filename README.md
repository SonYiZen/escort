# Escort 交友平台（前後端完整可運作示範）

純前端（HTML + CSS + 原生 JS，零框架）＋ 純 Node.js 後端（零套件依賴）。
前台、後台、資料全數串接：後台的每個操作都會寫入後端並即時反映到前台。

## 啟動方式

1. 安裝 [Node.js](https://nodejs.org)（任何近年版本皆可，**不需要 npm install**）
2. 在專案資料夾執行：

   ```
   node server.js
   ```

3. 開啟瀏覽器：

   | 頁面 | 網址 |
   |---|---|
   | 前台首頁（列表 / 篩選 / 進階搜尋） | http://localhost:3000/ |
   | 個人詳情頁（相片牆 / 方案 / 預約 / 評價 / 檢舉） | http://localhost:3000/detail.html?id=A1024 |
   | 新手指南 | http://localhost:3000/guide.html |
   | 營運後台（需登入） | http://localhost:3000/admin.html |

   後台示範密碼：**admin1234**（可在後台「系統設定」修改）

### 想分享給別人看？

**完全不用自己的電腦**（後端跑在雲端）：

| 目的 | 做法 | 說明 |
|---|---|---|
| 免費雲端後端，電腦可關機 | 見 **[DEPLOY.md](DEPLOY.md)** | 部署到 Render（含 `render.yaml` 一鍵設定） |
| 純靜態頁面（無後端） | 見 **[NETLIFY.md](NETLIFY.md)** | 部署「靜態示範版」到 Netlify |
| 想保存資料 | DEPLOY.md 方案二 | Render + 持久化磁碟（約 $7/月） |

**用到自己的電腦**（臨時展示）：

| 目的 | 做法 |
|---|---|
| 給人試用完整功能 | `$env:SHARE_MODE=1; node server.js` + Cloudflare Tunnel |
| 同一個 WiFi 的人連線 | `node server.js`（啟動訊息會印出區網網址） |
| 暫時擋掉後台 | `$env:SHARE_MODE=1; node server.js` |

### 環境變數（雲端部署用）

```powershell
$env:ADMIN_PASSWORD='你的強密碼'   # 首次啟動的管理密碼（雲端必設，否則為預設值）
$env:SHARE_MODE='1'                # 只開前台，停用後台管理
$env:DATA_DIR='D:\escort-data'     # 資料檔目錄（掛載持久化磁碟時用）
$env:UPLOAD_DIR='D:\escort-uploads'  # 上傳檔目錄
$env:SITE_NAME='Escort'            # 站台名稱
$env:PORT='3000'                   # 連接埠
```

4. （選用）自動化驗證（5 套，共 196 項；全部會自動啟動伺服器、測完關閉並還原資料）：

   ```
   node test-api.js            # API、認證、上傳、靜態伺服（98 項）
   node test-share.js          # 分享模式防護（37 項）
   node e2e-check.js           # 端到端整合（上傳照片 → 新增成員 → 前台顯示 → 客評圖片 → 自動清理）
   node tools/test-static.js   # Netlify 靜態版打包驗證（23 項，需先 build）
   node tools/test-cloud.js    # 雲端部署環境變數模擬（19 項）
   ```

   `test-api.js`、`test-share.js`、`e2e-check.js` 會在執行前備份、結束後還原 `data/` 與 `uploads/`，不會破壞你的資料。
   `tools/test-cloud.js` 全程在系統暫存目錄進行，完全不觸碰專案資料。

> 注意：請勿直接雙擊 HTML 檔案開啟（`file://` 無法呼叫 API，頁面會顯示連線錯誤提示）。
> 若連接埠 3000 被占用：PowerShell 用 `$env:PORT=3001; node server.js`。

## 功能總覽

### 前台

| 頁面 | 功能 |
|---|---|
| 首頁 | 外送／定點切換、縣市篩選（可由後台設定預設值）、進階搜尋（關鍵字／價格區間／排序）、站台公告、卡片瀏覽次數、聯絡客服 |
| 詳情頁 | 依 `?id=` 載入成員、四張相片牆與縮圖（支援後台上傳的照片）、自我介紹、數據條、方案價格自動計算、**立即預約**（選方案／時間／聯絡方式）、**語音朗讀自我介紹**（Web Speech API 實際發音）、顧客評價（可送出，含**後台上傳的客評圖片**）、**檢舉此頁面**、LINE 洽詢（ID 由後台設定） |
| 新手指南 | 預約流程、安全守則、FAQ 手風琴、服務條款、聯絡客服 |

### 後台（七個區塊全部可運作）

| 區塊 | 功能 |
|---|---|
| 登入／登出 | Session Cookie 認證（12 小時），未登入無法存取任何管理 API |
| 數據總覽 | 8 張即時統計卡、熱門瀏覽橫條圖（前 5 名）、最近動態彙整 |
| 上架管理 | 搜尋、狀態篩選、分頁、新增／編輯／刪除、上架／下架／審核通過、**上傳成員照片（最多 4 張）**、一鍵開前台頁面 |
| 預約管理 | 前台送出的預約、確認／完成／取消／刪除、狀態篩選 |
| 訊息管理 | 未讀／已讀／已回覆、回覆訊息（自動轉為已回覆）、刪除 |
| 客評審核 | 通過顯示／退回／刪除、**上傳／移除評價圖片（最多 3 張）**；**只有通過的評價會出現在前台** |
| 檢舉處理 | 標記已處理／駁回／刪除，並可**一鍵下架被檢舉的成員** |
| 系統設定 | 站台名稱、客服 LINE ID、站台公告、首頁預設縣市、開放接單開關、修改管理密碼、重置示範資料 |

側欄的數字徽章會即時顯示各區塊待處理數量；支援 `admin.html#bookings` 這類深連結。

## 圖片上傳

| 用途 | 位置 | 上限 |
|---|---|---|
| 成員照片 | 後台 → 上架管理 → 新增／編輯成員 → 「成員照片」 | 最多 4 張（對應前台相片牆 4 格） |
| 評價圖片 | 後台 → 客評審核 → 各則評價的「＋圖片」 | 最多 3 張 |

- **第一張成員照片**同時作為首頁卡片主圖與後台列表頭像
- 未上傳照片時，系統自動使用示範用 Placeholder 圖片（前台仍維持 4 格）
- 前端選檔後若圖片過大，會先用 `canvas` 等比縮圖（長邊 1400px、JPEG 品質 0.85）再上傳，避免超過後端限制
- 後端以 **magic bytes** 驗證真實檔案格式（不信任前端宣告的 MIME），只接受 PNG / JPEG / GIF / WebP
- 單張上限 **3MB**；檔名由後端以時間戳 + 隨機碼產生，不使用使用者檔名
- 所有上傳檔存於 `uploads/`，透過 `/uploads/<檔名>` 提供存取
- **自動清理**：移除照片、刪除成員、刪除評價或重置資料時，若該檔案已不被任何資料引用，會自動刪除；仍被引用時 `DELETE /api/uploads/:name` 會回 **409** 以保護資料
- 資料檔（`data/*.json`）禁止透過 HTTP 讀取，但 `uploads/` 需公開（前台要顯示圖片）

## 分享模式（對外開放時的安全開關）

把站台暫時開給別人試用時，用分享模式啟動：

```powershell
$env:SHARE_MODE=1; node server.js
```

開啟後的行為：

| 開放（前台試用） | 停用（回 403） |
|---|---|
| 瀏覽成員列表與個人頁面 | 登入／登出後台 |
| 新手指南、站台公告、LINE ID | 數據總覽、預約／訊息／檢舉清單 |
| 送出預約、客服訊息、評價、檢舉 | 新增／修改／刪除成員與評價 |
| 瀏覽次數統計 | 圖片上傳、修改設定、重置資料 |

另外 `/admin.html` 會改顯示「後台管理已停用」的說明頁，不會出現登入框。驗證：`node test-share.js`（37 項）。

## 部署到 Netlify

**Netlify 只托管靜態檔，不會執行 `server.js`**，因此專案提供了靜態示範版的打包工具：

```powershell
node tools/build-netlify.js     # 產生 public/（只含前端 + 去識別化示範資料）
node tools/serve-static.js      # 本機預覽（模擬 Netlify 靜態環境）
node tools/test-static.js       # 驗證打包結果沒有外洩資料（23 項）
```

打包工具的安全設計：

1. 只輸出前端白名單檔案（`server.js`、測試腳本、`data/`、`uploads/` 一律排除）
2. 資料去識別化：只含**上架中成員**與**已通過評價**，照片強制換成 Placeholder，**預約／訊息／檢舉清空**
3. 建置時掃描輸出，若發現管理密碼或敏感檔案會**中止並刪除輸出**

完整的拖放部署與 GitHub 自動部署步驟，請見 **[NETLIFY.md](NETLIFY.md)**。

## REST API

公開端點（前台用）：

| 方法 | 路徑 | 說明 |
|---|---|---|
| GET | `/api/session` | 目前登入狀態 |
| GET | `/api/settings` | 站台設定（不含管理密碼） |
| GET | `/api/members` | **僅回上架中**成員 |
| GET | `/api/members/:id` | 單一成員 |
| POST | `/api/members/:id/view` | 瀏覽次數 +1 |
| POST | `/api/bookings` | 送出預約（後端依方案計算金額，並自動建立客服通知） |
| POST | `/api/messages` | 送出客服訊息 |
| GET | `/api/reviews?memberId=X` | 該成員**已審核通過**的評價 |
| POST | `/api/reviews` | 送出評價（待審核） |
| POST | `/api/reports` | 送出檢舉 |

需登入端點（後台用）：

| 方法 | 路徑 | 說明 |
|---|---|---|
| POST | `/api/login` / `/api/logout` | 登入 / 登出 |
| GET | `/api/members?status=&city=&type=` | 全部成員（含待審核與已下架） |
| POST<br>PUT/PATCH<br>DELETE | `/api/members`<br>`/api/members/:id`<br>`/api/members/:id` | 新增 / 更新（可只帶 `{"status":"on"}` 快速上下架）/ 刪除（連動清除該成員的評價與檢舉） |
| GET / PUT / DELETE | `/api/bookings(/:id)` | 預約查詢 / 更新狀態 / 刪除 |
| GET / PUT / DELETE | `/api/messages(/:id)` | 訊息查詢 / 回覆或標記已讀 / 刪除 |
| GET / PUT / DELETE | `/api/reviews(/:id)` | 評價查詢 / 審核 / 刪除 |
| GET / PUT / DELETE | `/api/reports(/:id)` | 檢舉查詢 / 處理 / 刪除 |
| GET / PUT | `/api/settings` | 讀取 / 修改站台設定（含修改管理密碼） |
| POST | `/api/uploads` | **上傳圖片**（需登入）：`{ "data": "data:image/png;base64,..." }` 或 `data` 為陣列；單張上限 3MB，單次最多 6 張 |
| GET | `/api/uploads` | 列出已上傳檔案與引用狀態（需登入） |
| DELETE | `/api/uploads/:name` | 刪除上傳檔（需登入；仍被成員或評價引用時回 409） |
| GET | `/api/stats` | 統計資料（供數據總覽） |
| POST | `/api/reset` | 重置全部示範資料 |
| GET | `/api/health` | 健康檢查 |

所有寫入操作都在後端驗證（暱稱必填、年齡 ≥ 18、價格為正整數、標籤上限 3 個、狀態值白名單、長度上限），未登入一律回 401。

## 資料儲存

| 檔案 | 內容 |
|---|---|
| `data/members.json` | 成員（含相片、服務項目、加值服務、可約時段、瀏覽次數） |
| `data/bookings.json` | 預約單 |
| `data/messages.json` | 客服訊息（含預約通知） |
| `data/reviews.json` | 顧客評價（含審核狀態與評價圖片） |
| `data/reports.json` | 檢舉案件 |
| `data/settings.json` | 站台設定（含管理密碼） |
| `uploads/` | **上傳的圖片檔**（由 `POST /api/uploads` 寫入，可透過 `/uploads/xxx` 存取） |

- 首次啟動自動由種子資料建立，人類可讀的 JSON
- 所有異動即時寫入檔案，重啟伺服器資料仍在
- 資料檔不可透過 HTTP 直接下載（僅能經 API 存取）
- 還原方式：後台「系統設定 → 重置示範資料」，或刪除 `data/` 後重啟

## 專案結構

```
Escort/
├── server.js          # 後端：靜態伺服 + 多資源 REST API + Session 認證 + 圖片上傳 + 分享模式（零依賴）
├── netlify.toml       # Netlify 部署設定（建置指令 + 輸出目錄）
├── render.yaml        # Render 一鍵部署設定（含環境變數與磁碟說明）
├── Dockerfile         # 容器部署用（Fly.io / Koyeb 等）
├── .dockerignore      # 避免真實資料被打包進映像
├── package.json       # npm scripts（start / build / preview / test:*）
├── .gitignore         # 排除 data/、uploads/、public/（避免真實資料進 Git）
├── NETLIFY.md         # 手把手 Netlify 靜態版部署教學
├── DEPLOY.md          # 手把手免費雲端後端部署教學（Render 等）
├── test-api.js        # 自動化驗證（98 項；執行前後會自動備份／還原你的資料）
├── test-share.js      # 分享模式驗證（37 項）
├── e2e-check.js       # 端到端整合驗證（9 步驟）
├── tools/
│   ├── build-netlify.js   # 產生 Netlify 靜態版到 public/（含去識別化與安全掃描）
│   ├── serve-static.js    # 本機預覽 public/（模擬 Netlify 的靜態環境）
│   ├── test-static.js     # 驗證靜態版沒有外洩資料（23 項）
│   └── test-cloud.js      # 模擬雲端環境變數（19 項，在暫存目錄進行）
├── public/            # 靜態版輸出（由 build 產生，可重建）
├── data/              # 六個 JSON 資料檔（自動產生）
├── uploads/           # 上傳的圖片檔（自動產生）
├── index.html         # 前台首頁
├── detail.html        # 個人詳情頁
├── guide.html         # 新手指南
├── admin.html         # 營運後台（登入 + 七個區塊）
├── css/
│   ├── index.css / detail.css / admin.css / guide.css   # 各頁樣式
│   └── common.css                                       # 共用元件（Modal / Toast / 表單 / 公告 / 示範版橫幅）
└── js/
    ├── data.js        # 共用工具 + REST API 包裝 + 靜態示範模式 + 客服彈窗
    ├── app.js         # 前台（首頁列表 + 詳情頁全部互動）
    ├── admin.js       # 後台（認證 + 七區塊 + CRUD + 圖片上傳）
    └── guide.js       # 新手指南
```

## 端到端資料流

- 前台送出預約 → 寫入 `bookings.json`，同時在 `messages.json` 建立【預約通知】→ 後台「預約管理」與「訊息管理」同時看到 → 後台確認後狀態更新
- 前台送出評價 → 待審核 → 後台「客評審核」通過 → 前台個人頁立即顯示
- 前台送出檢舉 → 後台「檢舉處理」可一鍵下架該成員 → 前台列表同步消失
- 前台開啟詳情頁 → 瀏覽次數 +1 → 後台「數據總覽」的累計瀏覽與熱門排行即時更新
- 後台「系統設定」改站台名稱／公告／LINE ID／預設縣市／接單開關 → 前台重新整理即生效

## 注意事項

- 本專案為前後端整合示範，所有成員資料與圖片皆為 Placeholder，LINE ID 為虛構
- 語音自我介紹使用瀏覽器內建語音合成（Web Speech API），不需音檔；不支援的瀏覽器會改以文字提示
- 後端為示範用途：密碼以明碼存於 `settings.json`、Session 存於記憶體（重啟即登出）、未使用 HTTPS。正式環境請改用雜湊密碼、持久化 Session、HTTPS 與真實資料庫
- 換成真實資料庫時，只需修改 `server.js` 的存取層（`load` / `save` / `loadSettings` / `saveSettings`），前端完全不用改
- 圖片上傳為示範實作：檔案存在本機 `uploads/` 目錄，未串接雲端儲存（S3 等）、也未做病毒掃描或 EXIF 清除；正式環境建議改用雲端物件儲存並加上圖片處理
- 雲端部署的免費方案（如 Render Free）**不支援持久化磁碟**，重新部署時 `data/` 與 `uploads/` 會還原成示範資料；需永久保存請見 `DEPLOY.md` 方案二
- **部署到雲端時務必設定 `ADMIN_PASSWORD`**，否則管理密碼會是預設的 `admin1234`（程式偵測到雲端環境且使用預設密碼時會主動警告）