import { Dropbox } from "dropbox";
import "isomorphic-fetch";
import dotenv from "dotenv";
import { HttpsProxyAgent } from "https-proxy-agent";
import fetch, { RequestInit } from "node-fetch";

dotenv.config();

const ACCESS_TOKEN = process.env.DROPBOX_ACCESS_TOKEN;
const PROXY_URL = process.env.http_proxy || process.env.HTTP_PROXY || "http://127.0.0.1:7890"; // Fallback default for typical user

if (!ACCESS_TOKEN) {
  console.error("❌ Error: DROPBOX_ACCESS_TOKEN is missing in .env");
  process.exit(1);
}

// Create a custom fetch with proxy support
const customFetch = (url: string, init?: RequestInit) => {
    // @ts-ignore
    return fetch(url, {
        ...init,
        agent: new HttpsProxyAgent(PROXY_URL)
    });
};

console.log(`🔄 Connecting to Dropbox (Proxy: ${PROXY_URL})...`);

const dbx = new Dropbox({ 
    accessToken: ACCESS_TOKEN,
    fetch: customFetch as any // Force cast to match SDK signature
});

async function verify() {
  try {
    const response = await dbx.filesListFolder({ path: "" }); 
    console.log("✅ Connection Successful!");
    console.log("📂 Files found in your App Folder:");
    response.result.entries.forEach((entry) => {
      console.log(`   - ${entry.name} (${entry['.tag']})`);
    });
  } catch (error: any) {
    console.error("❌ Connection Failed:", error);
    if (error.error) console.error("API Error Details:", JSON.stringify(error.error, null, 2));
  }
}

verify();
