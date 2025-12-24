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

interface StorageProvider {
    listPrompts(): Promise<Prompt[]>;
    getPrompt(name: string): Promise<string>;
    savePrompt(name: string, content: string): Promise<void>;
    searchPrompts(query: string): Promise<string[]>;
}

// --- Global Config ---
const ROOT_PATH = process.env.DROPBOX_ROOT_PATH || process.env.WEBDAV_ROOT_PATH || "/";
const PROXY_URL = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || "http://127.0.0.1:7890";

const customFetch = (url: string, init?: any) => {
    return fetch(url, {
        ...init,
        agent: new HttpsProxyAgent(PROXY_URL)
    });
};

function normalizePath(filePath: string, providerRoot: string): string {
    let cleanPath = filePath.trim();
    if (!cleanPath.startsWith("/")) {
        cleanPath = "/" + cleanPath;
    }
    if (providerRoot && providerRoot !== "/") {
        if (!cleanPath.startsWith(providerRoot)) {
            cleanPath = path.posix.join(providerRoot, cleanPath);
        }
    }
    if (!cleanPath.endsWith(".md")) {
        cleanPath += ".md";
    }
    return cleanPath;
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

    async listPrompts(): Promise<Prompt[]> {
        const response = await this.dbx.filesListFolder({
            path: ROOT_PATH === "/" ? "" : ROOT_PATH,
            recursive: true,
        });
        return response.result.entries
            .filter((entry) => entry[".tag"] === "file" && entry.name.endsWith(".md"))
            .map((entry) => ({
                name: entry.name.replace(".md", ""),
                description: `Dropbox: ${entry.path_display}`,
            }));
    }

    async getPrompt(name: string): Promise<string> {
        const filePath = normalizePath(name, ROOT_PATH);
        const response = await this.dbx.filesDownload({ path: filePath });
        // @ts-ignore
        return (response.result as any).fileBinary.toString("utf8");
    }

    async savePrompt(name: string, content: string): Promise<void> {
        const filePath = normalizePath(name, ROOT_PATH);
        await this.dbx.filesUpload({
            path: filePath,
            contents: content,
            mode: { ".tag": "overwrite" },
        });
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
                entry.name.toLowerCase().includes(lowercaseQuery)
            )
            .map((entry) => entry.name.replace(".md", ""));
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

    async listPrompts(): Promise<Prompt[]> {
        console.error(`Listing WebDAV files in: ${ROOT_PATH}`);
        const files = await this.client.getDirectoryContents(ROOT_PATH) as any[];
        const prompts = files
            .filter(file => file.type === "file" && file.basename.endsWith(".md"))
            .map(file => ({
                name: file.basename.replace(".md", ""),
                description: `WebDAV: ${file.filename}`
            }));
        console.error(`Found ${prompts.length} prompts in WebDAV.`);
        return prompts;
    }

    async getPrompt(name: string): Promise<string> {
        const filePath = normalizePath(name, ROOT_PATH);
        const content = await this.client.getFileContents(filePath, { format: "text" });
        return content as string;
    }

    async savePrompt(name: string, content: string): Promise<void> {
        const filePath = normalizePath(name, ROOT_PATH);
        await this.client.putFileContents(filePath, content);
    }

    async searchPrompts(query: string): Promise<string[]> {
        const files = await this.client.getDirectoryContents(ROOT_PATH) as any[];
        const lowercaseQuery = query.toLowerCase();
        return files
            .filter(file => 
                file.type === "file" && 
                file.basename.endsWith(".md") &&
                file.basename.toLowerCase().includes(lowercaseQuery)
            )
            .map(file => file.basename.replace(".md", ""));
    }
}

// --- Initialize Server ---

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

    // If neither is configured, we provide a dummy provider that returns descriptive errors
    // instead of crashing the server immediately.
    console.error("❌ No storage provider configured. Please set environment variables.");
    return {
        async listPrompts() { return []; },
        async getPrompt() { throw new Error("No storage provider configured. Check your env variables."); },
        async savePrompt() { throw new Error("No storage provider configured. Check your env variables."); },
        async searchPrompts() { throw new Error("No storage provider configured. Check your env variables."); }
    };
}

const provider = getProvider();

const server = new Server(
  {
    name: "mcp-prompts-storage",
    version: "1.0.0",
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
    throw new McpError(ErrorCode.InvalidRequest, `Error reading prompt: ${error.message}`);
  }
});

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "save_prompt",
        description: "Save a new AI role or prompt to storage.",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "Prompt name (no extension)" },
            content: { type: "string", description: "Markdown content" },
          },
          required: ["name", "content"],
        },
      },
      {
        name: "list_prompts",
        description: "List all available AI prompts/roles.",
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
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    if (name === "save_prompt") {
      const { name: pName, content } = args as { name: string; content: string };
      await provider.savePrompt(pName, content);
      return { content: [{ type: "text", text: `Saved '${pName}' successfully.` }] };
    }
    if (name === "list_prompts") {
      const prompts = await provider.listPrompts();
      const list = prompts.map(p => p.name).join(", ");
      return { content: [{ type: "text", text: `Available: ${list}` }] };
    }
    if (name === "get_prompt") {
      const { name: pName } = args as { name: string };
      const content = await provider.getPrompt(pName);
      return { content: [{ type: "text", text: content }] };
    }
    if (name === "search_prompts") {
      const { query } = args as { query: string };
      const matches = await provider.searchPrompts(query);
      return { content: [{ type: "text", text: matches.length ? `Found: ${matches.join(", ")}` : "No matches." }] };
    }
    throw new McpError(ErrorCode.MethodNotFound, `Tool not found: ${name}`);
  } catch (error: any) {
    return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
