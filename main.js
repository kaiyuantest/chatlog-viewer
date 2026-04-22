const { app, BrowserWindow, ipcMain } = require("electron");
const { dialog } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const APP_DIR = __dirname;
const DEFAULT_SESSIONS_DIR = path.join(os.homedir(), ".codex", "sessions");
const APP_ICON = path.join(APP_DIR, "assets", "app-icon.png");

function getConfigPath() {
  return path.join(app.getPath("userData"), "config.json");
}

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(getConfigPath(), "utf8"));
  } catch {
    return {};
  }
}

function writeConfig(config) {
  fs.mkdirSync(path.dirname(getConfigPath()), { recursive: true });
  fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), "utf8");
}

function getSessionsDir() {
  const config = readConfig();
  if (config.sessionsDir && fs.existsSync(config.sessionsDir)) {
    return config.sessionsDir;
  }
  return DEFAULT_SESSIONS_DIR;
}

function listJsonlFiles(rootDir) {
  const results = [];

  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (fullPath === APP_DIR) {
          continue;
        }
        walk(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        results.push(fullPath);
      }
    }
  }

  walk(rootDir);
  return results.sort();
}

function parseJsonLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function formatFileTime(filePath) {
  const name = path.basename(filePath, ".jsonl");
  const match = name.match(/rollout-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})/);
  if (!match) {
    return name;
  }
  return `${match[1]} ${match[2]}:${match[3]}:${match[4]}`;
}

function getTextParts(content) {
  if (!Array.isArray(content)) {
    return [];
  }

  return content
    .map((part) => {
      if (!part || typeof part !== "object") {
        return "";
      }
      if (typeof part.text === "string") {
        return part.text;
      }
      if (typeof part.output_text === "string") {
        return part.output_text;
      }
      return "";
    })
    .filter(Boolean);
}

function buildIndex() {
  const sessionsDir = getSessionsDir();
  const files = listJsonlFiles(sessionsDir);
  const pathsMap = new Map();

  for (const filePath of files) {
    const cwdSet = new Set();
    const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean);

    for (const line of lines) {
      const item = parseJsonLine(line);
      const cwd = item && item.payload && typeof item.payload.cwd === "string" ? item.payload.cwd : "";
      if (cwd) {
        cwdSet.add(cwd);
      }
    }

    for (const cwd of cwdSet) {
      if (!pathsMap.has(cwd)) {
        pathsMap.set(cwd, []);
      }

      pathsMap.get(cwd).push({
        filePath,
        relativePath: path.relative(sessionsDir, filePath),
        timeLabel: formatFileTime(filePath)
      });
    }
  }

  const paths = Array.from(pathsMap.entries())
    .map(([cwd, filesForPath]) => ({
      cwd,
      fileCount: filesForPath.length,
      items: filesForPath.sort((a, b) => b.timeLabel.localeCompare(a.timeLabel))
    }))
    .sort((a, b) => a.cwd.localeCompare(b.cwd, "zh-CN"));

  return {
    rootDir: sessionsDir,
    defaultRootDir: DEFAULT_SESSIONS_DIR,
    paths
  };
}

function readConversation(filePath, selectedCwd) {
  const sessionsDir = getSessionsDir();
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean);
  const messages = [];
  let activeCwd = "";

  for (const line of lines) {
    const item = parseJsonLine(line);
    if (!item) {
      continue;
    }

    const payloadCwd = item.payload && typeof item.payload.cwd === "string" ? item.payload.cwd : "";
    if (payloadCwd) {
      activeCwd = payloadCwd;
    }

    const entryCwd = payloadCwd || activeCwd;
    if (selectedCwd && entryCwd && entryCwd !== selectedCwd) {
      continue;
    }

    if (item.type === "response_item" && item.payload && item.payload.type === "message") {
      const role = item.payload.role || "unknown";
      const text = getTextParts(item.payload.content).join("\n").trim();
      if (text) {
        messages.push({
          kind: "message",
          role,
          cwd: entryCwd,
          time: item.timestamp,
          text
        });
      }
      continue;
    }

    if (item.type === "event_msg" && item.payload && item.payload.type === "user_message") {
      messages.push({
        kind: "message",
        role: "user",
        cwd: entryCwd,
        time: item.timestamp,
        text: item.payload.message || ""
      });
      continue;
    }

    if (item.type === "event_msg" && item.payload && item.payload.type === "agent_message") {
      messages.push({
        kind: "message",
        role: "assistant",
        cwd: entryCwd,
        time: item.timestamp,
        text: item.payload.message || ""
      });
      continue;
    }

    if (item.type === "event_msg" && item.payload && item.payload.type === "exec_command_end") {
      messages.push({
        kind: "command",
        role: "tool",
        cwd: entryCwd,
        time: item.timestamp,
        command: Array.isArray(item.payload.command) ? item.payload.command.join(" ") : "",
        output: item.payload.aggregated_output || ""
      });
    }
  }

  return {
    filePath,
    relativePath: path.relative(sessionsDir, filePath),
    cwd: selectedCwd,
    timeLabel: formatFileTime(filePath),
    messages
  };
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    icon: APP_ICON,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadFile(path.join(__dirname, "renderer", "index.html"));
}

ipcMain.handle("index:load", async () => buildIndex());
ipcMain.handle("conversation:load", async (_event, payload) => {
  return readConversation(payload.filePath, payload.cwd);
});
ipcMain.handle("config:get", async () => {
  return {
    sessionsDir: getSessionsDir(),
    defaultSessionsDir: DEFAULT_SESSIONS_DIR
  };
});
ipcMain.handle("config:chooseSessionsDir", async () => {
  const result = await dialog.showOpenDialog({
    title: "选择 sessions 目录",
    defaultPath: getSessionsDir(),
    properties: ["openDirectory"]
  });

  if (result.canceled || !result.filePaths[0]) {
    return {
      canceled: true,
      sessionsDir: getSessionsDir(),
      defaultSessionsDir: DEFAULT_SESSIONS_DIR
    };
  }

  writeConfig({ sessionsDir: result.filePaths[0] });
  return {
    canceled: false,
    sessionsDir: result.filePaths[0],
    defaultSessionsDir: DEFAULT_SESSIONS_DIR
  };
});

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
