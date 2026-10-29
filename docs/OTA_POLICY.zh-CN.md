# OneYes Canvas OTA 发布规则

Canvas 是独立 Electron 应用；本通道不修改 OneYes Desktop 的 Tauri/Sparkle 更新器和签名身份。

增量 OTA 使用随应用打包的 `bsdiff-wasm`，无需用户安装依赖；重建在可取消的桌面 Worker 中执行。六种平台／芯片的打包启动检查都必须离线应用参考 BSDIFF40 包，验证 ASAR 内 Worker 与 WASM 可用。发布端用系统 BSDIFF 生成补丁并重建目标，单个大包差分生成超过两分钟或补丁不小于完整包时跳过该目标，保留签名完整包继续发布；已生成的补丁逐项核对目标大小和 SHA-256 后签名发布。`SHA256SUMS.txt` 保持只含 12 个完整安装包，兼容应用中心既有同步器；增量校验值另放 `SHA256SUMS-deltas.txt`，并由签名 OTA 清单绑定。

- 每个正式 Canvas 版本递增 `package.json`、`package-lock.json`、`VERSION`，提交并推送源码和同版本标签。公开仓库的 `desktop-release.yml` 必须完成六种平台／芯片构建、测试与打包后才发布。
- Release 必须包含 Windows x64/ARM64 EXE、macOS Intel/Apple Silicon DMG/ZIP、Linux x64/ARM64 AppImage/DEB/RPM 共 12 个完整安装包，另有 `SHA256SUMS.txt`、`canvas-latest.json` 和 `canvas-latest.json.sig`；有上一版完整包时还会发布按平台、芯片和安装格式绑定的 BSDIFF 增量包。缺失任一平台或签名身份不匹配时发布失败。
- `canvas-latest.json` 的原始 UTF-8 字节使用 Ed25519 签名；公钥固定在 `desktop/update-key.cjs`，私钥只放 GitHub Actions 的 `CANVAS_OTA_PRIVATE_KEY` 和本机忽略目录中的备份。不能随意换公钥，否则已安装客户端将拒绝后续更新；严禁把私钥提交到仓库或写进日志。
- 客户端固定读取 `https://github.com/Pan-chongyu/oneyes-infinite-canvas/releases/latest/download/canvas-latest.json` 及同地址 `.sig`。签名校验后，严格检查版本、仓库、标签、文件名、大小和 SHA-256。下载完成后及安装前均验证文件，损坏或不可信的包不得执行。增量清单同时绑定源包和目标完整包哈希；源包缺失、增量损坏或重建结果不一致时自动回退同一签名清单中的完整包。
- 启动时和每 6 小时检查，自动后台下载新版本；不开启退出时自动安装。完成后显示新版版本号，由用户点击“更新并重启”。失败保留当前版本并支持手动重试，已有完整且有效的新包在离线重启后可恢复。
- Windows 通过原生 `os.machine()`（GetNativeSystemInfo）识别芯片；macOS 检查 `hw.optional.arm64`，避免 Rosetta 错配；Linux 使用原生 machine。GitHub Actions 使用 `macos-15` 构建 Apple Silicon、`macos-15-intel` 构建 Intel。DEB/RPM/AppImage 使用独立平台键，包管理器仅识别安装格式，不用于推断架构。
- Windows 使用 NSIS 静默覆盖原目录，安装后重新打开；macOS 使用已签名清单中的 ZIP，校验 Bundle ID、版本、可执行文件与 ad-hoc codesign，等待新应用完成界面启动后才删除旧应用；AppImage 同样等待启动确认，失败回滚。DEB/RPM 调用系统 `pkexec` 获取正常安装授权，取消后保留原应用并允许重试。
- macOS 当前保留 ad-hoc 自签名，不声称 Apple 公证；应用必须放在可写目录，推荐“应用程序”。不调用系统钥匙串，不更换用户的 API Key、Codex 或 MCP 配置。
- 更新缓存仅保留当前完整新包和一份经过验证的当前版本基包；中断的 `.part` 文件、增量临时文件和旧版本目录会清理。首次升级到支持增量的版本仍需完整包，后续同平台同格式升级才使用增量包。升级后首次成功加载界面即清理已安装及历史更新包。新版本准备失败时保留可继续运行的旧应用，不删除本地画布、账户或配置。
- UI 安装前检查活动对话并刷新画布本地持久化；用户需先结束其他媒体生成任务。应用中心仍保留首次安装／手动恢复入口。v0.20.20 及更早版本需从应用中心先安装支持 OTA 的版本，此后可使用内置 OTA。

发布前检查：`npm test`、`npm run test:chat`、`npm run test:ota-ui`、`npm run test:images`、`npm run test:webdav`、前端类型检查、构建、`npm run test:codec` 和打包启动验证。异步生图恢复测试在六种平台／芯片的发布构建中运行，使用隔离 IndexedDB 和模拟传输，不发出付费请求；生产编码器测试使用真实原生协议加载打包 Worker/WASM 并核对无损像素，不依赖 CDN 或开发服务器。用户大图可通过 `CANVAS_IMAGE_REFERENCE_DIR` 在本机私有目录运行 `test:images`，不上传真实照片。Actions 成功后检查公开 Release 的 12 个完整包、签名清单、增量资源和全部 10 种 OTA 目标，再更新应用中心目录并核对公开接口。不能只触发构建就宣称已可更新。

打包启动验证必须创建真实 Codex 线程、完成必需 infinite-canvas MCP 握手并读取 canvas_get_state 工具，不能仅验证 app-server 进程初始化。验证环境提供不可达的 HTTP/HTTPS/ALL_PROXY 且无本机代理例外，确保应用自动保持本机通信直连；隔离测试配置、账户和工作空间，不发送模型 turn。
