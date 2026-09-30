// 日本嚴選代購 — 前端設定
// 只要改這個檔案就能切換訂單寄送方式，不需要動其他程式。
//
// 送出訂單時會依序嘗試：
//   1. Render 後端 API（如果這個網址有後端）
//   2. Google Apps Script（推薦：免費、不用任何密碼，用你自己的 Gmail 寄信，並自動寫入 Google 試算表）
//   3. Web3Forms（免費 250 封/月，需要 access key）
//   4. FormSubmit（免費，但目前服務異常，預設關閉）
//   5. 全部失敗時，改由客戶一鍵用 Email 寄出（訂單不會遺失）
window.SHOP_CONFIG = Object.assign(
  {
    contactEmail: 'cia8885@gmail.com',

    // === 方式 A：Google Apps Script（建議）===
    // 部署完 apps-script/Code.gs 之後，把 Web App URL 貼在這裡（結尾是 /exec）
    appsScriptUrl: '',

    // === 方式 B：Web3Forms ===
    // 到 https://web3forms.com 輸入 cia8885@gmail.com 取得 access key 後貼在這裡
    web3formsKey: '',

    // === 方式 C：FormSubmit ===
    // FormSubmit 目前（2026-10）全面回傳 500，先預設關閉；服務恢復後改成 true 即可
    formsubmit: false,

    // 日圓 -> 新台幣 匯率（僅前端顯示用，實際以客服報價為準）
    jpyToTwd: 0.22,
  },
  window.SHOP_CONFIG || {},
);
