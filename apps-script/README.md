# 訂單自動寄信設定（Google Apps Script，免費、不用任何密碼）

做完這 4 步，客戶在網站填單後就會**自動寄到 `cia8885@gmail.com`**，而且每筆訂單同時會被記錄在 Google 試算表（首批代購原始客戶名單）。整個過程約 3 分鐘。

## 步驟

### 1. 建立試算表
1. 開 <https://sheets.new>（會建立一份新的 Google 試算表）。
2. 檔名改成例如「日本代購訂單」。
3. 網址列 `/d/` 和 `/edit` 之間那一段就是你的 **Spreadsheet ID**，先複製起來備用。

### 2. 貼上程式碼
1. 在試算表上方選 **擴充功能 → Apps Script**。
2. 左側 `Code.gs` 的內容全部刪掉。
3. 把本資料夾 `Code.gs` 的內容整份複製貼上。
4. 最上面確認 `RECIPIENT` 是你要收單的信箱（預設 `cia8885@gmail.com`）。
5. 按 💾 存檔。

### 3. 部署成 Web App
1. 右上角 **部署 → 新增部署作業**。
2. 左側齒輪選 **網頁應用程式 (Web app)**。
3. 設定：
   - **執行身分 (Execute as)**：`我`（你自己）
   - **具有存取權的使用者 (Who has access)**：**任何人 (Anyone)**
4. 按 **部署** → 第一次會要求授權，選你的帳號 → 「進階」→「前往（不安全）」→ 允許
   （會出現「Google 尚未驗證這個應用程式」是正常的，因為這是你自己寫的指令碼）
5. 複製產生的 **Web App URL**（結尾是 `/exec`）。

### 4. 把 URL 填進網站
編輯 `public/js/config.js`，把網址貼進 `appsScriptUrl`：

```js
window.SHOP_CONFIG = {
  contactEmail: 'cia8885@gmail.com',
  appsScriptUrl: 'https://script.google.com/macros/s/AKfycb.........../exec',
  ...
};
```

存檔後 commit + push，Render 會自動重新部署。

> 也可以把網址直接交給協助建立的 AI 助手，由它代為填寫並重新部署。

## 驗證

1. 打開網站，選一個商品、填姓名／電話／台灣收貨地址，送出。
2. 看到 🎉 成功畫面。
3. `cia8885@gmail.com` 收到訂單信，試算表多一列資料。

用瀏覽器直接開 Web App URL（GET）應該會看到：

```json
{"ok":true,"message":"日本嚴選代購訂單端點運作中","recipient":"cia8885@gmail.com"}
```

## 常見問題

| 狀況 | 處理 |
|---|---|
| 網站顯示「自動寄送暫時不通」 | 檢查 `appsScriptUrl` 是否為 `/exec` 結尾、部署存取權是否為「任何人」 |
| 收到信但試算表沒資料 | 試算表是 Apps Script 的「容器」，請從該試算表開啟 Apps Script |
| 改了程式碼沒生效 | 要重新 **部署 → 管理部署作業 → 編輯 → 版本：新版本** |
| 每日寄信上限 | 一般 Gmail 帳號每天 100 封，足夠使用 |

## 為什麼不用 FormSubmit？

2026-10 實測 FormSubmit（formsubmit.co）**所有信箱都回傳 500 Server Error**，屬於該服務端故障，因此改用 Google Apps Script：免費、沒有第三方、訂單還會同步留在試算表。
