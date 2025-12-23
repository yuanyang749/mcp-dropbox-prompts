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

### 2. 在 Cursor 中配置 (UI 方式)

在 Cursor 的 MCP 设置界面点击 **"+ Add New MCP Server"**：

- **Type**: `command`
- **Command**: `npx -y mcp-dropbox-prompts`
- **Env Variables**:
  - `DROPBOX_ACCESS_TOKEN`: 您的 Dropbox Token
  - `HTTPS_PROXY`: `http://127.0.0.1:7890`
  - `DROPBOX_ROOT_PATH`: `/`

### 3. 在配置文件中配置 (JSON 方式)

如果您习惯直接修改配置文件，或者是在 **Claude Desktop** 中使用，请修改您的 `mcp_config.json` (或 `claude_desktop_config.json`)：

```json
{
  "mcpServers": {
    "mcp-dropbox-prompts": {
      "command": "npx",
      "args": ["-y", "mcp-dropbox-prompts"],
      "env": {
        "DROPBOX_ACCESS_TOKEN": "您的_DROPBOX_TOKEN",
        "HTTPS_PROXY": "http://127.0.0.1:7890",
        "DROPBOX_ROOT_PATH": "/"
      }
    }
  }
}
```

## 📖 使用指南

### 方式一：快捷指令 (限支持的客户端)

在 **Cursor** 等支持 MCP Prompts 标准的编辑器中，直接在对话框输入 **`/`**，即可看到所有存储在 Dropbox 中的提示词文件。选择后内容将自动注入。

> **⚠️ 兼容性说明**：并非所有 IDE/客户端都支持通过 `/` 呼叫 Prompts。如果您在工具栏看得到服务器但输入 `/` 没反应，请使用下方的**“工具调用”**方式。

### 方式二：工具调用 (通用方式)

本项目将所有核心功能封装为了 **Tools**，这意味着在任何支持 MCP 的环境（如 Claude Desktop, VS Code 等）中，您都可以通过口语指令让 AI 执行操作：

1.  **🔍 智能检索 (New!)**：

    > “帮我找一个**抖音相关的**提示词角色。”
    > AI 会调用 `search_prompts` 进行模糊匹配，并列出相关选项供您确认。

2.  **📋 列出所有角色**：

    > “列出我 Dropbox 里所有的 Prompt。”
    > AI 会执行 `list_prompts`。

3.  **📖 读取特定内容**：

    > “读取 `python_expert` 这个角色的内容。”
    > AI 会执行 `get_prompt` 并获取其具体提示词。

4.  **💾 保存新角色 (Chat-to-Save)**：
    > “把刚才这段对话逻辑保存为新角色，名字叫 `tech_lead`。”
    > AI 会调用 `save_prompt` 自动将内容同步到您的网盘。

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
