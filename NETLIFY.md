# 部署到 Netlify（手把手教學）

> 這份文件帶你**一步一步**把專案放上 Netlify，讓其他人用一個網址就能看你的網站。

---

## 先講最重要的一件事

**Netlify 只能托管「靜態檔案」（HTML / CSS / JavaScript / 圖片），它不會執行你的 `server.js` 後端。**

所以你的專案會有兩種部署方式：

| | 方案 A：靜態示範版（推薦先做這個） | 方案 B：完整功能版 |
|---|---|---|
| 放在哪 | **Netlify**（免費） | 自己的電腦 + 對外通道（Cloudflare Tunnel / ngrok） |
| 可用功能 | 瀏覽首頁、個人頁面、新手指南、篩選與搜尋 | 全部（含後台管理、預約、訊息、評價、圖片上傳） |
| 送出類功能 | ❌ 會提示需搭配後端 | ✅ 正常運作 |
| 費用 | 免費 | 免費（但你的電腦要開著） |
| 適用 | 給人「看」你的網站 | 給人「試用」完整流程 |

**建議：兩個都做。** 先用方案 A 把網站放上 Netlify（觀眾看得到、隨時開著），要展示完整功能時再用方案 B 開暫時的對外網址。

---

## 我已經幫你準備好的東西

為了讓你部署時不會出意外，專案裡已經加了這些檔案：

| 檔案 | 用途 |
|---|---|
| `tools/build-netlify.js` | **打包工具**：把前端檔案複製到 `public/`，並產生「去識別化」的示範資料 |
| `tools/serve-static.js` | 本機預覽用：模擬 Netlify 的靜態環境（沒有後端） |
| `tools/test-static.js` | 自動檢查：確認打包結果沒有外洩資料 |
| `netlify.toml` | Netlify 設定檔（指定建置指令與輸出目錄） |
| `package.json` | 方便用 `npm run build` 等指令 |
| `.gitignore` | 避免把 `data/`、`uploads/`（含真實資料）上傳到 GitHub |

**打包工具的三大安全設計**（部署前我幫你把關）：

1. **只輸出白名單檔案** — 只有 4 個 HTML + `css/` + `js/` 的前端程式，`server.js`、測試腳本、`data/`、`uploads/` 一律不輸出
2. **資料去識別化** — 示範資料只含**上架中成員**與**已通過評價**；所有人員照片強制換成 `placehold.co` 示意圖（不外洩真實照片）；**預約、訊息、檢舉一律清空**（這些含真實聯絡資訊）
3. **建置時自動掃描** — 若輸出中出現管理密碼或敏感檔案，建置會**直接失敗並刪除輸出**，不會讓你把資料傳出去

---

## 方案 A：部署靜態示範版到 Netlify

### 步驟 1：打包（在本機執行）

打開 PowerShell（或 VS Code 終端機），切到專案資料夾，執行：

```powershell
cd C:\Users\Ren\Desktop\Escort
node tools/build-netlify.js
```

你會看到類似這樣的輸出：

```
=== 建置 Netlify 靜態版本 ===

  已複製 13 個前端檔案：index.html, detail.html, guide.html, admin.html, css/...
  已產生 js/demo-data.js（成員 3 位、評價 5 則）
  安全檢查通過：未包含伺服器程式、資料檔、上傳檔或管理密碼

✔ 完成！輸出目錄：public/（共 197 KB）
```

> 「成員 3 位」是因為靜態版只放**上架中**的成員。想多放幾位，先到後台把成員「重新上架」後再重新打包。

### 步驟 2：本機確認畫面（強烈建議）

先自己看一眼，確認沒問題再傳上去：

```powershell
node tools/serve-static.js
```

然後打開瀏覽器進入 **http://localhost:4000/**

你應該會看到：
- 頂部有一條黃色提示：**「靜態示範版：可自由瀏覽列表與個人頁面…」**
- 首頁卡片、個人頁面、新手指南都能正常瀏覽
- 點「立即預約」會跳出提示說需搭配後端（這是正常的）

看完按 `Ctrl + C` 停止。

### 步驟 3：上傳到 Netlify（最簡單的方式：拖放部署）

1. 打開瀏覽器，進入 **https://app.netlify.com/drop**
2. 用 Email / Google / GitHub 註冊或登入（免費）
3. 打開檔案總管，找到 **`C:\Users\Ren\Desktop\Escort\public`** 這個資料夾
4. **把整個 `public` 資料夾拖到網頁上「Drag and drop your site output folder here」那塊灰色區域**
5. 等待約 10～30 秒，Netlify 會給你一個網址，例如：
   ```
   https://random-name-12345.netlify.app
   ```
6. 點那個網址 → **你的網站已經上線了！** 把網址複製給其他人，他們就能看。

> ⚠️ 注意：要拖的是 **`public` 資料夾本身**，不是 `public` 裡面的檔案。

### 步驟 4：改一個好記的網址（選用）

1. 在 Netlify 後台點進你的網站
2. 上方選單 **Site configuration** → 左側 **Change site name**
3. 輸入你喜歡的名字，例如 `my-escort-demo`
4. 網址就會變成 `https://my-escort-demo.netlify.app`

### 步驟 5：以後要更新網站怎麼辦？

因為是「拖放部署」，更新方式很簡單：

1. 在本機改東西（例如到後台把某位成員上架）
2. 重新打包：
   ```powershell
   node tools/build-netlify.js
   ```
3. 回到 Netlify 的網站頁面 → 上方 **Deploys** 分頁
4. 把 **`public` 資料夾再拖到頁面下方的拖放區** → 幾秒後就更新完成

> 每次拖放都會產生一筆新的部署紀錄，舊版還留著。如果改壞了，可以在 Deploys 頁面點之前的版本 → **Publish deploy** 就退回舊版。

---

## 方案 A-2：用 GitHub 自動部署（進階，但之後更省事）

如果你會用 Git，可以改成「推上 GitHub → Netlify 自動建置」，之後只要 `git push` 網站就自動更新。

### 步驟 1：建立 Git 倉庫並推上 GitHub

```powershell
cd C:\Users\Ren\Desktop\Escort
git init
git add .
git commit -m "Escort demo site"
```

然後在 GitHub 網站建立一個新的空白倉庫（**不要**勾選 Add README），把網址複製下來，執行：

```powershell
git remote add origin https://github.com/你的帳號/倉庫名稱.git
git branch -M main
git push -u origin main
```

> `.gitignore` 已經設定好，`data/`、`uploads/`、`public/` 都不會被上傳，所以**你的真實資料與照片不會進到 GitHub**。

### 步驟 2：在 Netlify 連接這個倉庫

1. 進入 **https://app.netlify.com/** → 點 **Add new site** → **Import an existing project**
2. 選 **GitHub** → 授權 → 選擇你剛推上去的倉庫
3. Netlify 會自動讀取 `netlify.toml`，畫面上應該顯示：
   - **Build command**：`node tools/build-netlify.js`
   - **Publish directory**：`public`
4. 直接點 **Deploy site**

### 步驟 3：之後的更新

```powershell
git add .
git commit -m "更新內容"
git push
```

Netlify 會自動重新建置並部署，約 30 秒後網站就更新了。

---

## 方案 B：想讓別人「試用完整功能」

Netlify 無法執行後端，所以要展示完整功能（後台、預約、上傳），要用「把你電腦的網站開一個對外通道」的方式。三種選擇：

### 選擇 1：分享模式 + Cloudflare Tunnel（推薦）

我在後端加了**分享模式**（`SHARE_MODE`），開啟後會自動停用所有後台管理功能，只留前台給人試用，避免別人亂改你的資料。

**做法：**

1. 安裝 Cloudflare Tunnel（免費，不用註冊網域）：
   ```powershell
   winget install --id Cloudflare.cloudflared
   ```
   （若沒有 winget，到 https://github.com/cloudflare/cloudflared/releases 下載 `cloudflared-windows-amd64.exe`）

2. 開兩個 PowerShell 視窗。**第一個**啟動網站（分享模式）：
   ```powershell
   cd C:\Users\Ren\Desktop\Escort
   $env:SHARE_MODE=1
   node server.js
   ```

3. **第二個**視窗啟動對外通道：
   ```powershell
   cloudflared tunnel --url http://localhost:3000
   ```

4. 畫面會印出一行網址，例如：
   ```
   https://random-words-1234.trycloudflare.com
   ```
   把這個網址給別人，他們就能試用前台（預約、訊息、評價都能送出並進到你的後台）。

5. 你**自己的電腦**要看後台，請用 `http://localhost:3000/admin.html`（不受分享模式影響，因為分享模式是「關閉後台」而非「限制來源」）。

> 關閉分享：第二個視窗按 `Ctrl + C`，第一個視窗也按 `Ctrl + C`，對外網址立即失效。

### 選擇 2：完整模式 + Cloudflare Tunnel（風險較高）

如果你要讓別人**也看到後台**，就不要加 `$env:SHARE_MODE=1`，直接 `node server.js` 再開 tunnel。

⚠️ **警告**：這樣任何人都能看到 `你的網址/admin.html`，只要猜到密碼就能改你的資料。我已經加了**登入失敗 5 次就封鎖 15 分鐘**的保護，但仍強烈建議：
- 先用後台「系統設定」把管理密碼改成較強的密碼
- 只給信任的人
- 用完立刻按 `Ctrl + C` 關掉

### 選擇 3：讓同一個 WiFi 的人直接連（最快，僅限區網）

不用任何額外工具：

1. ```powershell
   cd C:\Users\Ren\Desktop\Escort
   node server.js
   ```
2. 啟動訊息會直接印出區網網址，例如：
   ```
   同一網段裝置可直接連線（需允許 Windows 防火牆）：
     http://192.168.213.199:3000/   （乙太網路）
   ```
3. 把這個網址給同事／家人（連同一個 WiFi 的人），手機也能開。
4. 第一次連線時 Windows 可能會跳防火牆提示，要選**允許**。

---

## 常見問題

**Q：部署到 Netlify 後，為什麼點「立即預約」跳出紅字？**
這是預期的。Netlify 沒有後端，所以送出類功能會提示需搭配後端。要展示這些功能請用方案 B。

**Q：Netlify 上看到的照片跟本機不一樣？**
打包時為了不外洩真實照片，所有照片會統一換成 `placehold.co` 示意圖。這是刻意設計。

**Q：我想讓 Netlify 版顯示更多成員？**
到後台把成員「重新上架」，然後重新執行 `node tools/build-netlify.js` 再上傳。

**Q：拖放部署後想刪掉網站？**
Netlify 後台 → Site configuration → 最下方 **Delete this site**。

**Q：`public/` 資料夾要留著嗎？**
要，那是一次性的輸出檔。每次打包都會重新產生，乾淨且可重建，所以 `.gitignore` 已排除它（不需要進 Git）。

**Q：打包會不會把我的資料外洩？**
不會。`tools/build-netlify.js` 只輸出前端白名單檔案，且會自動掃描輸出目錄——若發現管理密碼或敏感檔案就**中止建置並刪除輸出**。你也可以隨時執行 `node tools/test-static.js` 自行驗證（會檢查 23 個項目）。

**Q：我可以把 `data/` 或 `uploads/` 直接上傳到 Netlify 嗎？**
**千萬不要。** 那些檔案含你的成員資料、真實照片、客人聯絡方式與管理密碼。這也是為什麼打包工具要把它們排除並做去識別化。