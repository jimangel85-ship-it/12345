# 同伴 CRM 部署說明

此專案同時包含網頁、Node.js 登入伺服器與 SQLite 資料庫。GitHub 儲存庫可保存程式碼；GitHub Pages 只提供靜態檔案，無法執行這個專案的登入 API。

## 在電腦執行

安裝 Node.js 24.22.1 或更新的 Node.js 24，於專案目錄執行：

```sh
npm start
```

開啟 `http://localhost:4173`。測試可執行 `npm test`。此專案沒有外部套件相依性。

## 從 GitHub 部署到伺服器

選擇可執行長駐 Node.js 程式、支援 HTTPS 與持久磁碟的主機，連接此 GitHub 儲存庫，啟動命令設為 `npm start`。不要將它建立為靜態網站，也不要只部署 `index.html`。

設定環境變數：

| 變數 | 設定 |
| --- | --- |
| `BIND_HOST` | `0.0.0.0` |
| `PORT` | 使用主機指定的服務埠；未設定時為 `4173` |
| `APP_ORIGIN` | 實際網站來源，例如 `https://crm.example.com`，不要加路徑或結尾斜線 |
| `CRM_DATA_DIR` | 主機上的持久磁碟目錄，例如 `/data/tongban` |

前端與 `/api/` 必須透過同一個 HTTPS 網域提供服務。反向代理需要保留該網域的 Host 標頭。只修改前端網址或移除權限檢查，無法補上缺少的登入服務。

## 帳號與資料

伺服器首次在空白資料目錄啟動時，會建立 20 個帳號，並於資料目錄產生 `initial-accounts.csv`。每次新的資料庫產生的初始密碼都不同；本機初始密碼不能直接用於另一台新建的資料庫。

若需沿用本機帳號與資料，先停止原伺服器、備份整個 `private` 資料目錄，再透過主機的私密檔案傳輸方式搬移至持久磁碟。不要透過公開儲存庫搬移資料庫或密碼清單。若沒有搬移資料庫，應使用新伺服器產生的初始帳密。

`private/`、SQLite 檔案和初始帳密清單已列入 `.gitignore`。若使用網頁手動上傳檔案，仍需自行排除這些檔案。請勿使用會定期清空的暫存磁碟儲存正式資料。

## 無法登入時

1. 顯示「此網站目前只有靜態網頁」：開啟的是 GitHub Pages，需要部署 Node.js 服務。
2. 顯示「目前網址沒有可用的 CRM 登入服務」：檢查伺服器是否啟動、`/api/` 是否轉送到 Node.js，以及執行版本是否支援 SQLite。
3. 顯示「此主機未設定允許存取」：把 `APP_ORIGIN` 設為實際的 HTTPS 網站來源，並確認反向代理保留 Host。
4. 顯示「帳號或密碼不正確」：確認使用該台伺服器產生的帳密；初始密碼更換後，需使用新密碼。
5. 重啟後帳密失效或資料歸零：檢查資料目錄是否使用持久磁碟，以及 `CRM_DATA_DIR` 是否變動。

GitHub Pages 官方說明：https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages