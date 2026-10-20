# OneYes Canvas 桌面版

公开分支：https://github.com/Pan-chongyu/oneyes-infinite-canvas 。保留 basketikun/infinite-canvas 原作者、MIT 许可与画布前端标识。

## 接入 OneYes

打开右上角「配置」，编辑预置 OneYes 渠道，填写自己的 API Key。地址预设 https://api.oneyes.ai ，请求自动补 /v1。Key 从 OneYes 客户端「API 密钥」复制；支持模型以该 Key 所属分组为准，可在渠道中获取模型列表。安装包不内置任何共享 Key，不读取其他应用的凭据。

OneYes 的 OpenAI 图像生成及参考图编辑发送 stream=true、partial_images=2，实时消费 SSE 心跳、预览及 completed 事件；只将最终图片写入素材。生图工作台会显示中间预览。不会因断流、524 或解析失败自动重试付费请求；失败后先检查 OneYes 用量再手动决定重试。自定义调用脚本仍由脚本定义协议。

沿用上游单次生图十分钟总超时与数量限制，取消通过 AbortSignal 传递。流式请求可减少长时间无响应导致的 Cloudflare 524；如果上游在整个生成期间不发送任何数据，客户端无法保证消除边缘超时。桌面内置转发仅允许固定 https://api.oneyes.ai，不关闭 WebSecurity，不经过管理后台，不跟随携带凭据的重定向。

## 本机数据

桌面版将渠道 Key、WebDAV 密码与配置使用 AES-256-GCM 保存在当前系统用户的应用数据目录；密钥为本机随机文件，不调用 macOS 钥匙串。加密密钥和密文同属该 OS 用户，不能防御该账户下的恶意进程。密文损坏时拒绝覆盖；更换设备需重新填写 Key。导出配置省略 API Key 和 WebDAV 密码。画布和媒体沿用上游本地 IndexedDB，未新增云同步。

浏览器开发版沿用浏览器本地配置存储，避免在共享浏览器保存密钥。

## 下载与构建

Release 文件名明确标注 Windows / macOS / Linux 及 x64 / arm64。Windows 提供 NSIS EXE；macOS 提供 DMG 和 ZIP；Linux 提供 AppImage、DEB、RPM。每包附 SHA256SUMS 验证，应用中心按平台与芯片架构选择。

macOS 当前为 ad-hoc 签名，未 Apple 公证；Windows 未配置商业代码签名，系统首次安装可能显示来源确认。不要把本分支包描述为已通过 Apple 公证或 Microsoft 签名认证。

根目录 npm ci，web 目录 npm ci，然后根目录 npm test、npm run build、npm run dist -- --win --x64（按当前系统改为 --mac / --linux 与 --arm64）。web/.npmrc 沿用上游 antd 6 与 pro-components beta 的实际依赖组合，忽略其仍指向 antd 5 的 peer 声明；不降级 UI 库。CI 在原生架构 Runner 分别构建并做启动检查，所有任务成功后才发布。
