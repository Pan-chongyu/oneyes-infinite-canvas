OneYes Canvas 桌面分支，基于 basketikun/infinite-canvas v0.20.0，保留原作者与 MIT 许可。

v0.20.12 自动处理 Windows-MCP 初始化期间的暂时性握手断开：通过 Codex 原生 MCP 刷新重连一次，沿用原配置与启动超时，重新读取工具清单并显示重连结果。后续服务恢复也会同步清除过期红色提示；保留当前对话、模型、权限和其他 MCP，不重发模型任务。缺少依赖、登录授权和用户取消不盲目重试，重连失败仍提供解决步骤。

v0.20.11 将 MCP 启动失败提示改为可操作的中文说明，区分握手断开、缺少依赖、超时、登录权限、连接失败和取消，明确哪些工具仍可使用。失败项可展开解决方法、复制处理步骤，Windows-MCP 提供官方安装文档入口；原始错误默认收起。仅提供处理指导，不自动修改其他 MCP 配置或安装依赖。

v0.20.10 新增「一键永久接入 Codex」：桌面版内置本地 Agent、运行依赖和对应芯片的 Codex CLI，点击后自动启动仅监听本机的服务并写入用户级 MCP 配置；重启画布后自动恢复，无需安装 Node.js 或复制令牌。原配置先备份，保留现有模型、登录及其他 MCP；损坏配置不会被覆盖，失败可直接重试。外部 Codex 请新建对话加载画布工具，使用工具时需保持画布打开。接入画布工具不会代替 Codex 登录或配置模型 API。

v0.20.9 将 Markdown、SVG、HTML、3D 全景和便利贴五种节点直接集成到客户端。无需逐个安装，可从画布添加节点菜单和底部扩展节点菜单使用；Markdown 与全景渲染依赖也随包提供，不再运行时访问插件仓库或依赖 CDN。已有同类型节点的内容保留，内置插件随客户端更新；第三方插件仍可单独安装。在线图片与 AI 生成功能仍需联网。

本次支持直接登录 OneYes、双重验证和复用 OneYes Desktop v0.1.65 登录态。可一键配置或手动填写 Key，按 OpenAI SVIP/VIP、DeepSeek DeepSeek、MiniMax Video 分组复用或创建 Canvas_无限画布。连接诊断识别误删、停用、分组变更和模型变化，用户确认后修复缺失 Key，不重放付费任务。接口地址仍固定，不提供新增／删除其他渠道。独立登录信息本机加密，密码不保存，登录态复用不交付主客户端令牌。修复桌面自定义协议的 Axios 传输方式。

- 预置 OneYes 渠道，填写自己的 Key 即可接入，支持获取当前 Key 可用模型。
- OneYes 文生图、参考图编辑使用 SSE 流式传输，生图工作台可显示中间预览。
- 断流、524 不自动重放付费请求；桌面配置本机 AES-GCM 加密，不调用 macOS 钥匙串。
- Windows、macOS、Linux 均提供 x64 与 ARM64 包。SHA256SUMS.txt 包含全部安装包校验值。

Windows：选择 Windows-x64 / Windows-arm64 的 Setup.exe。
macOS：Apple Silicon 选择 macOS-arm64，Intel 选择 macOS-x64；提供 DMG / ZIP。当前为 ad-hoc 签名，未经 Apple 公证。
Linux：Intel/AMD 芯片选 x86_64 的 AppImage/RPM 或 amd64 的 DEB；ARM64 芯片选 arm64 的 AppImage/DEB 或 aarch64 的 RPM。

首次安装可能有系统来源确认。真实 OneYes 付费生图由用户自行使用 Key 验证；流式能降低长等待导致的 524，仍依赖上游及时发送数据。
