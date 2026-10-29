#!/usr/bin/env node
/**
 * A MINIMAL MCP CLIENT OVER STDIO — for harnesses, not for shipping.
 *
 * Why this exists rather than the SDK client: the point of this transport is to
 * exercise `dist/index.js` exactly as a real host does, and the thinnest
 * possible client is the one least able to paper over a protocol fault in the
 * server. If the server emits a malformed frame, this notices; a forgiving
 * client would not.
 *
 * What it buys the sweep, concretely — the direct-endpoint transport fetches a
 * tool's declared `_meta.endpoint` itself. That proves the ENDPOINT works. It
 * cannot prove `dispatchTool` routes the tool to that endpoint, with those
 * arguments, at all: `check-dispatch.mjs` greps for a `case` label, which is
 * satisfied by a case that calls the wrong handler. This transport goes through
 * the real switch and the real `decorateForAgent` seam in the BUILT artifact,
 * so a mis-wired case shows up as a payload that disagrees with the endpoint's.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

export class McpStdioClient {
  constructor({ apiKey, apiUrl, timeoutMs = 45_000 }) {
    this.timeoutMs = timeoutMs;
    this.pending = new Map();
    this.nextId = 1;
    this.buf = "";
    this.stderr = [];
    this.malformedFrames = [];
    this.child = spawn("node", [join(__dirname, "..", "dist", "index.js"), "--stdio"], {
      env: { ...process.env, FAHALI_API_KEY: apiKey, FAHALI_API_URL: apiUrl },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child.stderr.on("data", (d) => this.stderr.push(d.toString()));
    this.child.stdout.on("data", (d) => this.#onData(d));
    this.exited = new Promise((res) => this.child.on("exit", (code) => res(code)));
  }

  #onData(chunk) {
    this.buf += chunk.toString();
    let i;
    while ((i = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, i).trim();
      this.buf = this.buf.slice(i + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        // A non-JSON line on stdout is a protocol fault: stdout is the frame
        // channel and nothing else may write to it. Recorded, never ignored —
        // a stray console.log here silently corrupts every host's session.
        this.malformedFrames.push(line.slice(0, 200));
        continue;
      }
      const h = msg.id != null ? this.pending.get(msg.id) : null;
      if (h) {
        this.pending.delete(msg.id);
        h(msg);
      }
    }
  }

  #rpc(method, params) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`timeout after ${this.timeoutMs}ms on ${method}`));
      }, this.timeoutMs);
      this.pending.set(id, (msg) => {
        clearTimeout(timer);
        resolve(msg);
      });
      this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }

  #notify(method, params) {
    this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  }

  async initialize() {
    const res = await this.#rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "fahali-envelope-sweep", version: "1.0.0" },
    });
    if (res.error) throw new Error(`initialize failed: ${JSON.stringify(res.error)}`);
    this.#notify("notifications/initialized", {});
    return res.result;
  }

  async listTools() {
    const res = await this.#rpc("tools/list", {});
    if (res.error) throw new Error(`tools/list failed: ${JSON.stringify(res.error)}`);
    return res.result?.tools ?? [];
  }

  /**
   * PROMPTS ARE A SEPARATE MCP PRIMITIVE, and until 2026-09-08 no harness here
   * had ever called one. `tools/list` does not enumerate them, so a prompt that
   * throws, renders empty, or names a tool that no longer exists is invisible
   * to every check in this directory — the roster counted 54 tools and stopped.
   * A user picking "Fahali risk desk" out of a host's prompt menu reaches this
   * path and nothing else.
   */
  async listPrompts() {
    const res = await this.#rpc("prompts/list", {});
    if (res.error) return { error: `prompts/list failed: ${JSON.stringify(res.error).slice(0, 200)}` };
    return { prompts: res.result?.prompts ?? [] };
  }

  async getPrompt(name, args) {
    let res;
    try {
      res = await this.#rpc("prompts/get", { name, arguments: args ?? {} });
    } catch (e) {
      return { error: e.message };
    }
    if (res.error) return { error: `rpc error: ${JSON.stringify(res.error).slice(0, 300)}` };
    const messages = res.result?.messages ?? [];
    return {
      description: res.result?.description ?? "",
      messages,
      text: messages.map((m) => (typeof m.content?.text === "string" ? m.content.text : "")).join("\n\n"),
    };
  }

  /**
   * Returns { envelope, isError, text } or { error }. A JSON-RPC-level error and
   * an `isError: true` result are DIFFERENT failures and are reported as such:
   * the first means the call never ran, the second means it ran and refused.
   */
  async callTool(name, args) {
    let res;
    try {
      res = await this.#rpc("tools/call", { name, arguments: args ?? {} });
    } catch (e) {
      return { error: e.message };
    }
    if (res.error) return { error: `rpc error: ${JSON.stringify(res.error).slice(0, 200)}` };
    const result = res.result ?? {};
    return {
      envelope: result.structuredContent ?? null,
      isError: result.isError === true,
      text: result.content?.[0]?.text ?? "",
    };
  }

  close() {
    try {
      this.child.stdin.end();
      this.child.kill();
    } catch {
      /* already gone */
    }
  }
}
