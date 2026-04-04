import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let httpServer = null;
let currentSession = null;

const INGEST_PORT = parseInt(process.env.DEBUG_INGEST_PORT || "7242", 10);
if (Number.isNaN(INGEST_PORT) || INGEST_PORT < 1024 || INGEST_PORT > 65535) {
  throw new Error("DEBUG_INGEST_PORT must be between 1024 and 65535");
}
const INGEST_HOST = "127.0.0.1";
const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const LOG_DIR = path.join(projectRoot, ".claude");
const LOG_FILE = path.join(LOG_DIR, "debug.log");

// ---------------------------------------------------------------------------
// String escaping for snippet template variables
// ---------------------------------------------------------------------------
function escapeForString(str) {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/`/g, "\\`")
    .replace(/\$/g, "\\$")
    .replace(/\0/g, "");
}

// ---------------------------------------------------------------------------
// Snippet templates
// ---------------------------------------------------------------------------
const SNIPPETS = {
  javascript: (vars) => `\
// #region DEBUG_${vars.HYPOTHESIS_ID}
fetch('http://127.0.0.1:${vars.PORT}/ingest/', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ sessionId: '${vars.SESSION_ID}', runId: '${vars.RUN_ID}', hypothesisId: '${vars.HYPOTHESIS_ID}', location: '${vars.LOCATION}', message: '${vars.MESSAGE}', data: ${vars.EXPRESSION}, timestamp: Date.now() })
}).catch(() => {});
// #endregion DEBUG_${vars.HYPOTHESIS_ID}`,

  typescript: null, // alias — resolved below

  python: (vars) => `\
# #region DEBUG_${vars.HYPOTHESIS_ID}
try:
    import urllib.request, json, time
    urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:${vars.PORT}/ingest/',
        data=json.dumps({"sessionId":"${vars.SESSION_ID}","runId":"${vars.RUN_ID}","hypothesisId":"${vars.HYPOTHESIS_ID}","location":"${vars.LOCATION}","message":"${vars.MESSAGE}","data":(${vars.EXPRESSION}),"timestamp":int(time.time()*1000)}).encode(),
        headers={"Content-Type":"application/json"}, method="POST"))
except: pass
# #endregion DEBUG_${vars.HYPOTHESIS_ID}`,

  go: (vars) => `\
// #region DEBUG_${vars.HYPOTHESIS_ID}
// Requires: "encoding/json", "net/http", "bytes", "time"
func() {
    b, _ := json.Marshal(map[string]interface{}{"sessionId":"${vars.SESSION_ID}","runId":"${vars.RUN_ID}","hypothesisId":"${vars.HYPOTHESIS_ID}","location":"${vars.LOCATION}","message":"${vars.MESSAGE}","data":${vars.EXPRESSION},"timestamp":time.Now().UnixMilli()})
    http.Post("http://127.0.0.1:${vars.PORT}/ingest/", "application/json", bytes.NewReader(b))
}()
// #endregion DEBUG_${vars.HYPOTHESIS_ID}`,

  rust: (vars) => `\
// #region DEBUG_${vars.HYPOTHESIS_ID}
if let Ok(data_str) = std::panic::catch_unwind(|| format!("{:?}", ${vars.EXPRESSION})) {
    use std::fs::OpenOptions;
    use std::io::Write;
    let ts = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    let escaped = data_str.replace('\\\\', "\\\\\\\\").replace('"', "\\\\\\\\"");
    let line = format!("{{\\"sessionId\\":\\"${vars.SESSION_ID}\\",\\"runId\\":\\"${vars.RUN_ID}\\",\\"hypothesisId\\":\\"${vars.HYPOTHESIS_ID}\\",\\"location\\":\\"${vars.LOCATION}\\",\\"message\\":\\"${vars.MESSAGE}\\",\\"data\\":\\"{}\\",\\"timestamp\\":{}}}\\n", escaped, ts);
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open("${vars.LOG_PATH}") {
        let _ = f.write_all(line.as_bytes());
    }
}
// #endregion DEBUG_${vars.HYPOTHESIS_ID}`,

  java: (vars) => `\
// #region DEBUG_${vars.HYPOTHESIS_ID}
try {
    var conn = (java.net.HttpURLConnection) new java.net.URL("http://127.0.0.1:${vars.PORT}/ingest/").openConnection();
    conn.setRequestMethod("POST");
    conn.setRequestProperty("Content-Type", "application/json");
    conn.setDoOutput(true);
    var os = conn.getOutputStream();
    os.write(("{\\"sessionId\\":\\"${vars.SESSION_ID}\\",\\"runId\\":\\"${vars.RUN_ID}\\",\\"hypothesisId\\":\\"${vars.HYPOTHESIS_ID}\\",\\"location\\":\\"${vars.LOCATION}\\",\\"message\\":\\"${vars.MESSAGE}\\",\\"data\\":" + ${vars.EXPRESSION} + ",\\"timestamp\\":" + System.currentTimeMillis() + "}").getBytes());
    os.close();
    conn.getResponseCode();
} catch (Exception e) {}
// #endregion DEBUG_${vars.HYPOTHESIS_ID}`,

  ruby: (vars) => `\
# #region DEBUG_${vars.HYPOTHESIS_ID}
begin
  require 'net/http'; require 'json'
  Net::HTTP.post(URI('http://127.0.0.1:${vars.PORT}/ingest/'), {sessionId:"${vars.SESSION_ID}",runId:"${vars.RUN_ID}",hypothesisId:"${vars.HYPOTHESIS_ID}",location:"${vars.LOCATION}",message:"${vars.MESSAGE}",data:${vars.EXPRESSION},timestamp:(Time.now.to_f*1000).to_i}.to_json, "Content-Type" => "application/json")
rescue; end
# #endregion DEBUG_${vars.HYPOTHESIS_ID}`,

  fallback: (vars) => `\
// #region DEBUG_${vars.HYPOTHESIS_ID}
// Append this NDJSON line to: ${vars.LOG_PATH}
// {"sessionId":"${vars.SESSION_ID}","runId":"${vars.RUN_ID}","hypothesisId":"${vars.HYPOTHESIS_ID}","location":"${vars.LOCATION}","message":"${vars.MESSAGE}","data":<${vars.EXPRESSION}>,"timestamp":<epoch_ms>}
// #endregion DEBUG_${vars.HYPOTHESIS_ID}`,
};

// typescript is an alias for javascript
SNIPPETS.typescript = SNIPPETS.javascript;
// common aliases
SNIPPETS.js = SNIPPETS.javascript;
SNIPPETS.ts = SNIPPETS.typescript;
SNIPPETS.py = SNIPPETS.python;
SNIPPETS.rb = SNIPPETS.ruby;

// ---------------------------------------------------------------------------
// HTTP ingest server
// ---------------------------------------------------------------------------
function startHttpServer() {
  return new Promise((resolve, reject) => {
    if (httpServer) {
      resolve();
      return;
    }

    httpServer = http.createServer((req, res) => {
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        });
        return res.end();
      }

      if (req.method === "POST" && req.url.startsWith("/ingest")) {
        const MAX_BODY_SIZE = 1024 * 1024;
        let body = "";
        let aborted = false;
        req.on("error", () => {});
        req.on("data", (chunk) => {
          if (aborted) return;
          body += chunk;
          if (body.length > MAX_BODY_SIZE) {
            aborted = true;
            res.writeHead(413, { "Access-Control-Allow-Origin": "*" });
            res.end("Payload too large");
            req.destroy();
            return;
          }
        });
        req.on("end", () => {
          if (aborted) return;
          try {
            const entry = JSON.parse(body);
            if (!entry.timestamp) entry.timestamp = Date.now();
            fs.promises.appendFile(LOG_FILE, JSON.stringify(entry) + "\n").catch(() => {});
          } catch {
            fs.promises.appendFile(LOG_FILE, body.trim() + "\n").catch(() => {});
          }
          res.writeHead(204, { "Access-Control-Allow-Origin": "*" });
          res.end();
        });
        return;
      }

      res.writeHead(404);
      res.end("Not found");
    });

    httpServer.on("error", (err) => {
      if (err.code === "EADDRINUSE") {
        httpServer = null;
        reject(new Error(`Port ${INGEST_PORT} already in use`));
      } else {
        reject(err);
      }
    });

    httpServer.listen(INGEST_PORT, INGEST_HOST, () => resolve());
  });
}

function stopHttpServer() {
  return new Promise((resolve) => {
    if (!httpServer) {
      resolve();
      return;
    }
    httpServer.close(() => {
      httpServer = null;
      resolve();
    });
    if (typeof httpServer.closeAllConnections === 'function') {
      httpServer.closeAllConnections();
    }
  });
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------
async function startDebugSession() {
  if (currentSession) {
    throw new Error(`Session ${currentSession.sessionId} is already active. Call stop_debug_session first.`);
  }
  const sessionId = crypto.randomUUID();
  currentSession = { sessionId, startedAt: Date.now() };

  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.writeFileSync(LOG_FILE, "", { mode: 0o600 });

  await startHttpServer();

  return {
    sessionId,
    endpoint: `http://${INGEST_HOST}:${INGEST_PORT}/ingest/`,
    logPath: LOG_FILE,
  };
}

function readDebugLogs({ hypothesisId, runId, limit = 100 }) {
  if (!fs.existsSync(LOG_FILE)) {
    return { entries: [], count: 0, totalInFile: 0 };
  }

  const raw = fs.readFileSync(LOG_FILE, "utf-8").trim();
  if (!raw) {
    return { entries: [], count: 0, totalInFile: 0 };
  }

  const lines = raw.split("\n");
  let entries = lines.map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return { raw: line };
    }
  });

  const totalInFile = entries.length;

  if (hypothesisId) {
    entries = entries.filter((e) => e.hypothesisId === hypothesisId);
  }
  if (runId) {
    entries = entries.filter((e) => e.runId === runId);
  }

  const limited = entries.slice(-limit);
  return { entries: limited, count: limited.length, totalInFile };
}

function clearDebugLogs() {
  if (fs.existsSync(LOG_FILE)) {
    fs.writeFileSync(LOG_FILE, "");
  }
  return { cleared: true, path: LOG_FILE };
}

function getInstrumentationSnippet({
  language,
  hypothesisId,
  location,
  message,
  expression,
  runId = "run1",
}) {
  if (!currentSession) {
    throw new Error(
      "No active debug session. Call start_debug_session first."
    );
  }

  const vars = {
    SESSION_ID: escapeForString(currentSession.sessionId),
    HYPOTHESIS_ID: escapeForString(hypothesisId),
    LOCATION: escapeForString(location),
    MESSAGE: escapeForString(message),
    EXPRESSION: expression,  // raw code, not escaped
    RUN_ID: escapeForString(runId || "run1"),
    PORT: INGEST_PORT,
    LOG_PATH: LOG_FILE.replace(/\\/g, "/"),
  };

  const lang = language.toLowerCase();
  const templateFn = SNIPPETS[lang] || SNIPPETS.fallback;
  const snippet = templateFn(vars);

  return {
    snippet,
    language: lang,
    marker: `DEBUG_${hypothesisId}`,
  };
}

async function stopDebugSession({ cleanup = false }) {
  const sessionId = currentSession?.sessionId ?? null;

  await stopHttpServer();

  if (cleanup && fs.existsSync(LOG_FILE)) {
    fs.unlinkSync(LOG_FILE);
  }

  const logsPreserved = !cleanup && fs.existsSync(LOG_FILE);
  currentSession = null;

  return { stopped: true, sessionId, logsPreserved };
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------
const TOOL_DEFINITIONS = [
  {
    name: "start_debug_session",
    description:
      "Start a new debug session. Creates a session ID, ensures .claude/ directory exists, clears the debug log, and starts the HTTP ingest server on port 7242.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "read_debug_logs",
    description:
      "Read debug log entries from the current session. Parses the NDJSON log file and optionally filters by hypothesisId or runId.",
    inputSchema: {
      type: "object",
      properties: {
        hypothesisId: {
          type: "string",
          description: "Filter entries to only this hypothesis ID.",
        },
        runId: {
          type: "string",
          description: "Filter entries to only this run ID.",
        },
        limit: {
          type: "number",
          description:
            "Maximum number of entries to return (from the tail). Defaults to 100.",
          default: 100,
        },
      },
      required: [],
    },
  },
  {
    name: "clear_debug_logs",
    description:
      "Truncate the debug log file, removing all entries. The file is preserved but emptied.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "get_instrumentation_snippet",
    description:
      "Generate a language-specific code snippet that sends debug data to the ingest server. Supports javascript, typescript, python, go, rust, java, and ruby. Requires an active debug session.",
    inputSchema: {
      type: "object",
      properties: {
        language: {
          type: "string",
          description:
            "Programming language for the snippet (javascript, typescript, python, go, rust, java, ruby).",
        },
        hypothesisId: {
          type: "string",
          description:
            "Unique identifier for the hypothesis being tested (e.g. 'h1', 'null-ref-check').",
        },
        location: {
          type: "string",
          description:
            "Source location descriptor (e.g. 'src/api/handler.ts:42').",
        },
        message: {
          type: "string",
          description:
            "Human-readable message describing what is being logged.",
        },
        expression: {
          type: "string",
          description:
            "The expression to capture at runtime (e.g. 'user.id', 'JSON.stringify(req.body)').",
        },
        runId: {
          type: "string",
          description:
            "Run identifier to group related log entries. Defaults to 'run1'.",
          default: "run1",
        },
      },
      required: ["language", "hypothesisId", "location", "message", "expression"],
    },
  },
  {
    name: "stop_debug_session",
    description:
      "Stop the current debug session and shut down the HTTP ingest server. Optionally delete the log file.",
    inputSchema: {
      type: "object",
      properties: {
        cleanup: {
          type: "boolean",
          description:
            "If true, delete the debug log file. If false (default), preserve logs for later analysis.",
          default: false,
        },
      },
      required: [],
    },
  },
];

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------
const server = new Server(
  { name: "debug-ingest-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOL_DEFINITIONS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  try {
    let result;

    switch (name) {
      case "start_debug_session":
        result = await startDebugSession();
        break;

      case "read_debug_logs":
        result = readDebugLogs({
          hypothesisId: args.hypothesisId,
          runId: args.runId,
          limit: args.limit,
        });
        break;

      case "clear_debug_logs":
        result = clearDebugLogs();
        break;

      case "get_instrumentation_snippet":
        result = getInstrumentationSnippet({
          language: args.language,
          hypothesisId: args.hypothesisId,
          location: args.location,
          message: args.message,
          expression: args.expression,
          runId: args.runId,
        });
        break;

      case "stop_debug_session":
        result = await stopDebugSession({ cleanup: args.cleanup });
        break;

      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    return {
      content: [{ type: "text", text: `Error: ${err.message}` }],
      isError: true,
    };
  }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
const transport = new StdioServerTransport();
await server.connect(transport);
