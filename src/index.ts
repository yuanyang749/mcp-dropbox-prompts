#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { Dropbox } from "dropbox";
import { createClient, WebDAVClient } from "webdav";
import "isomorphic-fetch";
import AdmZip from "adm-zip";
import fs from "fs";
import dotenv from "dotenv";
import path from "path";
import { HttpsProxyAgent } from "https-proxy-agent";
import fetch from "node-fetch";
import { fileURLToPath } from 'url';

// ESM specific way to get __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

// --- Types & Interfaces ---

interface Prompt {
    name: string;
    description: string;
}

interface PromptWithSummary extends Prompt {
    summary?: string;
}

interface StorageProvider {
    listPrompts(): Promise<PromptWithSummary[]>;
    getPrompt(name: string): Promise<string>;
    savePrompt(name: string, content: string, backup?: boolean): Promise<{ backedUp?: string }>;
    deletePrompt(name: string): Promise<void>;
    searchPrompts(query: string): Promise<string[]>;
    searchContent(query: string): Promise<Array<{ name: string; snippet: string }>>;
    exportPrompts(): Promise<string>;
}

// --- Global Config ---

function normalizeRootPath(p: string | undefined): string {
    if (!p) return "/";
    let cleaned = p.trim();
    // Remove trailing slash
    if (cleaned.length > 1 && cleaned.endsWith("/")) {
        cleaned = cleaned.slice(0, -1);
    }
    // Ensure leading slash
    if (!cleaned.startsWith("/")) {
        cleaned = "/" + cleaned;
    }
    return cleaned;
}

const ROOT_PATH = normalizeRootPath(process.env.DROPBOX_ROOT_PATH || process.env.WEBDAV_ROOT_PATH);
const PROXY_URL = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || "http://127.0.0.1:7890";
const WEBDAV_RECURSIVE = process.env.WEBDAV_RECURSIVE === "true";
const ARCHIVE_FOLDER = "_archive";

const customFetch = (url: string, init?: any) => {
    return fetch(url, {
        ...init,
        agent: new HttpsProxyAgent(PROXY_URL)
    });
};

function normalizePath(filePath: string, providerRoot: string): string {
    let cleanPath = filePath.trim();
    // Remove .md extension if present to avoid double extension
    if (cleanPath.endsWith(".md")) {
        cleanPath = cleanPath.slice(0, -3);
    }
    if (!cleanPath.startsWith("/")) {
        cleanPath = "/" + cleanPath;
    }
    if (providerRoot && providerRoot !== "/") {
        if (!cleanPath.startsWith(providerRoot)) {
            cleanPath = path.posix.join(providerRoot, cleanPath);
        }
    }
    cleanPath += ".md";
    return cleanPath;
}

function getSummary(content: string, maxLength: number = 80): string {
    const firstLine = content.split('\n').find(line => line.trim().length > 0) || '';
    const cleaned = firstLine.replace(/^#+\s*/, '').trim();
    if (cleaned.length <= maxLength) return cleaned;
    return cleaned.substring(0, maxLength) + '...';
}

function formatFriendlyError(error: any): string {
    const message = error.message || String(error);
    const status = error.status || error.statusCode;

    if (status === 401 || message.includes('401') || message.includes('Unauthorized')) {
        return "认证失败：请检查您的用户名和密码/Token 是否正确。";
    }
    if (status === 403 || message.includes('403') || message.includes('Forbidden')) {
        return "权限不足：请确保您的应用权限包含读写操作。";
    }
    if (status === 404 || message.includes('404') || message.includes('not found')) {
        return "文件或路径未找到：请检查 ROOT_PATH 配置是否正确。";
    }
    if (message.includes('ECONNREFUSED') || message.includes('ENOTFOUND')) {
        return "网络连接失败：请检查您的网络连接或代理设置。";
    }
    if (message.includes('ECONNRESET') || message.includes('timeout')) {
        return "连接超时：请检查网络代理设置 (HTTPS_PROXY) 是否正确配置。";
    }
    return message;
}

// --- Dropbox Provider ---

class DropboxProvider implements StorageProvider {
    private dbx: Dropbox;

    constructor() {
        const config: any = { fetch: customFetch as any };
        if (process.env.DROPBOX_REFRESH_TOKEN) {
            config.refreshToken = process.env.DROPBOX_REFRESH_TOKEN;
            config.clientId = process.env.DROPBOX_CLIENT_ID;
            config.clientSecret = process.env.DROPBOX_CLIENT_SECRET;
        } else {
            config.accessToken = process.env.DROPBOX_ACCESS_TOKEN;
        }
        this.dbx = new Dropbox(config);
    }

    async listPrompts(): Promise<PromptWithSummary[]> {
        const response = await this.dbx.filesListFolder({
            path: ROOT_PATH === "/" ? "" : ROOT_PATH,
            recursive: true,
        });
        const prompts: PromptWithSummary[] = [];
        for (const entry of response.result.entries) {
            if (entry[".tag"] === "file" && entry.name.endsWith(".md") && !entry.path_display?.includes(`/${ARCHIVE_FOLDER}/`)) {
                const name = entry.name.replace(".md", "");
                let summary = "";
                try {
                    const content = await this.getPrompt(name);
                    summary = getSummary(content);
                } catch { /* ignore */ }
                prompts.push({
                    name,
                    description: `Dropbox: ${entry.path_display}`,
                    summary
                });
            }
        }
        return prompts;
    }

    async getPrompt(name: string): Promise<string> {
        const filePath = normalizePath(name, ROOT_PATH);
        const response = await this.dbx.filesDownload({ path: filePath });
        // @ts-ignore
        return (response.result as any).fileBinary.toString("utf8");
    }

    async savePrompt(name: string, content: string, backup: boolean = true): Promise<{ backedUp?: string }> {
        const filePath = normalizePath(name, ROOT_PATH);
        let backedUp: string | undefined;

        if (backup) {
            try {
                const existingContent = await this.getPrompt(name);
                if (existingContent) {
                    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                    const archivePath = path.posix.join(ROOT_PATH, ARCHIVE_FOLDER, `${name}_${timestamp}.md`);
                    await this.dbx.filesUpload({
                        path: archivePath,
                        contents: existingContent,
                        mode: { ".tag": "add" },
                    });
                    backedUp = archivePath;
                }
            } catch { /* File doesn't exist, no backup needed */ }
        }

        await this.dbx.filesUpload({
            path: filePath,
            contents: content,
            mode: { ".tag": "overwrite" },
        });
        return { backedUp };
    }

    async deletePrompt(name: string): Promise<void> {
        const filePath = normalizePath(name, ROOT_PATH);
        await this.dbx.filesDeleteV2({ path: filePath });
    }

    async searchPrompts(query: string): Promise<string[]> {
        const response = await this.dbx.filesListFolder({
            path: ROOT_PATH === "/" ? "" : ROOT_PATH,
            recursive: true,
        });
        const lowercaseQuery = query.toLowerCase();
        return response.result.entries
            .filter((entry) => 
                entry[".tag"] === "file" && 
                entry.name.endsWith(".md") &&
                !entry.path_display?.includes(`/${ARCHIVE_FOLDER}/`) &&
                entry.name.toLowerCase().includes(lowercaseQuery)
            )
            .map((entry) => entry.name.replace(".md", ""));
    }

    async searchContent(query: string): Promise<Array<{ name: string; snippet: string }>> {
        const prompts = await this.listPrompts();
        const results: Array<{ name: string; snippet: string }> = [];
        const lowercaseQuery = query.toLowerCase();

        for (const prompt of prompts) {
            try {
                const content = await this.getPrompt(prompt.name);
                const lowerContent = content.toLowerCase();
                const index = lowerContent.indexOf(lowercaseQuery);
                if (index !== -1) {
                    const start = Math.max(0, index - 30);
                    const end = Math.min(content.length, index + query.length + 50);
                    const snippet = (start > 0 ? '...' : '') + content.substring(start, end) + (end < content.length ? '...' : '');
                    results.push({ name: prompt.name, snippet });
                }
            } catch { /* ignore */ }
        }
        return results;
    }

    async exportPrompts(): Promise<string> {
        const prompts = await this.listPrompts();
        if (prompts.length === 0) return "";
        
        const zip = new AdmZip();
        for (const prompt of prompts) {
            try {
                const content = await this.getPrompt(prompt.name);
                zip.addFile(`${prompt.name}.md`, Buffer.from(content, "utf8"));
            } catch { /* ignore */ }
        }
        
        const zipBuffer = zip.toBuffer();
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const exportPath = path.posix.join(ROOT_PATH, "_export", `prompts_backup_${timestamp}.zip`);
        
        await this.dbx.filesUpload({
            path: exportPath,
            contents: zipBuffer,
            mode: { ".tag": "overwrite" }
        });
        
        const linkResponse = await this.dbx.sharingCreateSharedLinkWithSettings({
            path: exportPath
        });
        
        return linkResponse.result.url.replace("?dl=0", "&dl=1");
    }
}

// --- WebDAV (Nutstore) Provider ---

class WebDavProvider implements StorageProvider {
    private client: WebDAVClient;

    constructor() {
        const url = process.env.WEBDAV_URL || "https://dav.jianguoyun.com/dav/";
        const username = process.env.WEBDAV_USERNAME || "";
        const password = process.env.WEBDAV_PASSWORD || "";
        
        this.client = createClient(url, {
            username,
            password
        });
    }

    private async getAllFiles(dirPath: string): Promise<any[]> {
        const files = await this.client.getDirectoryContents(dirPath) as any[];
        let allFiles = files.filter(f => f.type === "file");

        if (WEBDAV_RECURSIVE) {
            const directories = files.filter(f => f.type === "directory" && !f.basename.startsWith('_'));
            for (const dir of directories) {
                const subFiles = await this.getAllFiles(dir.filename);
                allFiles = allFiles.concat(subFiles);
            }
        }
        return allFiles;
    }

    async listPrompts(): Promise<PromptWithSummary[]> {
        console.error(`Listing WebDAV files in: ${ROOT_PATH} (recursive: ${WEBDAV_RECURSIVE})`);
        const files = await this.getAllFiles(ROOT_PATH);
        const prompts: PromptWithSummary[] = [];

        for (const file of files) {
            if (file.basename.endsWith(".md") && !file.filename.includes(`/${ARCHIVE_FOLDER}/`)) {
                const name = file.basename.replace(".md", "");
                let summary = "";
                try {
                    const content = await this.getPrompt(name);
                    summary = getSummary(content);
                } catch { /* ignore */ }
                prompts.push({
                    name,
                    description: `WebDAV: ${file.filename}`,
                    summary
                });
            }
        }
        console.error(`Found ${prompts.length} prompts in WebDAV.`);
        return prompts;
    }

    async getPrompt(name: string): Promise<string> {
        const filePath = normalizePath(name, ROOT_PATH);
        const content = await this.client.getFileContents(filePath, { format: "text" });
        return content as string;
    }

    async savePrompt(name: string, content: string, backup: boolean = true): Promise<{ backedUp?: string }> {
        const filePath = normalizePath(name, ROOT_PATH);
        let backedUp: string | undefined;

        if (backup) {
            try {
                const existingContent = await this.getPrompt(name);
                if (existingContent) {
                    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                    const archiveDir = path.posix.join(ROOT_PATH, ARCHIVE_FOLDER);
                    // Ensure archive directory exists
                    try {
                        await this.client.createDirectory(archiveDir);
                    } catch { /* directory might already exist */ }
                    const archivePath = path.posix.join(archiveDir, `${name}_${timestamp}.md`);
                    await this.client.putFileContents(archivePath, existingContent);
                    backedUp = archivePath;
                }
            } catch { /* File doesn't exist, no backup needed */ }
        }

        await this.client.putFileContents(filePath, content);
        return { backedUp };
    }

    async deletePrompt(name: string): Promise<void> {
        const filePath = normalizePath(name, ROOT_PATH);
        await this.client.deleteFile(filePath);
    }

    async searchPrompts(query: string): Promise<string[]> {
        const files = await this.getAllFiles(ROOT_PATH);
        const lowercaseQuery = query.toLowerCase();
        return files
            .filter(file => 
                file.basename.endsWith(".md") &&
                !file.filename.includes(`/${ARCHIVE_FOLDER}/`) &&
                file.basename.toLowerCase().includes(lowercaseQuery)
            )
            .map(file => file.basename.replace(".md", ""));
    }

    async searchContent(query: string): Promise<Array<{ name: string; snippet: string }>> {
        const prompts = await this.listPrompts();
        const results: Array<{ name: string; snippet: string }> = [];
        const lowercaseQuery = query.toLowerCase();

        for (const prompt of prompts) {
            try {
                const content = await this.getPrompt(prompt.name);
                const lowerContent = content.toLowerCase();
                const index = lowerContent.indexOf(lowercaseQuery);
                if (index !== -1) {
                    const start = Math.max(0, index - 30);
                    const end = Math.min(content.length, index + query.length + 50);
                    const snippet = (start > 0 ? '...' : '') + content.substring(start, end) + (end < content.length ? '...' : '');
                    results.push({ name: prompt.name, snippet });
                }
            } catch { /* ignore */ }
        }
        return results;
    }

    async exportPrompts(): Promise<string> {
        const prompts = await this.listPrompts();
        if (prompts.length === 0) return "";
        
        const zip = new AdmZip();
        for (const prompt of prompts) {
            try {
                const content = await this.getPrompt(prompt.name);
                zip.addFile(`${prompt.name}.md`, Buffer.from(content, "utf8"));
            } catch { /* ignore */ }
        }
        
        const zipBuffer = zip.toBuffer();
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        
        // Save to cloud
        const cloudExportDir = path.posix.join(ROOT_PATH, "_export");
        try { await this.client.createDirectory(cloudExportDir); } catch {}
        const cloudExportPath = path.posix.join(cloudExportDir, `prompts_backup_${timestamp}.zip`);
        await this.client.putFileContents(cloudExportPath, zipBuffer);
        
        // Save locally for click-to-download link
        const localExportDir = path.join(__dirname, "..", "exports");
        console.error(`Local export directory: ${localExportDir}`);
        if (!fs.existsSync(localExportDir)) {
            try {
                fs.mkdirSync(localExportDir, { recursive: true });
            } catch (err) {
                console.error(`Failed to create directory: ${localExportDir}`, err);
                // Fallback to a temp directory if project dir is not writable
                const tempDir = path.join(process.env.HOME || "/tmp", ".mcp-dropbox-prompts", "exports");
                if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
                return `file://${path.join(tempDir, `prompts_backup_${timestamp}.zip`)}`;
            }
        }
        const localFileName = `prompts_backup_${timestamp}.zip`;
        const localFilePath = path.join(localExportDir, localFileName);
        fs.writeFileSync(localFilePath, zipBuffer);
        
        return `file://${localFilePath}`;
    }
}

// --- Initialize Server ---

function getProvider(): StorageProvider {
    const hasWebDav = !!process.env.WEBDAV_USERNAME;
    const hasDropbox = !!(process.env.DROPBOX_ACCESS_TOKEN || process.env.DROPBOX_REFRESH_TOKEN);

    if (hasWebDav) {
        console.error("🔄 Using WebDAV (Nutstore) Storage Provider");
        return new WebDavProvider();
    }

    if (hasDropbox) {
        console.error("🔄 Using Dropbox Storage Provider");
        return new DropboxProvider();
    }

    console.error("❌ No storage provider configured. Please set environment variables.");
    const noConfigError = "未配置存储提供者：请设置 WEBDAV_USERNAME 或 DROPBOX_ACCESS_TOKEN 环境变量。";
    return {
        async listPrompts() { return []; },
        async getPrompt() { throw new Error(noConfigError); },
        async savePrompt() { throw new Error(noConfigError); },
        async deletePrompt() { throw new Error(noConfigError); },
        async searchPrompts() { throw new Error(noConfigError); },
        async searchContent() { throw new Error(noConfigError); },
        async exportPrompts() { return ""; }
    };
}

const provider = getProvider();

const server = new Server(
  {
    name: "mcp-prompts-storage",
    version: "2.0.0",
  },
  {
    capabilities: {
      prompts: {},
      tools: {},
    },
  }
);

server.setRequestHandler(ListPromptsRequestSchema, async () => {
  const prompts = await provider.listPrompts();
  return { prompts };
});

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  try {
    const content = await provider.getPrompt(request.params.name);
    return {
      messages: [{ role: "user", content: { type: "text", text: content } }],
    };
  } catch (error: any) {
    throw new McpError(ErrorCode.InvalidRequest, formatFriendlyError(error));
  }
});

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "save_prompt",
        description: "Save a new AI role or prompt to storage. Automatically backs up existing version.",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "Prompt name (no extension)" },
            content: { type: "string", description: "Markdown content" },
            backup: { type: "boolean", description: "Whether to backup existing file (default: true)" }
          },
          required: ["name", "content"],
        },
      },
      {
        name: "delete_prompt",
        description: "Delete an AI role or prompt from storage.",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "Prompt name to delete" },
          },
          required: ["name"],
        },
      },
      {
        name: "list_prompts",
        description: "List all available AI prompts/roles with summaries.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "get_prompt",
        description: "Get the content of a specific prompt/role.",
        inputSchema: {
          type: "object",
          properties: { name: { type: "string" } },
          required: ["name"],
        },
      },
      {
        name: "search_prompts",
        description: "Search for prompts by name.",
        inputSchema: {
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
        },
      },
      {
        name: "search_content",
        description: "Full-text search: find prompts containing specific text in their content.",
        inputSchema: {
          type: "object",
          properties: { query: { type: "string", description: "Text to search for in prompt content" } },
          required: ["query"],
        },
      },
      {
        name: "export_prompts",
        description: "Export all prompts as a ZIP file and return a download link.",
        inputSchema: { type: "object", properties: {} },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    if (name === "save_prompt") {
      const { name: pName, content, backup = true } = args as { name: string; content: string; backup?: boolean };
      const result = await provider.savePrompt(pName, content, backup);
      let message = `✅ 已保存 '${pName}'`;
      if (result.backedUp) {
        message += `\n📦 旧版本已备份至: ${result.backedUp}`;
      }
      return { content: [{ type: "text", text: message }] };
    }

    if (name === "delete_prompt") {
      const { name: pName } = args as { name: string };
      await provider.deletePrompt(pName);
      return { content: [{ type: "text", text: `🗑️ 已删除 '${pName}'` }] };
    }

    if (name === "list_prompts") {
      const prompts = await provider.listPrompts();
      if (prompts.length === 0) {
        return { content: [{ type: "text", text: "📭 当前没有可用的提示词。" }] };
      }
      const list = prompts.map(p => `• **${p.name}**${p.summary ? `: ${p.summary}` : ''}`).join('\n');
      return { content: [{ type: "text", text: `📚 可用提示词 (${prompts.length}):\n\n${list}` }] };
    }

    if (name === "get_prompt") {
      const { name: pName } = args as { name: string };
      const content = await provider.getPrompt(pName);
      return { content: [{ type: "text", text: content }] };
    }

    if (name === "search_prompts") {
      const { query } = args as { query: string };
      const matches = await provider.searchPrompts(query);
      return { content: [{ type: "text", text: matches.length ? `🔍 找到: ${matches.join(", ")}` : "未找到匹配的提示词。" }] };
    }

    if (name === "search_content") {
      const { query } = args as { query: string };
      const results = await provider.searchContent(query);
      if (results.length === 0) {
        return { content: [{ type: "text", text: `未找到包含 "${query}" 的提示词。` }] };
      }
      const formatted = results.map(r => `• **${r.name}**: "${r.snippet}"`).join('\n');
      return { content: [{ type: "text", text: `🔍 包含 "${query}" 的提示词 (${results.length}):\n\n${formatted}` }] };
    }

    if (name === "export_prompts") {
      const urlOrPath = await provider.exportPrompts();
      if (!urlOrPath) {
        return { content: [{ type: "text", text: "📭 没有可导出的提示词。" }] };
      }
      return { 
        content: [
          { 
            type: "text", 
            text: `📦 提示词已打包完成！\n\n🔗 [点击下载提示词备份压缩包](${urlOrPath})\n\n*(注：如果是本地文件链接，请直接在资源管理器中打开)*` 
          }
        ] 
      };
    }

    throw new McpError(ErrorCode.MethodNotFound, `Tool not found: ${name}`);
  } catch (error: any) {
    return { content: [{ type: "text", text: `❌ 错误: ${formatFriendlyError(error)}` }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
