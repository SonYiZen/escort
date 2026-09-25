# 部署到免費雲端主機（不用自己的電腦當通道）

> 目標：**後端跑在雲端**，你的電腦可以關機，網站依然開著。

---

## 先看清楚：免費方案的真相（2026 年查證）

我查了各平台的官方文件與實測比較，現況如下：

| 平台 | 免費後端 | 資料會不會消失 | 需要信用卡 | 備註 |
|---|---|---|---|---|
| **Render** | ✅ 有（512MB RAM） | ⚠️ 會（無持久磁碟） | 註冊不需，進階功能才要 | **本教學主力**；閒置 15 分鐘休眠，喚醒 30～60 秒 |
| **Fly.io** | ⚠️ 僅 2 小時試用 | — | ✅ 要 | 新帳號已無長期免費 |
| **Koyeb** | ❌ 已取消免費網頁服務 | — | ✅ 要 | 只剩免費資料庫（5 小時/月） |
| **Railway** | ❌ 只有 $5 一次性試用（30 天） | — | ✅ 要 | — |
| **Vercel / Netlify** | ❌ 只跑靜態與 Serverless | — | 否 | 不適合本專案的資料寫入 |
| **Cloudflare Workers** | ⚠️ 需改寫程式 | 需另接 D1/KV | 否 | 不是 Node.js 執行環境 |

**結論：要「真免費 + 不用自己的電腦 + 能跑 Node.js 後端」，目前首選是 Render 的免費 Web Service。**

⚠️ **但它有個關鍵限制你必須知道**：Render 免費方案**不支援持久化磁碟**，服務重新啟動或重新部署時，`data/` 與 `uploads/` 會還原成示範資料（你在後台改的成員、客人的預約、上傳的照片都會消失）。

這對「給人瀏覽的示範站」完全沒問題；如果你要「資料永久保存」，有兩個選擇：
- **便宜升級**：Render Starter（約 $7/月）+ 1GB 持久磁碟 → 資料永久保存（下面有設定檔，取消註解即可）
- **改用免費資料庫**：把資料層改接 Render Postgres 免費方案或 Supabase（需改 `server.js` 的存取層）

---

## 我已經幫你準備好的東西

| 檔案 | 用途 |
|---|---|
| `render.yaml` | **Render 一鍵部署設定檔**（Blueprint），會自動建好服務與環境變數 |
| `Dockerfile` | 給 Fly.io / Koyeb 等容器平台用（已排除資料檔、非 root 執行、含健康檢查） |
| `.dockerignore` | 確保真實資料不會被打包進映像 |
| `tools/test-cloud.js` | 雲端環境變數模擬測試（19 項） |

**同時我修好了一個重要的安全問題**：原本部署到雲端時，資料檔會重新生成種子資料，**管理密碼就會是預設的 `admin1234`**，任何人打開 `/admin.html` 就能登入亂改。現在：

- 新增 `ADMIN_PASSWORD` 環境變數支援（首次啟動就用你的自訂密碼）
- 新增 `DATA_DIR` / `UPLOAD_DIR` 環境變數（掛載磁碟時指向它）
- 新增 `SITE_NAME` / `LINE_ID` 環境變數
- **偵測到雲端環境且密碼仍是預設值時，啟動訊息會主動警告**
- 啟動訊息在雲端環境不再列印區網網址

**並且修好了一個真實 bug**：自訂 `UPLOAD_DIR` 時（掛載持久化磁碟的情況），`/uploads/xxx` 會找不到檔案。現在 `/uploads/` 會正確對應到 `UPLOAD_DIR`。

---

## 方案一：部署到 Render（推薦，手把手）

### 步驟 1：把專案推上 GitHub

Render 需要從 Git 倉庫部署。在專案資料夾執行：

```powershell
cd C:\Users\Ren\Desktop\Escort
git init
git add .
git commit -m "Escort demo"
```

> `.gitignore` 已排除 `data/`、`uploads/`、`public/`，**你的真實資料與照片不會被推到 GitHub**。

到 https://github.com 建立新的空白倉庫（**不要**勾選 Add README），然後：

```powershell
git remote add origin https://github.com/你的帳號/你的倉庫.git
git branch -M main
git push -u origin main
```

### 步驟 2：用 Blueprint 一鍵部署

1. 註冊 Render：https://dashboard.render.com/register （可用 GitHub 帳號登入，**不用信用卡**）
2. 進入 **Blueprints** 頁面：https://dashboard.render.com/blueprints
3. 點 **New Blueprint Instance**
4. 選擇你剛推上去的倉庫 → Render 會自動讀取 `render.yaml`
5. 畫面上會列出要建立的服務（`escort-demo`），並要求你填 **`ADMIN_PASSWORD`**（因為設定檔標記為 `sync: false`，不會寫進程式碼）
   - **請填一個強密碼**，例如 `MyStrongPass_2026`
6. 點 **Apply** / **Create**，等待 2～3 分鐘建置完成

### 步驟 3：拿到網址並驗證

建置完成後，Render 會給你一個網址，例如：

```
https://escort-demo.onrender.com
```

打開來應該看到前台首頁。**第一次開啟可能要等 30～60 秒**（免費方案休眠喚醒中）。

快速檢查清單：
- ✅ 首頁卡片正常顯示
- ✅ 點卡片進個人頁面正常
- ✅ `/admin.html` 顯示「後台管理已停用」（因為 `render.yaml` 預設 `SHARE_MODE=1`）
- ✅ 點「立即預約」可以成功送出（進到你的後台）

### 步驟 4：想開放後台時

`render.yaml` 預設用 `SHARE_MODE=1`（只開前台，最安全）。如果要開放後台：

1. Render Dashboard → 你的服務 → **Environment**
2. 找到 `SHARE_MODE`，把值改成 `0`
3. 確認 `ADMIN_PASSWORD` 已設定為強密碼
4. 點 **Save Changes** → 服務會自動重新部署
5. 之後就能用 `https://你的網址/admin.html` + 你的密碼登入

### 步驟 5：之後怎麼更新網站？

因為 `render.yaml` 設定了 `autoDeploy: true`，只要：

```powershell
git add .
git commit -m "更新內容"
git push
```

Render 就會自動重新部署，約 2 分鐘後生效。

---

## 方案二：想讓資料永久保存（Render + 持久化磁碟）

免費方案不支援磁碟，需升級到 Starter（約 $7/月）。升級後：

1. 打開 `render.yaml`，把檔案最下方註解的區塊取消註解（把 `plan: free` 改成 `plan: starter`，並加上 `disk` 與 `DATA_DIR`/`UPLOAD_DIR`）：

```yaml
    plan: starter
    disk:
      name: escort-data
      mountPath: /var/data
      sizeGB: 1
    envVars:
      - key: DATA_DIR
        value: /var/data/data
      - key: UPLOAD_DIR
        value: /var/data/uploads
```

2. 推上 GitHub，Render 重新部署後資料就會永久保存（同時不再休眠，開機秒開）。

> ⚠️ Render 官方說明：加上磁碟會讓部署時「先停舊實例再啟新實例」，部署期間會短暫中斷幾秒，這是避免資料損毀的正常保護。

---

## 方案三：其他平台（附設定檔）

如果你偏好別的平台，我準備的 `Dockerfile` 可直接用：

### Fly.io（需信用卡，僅試用額度）
```powershell
# 安裝 flyctl 後
fly launch --no-deploy     # 會偵測到 Dockerfile
fly volumes create escort_data --size 1
fly secrets set ADMIN_PASSWORD=你的強密碼
fly deploy
```

### Koyeb（免費層已無網頁服務，付費可用）
在 Koyeb Dashboard 建立 Web Service → 選 Dockerfile → 設定環境變數 `ADMIN_PASSWORD`。

### 自架 VPS（Oracle Cloud 永久免費方案等）
```bash
node server.js            # 直接用 systemd 或 pm2 常駐即可
```
Oracle Cloud 的 Always Free 方案提供永久免費的小型 VM，適合想要完全掌控的人（但設定門檻較高）。

---

## 環境變數完整對照表

部署時可設定這些變數：

| 變數 | 用途 | 範例 | 必要性 |
|---|---|---|---|
| `ADMIN_PASSWORD` | 管理後台密碼 | `MyStrongPass_2026` | **強烈建議** |
| `SHARE_MODE` | `1` = 只開前台（停用後台） | `1` | 公開展示建議設 `1` |
| `PORT` | 連接埠（平台通常自動指定） | `3000` | 平台會給 |
| `DATA_DIR` | 資料檔目錄 | `/var/data/data` | 有掛磁碟才需要 |
| `UPLOAD_DIR` | 上傳檔目錄 | `/var/data/uploads` | 有掛磁碟才需要 |
| `SITE_NAME` | 站台名稱 | `Escort` | 選用 |
| `LINE_ID` | 客服 LINE ID | `@escort.demo` | 選用 |
| `SITE_NAME`/`LINE_ID` | 首次啟動時寫入設定檔，之後可在後台改 | — | 選用 |

---

## 常見問題

**Q：免費方案休眠後，第一位訪客要等多久？**
約 30～60 秒。之後的訪客就很快（服務已被喚醒）。若不能接受，升級 Starter 即可常駐。

**Q：資料真的會消失嗎？**
Render 免費方案的檔案系統是「暫時性」的：服務重啟或重新部署時，`data/` 與 `uploads/` 會回到種子資料。**給人看的示範站無所謂**；要保存就見方案二。

**Q：可以同時用 Netlify 放前台、Render 放後端嗎？**
可以，但需要處理跨網域（CORS）與 API 網址設定，本專案目前沒做這層。**建議直接用 Render 同時托管頁面與 API**（它就是同一個 Node.js 服務），最簡單也最不容易出錯。

**Q：部署後 `/admin.html` 顯示「後台管理已停用」？**
正常，`render.yaml` 預設 `SHARE_MODE=1`。要開放就把 `SHARE_MODE` 改成 `0` 並重新部署。

**Q：怎麼確認我的密碼沒有外洩？**
執行 `node tools/test-cloud.js`（驗證環境變數邏輯），或用瀏覽器開發者工具看 `/api/settings`，回應中**不該出現 `adminPassword`**。

**Q：我想改回預設站名但已經設了環境變數？**
環境變數只在**首次建立** `settings.json` 時生效，之後以檔案為準，可在後台「系統設定」直接改。

**Q：部署到雲端後，我可以關電腦嗎？**
**可以，這正是這個方案的重點。** 網站跑在 Render 的伺服器上，你的電腦完全不用開。