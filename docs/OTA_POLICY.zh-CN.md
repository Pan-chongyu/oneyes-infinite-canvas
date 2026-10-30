# OneYes Canvas OTA 发布规则

Canvas 是独立 Electron 应用；本通道不修改 OneYes Desktop 的 Tauri/Sparkle 更新器和签名身份。

增量 OTA 使用随应用打包的 `bsdiff-wasm`，无需用户安装依赖；重建在可取消的桌面 Worker 中执行。六种平台／芯片的打包启动检查都必须离线应用参考 BSDIFF40 包，验证 ASAR 内 Worker 与 WASM 可用。发布端固定同一份上一版签名清单，十种目标在独立 GitHub Actions 任务中用系统 BSDIFF 并行生成补丁并重建目标；最终汇总再次重建校验，再由一个任务统一签名发布。单个大包差分生成超过两分钟或补丁不小于完整包时跳过该目标，保留签名完整包继续发布；已生成的补丁逐项核对目标大小和 SHA-256 后签名发布。`SHA256SUMS.txt` 保持只含 12 个完整安装包，兼容应用中心既有同步器；增量校验值另放 `SHA256SUMS-deltas.txt`，并由签名 OTA 清单绑定。

- 每个正式 Canvas 版本递增 `package.json`、`package-lock.json`、`VERSION`，提交并推送源码和同版本标签。公开仓库的 `desktop-release.yml` 必须完成六种平台／芯片构建、测试与打包后才发布。
- Release 必须包含 Windows x64/ARM64 EXE、macOS Intel/Apple Silicon DMG/ZIP、Linux x64/ARM64 AppImage/DEB/RPM 共 12 个完整安装包，另有 `SHA256SUMS.txt`、`canvas-latest.json` 和 `canvas-latest.json.sig`；有上一版完整包时还会发布按平台、芯片和安装格式绑定的 BSDIFF 增量包。缺失任一平台或签名身份不匹配时发布失败。
- `canvas-latest.json` 的原始 UTF-8 字节使用 Ed25519 签名；公钥固定在 `desktop/update-key.cjs`，私钥只放 GitHub Actions 的 `CANVAS_OTA_PRIVATE_KEY` 和本机忽略目录中的备份。不能随意换公钥，否则已安装客户端将拒绝后续更新；严禁把私钥提交到仓库或写进日志。
- 客户端固定读取 `https://github.com/Pan-chongyu/oneyes-infinite-canvas/releases/latest/download/canvas-latest.json` 及同地址 `.sig`。签名校验后，严格检查版本、仓库、标签、文件名、大小和 SHA-256。下载完成后及安装前均验证文件，损坏或不可信的包不得执行。增量清单同时绑定源包和目标完整包哈希；源包缺失、增量损坏或重建结果不一致时自动回退同一签名清单中的完整包。
- 启动时和每 6 小时检查，自动后台下载新版本；不开启退出时自动安装。完成后显示新版版本号，由用户点击“更新并重启”。失败保留当前版本并支持手动重试，已有完整且有效的新包在离线重启后可恢复。
- Windows 通过原生 `os.machine()`（GetNativeSystemInfo）识别芯片；macOS 检查 `hw.optional.arm64`，避免 Rosetta 错配；Linux 使用原生 machine。GitHub Actions 使用 `macos-15` 构建 Apple Silicon、`macos-15-intel` 构建 Intel。DEB/RPM/AppImage 使用独立平台键，包管理器仅识别安装格式，不用于推断架构。
- Windows 使用 NSIS 静默覆盖原目录，安装后重新打开；macOS 使用已签名清单中的 ZIP，校验 Bundle ID、版本、可执行文件与 ad-hoc codesign，等待新应用完成界面启动后才删除旧应用；AppImage 同样等待启动确认，失败回滚。DEB/RPM 调用系统 `pkexec` 获取正常安装授权，取消后保留原应用并允许重试。
- macOS 当前保留 ad-hoc 自签名，不声称 Apple 公证；应用必须放在可写目录，推荐“应用程序”。不调用系统钥匙串，不更换用户的 API Key、Codex 或 MCP 配置。
- 更新缓存仅保留当前新版本的完整包或可续传进度，以及一份经过验证的当前版本基包。下载前持久化签名清单，`.part` 与其 URL／大小／SHA-256／强 ETag 关联；中断或退出保留进度，重试及重启按 Range／If-Range 续传。服务器返回完整 200 时重新写入；范围错误或 416 清除旧片段并取完整包。拼接后必须校验全文件 SHA-256，损坏前缀不得安装；增量下载中断继续同一补丁，补丁完整但校验／重建失败才回退完整包。安装完成、发现其他新版或格式变化后清理历史进度和增量临时文件。首次升级到支持增量的版本仍需完整包，后续同平台同格式升级才使用增量包。升级后首次成功加载界面即清理已安装及历史更新包。新版本准备失败时保留可继续运行的旧应用，不删除本地画布、账户或配置。
- UI 安装前检查活动对话并刷新画布本地持久化；用户需先结束其他媒体生成任务。应用中心仍保留首次安装／手动恢复入口。v0.20.20 及更早版本需从应用中心先安装支持 OTA 的版本，此后可使用内置 OTA。

发布前检查：`npm test`、`npm run test:chat`、`npm run test:ota-ui`、`npm run test:images`、`npm run test:videos`、`npm run test:webdav`、`npm run test:plugins`、前端类型检查、构建、`npm run test:codec` 和打包启动验证。视频协议回归在六种平台／芯片通过隔离原生协议验证 Grok JSON、任务响应、素材 Worker 与鉴权下载，并验证参考模式 1080p 的提交前检查、参数保留与中文说明；不得自动降低分辨率或切换模型，只有用户明确操作才变更参数，设置变更不得触发生成请求，不发送真实付费请求。节点插件回归在六种平台／芯片验证拖入、选择文件、更新失败回退、内置节点保护、开发文档及 IndexedDB 缓存跨进程加载，不访问真实账户或发出付费请求。异步生图恢复测试在六种平台／芯片的发布构建中运行，使用隔离 IndexedDB 和模拟传输，不发出付费请求；生产编码器测试使用真实原生协议加载打包 Worker/WASM 并核对无损像素，不依赖 CDN 或开发服务器。用户大图可通过 `CANVAS_IMAGE_REFERENCE_DIR` 在本机私有目录运行 `test:images`，不上传真实照片。Actions 成功后检查公开 Release 的 12 个完整包、签名清单、增量资源和全部 10 种 OTA 目标，再更新应用中心目录并核对公开接口。不能只触发构建就宣称已可更新。

打包启动验证必须创建真实 Codex 线程、完成必需 infinite-canvas MCP 握手并读取 canvas_get_state 工具，不能仅验证 app-server 进程初始化。验证环境提供不可达的 HTTP/HTTPS/ALL_PROXY 且无本机代理例外，确保应用自动保持本机通信直连；隔离测试配置、账户和工作空间，不发送模型 turn。

Codex 对话回归须覆盖模型列表全量分页、同名模型 ID、动态推理档位、无推理模型、已选模型不可用时不静默替换、模型读取失败刷新与初始化失败恢复原线程及草稿；模型未就绪或 MCP 仍在初始化时不得提交 turn。验证过程不发送真实模型请求。

生图等待界面回归须从真实画布按钮发起，覆盖准备阶段尚无任务编号、批量任务仅部分绑定编号、正常结果回填、浅深主题与系统减少动态效果。准备中的活动请求不得被历史任务恢复逻辑误判为记录缺失；真正丢失历史记录仍应停止无限等待并提示先确认用量，不自动重提付费任务。

缓存更新就绪时，安装与后台检查独立：首次点击立即进入安装状态并取消后台清单请求，不等待远端网络返回；重复点击共用同一次安装。检查清单与签名并发读取，但必须配对验签后才接受。原生 OTA 回归须实际中断 Electron HTTP 下载，并在重建更新器后核对 Range、If-Range、续传字节及安装前完整文件哈希。发布回归覆盖独立任务无签名权限、汇总不重新生成补丁、篡改产物拒绝签名与跳过目标保留完整包。

WebDAV 原生回归同时验证原图 Blob 补回存储记录、跨业务同键备份按大小与 SHA-256 恢复、损坏／冲突副本拒绝写入、普通文本不被误认、生成引用不被清理，以及失败后各业务与整体状态全部收尾。不得删除缺失引用来掩盖同步失败，也不得使用缩略图替代原图。

WebDAV 兼容回归须覆盖真实原生 XML PROPFIND 请求体、HEAD 405／501 回退、MKCOL 403 已有目录确认、207 内部失败与非目录拒绝、BOM／旧版无哈希清单恢复、弱／无 ETag 的并发复核与 Last-Modified 条件转发，以及完整 Data URL／原图 Blob 恢复、损坏主副本的同哈希备用恢复。不得将缺少服务端条件写入能力描述成已提供原子锁。
