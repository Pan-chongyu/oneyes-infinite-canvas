# OneYes Canvas 本地转发服务

桌面版已内置 HTTP、HTTPS、SOCKS4/4a/5/5h 代理依赖，在「配置 → 本地代理」选择「HTTP / SOCKS 代理」，填写地址、可选用户名和密码后点击「保存并启用」即可，无需命令或 Node.js。裸主机和端口默认 HTTP；socks:// 等同 socks5h://，域名由代理解析。模型请求、媒体下载、WebDAV 以及桌面独立登录都经过此代理；Codex / MCP 独立进程不受影响。代理失败不会改走直连或重发付费请求。

## 网页版

浏览器不能直接使用 SOCKS，需要本机转发服务。已有的 npx @basketikun/canvas-proxy@latest 仍可用于原有直接转发模式；本分支新增的 --proxy 需要运行此仓库源码（未发布到上游 npm 包）：

```bash
npm ci
node canvas-proxy/index.js --port 23210 --proxy socks5h://127.0.0.1:1080
```

根目录安装会包含所需依赖，Node.js >= 18。填入网页本机转发服务地址 http://127.0.0.1:23210 后保存启用。也可以在 canvas-proxy 目录 npm install 后 node index.js。

支持 http://、https://、socks4://、socks4a://、socks5://、socks5h:// 上游地址；认证地址形式为 socks5h://user:password@host:port，用户名和密码内的特殊字符需 URL 编码。可通过 CANVAS_UPSTREAM_PROXY 环境变量提供地址，避免写入命令历史。PORT / HOST 可覆盖默认监听 127.0.0.1:23210，不要暴露到公网。

请求形式为 /<完整目标URL>。请求方法、头和上传体透传，SSE 按块转发，取消会中止上游。逐跳头和 Proxy-Authorization 不会转发给目标服务。TLS 校验保持开启；OneYes 重定向会被阻止，保护 API Key。根路径返回服务身份和版本，用于网页端连通性检测。

日志只输出方法、目标域名和路径、状态和耗时，不包含查询参数、请求头、正文或代理凭据，不落盘。桌面代理凭据沿用 AES-GCM 加密存储，配置导出清除凭据。连接测试只进行不带 API Key 的网络探测，不表示 Key 或模型权限已经通过验证。
