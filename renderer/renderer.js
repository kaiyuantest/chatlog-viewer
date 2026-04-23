const state = {
  index: null,
  selectedPath: "",
  selectedFile: "",
  currentConversation: null,
  config: null,
  pathActionMessage: "",
  selectedPaths: []
};

const elements = {
  refreshBtn: document.getElementById("refreshBtn"),
  chooseDirBtn: document.getElementById("chooseDirBtn"),
  openSelectedCmdBtn: document.getElementById("openSelectedCmdBtn"),
  pathSearchInput: document.getElementById("pathSearchInput"),
  sessionsDirText: document.getElementById("sessionsDirText"),
  defaultDirHint: document.getElementById("defaultDirHint"),
  pathsList: document.getElementById("pathsList"),
  pathTitle: document.getElementById("pathTitle"),
  filesList: document.getElementById("filesList"),
  chatTitle: document.getElementById("chatTitle"),
  chatView: document.getElementById("chatView"),
  copyChatBtn: document.getElementById("copyChatBtn")
};

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function getFilteredPaths() {
  const keyword = elements.pathSearchInput.value.trim().toLowerCase();
  return (state.index ? state.index.paths : []).filter((item) => item.cwd.toLowerCase().includes(keyword));
}

function setPathActionMessage(text) {
  state.pathActionMessage = text || "";
  renderPaths();
}

function isPathSelected(cwd) {
  return state.selectedPaths.includes(cwd);
}

function togglePathSelection(cwd) {
  if (isPathSelected(cwd)) {
    state.selectedPaths = state.selectedPaths.filter((item) => item !== cwd);
  } else {
    state.selectedPaths = [...state.selectedPaths, cwd];
  }

  renderPaths();
}

function syncSelectedPaths() {
  const availablePaths = new Set((state.index ? state.index.paths : []).map((item) => item.cwd));
  state.selectedPaths = state.selectedPaths.filter((cwd) => availablePaths.has(cwd));
}

async function savePathOrder() {
  if (!state.index) {
    return;
  }

  const result = await window.chatlogApi.setPathOrder({
    rootDir: state.index.rootDir,
    pathOrder: state.index.paths.map((item) => item.cwd)
  });

  if (state.config) {
    state.config.pathOrder = result.pathOrder;
  }
}

async function pinPath(cwd) {
  if (!state.index) {
    return;
  }

  const currentIndex = state.index.paths.findIndex((item) => item.cwd === cwd);
  if (currentIndex <= 0) {
    return;
  }

  const nextPaths = state.index.paths.slice();
  const [target] = nextPaths.splice(currentIndex, 1);
  nextPaths.unshift(target);
  state.index.paths = nextPaths;

  await savePathOrder();
  renderPaths();
  renderFiles();
  setPathActionMessage("路径已置顶并保存");
}

async function transferPathHistory(cwd) {
  if (!state.index) {
    return;
  }

  const pathItem = state.index.paths.find((item) => item.cwd === cwd);
  if (!pathItem || !pathItem.items.length) {
    setPathActionMessage("该路径下没有可转移的时间点");
    return;
  }

  setPathActionMessage(`正在转移 ${pathItem.items.length} 个时间点...`);
  const result = await window.chatlogApi.exportPathHistoryFiles({
    cwd,
    items: pathItem.items
  });

  setPathActionMessage(
    result.ok ? `已转移 ${result.count} 个时间点到当前路径目录` : `转移失败: ${result.error || "未知错误"}`
  );
}

function renderPaths() {
  const paths = getFilteredPaths();

  elements.pathsList.innerHTML = paths
    .map(
      (item) => `
        <div class="item path-item ${item.cwd === state.selectedPath ? "active" : ""}" data-cwd="${escapeHtml(item.cwd)}">
          <button class="path-main" type="button" data-cwd-select="${escapeHtml(item.cwd)}">
            <div class="item-title">${escapeHtml(item.cwd)}</div>
          </button>
          <div class="path-row">
            <label class="path-check">
              <input type="checkbox" data-select-path="${escapeHtml(item.cwd)}" ${isPathSelected(item.cwd) ? "checked" : ""} />
            </label>
            <div class="item-meta">${item.fileCount} 个时间点</div>
            <div class="path-actions">
              <button class="mini-btn open-btn" type="button" data-open-path="${escapeHtml(item.cwd)}">打开</button>
              <button class="mini-btn pin-btn" type="button" data-pin-path="${escapeHtml(item.cwd)}" title="置顶">置顶</button>
              <button class="mini-btn transfer-btn" type="button" data-transfer-path="${escapeHtml(item.cwd)}">转移</button>
              <button class="mini-btn cmd-btn" type="button" data-open-cmd="${escapeHtml(item.cwd)}">CMD</button>
            </div>
          </div>
        </div>
      `
    )
    .join("");

  elements.pathsList.querySelectorAll("[data-cwd-select]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedPath = button.dataset.cwdSelect;
      state.selectedFile = "";
      renderPaths();
      renderFiles();
      renderEmptyChat("先选择这个路径下的时间点。");
    });
  });

  elements.pathsList.querySelectorAll("[data-select-path]").forEach((input) => {
    input.addEventListener("change", () => {
      togglePathSelection(input.dataset.selectPath);
    });
  });

  elements.pathsList.querySelectorAll("[data-pin-path]").forEach((button) => {
    button.addEventListener("click", async () => {
      await pinPath(button.dataset.pinPath);
    });
  });

  elements.pathsList.querySelectorAll("[data-open-path]").forEach((button) => {
    button.addEventListener("click", async () => {
      const result = await window.chatlogApi.openPathInExplorer({ cwd: button.dataset.openPath });
      setPathActionMessage(result.ok ? "已打开对应路径" : `打开路径失败: ${result.error || "未知错误"}`);
    });
  });

  elements.pathsList.querySelectorAll("[data-transfer-path]").forEach((button) => {
    button.addEventListener("click", async () => {
      await transferPathHistory(button.dataset.transferPath);
    });
  });

  elements.pathsList.querySelectorAll("[data-open-cmd]").forEach((button) => {
    button.addEventListener("click", async () => {
      const result = await window.chatlogApi.openCmd({ cwd: button.dataset.openCmd });
      setPathActionMessage(result.ok ? "已打开 CMD" : `打开 CMD 失败: ${result.error || "未知错误"}`);
    });
  });

  if (state.pathActionMessage) {
    elements.pathsList.insertAdjacentHTML(
      "afterbegin",
      `<div class="path-action-status">${escapeHtml(state.pathActionMessage)}</div>`
    );
  }
}

function renderConfig() {
  if (!state.config) {
    elements.sessionsDirText.textContent = "";
    elements.defaultDirHint.textContent = "";
    return;
  }

  elements.sessionsDirText.textContent = state.config.sessionsDir || "";
  elements.defaultDirHint.textContent = `默认建议目录: ${state.config.defaultSessionsDir || ""}`;
}

function getSelectedPathItem() {
  return state.index && state.index.paths.find((item) => item.cwd === state.selectedPath);
}

function renderFiles() {
  const pathItem = getSelectedPathItem();
  elements.pathTitle.textContent = pathItem ? pathItem.cwd : "时间点";

  if (!pathItem) {
    elements.filesList.innerHTML = "";
    return;
  }

  elements.filesList.innerHTML = pathItem.items
    .map(
      (item) => `
        <button class="item ${item.filePath === state.selectedFile ? "active" : ""}" data-file="${escapeHtml(item.filePath)}">
          <div class="item-title">${escapeHtml(item.timeLabel)}</div>
          <div class="item-meta">${escapeHtml(item.relativePath)}</div>
        </button>
      `
    )
    .join("");

  elements.filesList.querySelectorAll("[data-file]").forEach((button) => {
    button.addEventListener("click", async () => {
      state.selectedFile = button.dataset.file;
      renderFiles();
      await loadConversation();
    });
  });
}

function renderEmptyChat(text) {
  state.currentConversation = null;
  elements.chatTitle.textContent = "对话";
  elements.chatView.className = "chat-view empty";
  elements.chatView.textContent = text;
  elements.copyChatBtn.disabled = true;
}

function renderConversation(data) {
  state.currentConversation = data;
  elements.chatTitle.textContent = `${data.timeLabel} | ${data.cwd}`;
  elements.chatView.className = "chat-view";
  elements.copyChatBtn.disabled = false;

  if (!data.messages.length) {
    elements.chatView.innerHTML = `<div class="message"><div class="message-text">这个路径在该时间点下没有可显示内容。</div></div>`;
    return;
  }

  elements.chatView.innerHTML = data.messages
    .map((item) => {
      const head = `<div class="message-head">${escapeHtml(item.role)} | ${escapeHtml(item.time || "")}</div>`;

      if (item.kind === "command") {
        return `
          <details class="message tool">
            <summary>${escapeHtml(item.command || "command")}</summary>
            ${head}
            <pre>${escapeHtml(item.output || "")}</pre>
          </details>
        `;
      }

      if (item.role === "assistant") {
        return `
          <details class="message assistant">
            <summary>${escapeHtml((item.text || "").slice(0, 60) || "assistant")}</summary>
            ${head}
            <div class="message-text">${escapeHtml(item.text || "")}</div>
          </details>
        `;
      }

      return `
        <div class="message ${escapeHtml(item.role)}">
          ${head}
          <div class="message-text">${escapeHtml(item.text || "")}</div>
        </div>
      `;
    })
    .join("");
}

async function loadIndex() {
  renderEmptyChat("正在加载索引...");
  state.config = await window.chatlogApi.getConfig();
  renderConfig();
  state.index = await window.chatlogApi.loadIndex();
  syncSelectedPaths();
  state.selectedPath = "";
  state.selectedFile = "";
  renderPaths();
  renderFiles();
  renderEmptyChat("先选择路径，再选择时间点。");
}

async function loadConversation() {
  if (!state.selectedPath || !state.selectedFile) {
    return;
  }

  renderEmptyChat("正在加载对话...");
  const data = await window.chatlogApi.loadConversation({
    cwd: state.selectedPath,
    filePath: state.selectedFile
  });
  renderConversation(data);
}

function buildConversationText(conversation) {
  const lines = [`时间点: ${conversation.timeLabel}`, `路径: ${conversation.cwd}`, `文件: ${conversation.relativePath}`, ""];

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

elements.refreshBtn.addEventListener("click", loadIndex);
elements.chooseDirBtn.addEventListener("click", async () => {
  const result = await window.chatlogApi.chooseSessionsDir();
  state.config = {
    sessionsDir: result.sessionsDir,
    defaultSessionsDir: result.defaultSessionsDir,
    pathOrder: result.pathOrder || []
  };
  renderConfig();
  await loadIndex();
});
elements.pathSearchInput.addEventListener("input", renderPaths);
elements.openSelectedCmdBtn.addEventListener("click", async () => {
  if (!state.selectedPaths.length) {
    setPathActionMessage("请先勾选至少一个路径");
    return;
  }

  setPathActionMessage("正在打开单标签多窗格...");
  const result = await window.chatlogApi.openCmdTabs({ paths: state.selectedPaths });
  setPathActionMessage(
    result.ok
      ? `已在单标签中慢速打开 ${result.openedCount || state.selectedPaths.length} 个窗格${
          result.ignoredCount ? `，忽略 ${result.ignoredCount} 个超出上限的路径` : ""
        }`
      : `打开标签页失败: ${result.error || "未知错误"}`
  );
});
elements.copyChatBtn.addEventListener("click", async () => {
  if (!state.currentConversation) {
    return;
  }

  const text = buildConversationText(state.currentConversation);
  await navigator.clipboard.writeText(text);
  elements.copyChatBtn.textContent = "已复制";
  setTimeout(() => {
    elements.copyChatBtn.textContent = "复制当前对话";
  }, 1200);
});

loadIndex();
