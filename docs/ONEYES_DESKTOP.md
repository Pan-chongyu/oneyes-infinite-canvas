# OneYes Canvas 桌面版

公开分支：https://github.com/Pan-chongyu/oneyes-infinite-canvas 。保留 basketikun/infinite-canvas 原作者、MIT 许可与画布前端标识。

## 接入 OneYes

打开左侧「配置」，可直接使用 OneYes 邮箱／密码登录，支持双重验证。主客户端 OneYes Desktop v0.1.65 及以后版本运行并登录时，Canvas 会复用登录态；也可点击「复用客户端登录」。主客户端令牌仍由主客户端保管，Canvas 经仅本机命名管道／Unix socket 读取所需账户与 Key 数据，不直接读取主客户端凭据库，不通过网址传递登录令牌。主客户端退出或切换账号后，需要重新连接或独立登录。网站要求额外验证码／登录协议验证时，先在主客户端完成，再复用登录态。

「一键配置」按官网平台、分组分别复用或创建名为 Canvas_无限画布 的 Key：生图和文本使用 OpenAI SVIP（其次 VIP），文本同时可选 DeepSeek 平台的 DeepSeek 分组，视频使用 MiniMax 平台的 Video 分组。一个 Key 只关联一个分组，因此最多为三种平台分别配置同名 Key；分组匹配必须同时满足平台与分组名，不猜测其他相似分组。读取各 Key 真实模型列表后按能力分配，不预设模型一定可用。缺少分组会单独提示，其余已成功配置的分组可继续使用。已停用、过期或额度耗尽的同名 Key 需要在官网处理，不通过新建 Key 绕过。

可使用「手动配置 Key」为三种固定路由填写自己的 Key，也可在下方编辑模型。仅保留 OneYes，不提供新增或删除渠道；名称、OpenAI 兼容协议及 https://api.oneyes.ai 接口地址固定。导入和本地恢复不能新增其他站点或复制其他站点 Key；既有 OneYes Key 与模型保留。默认模型可更新，已保存画布的显式模型 ID 不会静默切到其他分组。

「连接诊断」只读取 Key 状态和模型列表，不产生生图／视频费用。Key 被删除时显示「修复连接」，用户确认后重新创建并接入；不会自动重放付费任务。分组变更、停用、过期、额度耗尽、账号不匹配、模型列表变化或网络故障分别提示。退出连接／切换账号会清除自动配置的旧账号 Key；用户手动填写的 Key 不受账户退出影响。

OneYes 的 OpenAI 图像生成及参考图编辑发送 stream=true、partial_images=2，实时消费 SSE 心跳、预览及 completed 事件；只将最终图片写入素材。生图工作台会显示中间预览。不会因断流、524 或解析失败自动重试付费请求；失败后先检查 OneYes 用量再手动决定重试。自定义调用脚本仍由脚本定义协议。

沿用上游单次生图十分钟总超时与数量限制，取消通过 AbortSignal 传递。流式请求可减少长时间无响应导致的 Cloudflare 524；如果上游在整个生成期间不发送任何数据，客户端无法保证消除边缘超时。桌面内置转发仅允许固定 https://api.oneyes.ai，不关闭 WebSecurity，不经过管理后台，不跟随携带凭据的重定向。

## 本机数据

桌面版将渠道 Key、WebDAV 密码与配置使用 AES-256-GCM 保存在当前系统用户的应用数据目录；密钥为本机随机文件，不调用 macOS 钥匙串。加密密钥和密文同属该 OS 用户，不能防御该账户下的恶意进程。密文损坏时拒绝覆盖；更换设备需重新填写 Key。导出配置省略 API Key 和 WebDAV 密码。画布和媒体沿用上游本地 IndexedDB，未新增云同步。

独立登录的 refresh_token 使用独立 account 加密存储，密码与 access_token 不落盘；登录响应只向页面交付账户资料。退出标记持久保存，避免下次启动又自动连接。登录态复用需要主客户端运行，已配置的 Key 可独立调用模型。浏览器开发版沿用浏览器本地配置存储，仅提供手动 Key，避免在共享浏览器保存密钥。

## 下载与构建

Release 文件名明确标注 Windows / macOS / Linux 及 x64 / arm64。Windows 提供 NSIS EXE；macOS 提供 DMG 和 ZIP；Linux 提供 AppImage、DEB、RPM。每包附 SHA256SUMS 验证，应用中心按平台与芯片架构选择。

Linux 沿用各格式的标准架构名称：AppImage 的 x86_64 / arm64、DEB 的 amd64 / arm64、RPM 的 x86_64 / aarch64，分别对应 x64 / ARM64；发布校验要求全部十二个原生安装包齐全。

macOS 当前为 ad-hoc 签名，未 Apple 公证；Windows 未配置商业代码签名，系统首次安装可能显示来源确认。不要把本分支包描述为已通过 Apple 公证或 Microsoft 签名认证。

根目录 npm ci，web 目录 npm ci，然后根目录 npm test、npm run build、npm run dist -- --win --x64（按当前系统改为 --mac / --linux 与 --arm64）。web/.npmrc 沿用上游 antd 6 与 pro-components beta 的实际依赖组合，忽略其仍指向 antd 5 的 peer 声明；不降级 UI 库。CI 在原生架构 Runner 分别构建并做启动检查，所有任务成功后才发布。
