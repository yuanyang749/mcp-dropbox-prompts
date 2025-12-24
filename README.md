# MCP Dropbox Prompts (mcp-dropbox-prompts)

[![MCP](https://img.shields.io/badge/MCP-Compatible-blue.svg)](https://modelcontextprotocol.io)
[![npm version](https://img.shields.io/npm/v/mcp-dropbox-prompts.svg)](https://www.npmjs.com/package/mcp-dropbox-prompts)

这是一个专业级的 **Model Context Protocol (MCP)** 服务器，旨在让您的 AI 角色（Prompts）实现随处同步、即刻可用。

## 🌟 核心特性

- 📁 **多设备同步**：通过 Dropbox 或坚果云同步您的 `.md` 提示词文件，办公室存、家里用，彻底告别复制粘贴。
- 💬 **Chat-to-Save (双向同步)**：在与 AI 的对话中，直接指令 AI 将当前的 Prompt 保存到云端库。
- 📦 **自动版本备份**：覆盖保存时自动将旧版本备份到 `_archive` 文件夹，再也不怕误操作。
- 🔍 **全文搜索**：不仅能按名称搜索，还能根据提示词的具体内容进行全文检索。
- 📋 **智能摘要**：列出提示词时自动显示内容摘要，一目了然。
- ⚡ **即刻响应**：支持 Cursor/VS Code 的 `/` 指令快速呼叫角色。
- 🛡️ **生产级设计**：内置代理适配（解决国内访问延迟）、严格的路径管理、友好的中文错误提示。

---

## 🛠️ 安装与配置

### 方案一：配置 Dropbox

#### 1. 准备 Dropbox

1. 访问 [Dropbox Developers](https://www.dropbox.com/developers/apps)。
2. 创建 App：`Scoped access` -> `App folder`。
3. **关键权限 (Permissions)**：在 **Permissions** 选项卡勾选 `files.metadata.read`, `files.content.read`, `files.content.write` 并点击页面下方的 **Submit**。

#### 🔑 如何获得永久访问权限 (推荐)

Dropbox 默认生成的 Access Token 只有 4 小时有效期。为了实现"永久在线"，建议配置 **Refresh Token**：

1. **获取 App Key 和 Secret**：在 Dropbox App 控制台的 **Settings** 页面找到 `App key` 和 `App secret`。
2. **获取授权码**：在浏览器打开以下链接（替换 `YOUR_APP_KEY`）：
   `https://www.dropbox.com/oauth2/authorize?client_id=YOUR_APP_KEY&token_access_type=offline&response_type=code`
3. **换取 Refresh Token**：在终端执行以下命令（替换对应参数）：
   ```bash
   curl https://api.dropbox.com/oauth2/token \
     -d code=您刚刚得到的代码 \
     -d grant_type=authorization_code \
     -u 您的AppKey:您的AppSecret
   ```
4. **记录结果**：返回的 JSON 中包含的 `refresh_token` 即为永久令牌。

#### 2. 配置文件示例 (Dropbox)

```json
{
  "mcpServers": {
    "mcp-dropbox-prompts": {
      "command": "npx",
      "args": ["-y", "mcp-dropbox-prompts"],
      "env": {
        "DROPBOX_REFRESH_TOKEN": "您的_REFRESH_TOKEN",
        "DROPBOX_CLIENT_ID": "您的_APP_KEY",
        "DROPBOX_CLIENT_SECRET": "您的_APP_SECRET",
        "HTTPS_PROXY": "http://127.0.0.1:7890",
        "DROPBOX_ROOT_PATH": "/"
      }
    }
  }
}
```

---

### ☁️ 方案二：配置坚果云 (WebDAV) - 国内推荐

坚果云支持标准的 WebDAV 协议，无需代理且 Token 永久有效。

1. **开启 WebDAV**：登录坚果云官网 -> 安全设置 -> 第三方应用管理。
2. **添加应用**：生成一个专门给 MCP 使用的 **"应用密码"**。
3. **在配置文件中配置**：

```json
{
  "mcpServers": {
    "mcp-prompts": {
      "command": "npx",
      "args": ["-y", "mcp-dropbox-prompts"],
      "env": {
        "WEBDAV_USERNAME": "您的坚果云账号邮箱",
        "WEBDAV_PASSWORD": "您的应用特定密码",
        "WEBDAV_URL": "https://dav.jianguoyun.com/dav/",
        "WEBDAV_ROOT_PATH": "/mcp-prompts",
        "WEBDAV_RECURSIVE": "false"
      }
    }
  }
}
```

> **⚠️ 重要提示**：
>
> - `WEBDAV_ROOT_PATH` 必须设置为存放您 `.md` 提示词文件的具体文件夹路径（例如 `/mcp-prompts`），而不是 `/`。
> - 设置 `WEBDAV_RECURSIVE=true` 可以递归扫描子文件夹中的提示词（默认关闭以保证性能）。

---

## 📖 使用指南

### 方式一：快捷指令 (限支持的客户端)

在 **Cursor** 等支持 MCP Prompts 标准的编辑器中，直接在对话框输入 **`/`**，即可看到所有存储在云端的提示词文件。选择后内容将自动注入。

> **⚠️ 兼容性说明**：并非所有 IDE/客户端都支持通过 `/` 呼叫 Prompts。如果您在工具栏看得到服务器但输入 `/` 没反应，请使用下方的**"工具调用"**方式。

### 方式二：工具调用 (通用方式)

本项目将所有核心功能封装为了 **Tools**，这意味着在任何支持 MCP 的环境（如 Claude Desktop, VS Code 等）中，您都可以通过口语指令让 AI 执行操作：

| 工具             | 说明                              | 示例指令                       |
| ---------------- | --------------------------------- | ------------------------------ |
| `list_prompts`   | 📋 列出所有提示词（含摘要）       | "列出我的所有提示词"           |
| `get_prompt`     | 📖 读取特定提示词内容             | "读取 python_expert 的内容"    |
| `save_prompt`    | 💾 保存新提示词（自动备份旧版本） | "把刚才的对话保存为 tech_lead" |
| `delete_prompt`  | 🗑️ 删除指定提示词                 | "删除 old_prompt"              |
| `search_prompts` | 🔍 按名称模糊搜索                 | "找一个抖音相关的提示词"       |
| `search_content` | 📝 全文内容搜索                   | "哪些提示词提到了认知偏见"     |
| `export_prompts` | 📦 导出所有提示词                 | "导出我的全部提示词用于备份"   |

#### 使用示例

1. **🔍 智能检索**：

   > "帮我找一个**抖音相关的**提示词角色。"
   > AI 会调用 `search_prompts` 进行模糊匹配，并列出相关选项供您确认。

2. **📝 全文搜索 (New!)**：

   > "哪些提示词里提到了**认知偏见**？"
   > AI 会调用 `search_content` 深入每个提示词的内容进行检索，并返回匹配的片段。

3. **💾 保存并备份**：

   > "把刚才这段对话逻辑保存为新角色，名字叫 `tech_lead`。"
   > AI 会调用 `save_prompt`。如果 `tech_lead` 已存在，旧版本会自动备份到 `_archive` 文件夹。

4. **📦 导出备份**：
   > "帮我导出所有提示词，我要做个备份。"
   > AI 会调用 `export_prompts` 返回一个包含所有提示词的 Markdown 文档。

---

## ❓ 常见问题 (Troubleshooting)

### 1. 提示 "ECONNRESET" 或连接超时

- **原因**: 无法直连 Dropbox API。
- **解决**: 请确保您的全局代理已开启，并在配置的 `env` 中正确填写了 `HTTPS_PROXY` (例如 `http://127.0.0.1:7890`)。

### 2. 无法保存新角色 (Permission Denied / 权限不足)

- **原因**: Dropbox App 权限设置不全，或者生成 Token 时未包含写入权限。
- **解决**: 请回到 Dropbox 控制台，在 **Permissions** 中确认 `files.content.write` 已勾选且已 **Submit**；然后 **重新生成** 一个新的 Token。

### 3. 认证失败 (401 Unauthorized)

- **原因**: 用户名、密码或 Token 不正确。
- **解决 (坚果云)**: 请确认使用的是 **应用特定密码** 而不是您的登录密码。
- **解决 (Dropbox)**: 请检查 `DROPBOX_CLIENT_ID` 和 `DROPBOX_CLIENT_SECRET` 是否正确填写。

### 4. 文件或路径未找到 (404)

- **原因**: `ROOT_PATH` 配置错误。
- **解决**: 请确认 `WEBDAV_ROOT_PATH` 或 `DROPBOX_ROOT_PATH` 指向的文件夹在您的网盘中确实存在。

### 5. 如何同步多台设备？

- 只要在不同设备的 Cursor/IDE 中使用同一个应用的凭据，您的提示词库就会完全同步。

---

## 🏗️ 本地开发

如果您想基于此项目二次开发：

```bash
git clone https://github.com/yuanyang749/mcp-dropbox-prompts.git
cd mcp-dropbox-prompts
npm install
npm run build
```

---

## 📄 更新日志

### v2.0.0 (2024-12-24)

- ✨ **新增** `delete_prompt` 工具，实现完整 CRUD
- ✨ **新增** `search_content` 全文搜索工具
- ✨ **新增** `export_prompts` 导出工具
- ✨ **新增** 自动版本备份功能（备份到 `_archive` 文件夹）
- ✨ **新增** `WEBDAV_RECURSIVE` 配置项，支持递归扫描子目录
- ⚡ **优化** `list_prompts` 现在会显示内容摘要
- ⚡ **优化** 路径处理更加健壮
- ⚡ **优化** 错误提示更加友好（中文）

### v1.4.x

- 📁 支持 Dropbox 和 WebDAV (坚果云) 双存储后端
- 🔍 基础的按名称搜索功能
- 💾 保存和读取提示词

---

## 📄 开源协议

MIT License
