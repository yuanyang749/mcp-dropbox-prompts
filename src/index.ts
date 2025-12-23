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
import "isomorphic-fetch";
import dotenv from "dotenv";
import path from "path";
import { HttpsProxyAgent } from "https-proxy-agent";
import fetch from "node-fetch";

import { fileURLToPath } from 'url';

// ESM specific way to get __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from the project root (one level up from build/ or src/)
// Assuming the compiled file is in build/index.js, .env is in ../.env
dotenv.config({ path: path.join(__dirname, '../.env') });

const ACCESS_TOKEN = process.env.DROPBOX_ACCESS_TOKEN;
const ROOT_PATH = process.env.DROPBOX_ROOT_PATH || "";
// 优先级：用户配置的 HTTPS_PROXY > 系统环境变量 > 默认 7890
const PROXY_URL = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || "http://127.0.0.1:7890";

if (!ACCESS_TOKEN) {
  console.error("Error: DROPBOX_ACCESS_TOKEN is not set in .env file");
  process.exit(1);
}

// Custom fetch with proxy support
const customFetch = (url: string, init?: any) => {
    return fetch(url, {
        ...init,
        agent: new HttpsProxyAgent(PROXY_URL)
    });
};

const dbx = new Dropbox({ 
    accessToken: ACCESS_TOKEN, 
    fetch: customFetch as any 
});

const server = new Server(
  {
    name: "mcp-dropbox-prompts",
    version: "1.0.0",
  },
  {
    capabilities: {
      prompts: {},
      tools: {},
    },
  }
);

// 辅助函数：标准化 Dropbox 路径
function normalizePath(filePath: string): string {
  let cleanPath = filePath.trim();
  if (!cleanPath.startsWith("/")) {
    cleanPath = "/" + cleanPath;
  }
  if (ROOT_PATH && ROOT_PATH !== "/") {
      if (!cleanPath.startsWith(ROOT_PATH)) {
          cleanPath = path.posix.join(ROOT_PATH, cleanPath); // Ensure path is inside root
      }
  }
  if (!cleanPath.endsWith(".md")) {
    cleanPath += ".md";
  }
  return cleanPath;
}

// 1. 列出 Prompts (List Prompts)
server.setRequestHandler(ListPromptsRequestSchema, async () => {
  try {
    const response = await dbx.filesListFolder({
      path: ROOT_PATH === "/" ? "" : ROOT_PATH,
      recursive: true, 
    });

    const prompts = response.result.entries
      .filter((entry) => entry[".tag"] === "file" && entry.name.endsWith(".md"))
      .map((entry) => {
        const name = entry.name.replace(".md", "");
        return {
          name: name,
          description: `Imported from Dropbox: ${entry.path_display}`,
        };
      });

    return {
      prompts: prompts,
    };
  } catch (error: any) {
    console.error("Error listing prompts:", error);
    return { prompts: [] };
  }
});

// 2. 获取 Prompt 内容 (Get Prompt)
server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const promptName = request.params.name;
  try {
    const filePath = normalizePath(promptName);
    
    // 下载文件
    const response = await dbx.filesDownload({ path: filePath });
    
    // @ts-ignore
    const content = (response.result as any).fileBinary.toString("utf8");

    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: content,
          },
        },
      ],
    };
  } catch (error: any) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      `Prompt not found or error reading from Dropbox: ${error.message}`
    );
  }
});

// 3. 列出工具 (List Tools)
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "save_prompt",
        description: "Save a new AI role or prompt to Dropbox. Use this to persist a useful prompt found during chat.",
        inputSchema: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "The name of the prompt (e.g., 'sql_expert'). Do not include .md extension.",
            },
            content: {
              type: "string",
              description: "The full content/markdown of the prompt.",
            },
          },
          required: ["name", "content"],
        },
      },
      {
        name: "list_prompts",
        description: "List all available AI prompts/roles stored in Dropbox.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "get_prompt",
        description: "Get the content of a specific prompt/role from Dropbox.",
        inputSchema: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "The name of the prompt to retrieve.",
            },
          },
          required: ["name"],
        },
      },
      {
        name: "search_prompts",
        description: "Search for prompts by name using a keyword (fuzzy match/substring).",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "The keyword to search for in prompt names.",
            },
          },
          required: ["query"],
        },
      },
    ],
  };
});

// 4. 调用工具 (Call Tool)
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === "save_prompt") {
      const { name: pName, content } = args as { name: string; content: string };
      if (!pName || !content) throw new McpError(ErrorCode.InvalidParams, "Name and content are required");
      
      const filePath = normalizePath(pName);
      await dbx.filesUpload({
        path: filePath,
        contents: content,
        mode: { ".tag": "overwrite" },
      });

      return {
        content: [{ type: "text", text: `Successfully saved prompt '${pName}' to Dropbox at ${filePath}` }],
      };
    }

    if (name === "list_prompts") {
      const response = await dbx.filesListFolder({
        path: ROOT_PATH === "/" ? "" : ROOT_PATH,
        recursive: true,
      });

      const files = response.result.entries
        .filter((entry) => entry[".tag"] === "file" && entry.name.endsWith(".md"))
        .map((entry) => entry.name.replace(".md", ""));

      return {
        content: [{ type: "text", text: `Available prompts: ${files.join(", ")}` }],
      };
    }

    if (name === "get_prompt") {
      const { name: pName } = args as { name: string };
      if (!pName) throw new McpError(ErrorCode.InvalidParams, "Prompt name is required");

      const filePath = normalizePath(pName);
      const response = await dbx.filesDownload({ path: filePath });
      // @ts-ignore
      const content = (response.result as any).fileBinary.toString("utf8");

      return {
        content: [{ type: "text", text: content }],
      };
    }

    if (name === "search_prompts") {
      const { query } = args as { query: string };
      if (!query) throw new McpError(ErrorCode.InvalidParams, "Search query is required");

      const response = await dbx.filesListFolder({
        path: ROOT_PATH === "/" ? "" : ROOT_PATH,
        recursive: true,
      });

      const lowercaseQuery = query.toLowerCase();
      const matchedFiles = response.result.entries
        .filter((entry) => 
            entry[".tag"] === "file" && 
            entry.name.endsWith(".md") &&
            entry.name.toLowerCase().includes(lowercaseQuery)
        )
        .map((entry) => entry.name.replace(".md", ""));

      if (matchedFiles.length === 0) {
        return {
          content: [{ type: "text", text: `No prompts found matching: "${query}"` }],
        };
      }

      return {
        content: [{ type: "text", text: `I found these related prompts: ${matchedFiles.join(", ")}. Which one would you like to use?` }],
      };
    }

    throw new McpError(ErrorCode.MethodNotFound, `Tool not found: ${name}`);
  } catch (error: any) {
    return {
      content: [{ type: "text", text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
