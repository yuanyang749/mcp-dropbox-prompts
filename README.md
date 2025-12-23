# MCP Dropbox Prompts (mcp-dropbox-prompts)

[![MCP](https://img.shields.io/badge/MCP-Compatible-blue.svg)](https://modelcontextprotocol.io)

这是一个专业级的 **Model Context Protocol (MCP)** 服务器，旨在让您的 AI 角色（Prompts）实现随处同步、即刻可用。

## 🌟 核心特性

- 📁 **多设备同步**：通过 Dropbox 同步您的 `.md` 提示词文件，办公室存、家里用，彻底告别复制粘贴。
- 💬 **Chat-to-Save (双向同步)**：在与 AI 的对话中，直接指令 AI 将当前的 Prompt 保存到云端库。
- ⚡ **即刻响应**：支持 Cursor/VS Code 的 `/` 指令快速呼叫角色。
- 🛡️ **生产级设计**：内置代理适配（解决国内访问延迟）、严格的路径管理、以及对 App Folder 的安全限制。

## 🛠️ 安装与配置

### 1. 准备 Dropbox

1. 访问 [Dropbox Developers](https://www.dropbox.com/developers/apps)。
2. 创建 App：`Scoped access` -> `App folder`。
3. **关键权限 (Permissions)**：勾选 `files.metadata.read`, `files.content.read`, `files.content.write`并提交。
4. 生成 **Generated access token**。

### 2. 在 Cursor 中配置

在 Cursor 的 MCP 设置中添加一个新的 Server：

- **Type**: `command`
- **Command**:
  ```bash
  npx -y github:yuanyang749/mcp-dropbox-prompts
  ```
- **Env Variables**:
  - `DROPBOX_ACCESS_TOKEN`: 您的 Dropbox Token
  - `HTTPS_PROXY`: `http://127.0.0.1:7890` (如果您在中国境内使用，建议填写您的本地代理地址)
  - `DROPBOX_ROOT_PATH`: `/`

## 📖 使用指南

### 呼叫角色

在对话窗口输入 `/` 即可看到所有存储在 Dropbox 中的提示词。

### 保存新角色 (Chat-to-Save)

在对话中直接输入：

> “把以上提示词保存为新角色，名字叫 `tech_lead`”

AI 会自动通过工具调用将内容同步到您的网盘中。

## ❓ 常见问题 (Troubleshooting)

### 1. 提示 "ECONNRESET" 或连接超时

- **原因**: 无法直连 Dropbox API。
- **解决**: 请确保您的全局代理已开启，并在 Cursor 配置的 `env` 中正确填写了 `HTTPS_PROXY` (例如 `http://127.0.0.1:7890`)。

### 2. 无法保存新角色 (Permission Denied)

- **原因**: Dropbox App 权限设置不全，或者生成 Token 时未包含写入权限。
- **解决**: 请回到 Dropbox 控制台，在 **Permissions** 中确认 `files.content.write` 已勾选且已 **Submit**；然后 **重新生成** 一个新的 Token。

### 3. 如何同步多台设备？

- 只要在不同设备的 Cursor 中使用同一个 Dropbox 应用生成的 Token，您的提示词库就会完全同步。

## 🏗️ 本地开发

如果您想基于此项目二次开发：

```bash
git clone https://github.com/yuanyang749/mcp-dropbox-prompts.git
cd mcp-dropbox-prompts
npm install
npm run build
```

## 📄 开源协议

MIT License
