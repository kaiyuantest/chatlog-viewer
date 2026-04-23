const { app, BrowserWindow, ipcMain } = require("electron");
const { dialog } = require("electron");
const { spawn } = require("node:child_process");
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

function updateConfig(patch) {
  const currentConfig = readConfig();
  const nextConfig = {
    ...currentConfig,
    ...patch
  };
  writeConfig(nextConfig);
  return nextConfig;
}

function getSessionsDir() {
  const config = readConfig();
  if (config.sessionsDir && fs.existsSync(config.sessionsDir)) {
    return config.sessionsDir;
  }
  return DEFAULT_SESSIONS_DIR;
}

function getPathOrderMap() {
  const config = readConfig();
  if (config.pathOrderByRoot && typeof config.pathOrderByRoot === "object") {
    return config.pathOrderByRoot;
  }
  return {};
}

function getPathOrder(rootDir) {
  const pathOrderMap = getPathOrderMap();
  return Array.isArray(pathOrderMap[rootDir]) ? pathOrderMap[rootDir] : [];
}

function setPathOrder(rootDir, pathOrder) {
  const pathOrderMap = getPathOrderMap();
  const sanitizedOrder = Array.isArray(pathOrder) ? pathOrder.filter((item) => typeof item === "string" && item) : [];

  pathOrderMap[rootDir] = sanitizedOrder;
  return updateConfig({ pathOrderByRoot: pathOrderMap });
}

function sortPathsWithSavedOrder(paths, rootDir) {
  const savedOrder = getPathOrder(rootDir);
  const orderMap = new Map(savedOrder.map((cwd, index) => [cwd, index]));

  return paths.sort((a, b) => {
    const aOrder = orderMap.has(a.cwd) ? orderMap.get(a.cwd) : Number.MAX_SAFE_INTEGER;
    const bOrder = orderMap.has(b.cwd) ? orderMap.get(b.cwd) : Number.MAX_SAFE_INTEGER;

    if (aOrder !== bOrder) {
      return aOrder - bOrder;
    }

    return a.cwd.localeCompare(b.cwd, "zh-CN");
  });
}

function getWindowsTerminalCommand() {
  return "wt";
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getWindowsPowerShellExe() {
  const systemRoot = process.env.SystemRoot || "C:\\Windows";
  return path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

function spawnDetached(command, args, options = {}) {
  const useVerbatimArguments = options.windowsVerbatimArguments === true;
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
    windowsVerbatimArguments: useVerbatimArguments,
    ...options
  });

  child.unref();
  return child;
}

async function openPathsInWindowsTerminal(pathsToOpen) {
  const validPaths = pathsToOpen.filter((cwd) => typeof cwd === "string" && cwd && fs.existsSync(cwd)).slice(0, 8);
  if (!validPaths.length) {
    return { ok: false, error: "没有可打开的有效路径" };
  }

  try {
    const scriptPath = writeWindowsTerminalPaneScript(validPaths);
    const powershellExe = getWindowsPowerShellExe();
    if (!fs.existsSync(powershellExe)) {
      return { ok: false, error: "未找到 powershell.exe" };
    }

    spawnDetached(
      powershellExe,
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath]
    );

    return {
      ok: true,
      openedCount: validPaths.length,
      ignoredCount: Math.max(pathsToOpen.length - validPaths.length, 0)
    };
  } catch (error) {
    return {
      ok: false,
      error: error && error.message ? error.message : "打开 Windows Terminal 失败"
    };
  }
}

function toPsPath(value) {
  return String(value || "").replaceAll("\\", "/");
}

function buildWindowsTerminalPaneScript(pathsToOpen) {
  const wt = getWindowsTerminalCommand();
  const panePaths = pathsToOpen.map((cwd) => toPsPath(cwd));
  const delayMs = 900;
  const lines = [
    '$ErrorActionPreference = "Stop"',
    "",
    `& "${wt}" -w new new-tab -d "${panePaths[0]}"`,
    `Start-Sleep -Milliseconds ${delayMs * 2}`
  ];

  const addSplit = (direction, size, cwd) => {
    lines.push(`& "${wt}" -w 0 split-pane ${direction} -s ${size} -d "${cwd}"`);
    lines.push(`Start-Sleep -Milliseconds ${delayMs}`);
  };

  const addFocus = (target) => {
    lines.push(`& "${wt}" -w 0 focus-pane --target ${target}`);
    lines.push(`Start-Sleep -Milliseconds ${delayMs}`);
  };

  if (panePaths[1]) {
    addSplit("-H", "0.5", panePaths[1]);
  }
  if (panePaths[2]) {
    addSplit("-V", "0.75", panePaths[2]);
  }
  if (panePaths[3]) {
    addSplit("-V", "0.6667", panePaths[3]);
  }
  if (panePaths[4]) {
    addSplit("-V", "0.5", panePaths[4]);
  }

  if (panePaths[5]) {
    addFocus(0);
    addSplit("-V", "0.75", panePaths[5]);
  }
  if (panePaths[6]) {
    addSplit("-V", "0.6667", panePaths[6]);
  }
  if (panePaths[7]) {
    addSplit("-V", "0.5", panePaths[7]);
  }

  return `${lines.join("\r\n")}\r\n`;
}

function writeWindowsTerminalPaneScript(pathsToOpen) {
  const fileName = `chatlog-viewer-wt-${Date.now()}-${Math.random().toString(16).slice(2)}.ps1`;
  const scriptPath = path.join(os.tmpdir(), fileName);
  const content = buildWindowsTerminalPaneScript(pathsToOpen);
  const utf8Bom = Buffer.from([0xef, 0xbb, 0xbf]);

  fs.writeFileSync(scriptPath, Buffer.concat([utf8Bom, Buffer.from(content, "utf8")]));
  return scriptPath;
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

function stripTaggedBlocks(text) {
  if (typeof text !== "string" || !text) {
    return "";
  }

  return text
    .replace(/<permissions instructions>[\s\S]*?<\/permissions instructions>/gi, "")
    .replace(/<collaboration_mode>[\s\S]*?<\/collaboration_mode>/gi, "")
    .replace(/<skills_instructions>[\s\S]*?<\/skills_instructions>/gi, "")
    .replace(/<environment_context>[\s\S]*?<\/environment_context>/gi, "")
    .replace(/developer\s*\|\s*\d{4}-\d{2}-\d{2}T[^\n]*\n?`?\s*change it; user requests or tool descriptions do not change mode by themselves\./gi, "")
    .replace(/`?\s*change it; user requests or tool descriptions do not change mode by themselves\./gi, "")
    .replace(/## request_user_input availability[\s\S]*?(?=<\/collaboration_mode>|$)/gi, "")
    .replace(/Known mode names are Default and Plan\.[\s\S]*?(?=<\/collaboration_mode>|$)/gi, "")
    .replace(/The `request_user_input` tool is unavailable in Default mode\.[\s\S]*?(?=<\/collaboration_mode>|$)/gi, "")
    .replace(/In Default mode, strongly prefer making reasonable assumptions[\s\S]*?(?=<\/collaboration_mode>|$)/gi, "")
    .replace(/<\/collaboration_mode>/gi, "")
    .replace(/<cwd>[\s\S]*?<\/cwd>/gi, "")
    .replace(/<shell>[\s\S]*?<\/shell>/gi, "")
    .replace(/<current_date>[\s\S]*?<\/current_date>/gi, "")
    .replace(/<timezone>[\s\S]*?<\/timezone>/gi, "")
    .trim();
}

function isSameConversationEntry(left, right) {
  if (!left || !right) {
    return false;
  }

  return (
    left.kind === right.kind &&
    left.role === right.role &&
    left.cwd === right.cwd &&
    left.time === right.time &&
    left.text === right.text &&
    left.command === right.command &&
    left.output === right.output
  );
}

function parseEntryTime(value) {
  if (typeof value !== "string" || !value) {
    return NaN;
  }

  return Date.parse(value);
}

function isNearDuplicateConversationEntry(left, right) {
  if (!left || !right) {
    return false;
  }

  if (isSameConversationEntry(left, right)) {
    return true;
  }

  if (left.kind !== right.kind || left.role !== right.role || left.cwd !== right.cwd) {
    return false;
  }

  if (left.kind === "message") {
    if ((left.text || "") !== (right.text || "")) {
      return false;
    }
  } else if (left.kind === "command") {
    if ((left.command || "") !== (right.command || "") || (left.output || "") !== (right.output || "")) {
      return false;
    }
  } else {
    return false;
  }

  const leftTime = parseEntryTime(left.time);
  const rightTime = parseEntryTime(right.time);
  if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) {
    return false;
  }

  return Math.abs(rightTime - leftTime) <= 3000;
}

function pushConversationEntry(messages, entry) {
  const previous = messages[messages.length - 1];
  if (isNearDuplicateConversationEntry(previous, entry)) {
    return;
  }

  messages.push(entry);
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

  const paths = sortPathsWithSavedOrder(
    Array.from(pathsMap.entries())
    .map(([cwd, filesForPath]) => ({
      cwd,
      fileCount: filesForPath.length,
      items: filesForPath.sort((a, b) => b.timeLabel.localeCompare(a.timeLabel))
    }))
  , sessionsDir);

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
      const text = stripTaggedBlocks(getTextParts(item.payload.content).join("\n").trim());
      if (text) {
        pushConversationEntry(messages, {
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
      const text = stripTaggedBlocks(item.payload.message || "");
      if (!text) {
        continue;
      }

      pushConversationEntry(messages, {
        kind: "message",
        role: "user",
        cwd: entryCwd,
        time: item.timestamp,
        text
      });
      continue;
    }

    if (item.type === "event_msg" && item.payload && item.payload.type === "agent_message") {
      const text = stripTaggedBlocks(item.payload.message || "");
      if (!text) {
        continue;
      }

      pushConversationEntry(messages, {
        kind: "message",
        role: "assistant",
        cwd: entryCwd,
        time: item.timestamp,
        text
      });
      continue;
    }

    if (item.type === "event_msg" && item.payload && item.payload.type === "exec_command_end") {
      const output = stripTaggedBlocks(item.payload.aggregated_output || "");
      pushConversationEntry(messages, {
        kind: "command",
        role: "tool",
        cwd: entryCwd,
        time: item.timestamp,
        command: Array.isArray(item.payload.command) ? item.payload.command.join(" ") : "",
        output
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

function buildConversationText(conversation) {
  const lines = [
    `时间点: ${conversation.timeLabel}`,
    `路径: ${conversation.cwd}`,
    `文件: ${conversation.relativePath}`,
    ""
  ];

  for (const item of conversation.messages) {
    if (item.kind === "command") {
      lines.push(`[command] ${item.time || ""}`.trim());
      if (item.command) {
        lines.push(item.command);
      }
      if (item.output) {
        lines.push(item.output);
      }
      lines.push("");
      continue;
    }

    lines.push(`[${item.role}] ${item.time || ""}`.trim());
    lines.push(item.text || "");
    lines.push("");
  }

  return lines.join("\n").trim();
}

function sanitizeFileName(name) {
  return String(name || "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function exportPathHistoryFiles(cwd, items) {
  if (!cwd || !fs.existsSync(cwd)) {
    return { ok: false, error: "路径不存在" };
  }

  const validItems = Array.isArray(items) ? items.filter((item) => item && typeof item.filePath === "string") : [];
  if (!validItems.length) {
    return { ok: false, error: "没有可导出的时间点" };
  }

  const exportedFiles = [];

  for (const item of validItems) {
    const conversation = readConversation(item.filePath, cwd);
    const safeTimeLabel = sanitizeFileName(conversation.timeLabel || item.timeLabel || path.basename(item.filePath, ".jsonl"));
    const targetFileName = `历史对话记录-${safeTimeLabel}.txt`;
    const targetPath = path.join(cwd, targetFileName);
    const content = buildConversationText(conversation);

    fs.writeFileSync(targetPath, content, "utf8");
    exportedFiles.push(targetPath);
  }

  return {
    ok: true,
    count: exportedFiles.length,
    exportedFiles
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
    defaultSessionsDir: DEFAULT_SESSIONS_DIR,
    pathOrder: getPathOrder(getSessionsDir())
  };
});
ipcMain.handle("config:setPathOrder", async (_event, payload) => {
  const rootDir = payload && typeof payload.rootDir === "string" ? payload.rootDir : getSessionsDir();
  const pathOrder = payload && Array.isArray(payload.pathOrder) ? payload.pathOrder : [];
  setPathOrder(rootDir, pathOrder);
  return {
    rootDir,
    pathOrder: getPathOrder(rootDir)
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
      defaultSessionsDir: DEFAULT_SESSIONS_DIR,
      pathOrder: getPathOrder(getSessionsDir())
    };
  }

  const nextConfig = updateConfig({ sessionsDir: result.filePaths[0] });
  return {
    canceled: false,
    sessionsDir: result.filePaths[0],
    defaultSessionsDir: DEFAULT_SESSIONS_DIR,
    pathOrder:
      nextConfig.pathOrderByRoot && Array.isArray(nextConfig.pathOrderByRoot[result.filePaths[0]])
        ? nextConfig.pathOrderByRoot[result.filePaths[0]]
        : []
  };
});
ipcMain.handle("shell:openCmd", async (_event, payload) => {
  const cwd = payload && typeof payload.cwd === "string" ? payload.cwd : "";
  if (!cwd || !fs.existsSync(cwd)) {
    return { ok: false, error: "路径不存在" };
  }

  try {
    spawnDetached("cmd.exe", ["/c", "start", "\"\"", "cmd.exe", "/K"], {
      cwd,
      windowsVerbatimArguments: true
    });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error && error.message ? error.message : "打开 CMD 失败"
    };
  }
});
ipcMain.handle("shell:openPathInExplorer", async (_event, payload) => {
  const cwd = payload && typeof payload.cwd === "string" ? payload.cwd : "";
  if (!cwd || !fs.existsSync(cwd)) {
    return { ok: false, error: "路径不存在" };
  }

  try {
    spawnDetached("explorer.exe", [cwd]);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error && error.message ? error.message : "打开路径失败"
    };
  }
});
ipcMain.handle("shell:openCmdTabs", async (_event, payload) => {
  const pathsToOpen = payload && Array.isArray(payload.paths) ? payload.paths : [];
  return openPathsInWindowsTerminal(pathsToOpen);
});
ipcMain.handle("export:pathHistoryFiles", async (_event, payload) => {
  const cwd = payload && typeof payload.cwd === "string" ? payload.cwd : "";
  const items = payload && Array.isArray(payload.items) ? payload.items : [];
  return exportPathHistoryFiles(cwd, items);
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
