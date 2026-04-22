const state = {
  index: null,
  selectedPath: "",
  selectedFile: "",
  currentConversation: null,
  config: null
};

const elements = {
  refreshBtn: document.getElementById("refreshBtn"),
  chooseDirBtn: document.getElementById("chooseDirBtn"),
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

function renderPaths() {
  const keyword = elements.pathSearchInput.value.trim().toLowerCase();
  const paths = (state.index ? state.index.paths : []).filter((item) =>
    item.cwd.toLowerCase().includes(keyword)
  );

  elements.pathsList.innerHTML = paths
    .map(
      (item) => `
        <button class="item ${item.cwd === state.selectedPath ? "active" : ""}" data-cwd="${escapeHtml(item.cwd)}">
          <div class="item-title">${escapeHtml(item.cwd)}</div>
          <div class="item-meta">${item.fileCount} 个时间点</div>
        </button>
      `
    )
    .join("");

  elements.pathsList.querySelectorAll("[data-cwd]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedPath = button.dataset.cwd;
      state.selectedFile = "";
      renderPaths();
      renderFiles();
      renderEmptyChat("先选择这个路径下的时间点。");
    });
  });
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
    defaultSessionsDir: result.defaultSessionsDir
  };
  renderConfig();
  await loadIndex();
});
elements.pathSearchInput.addEventListener("input", renderPaths);
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
