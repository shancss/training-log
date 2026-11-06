# 八週訓練日誌

「運動與健康」8 週運動計畫的紀錄 App。手機和電腦都可以用，資料存在你自己的 GitHub 私人 repo。

- **今日**：早餐、午餐、下午茶、晚餐、宵夜（可以從常吃清單點選、填份數、拍照）；運動（狀態、類型、組數、距離和時間會自動算配速、RPE、和計畫的差異、截圖）；體重、日記
- **週表**：一週一張表，排法和 Notion 一樣，下面寫本週檢討
- **趨勢**：體重、每日熱量和蛋白質、每週統計、跑步配速
- **歷程**：計畫修正紀錄（遇到的狀況、原因分析、修正內容、依據、修正後成效）
- **計畫**：8 週課表（可編輯，每次儲存都會留下版本，可以和舊版本對照）、前測和後測
- **更多**：常吃食物清單；匯出 Markdown 報告草稿、CSV、照片 zip、JSON 備份

## 架構

- 這個 repo（公開）：只有程式碼，用 GitHub Pages 架站，不含任何個人資料或金鑰
- `training-log-data`（私人）：所有紀錄和照片。App 透過 GitHub API 讀寫，每次儲存就是一個 commit
- token 只存在各裝置的瀏覽器裡

## 設定

1. 建立私人 repo `training-log-data`，把初始資料 push 上去
2. 在這個 repo 的 Settings → Pages 設定：Source 選 **Deploy from a branch**，Branch 選 `main`、資料夾選 `/ (root)`
3. 建立 fine-grained token：
   - Repository access 只勾 `training-log-data`
   - Permissions → Contents 設為 **Read and write**
4. 用手機打開 `https://<帳號>.github.io/training-log/`，輸入帳號和 token，然後用瀏覽器選單的「加到主畫面」安裝
5. 電腦也照第 4 步操作一次

## 本機測試

```bash
python -m http.server 5178
```

打開 `http://localhost:5178/app/?mock=1`。這是示範模式：資料只存在記憶體，重新整理就會清空。
