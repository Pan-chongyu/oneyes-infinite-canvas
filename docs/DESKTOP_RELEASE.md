OneYes Canvas 桌面分支，基于 basketikun/infinite-canvas v0.20.0，保留原作者与 MIT 许可。

本次支持直接登录 OneYes、双重验证和复用 OneYes Desktop v0.1.65 登录态。可一键配置或手动填写 Key，按 OpenAI SVIP/VIP、DeepSeek DeepSeek、MiniMax Video 分组复用或创建 Canvas_无限画布。连接诊断识别误删、停用、分组变更和模型变化，用户确认后修复缺失 Key，不重放付费任务。接口地址仍固定，不提供新增／删除其他渠道。独立登录信息本机加密，密码不保存，登录态复用不交付主客户端令牌。修复桌面自定义协议的 Axios 传输方式。

- 预置 OneYes 渠道，填写自己的 Key 即可接入，支持获取当前 Key 可用模型。
- OneYes 文生图、参考图编辑使用 SSE 流式传输，生图工作台可显示中间预览。
- 断流、524 不自动重放付费请求；桌面配置本机 AES-GCM 加密，不调用 macOS 钥匙串。
- Windows、macOS、Linux 均提供 x64 与 ARM64 包。SHA256SUMS.txt 包含全部安装包校验值。

Windows：选择 Windows-x64 / Windows-arm64 的 Setup.exe。
macOS：Apple Silicon 选择 macOS-arm64，Intel 选择 macOS-x64；提供 DMG / ZIP。当前为 ad-hoc 签名，未经 Apple 公证。
Linux：Intel/AMD 芯片选 x86_64 的 AppImage/RPM 或 amd64 的 DEB；ARM64 芯片选 arm64 的 AppImage/DEB 或 aarch64 的 RPM。

首次安装可能有系统来源确认。真实 OneYes 付费生图由用户自行使用 Key 验证；流式能降低长等待导致的 524，仍依赖上游及时发送数据。
