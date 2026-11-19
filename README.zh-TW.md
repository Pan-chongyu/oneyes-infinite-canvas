<p align="center">
  <img src="https://raw.githubusercontent.com/Pan-chongyu/oneyes-infinite-canvas/v0.20.177/desktop/resources/icon.png" width="88" alt="OneYes Canvas">
</p>

<h1 align="center">OneYes Canvas · 無限畫布</h1>

<p align="center">
  <a href="README.md">简体中文</a> · <a href="README.en.md">English</a> · <strong>繁體中文</strong> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a>
</p>

<p align="center">把靈感、素材、AI 生成、三維預演與影片剪輯連接在同一張畫布上。</p>

<p align="center">
  <a href="https://github.com/Pan-chongyu/oneyes-infinite-canvas/releases/latest">下載桌面版</a> ·
  <a href="#features">核心功能</a> ·
  <a href="#get-started">開始創作</a> ·
  <a href="#documentation">使用文件</a> ·
  <a href="https://github.com/Pan-chongyu/oneyes-infinite-canvas/issues">回報問題</a>
</p>

OneYes Canvas 是面向視覺創作者的開源桌面工作台，支援 Windows、macOS 和 Linux。從提示詞、參考圖片到影片分鏡，你可以透過節點與連線組織創作流程，銜接 AI 生成和手動編輯，也能與同一區域網路的夥伴共同創作。

<a id="features"></a>

## 核心功能

| 工作區 | 可以做什麼 |
| --- | --- |
| 無限畫布 | 多專案管理、拖放素材、縮放與小地圖、群組、批次複製、連線、復原與重做，以及專案匯入匯出。 |
| 圖片創作 | 文字生圖、參考圖編輯、多圖引用、串流預覽與非同步結果取回；在畫布上修改提示詞、比較結果並持續迭代。 |
| 影片創作 | 文字生影片、圖片與多素材參考，依模型顯示支援的長度、畫面比例和解析度；已取得回執的任務可在重新啟動後繼續查詢與取回。 |
| 生成設定 | 將文字、圖片、影片與音訊連入設定節點，用 @ 引用素材；管理模型參數和各影片模型的偏好，重複使用工作流程。 |
| 3D 導演台 | 透過提示詞或連接的參考生成布景與動態預演，再手動調整人物、道具、姿態、燈光和機位；編輯分鏡與關鍵影格，匯出取景圖、分鏡套件或 PNG 序列。 |
| 智慧剪輯 | 從節點開啟獨立多軌剪輯視窗，修剪、分割、變速，加入文字、轉場與關鍵影格；確認 AI 剪輯草稿後套用，再將成片匯回畫布。 |
| 影片反推提示詞 | 擷取參考影格，使用視覺模型分析場景、動作、鏡頭與時間區段，產生可編輯的詳細提示詞，繼續建立生成設定或分鏡。 |
| 本機創作工具 | 智慧去背、圖層合成、拼圖與分鏡板、調色與色彩匹配、圖片 AI 超解析、影片 AI 超採樣、拉片分析、拼接、配樂與混音。 |
| 劇本與漫劇 | 透過擴充節點整理故事、角色和分鏡，將文字、參考素材與生成設定連接成創作流程。 |
| Agent 助手 | 接入 Codex 與 Claude Code，在側欄對話、查看執行狀態並核准操作；透過 MCP 讀取及操作目前畫布，支援一鍵永久接入 Codex。 |
| 區域網路協作 | 共同編輯同一畫布，即時顯示成員、游標、選取節點與操作狀態；同步編輯與原始素材，斷線自動重連，各自保留獨立視角。 |
| 素材與擴充 | 管理可重複使用的圖片、影片、音訊和提示詞；設定 WebDAV 同步，拖入節點外掛即可安裝，使用 SDK 開發自己的節點。 |

模型清單依目前 Key 的實際權限同步；各模型支援的素材、尺寸與參數不同，介面會顯示對應能力。3D 動態預演用於構圖與鏡頭設計，實際 AI 影片由所選模型生成。

<a id="get-started"></a>

## 開始創作

1. **安裝並連線**：下載符合系統與原生晶片架構的安裝包。開啟「配置與使用者偏好」，登入 OneYes 後一鍵設定模型，或手動填入 Key；已登入 OneYes Desktop 時可共用登入狀態。Canvas 也能獨立安裝、登入與使用。
2. **準備內容**：建立畫布，拖入圖片、影片或音訊，加入文字與生成設定，透過連線或 @ 引用選擇參考素材。
3. **生成與微調**：選擇模型、確認參數後生成；使用 3D 導演台設計鏡頭，或以智慧剪輯精修成片。生成結果可繼續作為下游節點的參考。
4. **儲存與分享**：專案與素材保存在本機，可匯出專案及作品、設定 WebDAV，或邀請同一區域網路的夥伴共同編輯。

斷線或重新啟動後，已有可靠回執的任務會繼續查詢原任務，不會自動重新提交付費生成。未取得回執的提交會保留核實入口，避免重複呼叫。

<a id="downloads"></a>

## 下載與更新

前往[最新版本](https://github.com/Pan-chongyu/oneyes-infinite-canvas/releases/latest)，依系統與原生晶片選擇安裝包：

| 系統 | 晶片 | 安裝包 |
| --- | --- | --- |
| Windows | x64 / ARM64 | EXE 安裝程式 |
| macOS | Intel / Apple Silicon | DMG / ZIP |
| Linux | x64 / ARM64 | AppImage / DEB / RPM |

桌面版內建 OTA：在背景檢查與準備更新，畫布頂部顯示版本和下載狀態，完成後點擊即可安裝並重新開啟。更新包含簽章與完整檔案驗證、下載進度和續傳；Windows 支援區塊增量及獨立更新進度視窗。發行版同時提供安裝包校驗清單。

<a id="data"></a>

## 資料與同步

畫布與素材預設保存在目前裝置，WebDAV 是選用的同步方式；區域網路協作直接在房間內裝置之間同步內容。獨立剪輯視窗的時間軸專案保存在本機，匯回畫布的成片可隨畫布分享。

桌面版的 Key 與連線設定採本機加密儲存；瀏覽器開發版使用瀏覽器本機儲存。呼叫 AI 時，選取的提示詞與參考素材會傳送到設定的介面；區域網路協作不會將帳號與 Key 分享給其他成員。

<a id="documentation"></a>

## 使用文件

下列詳細文件目前以簡體中文提供。

- [OneYes 接入、資料儲存與桌面建置](https://github.com/Pan-chongyu/oneyes-infinite-canvas/blob/codex/smart-video-edit/docs/ONEYES_DESKTOP.md)
- [模型自動同步與設定](https://github.com/Pan-chongyu/oneyes-infinite-canvas/blob/codex/smart-video-edit/docs/MODEL_SYNC.zh-CN.md)
- [3D 導演台：布景、動畫、分鏡與匯出](https://github.com/Pan-chongyu/oneyes-infinite-canvas/blob/codex/smart-video-edit/docs/DIRECTOR.zh-CN.md)
- [影片反推與生成設定](https://github.com/Pan-chongyu/oneyes-infinite-canvas/blob/codex/smart-video-edit/docs/VIDEO_WORKFLOW.zh-CN.md)
- [影片請求與任務恢復](https://github.com/Pan-chongyu/oneyes-infinite-canvas/blob/codex/smart-video-edit/docs/VIDEO_BRIDGE.zh-CN.md)
- [智慧剪輯](https://github.com/Pan-chongyu/oneyes-infinite-canvas/blob/codex/smart-video-edit/docs/SMART_EDIT.zh-CN.md)
- [區域網路協作](https://github.com/Pan-chongyu/oneyes-infinite-canvas/blob/codex/smart-video-edit/docs/COLLABORATION.zh-CN.md)
- [節點外掛開發](https://github.com/Pan-chongyu/oneyes-infinite-canvas/blob/codex/smart-video-edit/docs/content/docs/development/canvas-node-plugins.zh-CN.mdx)
- [畫布快捷鍵](https://github.com/Pan-chongyu/oneyes-infinite-canvas/blob/codex/smart-video-edit/docs/content/docs/canvas/canvas-shortcuts.mdx)
- [OTA 更新說明](https://github.com/Pan-chongyu/oneyes-infinite-canvas/blob/codex/smart-video-edit/docs/OTA_POLICY.zh-CN.md)
- [更新紀錄](https://github.com/Pan-chongyu/oneyes-infinite-canvas/blob/codex/smart-video-edit/CHANGELOG.md)

<a id="development"></a>

## 本機開發

桌面版維護程式碼位於 `codex/smart-video-edit` 分支：

```bash
git clone --branch codex/smart-video-edit https://github.com/Pan-chongyu/oneyes-infinite-canvas.git
cd oneyes-infinite-canvas
npm ci
npm ci --prefix web
npm ci --prefix canvas-agent
npm ci --prefix vendor/velocut/web --ignore-scripts
```

瀏覽器開發執行 `npm --prefix web run dev`。桌面打包需準備本機媒體工具並建置應用，完整步驟請見[桌面建置說明](https://github.com/Pan-chongyu/oneyes-infinite-canvas/blob/codex/smart-video-edit/docs/ONEYES_DESKTOP.md)。

授權條款與第三方元件署名請見 [LICENSE](https://github.com/Pan-chongyu/oneyes-infinite-canvas/blob/codex/smart-video-edit/LICENSE) 和 [NOTICE](https://github.com/Pan-chongyu/oneyes-infinite-canvas/blob/codex/smart-video-edit/NOTICE.md)。
