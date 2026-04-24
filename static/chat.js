(function () {
  "use strict";
  // Inject copy buttons into all <pre> blocks inside a container
  function addCopyButtons(container) {
    container.querySelectorAll("pre").forEach(pre => {
      if (pre.querySelector(".code-copy-btn")) return;
      const btn = document.createElement("button");
      btn.className = "code-copy-btn";
      btn.textContent = "Copy";
      btn.addEventListener("click", () => {
        const code = pre.querySelector("code");
        const text = (code || pre).textContent;
        navigator.clipboard.writeText(text).then(() => {
          btn.textContent = "Copied!";
          setTimeout(() => { btn.textContent = "Copy"; }, 1500);
        });
      });
      pre.appendChild(btn);
    });
  }

  function copyText(text) {
    if (navigator.clipboard?.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise((resolve, reject) => {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.top = "-9999px";
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand("copy");
        resolve();
      } catch (err) {
        reject(err);
      } finally {
        textarea.remove();
      }
    });
  }

  function createMessageToolbar(copyTextValue) {
    const toolbar = document.createElement("div");
    toolbar.className = "message-toolbar";

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "message-toolbar-btn";
    copyBtn.textContent = "复制";

    if (!copyTextValue) {
      copyBtn.disabled = true;
    } else {
      copyBtn.addEventListener("click", async () => {
        const originalText = copyBtn.textContent;
        try {
          await copyText(copyTextValue);
          copyBtn.textContent = "已复制";
        } catch (err) {
          console.error("Copy failed:", err);
          copyBtn.textContent = "复制失败";
        }
        setTimeout(() => {
          copyBtn.textContent = originalText;
        }, 1500);
      });
    }

    toolbar.appendChild(copyBtn);
    return toolbar;
  }

  // Reliable touch detection: add class to <html> so CSS can target it
  // More reliable than @media (hover: none) on real Android/iOS devices
  if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
    document.documentElement.classList.add('touch-device');
  }

  // ---- Elements ----
  const menuBtn = document.getElementById("menuBtn");
  const sidebarOverlay = document.getElementById("sidebarOverlay");
  const closeSidebar = document.getElementById("closeSidebar");
  const collapseBtn = document.getElementById("collapseBtn");
  const sessionList = document.getElementById("sessionList");
  const newSessionBtn = document.getElementById("newSessionBtn");
  const newSessionModal = document.getElementById("newSessionModal");
  const folderInput = document.getElementById("folderInput");
  const folderSuggestions = document.getElementById("folderSuggestions");

  const toolSelect = document.getElementById("toolSelect");
  const cancelModal = document.getElementById("cancelModal");
  const createSessionBtn = document.getElementById("createSession");
  const messagesEl = document.getElementById("messages");
  const messagesInner = document.getElementById("messagesInner");
  const emptyState = document.getElementById("emptyState");
  const msgInput = document.getElementById("msgInput");
  const sendBtn = document.getElementById("sendBtn");
  const headerTitle = document.getElementById("headerTitle");
  const headerLeft = headerTitle.closest(".header-left");
  const statusText = document.getElementById("statusText");
  const imgBtn = document.getElementById("imgBtn");
  const imgFileInput = document.getElementById("imgFileInput");
  const imgPreviewStrip = document.getElementById("imgPreviewStrip");
  const inlineToolSelect = document.getElementById("inlineToolSelect");
  const inlineModelSelect = document.getElementById("inlineModelSelect");
  const thinkingToggle = document.getElementById("thinkingToggle");
  const cancelBtn = document.getElementById("cancelBtn");
  const quickReplies = document.getElementById("quickReplies");
  const tabSessions = document.getElementById("tabSessions");
  const tabProgress = document.getElementById("tabProgress");
  const tabTasks = document.getElementById("tabTasks");
  const progressPanel = document.getElementById("progressPanel");
  const taskPanel = document.getElementById("taskPanel");
  const workflowView = document.getElementById("workflowView");
  const headerCtx = document.getElementById("headerCtx");
  const headerCtxDetail = document.getElementById("headerCtxDetail");
  const headerCtxFill = document.getElementById("headerCtxFill");
  const headerCtxPct = document.getElementById("headerCtxPct");
  const headerCtxCompress = document.getElementById("headerCtxCompress");
  const headerCtxClear = document.getElementById("headerCtxClear");
  const floatingLogo = document.getElementById("floatingLogo");
  const headerLogo = document.getElementById("headerLogo");

  let ws = null;
  let pendingAttachments = [];
  let currentSessionId = null;
  let sessionStatus = "idle";
  let reconnectTimer = null;
  let sessions = [];
  let workflowSessions = []; // hidden sessions created by workflow engine
  let archivedSessions = []; // archived sessions (hidden from main list)
  let knownFolders = new Set(); // all folders ever seen (active + archived) — avoids O(n) scan per render
  let showArchived = false;
  let currentHistory = []; // raw events for current session (used by Recover)
  let currentQueuedMessages = [];
  let sessionContextTotal = 0; // latest total context tokens (input + cache)
  let pendingSummary = new Set(); // sessionIds awaiting summary generation
  let currentTaskDetailId = null; // currently viewed task in main content area
  let taskDetailCountdownInterval = null; // interval for next-run countdown in task detail panel
  let activeRunPollInterval = null; // interval for polling a live run's status
  let lastSidebarUpdatedAt = {}; // sessionId -> last known updatedAt

  let sessionLastMessage = {}; // sessionId -> last sent message text
  let pendingClearedBanner = false; // show cleared banner on next history load
  let sessionLabels = []; // loaded from /api/session-labels

  let selectedTool = localStorage.getItem("selectedTool") || null;
  let selectedModel = localStorage.getItem("selectedModel") || "";
  // Default thinking to enabled; only disable if explicitly set to 'false'
  let thinkingEnabled = localStorage.getItem("thinkingEnabled") !== "false";
  let sidebarCollapsed = localStorage.getItem("sidebarCollapsed") === "true";
  let themeMode = localStorage.getItem("themeMode") || "auto"; // 'auto' | 'dark' | 'light'
  let selectedThemeId = localStorage.getItem("selectedTheme") || "classic";
  const settingsBtn = document.getElementById("settingsBtn");
  const themeBtn = document.getElementById("themeBtn");
  const themePicker = document.getElementById("themePicker");
  const settingsView = document.getElementById("settingsView");
  const settingsBackBtn = document.getElementById("settingsBackBtn");
  const settingsSaveStatus = document.getElementById("settingsSaveStatus");
  const automationSave = document.getElementById("automationSave");
  const automationChatTool = document.getElementById("automationChatTool");
  const automationChatCodexModelField = document.getElementById("automationChatCodexModelField");
  const automationChatCodexModel = document.getElementById("automationChatCodexModel");
  const automationChatClaudeModelField = document.getElementById("automationChatClaudeModelField");
  const automationChatClaudeModel = document.getElementById("automationChatClaudeModel");
  const automationChatNamingTool = document.getElementById("automationChatNamingTool");
  const automationChatNamingModel = document.getElementById("automationChatNamingModel");
  const automationWorkflowTool = document.getElementById("automationWorkflowTool");
  const automationWorkflowModel = document.getElementById("automationWorkflowModel");
  const automationWorkflowForceModel = document.getElementById("automationWorkflowForceModel");
  const automationSessionMessageTool = document.getElementById("automationSessionMessageTool");
  const automationSessionMessageModel = document.getElementById("automationSessionMessageModel");
  const automationSessionMessageForceModel = document.getElementById("automationSessionMessageForceModel");
  const workflowOverrideList = document.getElementById("workflowOverrideList");
  const scheduleOverrideList = document.getElementById("scheduleOverrideList");
  let themePickerOpen = false;
  let toolsList = [];
  let availableWorkflows = [];
  let availableSchedules = [];
  let activeMainView = "chat";
  const modelCatalogCache = new Map();
  let isDesktop = window.matchMedia("(min-width: 768px)").matches;
  let collapsedFolders = JSON.parse(
    localStorage.getItem("collapsedFolders") || "{}",
  );

  // Thinking block state
  let currentThinkingBlock = null; // { el, body, tools: Set }
  let inThinkingBlock = false;
  let queuedFollowUpsEl = null;

  // ---- Files tab state & elements ----
  const sessionTabs = document.getElementById("sessionTabs");
  const sessionTabChat = document.getElementById("sessionTabChat");
  const sessionTabFiles = document.getElementById("sessionTabFiles");
  const filesView = document.getElementById("filesView");
  const filesTree = document.getElementById("filesTree");
  const filesContent = document.getElementById("filesContent");
  let activeSessionTab = "chat"; // "chat" | "files" | "git"
  let fileTreeCache = {}; // folder -> tree data
  let selectedFilePath = null;
  let isFileEditing = false;
  let rawFileContent = null; // original content for edit mode
  let suppressHashPush = false; // flag to prevent pushState during popstate restore

  // ---- Git tab state & elements ----
  const sessionTabGit = document.getElementById("sessionTabGit");
  const gitView = document.getElementById("gitView");
  const gitChanges = document.getElementById("gitChanges");
  const gitHistory = document.getElementById("gitHistory");
  const gitBranches = document.getElementById("gitBranches");
  let activeGitSubTab = "changes"; // "changes" | "history" | "branches"

  // ---- Browser Notifications ----
  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission();
  }

  function notifyCompletion(session) {
    if (!("Notification" in window) || Notification.permission !== "granted")
      return;
    if (document.visibilityState === "visible") return;
    const folder = (session?.folder || "").split("/").pop() || "Session";
    const lastMsg = sessionLastMessage[session?.id] || "";
    const snippet = lastMsg.length > 60 ? lastMsg.slice(0, 60) + "…" : lastMsg;
    const body = snippet ? `${folder}: ${snippet}` : `${folder} — task completed`;
    const n = new Notification("RemoteLab", {
      body,
      tag: "remotelab-done",
    });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  }

  // ---- Theme ----
  function isDarkByTime() {
    const h = new Date().getHours();
    return h < 7 || h >= 19;
  }

  function getThemeById(id) {
    return (typeof THEMES !== "undefined" ? THEMES : []).find((t) => t.id === id);
  }

  function applyTheme() {
    const dark = themeMode === "dark" || (themeMode === "auto" && isDarkByTime());
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");

    // Apply selected theme's CSS variables
    const theme = getThemeById(selectedThemeId);
    if (theme) {
      const vars = dark ? theme.dark : theme.light;
      const root = document.documentElement;
      for (const [k, v] of Object.entries(vars)) {
        root.style.setProperty(k, v);
      }

      // Theme class for extra CSS (glass backdrop-filter, github font)
      root.classList.remove("theme-glass", "theme-github");
      if (theme.id === "glass") root.classList.add("theme-glass");
      else if (theme.id === "github") root.classList.add("theme-github");

      // Load Google Font if needed
      if (theme.fontUrl && !document.getElementById("theme-font-" + theme.id)) {
        const link = document.createElement("link");
        link.id = "theme-font-" + theme.id;
        link.rel = "stylesheet";
        link.href = theme.fontUrl;
        document.head.appendChild(link);
      }
    }

    // Update button icon
    const icons = { auto: "◑", dark: "●", light: "○" };
    themeBtn.textContent = icons[themeMode];
    themeBtn.title = (theme ? theme.name + " — " : "") + { auto: "自动", dark: "深色", light: "浅色" }[themeMode];

    // Update picker UI if open
    if (themePickerOpen) renderThemePicker();
  }

  function selectTheme(id) {
    selectedThemeId = id;
    localStorage.setItem("selectedTheme", id);
    applyTheme();
  }

  function setThemeMode(mode) {
    themeMode = mode;
    localStorage.setItem("themeMode", mode);
    applyTheme();
  }

  function renderThemePicker() {
    const dark = themeMode === "dark" || (themeMode === "auto" && isDarkByTime());
    const themes = typeof THEMES !== "undefined" ? THEMES : [];
    let html = "";
    for (const t of themes) {
      const isActive = t.id === selectedThemeId;
      const dots = (dark ? t.previewDark || t.preview : t.preview) || [];
      html += '<button class="theme-option' + (isActive ? " active" : "") + '" data-theme-id="' + t.id + '">';
      html += '<span class="theme-option-colors">';
      for (const c of dots) {
        html += '<span class="theme-option-dot" style="background:' + c + '"></span>';
      }
      html += "</span>";
      html += '<span class="theme-option-info">';
      html += '<span class="theme-option-name">' + t.name + (isActive ? ' <span class="check">✓</span>' : "") + "</span>";
      html += '<span class="theme-option-desc">' + t.description + "</span>";
      html += "</span></button>";
    }
    html += '<div class="theme-picker-divider"></div>';
    html += '<div class="theme-mode-row">';
    for (const [m, label] of [["auto", "◑ 自动"], ["light", "○ 浅色"], ["dark", "● 深色"]]) {
      html += '<button class="theme-mode-btn' + (themeMode === m ? " active" : "") + '" data-mode="' + m + '">' + label + "</button>";
    }
    html += "</div>";
    themePicker.innerHTML = html;
  }

  function toggleThemePicker() {
    themePickerOpen = !themePickerOpen;
    if (themePickerOpen) {
      renderThemePicker();
      themePicker.classList.add("open");
    } else {
      themePicker.classList.remove("open");
    }
  }

  // Close picker on outside click
  document.addEventListener("click", function (e) {
    if (themePickerOpen && !e.target.closest(".theme-picker-wrap")) {
      themePickerOpen = false;
      themePicker.classList.remove("open");
    }
  });

  // Delegate clicks inside picker
  themePicker.addEventListener("click", function (e) {
    const opt = e.target.closest("[data-theme-id]");
    if (opt) { selectTheme(opt.dataset.themeId); return; }
    const modeBtn = e.target.closest("[data-mode]");
    if (modeBtn) { setThemeMode(modeBtn.dataset.mode); }
  });

  // ---- Responsive layout ----
  function initResponsiveLayout() {
    const mq = window.matchMedia("(min-width: 768px)");
    function onBreakpointChange(e) {
      isDesktop = e.matches;
      if (isDesktop) {
        sidebarOverlay.classList.remove("open");
        if (sidebarCollapsed) sidebarOverlay.classList.add("collapsed");
      } else {
        sidebarOverlay.classList.remove("collapsed");
      }
    }
    mq.addEventListener("change", onBreakpointChange);
    onBreakpointChange(mq);
  }

  // ---- Thinking toggle ----
  function updateThinkingUI() {
    thinkingToggle.classList.toggle("active", thinkingEnabled);
  }
  updateThinkingUI();

  thinkingToggle.addEventListener("click", () => {
    thinkingEnabled = !thinkingEnabled;
    localStorage.setItem("thinkingEnabled", thinkingEnabled);
    updateThinkingUI();
  });

  // ---- Sidebar collapse (desktop) ----
  collapseBtn.addEventListener("click", () => {
    sidebarCollapsed = !sidebarCollapsed;
    localStorage.setItem("sidebarCollapsed", sidebarCollapsed);
    sidebarOverlay.classList.toggle("collapsed", sidebarCollapsed);
  });

  let chatDefaults = {
    defaultTool: "codex",
    codexModel: "gpt-5.4",
    claudeModel: "opus[1m]",
    namingTool: "codex",
    namingModel: "gpt-5.4-mini",
  };
  let automationDefaults = {
    workflowTool: "codex",
    workflowModel: "gpt-5.4",
    workflowForceModel: false,
    sessionMessageTool: "inherit",
    sessionMessageModel: "gpt-5.4",
    sessionMessageForceModel: false,
  };
  let automationOverrides = {
    workflowOverrides: {},
    scheduleOverrides: {},
  };

  // ---- Inline tool select ----
  async function loadInlineTools() {
    try {
      const res = await fetch("/api/tools");
      const data = await res.json();
      toolsList = (data.tools || []).filter((t) => t.available);
      inlineToolSelect.innerHTML = "";
      for (const t of toolsList) {
        const opt = document.createElement("option");
        opt.value = t.id;
        opt.textContent = t.name;
        inlineToolSelect.appendChild(opt);
      }
      if (selectedTool && toolsList.some((t) => t.id === selectedTool)) {
        inlineToolSelect.value = selectedTool;
      } else if (toolsList.length > 0) {
        const preferredTool = toolsList.some((t) => t.id === chatDefaults.defaultTool)
          ? chatDefaults.defaultTool
          : toolsList[0].id;
        selectedTool = preferredTool;
        inlineToolSelect.value = selectedTool;
        localStorage.setItem("selectedTool", selectedTool);
      }
    } catch {}
  }

  inlineToolSelect.addEventListener("change", () => {
    selectedTool = inlineToolSelect.value;
    localStorage.setItem("selectedTool", selectedTool);
    loadInlineModels(selectedTool);
  });

  // ---- Inline model select ----
  const CLAUDE_DEFAULT_MODEL = "opus[1m]";

  async function fetchModelCatalog(toolId, { refresh = false } = {}) {
    const normalizedTool = toolId || "";
    if (!refresh && modelCatalogCache.has(normalizedTool)) {
      return modelCatalogCache.get(normalizedTool);
    }
    const request = fetch(`/api/models?tool=${encodeURIComponent(normalizedTool)}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        modelCatalogCache.set(normalizedTool, data);
        return data;
      });
    if (!refresh) {
      modelCatalogCache.set(normalizedTool, request);
    }
    return request;
  }

  function normalizeModelRecords(models) {
    return (models || []).map((model) => ({
      id: model.id,
      name: model.label || model.name || model.id,
    }));
  }

  function populateModelSelect(models, tool, serverDefault, sessionModel) {
    const storageKey = `selectedModel_${tool || "claude"}`;
    const saved = localStorage.getItem(storageKey);

    inlineModelSelect.innerHTML = "";
    for (const m of models) {
      const opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = m.label || m.name || m.id;
      inlineModelSelect.appendChild(opt);
    }
    // Priority: session-persisted > localStorage > server default > first item
    const preferred = (sessionModel && models.some((m) => m.id === sessionModel) ? sessionModel : null)
      || saved || serverDefault;
    if (preferred && models.some((m) => m.id === preferred)) {
      inlineModelSelect.value = preferred;
      selectedModel = preferred;
    } else if (models.length > 0) {
      selectedModel = models[0].id;
      inlineModelSelect.value = selectedModel;
      localStorage.setItem(storageKey, selectedModel);
    }
  }

  async function loadInlineModels(tool, sessionModel) {
    const activeTool = tool || selectedTool;
    try {
      const data = await fetchModelCatalog(activeTool);
      const models = normalizeModelRecords(data.models);
      if (models.length > 0) {
        populateModelSelect(models, activeTool, data.defaultModel || data.default, sessionModel);
        return;
      }
    } catch {}
    const fallback = activeTool === "claude"
      ? [{ id: chatDefaults.claudeModel || CLAUDE_DEFAULT_MODEL, name: chatDefaults.claudeModel || CLAUDE_DEFAULT_MODEL }]
      : [{ id: chatDefaults.codexModel, name: chatDefaults.codexModel }];
    const fallbackDefault = activeTool === "claude"
      ? (chatDefaults.claudeModel || CLAUDE_DEFAULT_MODEL)
      : chatDefaults.codexModel;
    populateModelSelect(fallback, activeTool, fallbackDefault, sessionModel);
  }

  inlineModelSelect.addEventListener("change", () => {
    selectedModel = inlineModelSelect.value;
    const storageKey = `selectedModel_${selectedTool || "claude"}`;
    localStorage.setItem(storageKey, selectedModel);
  });

  // ---- WebSocket ----
  function connect() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(`${proto}//${location.host}/ws`);

    ws.onopen = () => {
      updateStatus("connected", "idle");
      const restartBanner = document.getElementById("restart-banner");
      if (restartBanner) restartBanner.remove();
      // Check if there's still a pending restart after reconnect
      fetch("/api/restart/pending").then(r => r.json()).then(data => {
        if (data.pending) showPendingRestartBanner(null, data.requestedAt);
        else removePendingRestartBanner();
      }).catch(() => {});
      ws.send(JSON.stringify({ action: "list" }));
      if (currentSessionId) {
        ws.send(
          JSON.stringify({ action: "attach", sessionId: currentSessionId }),
        );
      }
    };

    ws.onmessage = (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      handleWsMessage(msg);
    };

    ws.onclose = () => {
      updateStatus("disconnected", "idle");
      scheduleReconnect();
    };

    ws.onerror = () => ws.close();
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, 3000);
  }

  function wsSend(msg) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  function handleWsMessage(msg) {
    switch (msg.type) {
      case "sessions":
        // Filter: hidden → workflow engine sessions; archived → includes disposable task runs
        sessions = (msg.sessions || []).filter(s => !s.hidden && !s.archived);
        workflowSessions = (msg.sessions || []).filter(s => s.hidden);
        archivedSessions = (msg.sessions || []).filter(s => !s.hidden && s.archived);
        rebuildKnownFolders();
        renderSessionList();
        // Handle ?open=<absolute_path> deep link to preview a file
        handleOpenFileParam();
        // Handle #s/<sessionId>[/files/<path>] hash on initial load
        handleHashOnLoad();
        break;

      case "session":
        if (msg.session) {
          const isHidden = !!msg.session.hidden;
          const isArchived = !!msg.session.archived;
          // Save original position before removing (to preserve list order on updates)
          const prevSessionIdx = sessions.findIndex(s => s.id === msg.session.id);
          const prevEntry = sessions.find(s => s.id === msg.session.id)
            || archivedSessions.find(s => s.id === msg.session.id)
            || workflowSessions.find(s => s.id === msg.session.id);
          // Determine target array and remove from any other array to handle moves
          if (!isHidden) {
            sessions = sessions.filter(s => s.id !== msg.session.id);
            archivedSessions = archivedSessions.filter(s => s.id !== msg.session.id);
          }
          const targetArr = isHidden ? workflowSessions : (isArchived ? archivedSessions : sessions);
          const prevStatus = sessionStatus;
          sessionStatus = msg.session.status || "idle";
          updateStatus("connected", sessionStatus);
          const wasRunning = prevEntry?.status === "running";
          if (
            msg.session.id === currentSessionId &&
            prevStatus === "running" &&
            sessionStatus === "idle"
          ) {
            notifyCompletion(msg.session);
          }
          // Mark as pending summary when any session goes running → idle
          if (wasRunning && msg.session.status === "idle") {
            pendingSummary.add(msg.session.id);
            if (activeTab === "progress") renderProgressPanel();
          }
          const idx = targetArr.findIndex((s) => s.id === msg.session.id);
          if (idx >= 0) {
            targetArr[idx] = msg.session;
          } else if (prevSessionIdx >= 0 && targetArr === sessions) {
            // Re-insert at original position to prevent reordering on update
            sessions.splice(prevSessionIdx, 0, msg.session);
          } else if (targetArr === archivedSessions) {
            // Newest archived first — prepend so recently archived sessions appear at top
            targetArr.unshift(msg.session);
          } else {
            targetArr.push(msg.session);
          }
          rebuildKnownFolders();
          // Update header title if current session was renamed (e.g. auto-title)
          if (msg.session.id === currentSessionId && msg.session.name) {
            headerTitle.textContent = msg.session.name;
          }
          if (msg.session.id === currentSessionId) {
            currentQueuedMessages = Array.isArray(msg.session.queuedMessages) ? msg.session.queuedMessages : [];
            renderQueuedFollowUps();
          }
          if (isHidden) {
            // workflow sessions update silently; task section refreshes on demand
          } else {
            renderSessionList();
          }
        }
        break;

      case "history":
        if (pendingClearedBanner) {
          pendingClearedBanner = false;
          renderSessionClearedBanner();
        } else {
          clearMessages();
        }
        if (msg.events && msg.events.length > 0) {
          currentHistory = [...msg.events];
          for (const evt of msg.events) renderEvent(evt, false);
        }
        renderQueuedFollowUps();
        scrollToBottom();
        break;

      case "event":
        if (msg.event) {
          currentHistory.push(msg.event);
          renderEvent(msg.event, true);
          renderQueuedFollowUps();
        }
        break;

      case "deleted":
        sessions = sessions.filter((s) => s.id !== msg.sessionId);
        workflowSessions = workflowSessions.filter((s) => s.id !== msg.sessionId);
        archivedSessions = archivedSessions.filter((s) => s.id !== msg.sessionId);
        rebuildKnownFolders();
        if (currentSessionId === msg.sessionId) {
          currentSessionId = null;
          clearMessages();
          showEmpty();
        }
        renderSessionList();
        break;

      case "compact":
        // Server says: session compacted, switch to new session
        if (msg.newSessionId && msg.oldSessionId === currentSessionId) {
          console.log(`[compact] Switching from ${msg.oldSessionId.slice(0,8)} to ${msg.newSessionId.slice(0,8)}`);
          // Refresh session list, then attach to new session
          wsSend({ action: "list" });
          const compactHandler = (ev) => {
            let m; try { m = JSON.parse(ev.data); } catch { return; }
            if (m.type === "sessions") {
              ws.removeEventListener("message", compactHandler);
              sessions = m.sessions || [];
              renderSessionList();
              const newSess = sessions.find(s => s.id === msg.newSessionId);
              if (newSess) attachSession(newSess.id, newSess);
            }
          };
          ws.addEventListener("message", compactHandler);
        }
        break;

      case "report:new":
        if (msg.report) reportManager.handleNewReport(msg.report);
        break;

      case "server_restart":
        showRestartBanner(msg.message);
        break;

      case "pending_restart":
        showPendingRestartBanner(msg.message, msg.requestedAt);
        break;

      case "pending_restart_cancelled":
        removePendingRestartBanner();
        break;

      case "error":
        console.error("WS error:", msg.message);
        break;
    }
  }

  function showRestartBanner(message) {
    const existing = document.getElementById("restart-banner");
    if (existing) existing.remove();
    removePendingRestartBanner();
    const banner = document.createElement("div");
    banner.id = "restart-banner";
    banner.className = "restart-banner";
    banner.textContent = message || "Server is restarting...";
    document.body.appendChild(banner);
  }

  function showPendingRestartBanner(message, requestedAt) {
    removePendingRestartBanner();
    const banner = document.createElement("div");
    banner.id = "pending-restart-banner";
    banner.className = "pending-restart-banner";

    const textSpan = document.createElement("span");
    textSpan.textContent = message || "Waiting for all sessions to finish before restarting...";
    banner.appendChild(textSpan);

    const btnGroup = document.createElement("span");
    btnGroup.className = "pending-restart-actions";

    const restartBtn = document.createElement("button");
    restartBtn.className = "pending-restart-btn restart-now";
    restartBtn.textContent = "Restart Now";
    restartBtn.onclick = async () => {
      restartBtn.disabled = true;
      restartBtn.textContent = "Restarting...";
      try {
        await fetch("/api/restart", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "immediate" }),
        });
      } catch {}
    };

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "pending-restart-btn cancel-restart";
    cancelBtn.textContent = "Cancel";
    cancelBtn.onclick = async () => {
      try {
        await fetch("/api/restart/pending", { method: "DELETE" });
      } catch {}
      removePendingRestartBanner();
    };

    btnGroup.appendChild(restartBtn);
    btnGroup.appendChild(cancelBtn);
    banner.appendChild(btnGroup);
    document.body.appendChild(banner);
  }

  function removePendingRestartBanner() {
    const existing = document.getElementById("pending-restart-banner");
    if (existing) existing.remove();
  }

  function renderRestartDivider(text, extraClass) {
    if (inThinkingBlock) finalizeThinkingBlock();
    const div = document.createElement("div");
    div.className = `restart-divider ${extraClass}`;
    div.innerHTML = `<span class="restart-divider-text">${text}</span>`;
    messagesInner.appendChild(div);
    scrollToBottom();
  }

  function renderSystemNotification(evt) {
    if (inThinkingBlock) finalizeThinkingBlock();
    const wrap = document.createElement("div");
    wrap.className = "sys-notif collapsed";

    const header = document.createElement("div");
    header.className = "sys-notif-header";
    // Show first line of content as preview
    const preview = (evt.content || "").split("\n")[0].slice(0, 80);
    header.innerHTML = `<span class="sys-notif-icon">&#x1F916;</span><span class="sys-notif-label">${escapeHtml(preview)}</span><span class="sys-notif-chevron">&#9660;</span>`;

    const body = document.createElement("div");
    body.className = "sys-notif-body";
    body.textContent = evt.content || "";

    header.addEventListener("click", () => {
      wrap.classList.toggle("collapsed");
    });

    wrap.appendChild(header);
    wrap.appendChild(body);
    messagesInner.appendChild(wrap);
  }

  // ---- Status ----
  function updateStatus(connState, sessState) {
    if (connState === "disconnected") {
      headerLogo.classList.remove("active");
      statusText.textContent = "disconnected";
      msgInput.disabled = true;
      sendBtn.style.display = "";
      sendBtn.disabled = true;
      cancelBtn.style.display = "none";
      floatingLogo.classList.remove("active");
      return;
    }
    sessionStatus = sessState;
    const isRunning = sessState === "running";
    headerLogo.classList.toggle("active", isRunning);
    statusText.textContent = isRunning ? "running" : (currentSessionId ? "idle" : "connected");
    const hasSession = !!currentSessionId;
    msgInput.disabled = !hasSession;
    // Keep Send available while running, but queue follow-ups instead of interrupting.
    sendBtn.style.display = "";
    sendBtn.disabled = !hasSession;
    sendBtn.title = isRunning ? "Queue follow-up" : "Send";
    cancelBtn.style.display = isRunning && hasSession ? "flex" : "none";
    msgInput.placeholder = isRunning ? "Queue a follow-up, correction, or hint..." : "Message...";
    imgBtn.disabled = !hasSession;
    inlineToolSelect.disabled = !hasSession;
    inlineModelSelect.disabled = !hasSession;
    thinkingToggle.disabled = !hasSession;
    quickReplies.style.display = hasSession && !isRunning ? "flex" : "none";
  }

  // ---- Floating logo & favicon global status ----
  const faviconEl = document.getElementById("favicon");
  const faviconCanvas = document.createElement("canvas");
  faviconCanvas.width = 64;
  faviconCanvas.height = 64;
  const faviconCtx = faviconCanvas.getContext("2d");
  let faviconAngle = 0;
  let faviconAnimating = false;
  let faviconRAF = null;

  // Build SVG image for favicon
  function makeFaviconSvg(color) {
    return `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><g stroke='${color}' stroke-width='5.5' fill='none'><circle cx='50' cy='28' r='19'/><circle cx='72' cy='50' r='19'/><circle cx='50' cy='72' r='19'/><circle cx='28' cy='50' r='19'/></g><circle cx='50' cy='50' r='4' fill='${color}'/></svg>`;
  }

  const faviconImgIdle = new Image();
  faviconImgIdle.src = "data:image/svg+xml," + encodeURIComponent(makeFaviconSvg("#6b7280"));
  const faviconImgActive = new Image();
  faviconImgActive.src = "data:image/svg+xml," + encodeURIComponent(makeFaviconSvg("#22c55e"));

  function drawFavicon(img, angle) {
    const s = 64;
    faviconCtx.clearRect(0, 0, s, s);
    faviconCtx.save();
    faviconCtx.translate(s / 2, s / 2);
    faviconCtx.rotate(angle);
    faviconCtx.drawImage(img, -s / 2, -s / 2, s, s);
    faviconCtx.restore();
    faviconEl.href = faviconCanvas.toDataURL("image/png");
  }

  function animateFavicon(ts) {
    if (!faviconAnimating) return;
    // 8s per full rotation, matching CSS logo-spin
    faviconAngle = ((ts % 8000) / 8000) * Math.PI * 2;
    drawFavicon(faviconImgActive, faviconAngle);
    faviconRAF = requestAnimationFrame(animateFavicon);
  }

  function startFaviconSpin() {
    if (faviconAnimating) return;
    faviconAnimating = true;
    faviconRAF = requestAnimationFrame(animateFavicon);
  }

  function stopFaviconSpin() {
    faviconAnimating = false;
    if (faviconRAF) { cancelAnimationFrame(faviconRAF); faviconRAF = null; }
    faviconAngle = 0;
    drawFavicon(faviconImgIdle, 0);
  }

  function updateFloatingLogo() {
    const anyRunning = sessions.some(s => s.status === "running");
    floatingLogo.classList.toggle("active", anyRunning);
    if (anyRunning) startFaviconSpin();
    else stopFaviconSpin();
  }

  // ---- Message rendering ----
  function clearMessages() {
    messagesInner.innerHTML = "";
    // Reset thinking block state
    inThinkingBlock = false;
    currentThinkingBlock = null;
    currentHistory = [];
    sessionContextTotal = 0;
    queuedFollowUpsEl = null;
  }

  function showEmpty() {
    messagesInner.innerHTML = "";
    messagesInner.appendChild(emptyState);
    inThinkingBlock = false;
    currentThinkingBlock = null;
    currentQueuedMessages = [];
    queuedFollowUpsEl = null;
  }

  function scrollToBottom() {
    requestAnimationFrame(() => {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    });
  }

  function removeQueuedFollowUps() {
    if (queuedFollowUpsEl?.parentNode) {
      queuedFollowUpsEl.remove();
    }
    queuedFollowUpsEl = null;
  }

  function renderQueuedFollowUps() {
    removeQueuedFollowUps();
    if (!currentSessionId || !Array.isArray(currentQueuedMessages) || currentQueuedMessages.length === 0) {
      return;
    }

    const wrap = document.createElement("div");
    wrap.className = "queued-followups";

    currentQueuedMessages.forEach((queued, index) => {
      const row = document.createElement("div");
      row.className = "msg-user pending";

      const bubble = document.createElement("div");
      bubble.className = "msg-user-bubble pending";

      const badge = document.createElement("div");
      badge.className = "queued-followup-badge";
      badge.textContent = currentQueuedMessages.length > 1
        ? `Pending follow-up ${index + 1}`
        : "Pending follow-up";
      bubble.appendChild(badge);

      const messageAttachments = Array.isArray(queued?.attachments) ? queued.attachments : [];
      if (messageAttachments.length > 0) {
        const imgWrap = document.createElement("div");
        imgWrap.className = "msg-images";
        for (const attachment of messageAttachments) {
          const node = createMessageAttachmentNode(attachment);
          if (node) imgWrap.appendChild(node);
        }
        bubble.appendChild(imgWrap);
      }

      if (queued?.text) {
        const span = document.createElement("span");
        span.textContent = queued.text;
        bubble.appendChild(span);
      } else if (messageAttachments.length === 0) {
        const span = document.createElement("span");
        span.textContent = "(empty follow-up)";
        bubble.appendChild(span);
      }

      row.appendChild(bubble);
      wrap.appendChild(row);
    });

    queuedFollowUpsEl = wrap;
    messagesInner.appendChild(wrap);
  }

  function renderEvent(evt, autoScroll) {
    if (emptyState.parentNode === messagesInner) emptyState.remove();

    const shouldScroll =
      autoScroll &&
      messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight <
        120;

    switch (evt.type) {
      case "message":
        renderMessage(evt);
        break;
      case "tool_use":
        renderToolUse(evt);
        break;
      case "tool_result":
        renderToolResult(evt);
        break;
      case "file_change":
        renderFileChange(evt);
        break;
      case "reasoning":
        renderReasoning(evt);
        break;
      case "status":
        renderStatusMsg(evt);
        break;
      case "usage":
        renderUsage(evt);
        break;
      case "question":
        renderQuestion(evt, !autoScroll);
        break;
      case "plan_approval":
        renderPlanApproval(evt, !autoScroll);
        break;
      case "session_error":
        renderSessionError(evt);
        break;
      case "compact":
        renderCompactDivider(evt);
        break;
      case "restart_interrupt":
        renderRestartDivider("\u26a1 Server restarting \u2014 session will resume automatically", "restart-interrupt-divider");
        break;
      case "restart_resume":
        renderRestartDivider("\u2713 Server restarted \u2014 continuing your work...", "restart-resume-divider");
        break;
      case "system_notification":
        renderSystemNotification(evt);
        break;
    }

    if (shouldScroll) scrollToBottom();
  }

  // ---- Thinking block helpers ----
  function openThinkingBlock() {
    const block = document.createElement("div");
    block.className = "thinking-block collapsed"; // collapsed by default

    const header = document.createElement("div");
    header.className = "thinking-header";
    header.innerHTML = `<span class="thinking-icon">&#9881;</span>
      <span class="thinking-label">Thinking…</span>
      <span class="thinking-chevron">&#9660;</span>`;

    const body = document.createElement("div");
    body.className = "thinking-body";

    header.addEventListener("click", () => {
      block.classList.toggle("collapsed");
    });

    block.appendChild(header);
    block.appendChild(body);
    messagesInner.appendChild(block);

    currentThinkingBlock = {
      el: block,
      header,
      body,
      label: header.querySelector(".thinking-label"),
      tools: new Set(),
    };
    inThinkingBlock = true;
  }

  function finalizeThinkingBlock() {
    if (!currentThinkingBlock) return;
    const { label, tools } = currentThinkingBlock;
    const toolList = [...tools];
    if (toolList.length > 0) {
      label.textContent = `Thought · used ${toolList.join(", ")}`;
    } else {
      label.textContent = "Thought";
    }
    inThinkingBlock = false;
    currentThinkingBlock = null;
  }

  function getThinkingBody() {
    if (!inThinkingBlock) openThinkingBlock();
    return currentThinkingBlock.body;
  }

  function getAttachmentDisplayName(attachment) {
    return attachment?.originalName || attachment?.filename || "attachment";
  }

  function getAttachmentSource(attachment) {
    return attachment?.url || attachment?.downloadUrl || (attachment?.filename && currentSessionId
      ? `/api/sessions/${encodeURIComponent(currentSessionId)}/attachments/${encodeURIComponent(attachment.filename)}`
      : "");
  }

  function getAttachmentDownloadSource(attachment) {
    return attachment?.downloadUrl || getAttachmentSource(attachment);
  }

  function getAttachmentKind(attachment) {
    const mimeType = attachment?.mimeType || "";
    if (attachment?.renderAs === "file") return "file";
    if (mimeType.startsWith("image/")) return "image";
    return "file";
  }

  function formatAttachmentSize(sizeBytes) {
    const size = Number(sizeBytes);
    if (!Number.isFinite(size) || size <= 0) return "";
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }

  function createMessageAttachmentNode(attachment) {
    const kind = getAttachmentKind(attachment);
    const source = getAttachmentSource(attachment);
    const downloadSource = getAttachmentDownloadSource(attachment);
    if (!source) return null;

    if (kind === "image") {
      const imgEl = document.createElement("img");
      imgEl.src = source;
      imgEl.alt = getAttachmentDisplayName(attachment);
      imgEl.loading = "lazy";
      imgEl.onclick = () => window.open(source, "_blank");
      return imgEl;
    }

    const link = document.createElement("a");
    link.className = "attachment-file-card";
    link.href = downloadSource;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    const name = document.createElement("div");
    name.className = "attachment-file-card-name";
    name.textContent = getAttachmentDisplayName(attachment);
    const meta = document.createElement("div");
    meta.className = "attachment-file-card-meta";
    const metaParts = [attachment?.mimeType || "file", formatAttachmentSize(attachment?.sizeBytes)].filter(Boolean);
    meta.textContent = metaParts.join(" · ");
    link.appendChild(name);
    link.appendChild(meta);
    return link;
  }

  // ---- Render functions ----
  function renderMessage(evt) {
    const role = evt.role || "assistant";
    const messageText = typeof evt.content === "string" ? evt.content : "";

    if (role === "assistant" && inThinkingBlock) {
      finalizeThinkingBlock();
    }

    if (role === "user") {
      const wrap = document.createElement("div");
      wrap.className = "msg-user";
      const bubble = document.createElement("div");
      bubble.className = "msg-user-bubble";
      const messageAttachments = Array.isArray(evt.attachments) && evt.attachments.length > 0
        ? evt.attachments
        : evt.images || [];
      if (messageAttachments.length > 0) {
        const imgWrap = document.createElement("div");
        imgWrap.className = "msg-images";
        for (const attachment of messageAttachments) {
          const node = createMessageAttachmentNode(attachment);
          if (node) imgWrap.appendChild(node);
        }
        bubble.appendChild(imgWrap);
      }
      if (evt.content) {
        const span = document.createElement("span");
        span.textContent = evt.content;
        bubble.appendChild(span);
      }
      bubble.appendChild(createMessageToolbar(messageText));
      wrap.appendChild(bubble);
      messagesInner.appendChild(wrap);
    } else {
      const div = document.createElement("div");
      div.className = "msg-assistant md-content";
      const messageAttachments = Array.isArray(evt.attachments) && evt.attachments.length > 0
        ? evt.attachments
        : evt.images || [];
      if (messageAttachments.length > 0) {
        const attachmentWrap = document.createElement("div");
        attachmentWrap.className = "msg-images";
        for (const attachment of messageAttachments) {
          const node = createMessageAttachmentNode(attachment);
          if (node) attachmentWrap.appendChild(node);
        }
        div.appendChild(attachmentWrap);
      }
      if (evt.content) {
        const contentWrap = document.createElement("div");
        contentWrap.innerHTML = marked.parse(evt.content);
        addCopyButtons(contentWrap);
        div.appendChild(contentWrap);
      }
      div.appendChild(createMessageToolbar(messageText));
      messagesInner.appendChild(div);
    }
  }

  function renderToolUse(evt) {
    const container = getThinkingBody();
    if (currentThinkingBlock && evt.toolName) {
      currentThinkingBlock.tools.add(evt.toolName);
    }

    const card = document.createElement("div");
    card.className = "tool-card";

    const header = document.createElement("div");
    header.className = "tool-header";
    header.innerHTML = `<span class="tool-name">${esc(evt.toolName || "tool")}</span>
      <span class="tool-toggle">&#9654;</span>`;

    const body = document.createElement("div");
    body.className = "tool-body";
    body.id = "tool_" + evt.id;
    const pre = document.createElement("pre");
    pre.textContent = evt.toolInput || "";
    body.appendChild(pre);

    header.addEventListener("click", () => {
      header.classList.toggle("expanded");
      body.classList.toggle("expanded");
    });

    card.appendChild(header);
    card.appendChild(body);
    card.dataset.toolId = evt.id;
    container.appendChild(card);
  }

  function renderToolResult(evt) {
    // Search in current thinking block body, or fall back to messagesInner
    const searchRoot =
      inThinkingBlock && currentThinkingBlock
        ? currentThinkingBlock.body
        : messagesInner;

    const cards = searchRoot.querySelectorAll(".tool-card");
    let targetCard = null;
    for (let i = cards.length - 1; i >= 0; i--) {
      if (!cards[i].querySelector(".tool-result")) {
        targetCard = cards[i];
        break;
      }
    }

    if (targetCard) {
      const body = targetCard.querySelector(".tool-body");
      const label = document.createElement("div");
      label.className = "tool-result-label";
      label.innerHTML =
        "Result" +
        (evt.exitCode !== undefined
          ? `<span class="exit-code ${evt.exitCode === 0 ? "ok" : "fail"}">${evt.exitCode === 0 ? "exit 0" : "exit " + evt.exitCode}</span>`
          : "");
      const pre = document.createElement("pre");
      pre.className = "tool-result";
      pre.textContent = evt.output || "";
      body.appendChild(label);
      body.appendChild(pre);
      if (evt.exitCode && evt.exitCode !== 0) {
        targetCard.querySelector(".tool-header").classList.add("expanded");
        body.classList.add("expanded");
      }
    }
  }

  function renderFileChange(evt) {
    const container = getThinkingBody();
    const div = document.createElement("div");
    div.className = "file-card";
    const kind = evt.changeType || "edit";
    div.innerHTML = `<span class="file-path">${esc(evt.filePath || "")}</span>
      <span class="change-type ${kind}">${kind}</span>`;
    container.appendChild(div);
  }

  function renderReasoning(evt) {
    const container = getThinkingBody();
    const div = document.createElement("div");
    div.className = "reasoning";
    div.textContent = evt.content || "";
    container.appendChild(div);
  }

  function renderStatusMsg(evt) {
    if (!evt.content || evt.content === "completed" || evt.content === "thinking")
      return;
    const c = evt.content;
    // Filter out internal process-level status messages
    if (
      c === "Starting CLI..." ||
      c === "Resuming session..." ||
      c.startsWith("Waiting for CLI") ||
      c.startsWith("auto-continuing")
    )
      return;
    const div = document.createElement("div");
    div.className = "msg-system";
    div.textContent = c;
    messagesInner.appendChild(div);
  }

  const CONTEXT_WINDOW = 200000; // claude-sonnet context window
  const CONTEXT_DANGER_THRESHOLD = 0.85; // header danger threshold

  function fmtTok(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
    if (n >= 10000) return Math.round(n / 1000) + "k";
    if (n >= 1000) return (n / 1000).toFixed(1) + "k";
    return String(n);
  }

  function updateHeaderContext(input, output, cacheWrite, cacheRead) {
    // Context fill = input + cacheCreation.
    // cacheCreation accumulates the system prompt (first call) + all conversation history
    // (each subsequent call), so it ≈ the total tokens sent on the most recent API call.
    //
    // cacheRead is NOT included: it's a cumulative count of how many times previously-cached
    // content was re-read across ALL API calls in the run (e.g. system prompt re-read 9× for
    // a task with 9 tool calls = 450k), so it always exceeds the 200k window and is meaningless
    // for measuring context fill.
    const contextTotal = input + cacheWrite;
    const pct = Math.min(contextTotal / CONTEXT_WINDOW, 1);
    const pctRounded = Math.round(pct * 100);

    // Line 1: total context (what fills the window) + output
    // Line 2: breakdown — new input this call vs accumulated cache
    headerCtxDetail.textContent =
      `ctx: ${fmtTok(contextTotal)}  out: ${fmtTok(output)}\nin: ${fmtTok(input)}  +c: ${fmtTok(cacheWrite)}`;

    headerCtxFill.style.width = `${pct * 100}%`;
    headerCtxFill.className = "header-ctx-fill" +
      (pct >= CONTEXT_DANGER_THRESHOLD ? " danger" : pct >= 0.6 ? " warn" : "");

    headerCtxPct.textContent = `${pctRounded}%`;
    headerCtxPct.className = "header-ctx-pct" + (pct >= CONTEXT_DANGER_THRESHOLD ? " danger" : "");

    if (pct >= CONTEXT_DANGER_THRESHOLD) {
      headerCtxCompress.classList.add("visible");
    } else {
      headerCtxCompress.classList.remove("visible");
    }
    headerCtxClear.classList.add("visible");

    // Shrink the left section to its content width, but never collapse to 0
    headerLeft.style.flex = "0 0 auto";
    headerTitle.style.flex = "";  // clear any stale inline style on h1
    headerCtx.classList.add("visible");
  }

  function resetHeaderContext() {
    headerCtx.classList.remove("visible");
    headerCtxCompress.disabled = false;
    headerCtxCompress.textContent = "Compress";
    headerCtxClear.disabled = false;
    headerCtxClear.textContent = "Clear";
    headerLeft.style.flex = "";
  }

  headerCtxCompress.addEventListener("click", () => {
    if (!currentSessionId) return;
    wsSend({ action: "compact" });
    headerCtxCompress.disabled = true;
    headerCtxCompress.textContent = "Compressing…";
  });

  headerCtxClear.addEventListener("click", () => {
    if (!currentSessionId) return;
    const sess = sessions.find((s) => s.id === currentSessionId);
    if (!sess) return;
    if (!confirm("清空这个 Session？会创建一个全新的会话，AI 不会继承之前的对话内容。")) return;
    headerCtxClear.disabled = true;
    headerCtxClear.textContent = "Clearing…";
    pendingClearedBanner = true;
    wsSend({ action: "create", folder: sess.folder, tool: sess.tool || selectedTool, name: sess.name || "" });
    const handler = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === "session" && msg.session) {
        ws.removeEventListener("message", handler);
        attachSession(msg.session.id, msg.session);
        wsSend({ action: "list" });
      }
    };
    ws.addEventListener("message", handler);
  });

  function renderUsage(evt) {
    const input = evt.inputTokens || 0;
    const output = evt.outputTokens || 0;
    const cacheWrite = evt.cacheCreationTokens || 0;
    // cacheRead excluded: it's cumulative across all API calls in the run, not per-call context
    const total = input + cacheWrite;
    sessionContextTotal = total;

    updateHeaderContext(input, output, cacheWrite, evt.cacheReadTokens || 0);

    const div = document.createElement("div");
    div.className = "usage-info";

    const tokens = document.createElement("span");
    tokens.textContent = `ctx: ${total.toLocaleString()} · out: ${output.toLocaleString()}`;
    div.appendChild(tokens);

    messagesInner.appendChild(div);
  }

  function renderSessionClearedBanner() {
    if (emptyState.parentNode === messagesInner) emptyState.remove();
    const banner = document.createElement("div");
    banner.className = "session-cleared-banner";
    banner.innerHTML = `
      <div class="session-cleared-icon">🗑</div>
      <div class="session-cleared-title">Session 已清空</div>
      <div class="session-cleared-desc">以上消息已被清空，AI 不会继承上方任何对话内容。<br>这是一个全新的会话，请重新开始。</div>`;
    messagesInner.appendChild(banner);
  }

  function renderCompactDivider(evt) {
    if (inThinkingBlock) finalizeThinkingBlock();
    const div = document.createElement("div");
    div.className = "compact-divider";
    div.innerHTML = '<span class="compact-divider-text">Context compacted &mdash; conversation continues in a new session</span>';
    if (evt.summary) {
      const details = document.createElement("details");
      details.className = "compact-summary-details";
      const summaryEl = document.createElement("summary");
      summaryEl.textContent = "View summary";
      details.appendChild(summaryEl);
      const pre = document.createElement("pre");
      pre.className = "compact-summary-pre";
      pre.textContent = evt.summary;
      details.appendChild(pre);
      div.appendChild(details);
    }
    messagesInner.appendChild(div);
    scrollToBottom();
  }

  function renderSessionError(evt) {
    if (inThinkingBlock) finalizeThinkingBlock();
    const card = document.createElement("div");
    card.className = "interactive-card session-error-card";

    const tag = document.createElement("span");
    tag.className = "interactive-tag";
    tag.textContent = "Session Error";
    card.appendChild(tag);

    const msg = document.createElement("p");
    msg.className = "interactive-question";
    msg.textContent = "The session could not be resumed. You can delete it or recover the conversation by replaying history into a new session.";
    card.appendChild(msg);

    const actions = document.createElement("div");
    actions.className = "session-error-actions";

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "session-error-btn session-error-delete";
    deleteBtn.textContent = "Delete session";
    deleteBtn.addEventListener("click", () => {
      if (!currentSessionId) return;
      if (confirm("Delete this session?")) {
        wsSend({ action: "delete", sessionId: currentSessionId });
      }
    });

    const recoverBtn = document.createElement("button");
    recoverBtn.className = "session-error-btn session-error-recover";
    recoverBtn.textContent = "Recover conversation";
    recoverBtn.addEventListener("click", () => recoverSession(recoverBtn));

    actions.appendChild(deleteBtn);
    actions.appendChild(recoverBtn);
    card.appendChild(actions);
    messagesInner.appendChild(card);
  }

  function recoverSession(btn) {
    const currentSession = sessions.find((s) => s.id === currentSessionId);
    if (!currentSession) return;

    // Build a recovery prompt from the visible conversation history
    const lines = ["[Previous conversation for context recovery — please review and confirm ready to continue:]", ""];
    for (const e of currentHistory) {
      if (e.type === "message" && e.role === "user" && e.content) {
        lines.push(`[USER]: ${e.content}`);
      } else if (e.type === "message" && e.role === "assistant" && e.content) {
        lines.push(`[ASSISTANT]: ${e.content}`);
      }
    }
    lines.push("", "[Please confirm you have reviewed the above and are ready to continue.]");
    const recoveryPrompt = lines.join("\n");

    if (btn) { btn.disabled = true; btn.textContent = "Recovering…"; }

    // Create new session, attach, send recovery prompt
    const tool = currentSession.tool || selectedTool;
    const name = (currentSession.name || "").replace(/ \(recovered\)$/, "") + " (recovered)";
    wsSend({ action: "create", folder: currentSession.folder, tool, name });

    const handler = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.type === "session" && msg.session) {
        ws.removeEventListener("message", handler);
        attachSession(msg.session.id, msg.session);
        wsSend({ action: "list" });
        // Send the recovery prompt after attach completes (history loads first)
        setTimeout(() => {
          const m = { action: "send", text: recoveryPrompt };
          if (tool) m.tool = tool;
          m.thinking = thinkingEnabled;
          wsSend(m);
        }, 300);
      }
    };
    ws.addEventListener("message", handler);
  }

  // ---- Interactive events (AskUserQuestion / ExitPlanMode passthrough) ----

  function sendQuickReply(text) {
    if (!currentSessionId) return;
    sessionLastMessage[currentSessionId] = text;
    const msg = { action: "send", text };
    if (selectedTool) msg.tool = selectedTool;
    msg.model = selectedModel;
    msg.thinking = thinkingEnabled;
    wsSend(msg);
  }

  function renderQuestion(evt, isResolved) {
    if (inThinkingBlock) finalizeThinkingBlock();

    const questions = evt.questions;
    if (!Array.isArray(questions) || questions.length === 0) return;

    const card = document.createElement("div");
    card.className = "interactive-card question-card";

    // Per-question answer state: index -> selected labels (array for multi, single-element for single)
    const answers = questions.map(() => []);

    questions.forEach((q, qi) => {
      const section = document.createElement("div");
      section.className = "question-section";

      if (q.header) {
        const tag = document.createElement("span");
        tag.className = "interactive-tag";
        tag.textContent = q.header;
        section.appendChild(tag);
      }

      const qText = document.createElement("div");
      qText.className = "interactive-question";
      qText.textContent = q.question || "";
      section.appendChild(qText);

      const optionsWrap = document.createElement("div");
      optionsWrap.className = "interactive-options";

      const optBtns = [];
      for (const opt of (q.options || [])) {
        const btn = document.createElement("button");
        btn.className = "interactive-option-btn";
        const labelSpan = document.createElement("span");
        labelSpan.className = "option-label";
        labelSpan.textContent = opt.label;
        btn.appendChild(labelSpan);
        if (opt.description) {
          const descSpan = document.createElement("span");
          descSpan.className = "option-desc";
          descSpan.textContent = opt.description;
          btn.appendChild(descSpan);
        }
        btn.addEventListener("click", () => {
          if (card.classList.contains("submitted")) return;
          // Clear other input when option selected
          const otherIn = section.querySelector(".interactive-other-input");
          if (otherIn) otherIn.value = "";

          if (q.multiSelect) {
            btn.classList.toggle("selected");
            const sel = [];
            optBtns.forEach(b => { if (b.classList.contains("selected")) sel.push(b.querySelector(".option-label").textContent); });
            answers[qi] = sel;
          } else {
            optBtns.forEach(b => b.classList.remove("selected"));
            btn.classList.add("selected");
            answers[qi] = [opt.label];
          }
        });
        optBtns.push(btn);
        optionsWrap.appendChild(btn);
      }
      section.appendChild(optionsWrap);

      // "Other" free-text input
      const otherWrap = document.createElement("div");
      otherWrap.className = "interactive-other";
      const otherInput = document.createElement("input");
      otherInput.type = "text";
      otherInput.placeholder = "Other...";
      otherInput.className = "interactive-other-input";
      otherInput.addEventListener("input", () => {
        if (otherInput.value.trim()) {
          optBtns.forEach(b => b.classList.remove("selected"));
          answers[qi] = [];
        }
      });
      otherWrap.appendChild(otherInput);
      section.appendChild(otherWrap);

      card.appendChild(section);
    });

    // Submit button
    const submitWrap = document.createElement("div");
    submitWrap.className = "question-submit-wrap";
    const submitBtn = document.createElement("button");
    submitBtn.className = "question-submit-btn";
    submitBtn.textContent = "Confirm";
    submitBtn.addEventListener("click", () => {
      // Collect answers as { "question text": "selected answer" } for the hook
      const answersObj = {};
      let hasAnswer = false;
      questions.forEach((q, qi) => {
        const otherIn = card.querySelectorAll(".question-section")[qi]?.querySelector(".interactive-other-input");
        const otherVal = otherIn?.value.trim();
        let answer;
        if (otherVal) {
          answer = otherVal;
        } else if (answers[qi].length > 0) {
          answer = answers[qi].join(", ");
        } else {
          return; // skip unanswered
        }
        answersObj[q.question || ("Q" + (qi + 1))] = answer;
        hasAnswer = true;
      });
      if (!hasAnswer) return;

      card.classList.add("submitted");
      submitBtn.disabled = true;
      card.querySelectorAll(".interactive-option-btn").forEach(b => b.disabled = true);
      card.querySelectorAll(".interactive-other-input").forEach(i => i.disabled = true);
      wsSend({ action: "hook_response", toolUseId: evt.toolUseId, answers: answersObj });
    });
    submitWrap.appendChild(submitBtn);
    card.appendChild(submitWrap);

    messagesInner.appendChild(card);
    if (isResolved) {
      submitBtn.disabled = true;
      card.querySelectorAll(".interactive-option-btn").forEach(b => b.disabled = true);
      card.querySelectorAll(".interactive-other-input").forEach(i => i.disabled = true);
      card.classList.add("submitted");
    }
  }

  function renderPlanApproval(evt, isResolved) {
    if (inThinkingBlock) finalizeThinkingBlock();

    const card = document.createElement("div");
    card.className = "interactive-card plan-approval-card";

    // Header row: tag + expand button
    const header = document.createElement("div");
    header.className = "plan-header";
    const tag = document.createElement("span");
    tag.className = "interactive-tag";
    tag.textContent = "Plan";
    header.appendChild(tag);

    let planHtml = "";
    if (evt.plan) {
      planHtml = marked.parse(evt.plan);
    }

    const expandBtn = document.createElement("button");
    expandBtn.className = "plan-expand-btn";
    expandBtn.innerHTML = "&#x26F6; Fullscreen";
    expandBtn.addEventListener("click", () => openPlanFullscreen(planHtml));
    header.appendChild(expandBtn);
    card.appendChild(header);

    if (planHtml) {
      const planBody = document.createElement("div");
      planBody.className = "plan-body md-content";
      planBody.innerHTML = planHtml;
      addCopyButtons(planBody);
      card.appendChild(planBody);
    }

    function resolveCard() {
      card.classList.add("resolved");
      approveBtn.disabled = true;
      rejectBtn.disabled = true;
      feedbackInput.disabled = true;
      feedbackBtn.disabled = true;
    }

    const actions = document.createElement("div");
    actions.className = "plan-actions";

    const approveBtn = document.createElement("button");
    approveBtn.className = "plan-btn approve";
    approveBtn.textContent = "Approve";
    approveBtn.addEventListener("click", () => {
      resolveCard();
      approveBtn.classList.add("selected");
      feedbackWrap.style.display = "none";
      wsSend({ action: "hook_response", toolUseId: evt.toolUseId, decision: "allow" });
    });

    const rejectBtn = document.createElement("button");
    rejectBtn.className = "plan-btn reject";
    rejectBtn.textContent = "Reject";
    rejectBtn.addEventListener("click", () => {
      if (card.classList.contains("resolved")) return;
      feedbackWrap.style.display = feedbackWrap.style.display === "none" ? "flex" : "none";
    });

    actions.appendChild(approveBtn);
    actions.appendChild(rejectBtn);
    card.appendChild(actions);

    // Feedback input for rejection
    const feedbackWrap = document.createElement("div");
    feedbackWrap.className = "interactive-other";
    feedbackWrap.style.display = "none";
    const feedbackInput = document.createElement("input");
    feedbackInput.type = "text";
    feedbackInput.placeholder = "Feedback (what to change)...";
    feedbackInput.className = "interactive-other-input";
    const feedbackBtn = document.createElement("button");
    feedbackBtn.className = "interactive-other-send";
    feedbackBtn.textContent = "Send";
    feedbackBtn.addEventListener("click", () => {
      const val = feedbackInput.value.trim();
      if (!val) return;
      resolveCard();
      rejectBtn.classList.add("selected");
      wsSend({ action: "hook_response", toolUseId: evt.toolUseId, decision: "deny", reason: val });
    });
    feedbackInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); feedbackBtn.click(); }
    });
    feedbackWrap.appendChild(feedbackInput);
    feedbackWrap.appendChild(feedbackBtn);
    card.appendChild(feedbackWrap);

    messagesInner.appendChild(card);
    if (isResolved) resolveCard();
  }

  function openPlanFullscreen(planHtml) {
    const overlay = document.createElement("div");
    overlay.className = "plan-fullscreen-overlay";

    const header = document.createElement("div");
    header.className = "plan-fullscreen-header";
    const tag = document.createElement("span");
    tag.className = "interactive-tag";
    tag.textContent = "Plan";
    header.appendChild(tag);
    const closeBtn = document.createElement("button");
    closeBtn.className = "plan-fullscreen-close";
    closeBtn.innerHTML = "&#x2715; Close";
    closeBtn.addEventListener("click", () => overlay.remove());
    header.appendChild(closeBtn);
    overlay.appendChild(header);

    const body = document.createElement("div");
    body.className = "plan-fullscreen-body md-content";
    body.innerHTML = planHtml;
    addCopyButtons(body);
    overlay.appendChild(body);

    // ESC to close
    function onKey(e) {
      if (e.key === "Escape") { overlay.remove(); document.removeEventListener("keydown", onKey); }
    }
    document.addEventListener("keydown", onKey);

    document.body.appendChild(overlay);
  }

  function esc(s) {
    const el = document.createElement("span");
    el.textContent = s;
    return el.innerHTML;
  }

  // ---- Session Labels ----
  const LABEL_PRESET_COLORS = ['#ef4444','#f59e0b','#eab308','#10b981','#06b6d4','#3b82f6','#8b5cf6','#ec4899'];

  async function loadSessionLabels() {
    try {
      const res = await fetch('/api/session-labels');
      const data = await res.json();
      sessionLabels = data.labels || [];
    } catch {}
  }

  async function loadUiSettings() {
    try {
      const res = await fetch('/api/ui-settings');
      const data = await res.json();
      if (data.chatDefaults) {
        chatDefaults = { ...chatDefaults, ...data.chatDefaults };
      }
      if (data.automationDefaults) {
        automationDefaults = { ...automationDefaults, ...data.automationDefaults };
      }
      if (data.automationOverrides) {
        automationOverrides = {
          workflowOverrides: { ...(automationOverrides.workflowOverrides || {}), ...(data.automationOverrides.workflowOverrides || {}) },
          scheduleOverrides: { ...(automationOverrides.scheduleOverrides || {}), ...(data.automationOverrides.scheduleOverrides || {}) },
        };
      }
      if (data.folderOrder) {
        folderOrderList = data.folderOrder;
        localStorage.setItem("folderOrder", JSON.stringify(folderOrderList));
      }
      if (data.collapsedFolders) {
        collapsedFolders = data.collapsedFolders;
        localStorage.setItem("collapsedFolders", JSON.stringify(collapsedFolders));
      }
    } catch {}
  }

  function fillAutomationToolSelect(selectEl, selectedValue) {
    if (!selectEl) return;
    selectEl.innerHTML = "";
    const sourceTools = toolsList.length > 0 ? toolsList : [
      { id: "codex", name: "OpenAI Codex" },
      { id: "claude", name: "Claude Code" },
    ];
    for (const t of sourceTools) {
      if (t.available === false) continue;
      const opt = document.createElement("option");
      opt.value = t.id;
      opt.textContent = t.name;
      selectEl.appendChild(opt);
    }
    if ([...selectEl.options].some(opt => opt.value === selectedValue)) {
      selectEl.value = selectedValue;
    }
  }

  function renderOverrideToolOptions(selectedValue, includeInherit = false) {
    const options = [];
    if (includeInherit) {
      options.push('<option value="inherit">Inherit default</option>');
    }
    const sourceTools = toolsList.length > 0 ? toolsList : [
      { id: "codex", name: "OpenAI Codex" },
      { id: "claude", name: "Claude Code" },
    ];
    for (const t of sourceTools) {
      if (t.available === false) continue;
      const selected = t.id === selectedValue ? " selected" : "";
      options.push(`<option value="${esc(t.id)}"${selected}>${esc(t.name)}</option>`);
    }
    return options.join("");
  }

  function syncChatDefaultModelFields() {
    const activeTool = automationChatTool?.value || chatDefaults.defaultTool || "codex";
    if (automationChatCodexModelField) {
      automationChatCodexModelField.classList.toggle("hidden", activeTool !== "codex");
    }
    if (automationChatClaudeModelField) {
      automationChatClaudeModelField.classList.toggle("hidden", activeTool !== "claude");
    }
  }

  async function populateSettingsModelSelect(selectEl, toolId, selectedValue, { allowBlank = false, blankLabel = "Inherit default" } = {}) {
    if (!selectEl) return;
    const currentValue = selectedValue || "";
    selectEl.innerHTML = "";
    if (allowBlank) {
      const blank = document.createElement("option");
      blank.value = "";
      blank.textContent = blankLabel;
      selectEl.appendChild(blank);
    }
    try {
      const data = await fetchModelCatalog(toolId);
      const models = normalizeModelRecords(data.models);
      for (const model of models) {
        const option = document.createElement("option");
        option.value = model.id;
        option.textContent = model.name;
        selectEl.appendChild(option);
      }
      const preferred = currentValue || data.defaultModel || data.default || "";
      if ([...selectEl.options].some((option) => option.value === preferred)) {
        selectEl.value = preferred;
      } else if (allowBlank) {
        selectEl.value = "";
      } else if (selectEl.options.length > 0) {
        selectEl.value = selectEl.options[0].value;
      }
    } catch {
      const fallbackValue = currentValue || (toolId === "claude" ? (chatDefaults.claudeModel || CLAUDE_DEFAULT_MODEL) : chatDefaults.codexModel);
      const option = document.createElement("option");
      option.value = fallbackValue;
      option.textContent = fallbackValue;
      selectEl.appendChild(option);
      selectEl.value = fallbackValue;
    }
  }

  function renderWorkflowOverrideCards() {
    if (!workflowOverrideList) return;
    if (!availableWorkflows.length) {
      workflowOverrideList.innerHTML = '<div class="settings-card-empty">No workflows found.</div>';
      return;
    }
    workflowOverrideList.innerHTML = availableWorkflows.map((workflow) => {
      const key = workflow.id || workflow.name;
      const override = automationOverrides.workflowOverrides[key] || {};
      const enabled = !!override.enabled;
      const taskCount = (workflow.steps || []).reduce((count, step) => count + ((step.tasks || []).length || 0), 0);
      return `<article class="settings-override-card" data-workflow-key="${esc(key)}">
        <div class="settings-card-header">
          <div>
            <div class="settings-card-title">${esc(workflow.name || key)}</div>
            <div class="settings-card-meta">${esc(workflow.description || "No description")}<br>${taskCount} task(s)</div>
          </div>
          <label class="settings-check">
            <input type="checkbox" data-field="enabled"${enabled ? " checked" : ""}>
            Override
          </label>
        </div>
        <div class="settings-card-grid">
          <div>
            <div class="settings-card-label">Tool</div>
            <select data-field="tool">
              <option value="">Inherit default</option>
              ${renderOverrideToolOptions(override.tool)}
            </select>
          </div>
          <div>
            <div class="settings-card-label">Model</div>
            <select data-field="model">
              <option value="">Inherit default</option>
            </select>
          </div>
          <label class="settings-check span-2">
            <input type="checkbox" data-field="forceModel"${override.forceModel ? " checked" : ""}>
            Force override even if workflow JSON sets a model
          </label>
        </div>
      </article>`;
    }).join("");
  }

  function renderScheduleOverrideCards() {
    if (!scheduleOverrideList) return;
    if (!availableSchedules.length) {
      scheduleOverrideList.innerHTML = '<div class="settings-card-empty">No schedules found.</div>';
      return;
    }
    scheduleOverrideList.innerHTML = availableSchedules.map((schedule) => {
      const override = automationOverrides.scheduleOverrides[schedule.id] || {};
      const target = schedule.workflow || schedule.inlineWorkflow?.name || "inline";
      const cadence = schedule.cron || (schedule.intervalMs ? `Every ${Math.round(schedule.intervalMs / 60000)} min` : schedule.runAt || "Manual");
      return `<article class="settings-override-card" data-schedule-key="${esc(schedule.id)}">
        <div class="settings-card-header">
          <div>
            <div class="settings-card-title">${esc(schedule.id)}</div>
            <div class="settings-card-meta">Target: ${esc(target)}<br>${esc(cadence)}</div>
          </div>
          <label class="settings-check">
            <input type="checkbox" data-field="enabled"${override.enabled ? " checked" : ""}>
            Override
          </label>
        </div>
        <div class="settings-card-grid">
          <div>
            <div class="settings-card-label">Workflow Tool</div>
            <select data-field="workflowTool">
              <option value="">Inherit default</option>
              ${renderOverrideToolOptions(override.workflowTool)}
            </select>
          </div>
          <div>
            <div class="settings-card-label">Workflow Model</div>
            <select data-field="workflowModel">
              <option value="">Inherit default</option>
            </select>
          </div>
          <label class="settings-check span-2">
            <input type="checkbox" data-field="workflowForceModel"${override.workflowForceModel ? " checked" : ""}>
            Force workflow model override
          </label>
          <div>
            <div class="settings-card-label">Message Tool</div>
            <select data-field="sessionMessageTool">
              <option value="">Inherit default</option>
              <option value="inherit"${override.sessionMessageTool === "inherit" ? " selected" : ""}>Inherit session tool</option>
              ${renderOverrideToolOptions(override.sessionMessageTool)}
            </select>
          </div>
          <div>
            <div class="settings-card-label">Message Model</div>
            <select data-field="sessionMessageModel">
              <option value="">Inherit default</option>
            </select>
          </div>
          <label class="settings-check span-2">
            <input type="checkbox" data-field="sessionMessageForceModel"${override.sessionMessageForceModel ? " checked" : ""}>
            Force scheduled message model override
          </label>
        </div>
      </article>`;
    }).join("");
  }

  async function hydrateWorkflowOverrideModelSelects() {
    const cards = [...document.querySelectorAll("[data-workflow-key]")];
    await Promise.all(cards.map(async (card) => {
      const key = card.dataset.workflowKey;
      const override = automationOverrides.workflowOverrides[key] || {};
      const toolId = card.querySelector('[data-field="tool"]')?.value || automationDefaults.workflowTool || "codex";
      await populateSettingsModelSelect(card.querySelector('[data-field="model"]'), toolId, override.model || "", {
        allowBlank: true,
      });
    }));
  }

  async function hydrateScheduleOverrideModelSelects() {
    const cards = [...document.querySelectorAll("[data-schedule-key]")];
    await Promise.all(cards.map(async (card) => {
      const key = card.dataset.scheduleKey;
      const override = automationOverrides.scheduleOverrides[key] || {};
      const workflowToolId = card.querySelector('[data-field="workflowTool"]')?.value || automationDefaults.workflowTool || "codex";
      const sessionMessageToolValue = card.querySelector('[data-field="sessionMessageTool"]')?.value || "";
      const sessionMessageToolId = sessionMessageToolValue && sessionMessageToolValue !== "inherit"
        ? sessionMessageToolValue
        : (automationDefaults.sessionMessageTool !== "inherit" ? automationDefaults.sessionMessageTool : chatDefaults.defaultTool || "codex");
      await Promise.all([
        populateSettingsModelSelect(card.querySelector('[data-field="workflowModel"]'), workflowToolId, override.workflowModel || "", {
          allowBlank: true,
        }),
        populateSettingsModelSelect(card.querySelector('[data-field="sessionMessageModel"]'), sessionMessageToolId, override.sessionMessageModel || "", {
          allowBlank: true,
        }),
      ]);
    }));
  }

  async function loadSettingsCatalog() {
    const [workflowRes, scheduleRes] = await Promise.all([
      fetch("/api/workflows"),
      fetch("/api/schedules"),
    ]);
    if (!workflowRes.ok) throw new Error("Failed to load workflows");
    if (!scheduleRes.ok) throw new Error("Failed to load schedules");
    const workflowData = await workflowRes.json();
    const scheduleData = await scheduleRes.json();
    availableWorkflows = workflowData.workflows || [];
    availableSchedules = scheduleData.schedules || [];
  }

  async function populateSettingsForm() {
    fillAutomationToolSelect(automationChatTool, chatDefaults.defaultTool);
    fillAutomationToolSelect(automationChatNamingTool, chatDefaults.namingTool || "codex");
    syncChatDefaultModelFields();
    fillAutomationToolSelect(automationWorkflowTool, automationDefaults.workflowTool);
    automationWorkflowForceModel.checked = !!automationDefaults.workflowForceModel;
    automationSessionMessageTool.value = automationDefaults.sessionMessageTool || "inherit";
    automationSessionMessageForceModel.checked = !!automationDefaults.sessionMessageForceModel;
    renderWorkflowOverrideCards();
    renderScheduleOverrideCards();
    await Promise.all([
      populateSettingsModelSelect(automationChatCodexModel, "codex", chatDefaults.codexModel || "gpt-5.4"),
      populateSettingsModelSelect(automationChatClaudeModel, "claude", chatDefaults.claudeModel || CLAUDE_DEFAULT_MODEL),
      populateSettingsModelSelect(
        automationChatNamingModel,
        automationChatNamingTool.value || chatDefaults.namingTool || "codex",
        chatDefaults.namingModel || "gpt-5.4-mini"
      ),
      populateSettingsModelSelect(
        automationWorkflowModel,
        automationWorkflowTool.value || automationDefaults.workflowTool || "codex",
        automationDefaults.workflowModel || "gpt-5.4"
      ),
      populateSettingsModelSelect(
        automationSessionMessageModel,
        automationSessionMessageTool.value && automationSessionMessageTool.value !== "inherit"
          ? automationSessionMessageTool.value
          : (chatDefaults.defaultTool || "codex"),
        automationDefaults.sessionMessageModel || "gpt-5.4"
      ),
      hydrateWorkflowOverrideModelSelects(),
      hydrateScheduleOverrideModelSelects(),
    ]);
  }

  function collectWorkflowOverrides() {
    const next = {};
    document.querySelectorAll("[data-workflow-key]").forEach((card) => {
      const key = card.dataset.workflowKey;
      const enabled = !!card.querySelector('[data-field="enabled"]')?.checked;
      if (!enabled) return;
      next[key] = {
        enabled: true,
        tool: card.querySelector('[data-field="tool"]')?.value || "",
        model: card.querySelector('[data-field="model"]')?.value.trim() || "",
        forceModel: !!card.querySelector('[data-field="forceModel"]')?.checked,
      };
    });
    return next;
  }

  function collectScheduleOverrides() {
    const next = {};
    document.querySelectorAll("[data-schedule-key]").forEach((card) => {
      const key = card.dataset.scheduleKey;
      const enabled = !!card.querySelector('[data-field="enabled"]')?.checked;
      if (!enabled) return;
      next[key] = {
        enabled: true,
        workflowTool: card.querySelector('[data-field="workflowTool"]')?.value || "",
        workflowModel: card.querySelector('[data-field="workflowModel"]')?.value.trim() || "",
        workflowForceModel: !!card.querySelector('[data-field="workflowForceModel"]')?.checked,
        sessionMessageTool: card.querySelector('[data-field="sessionMessageTool"]')?.value || "",
        sessionMessageModel: card.querySelector('[data-field="sessionMessageModel"]')?.value.trim() || "",
        sessionMessageForceModel: !!card.querySelector('[data-field="sessionMessageForceModel"]')?.checked,
      };
    });
    return next;
  }

  function showMainView(view) {
    activeMainView = view;
    const inputArea = document.getElementById("inputArea");
    const isSettings = view === "settings";
    settingsView.style.display = isSettings ? "" : "none";
    workflowView.style.display = view === "workflow" ? "" : "none";
    messagesEl.style.display = view === "chat" ? "" : "none";
    if (inputArea) inputArea.style.display = view === "chat" ? "" : "none";
    if (view !== "files") filesView.classList.remove("visible");
    if (view !== "git") gitView.classList.remove("visible");
    if (isSettings) {
      sessionTabs.classList.remove("visible");
      headerTitle.textContent = "Settings";
      resetHeaderContext();
    }
  }

  async function openSettingsView() {
    if (activeSessionTab === "files" && !checkUnsavedEdits()) return;
    settingsSaveStatus.textContent = "";
    if (!availableWorkflows.length && !availableSchedules.length) {
      await loadSettingsCatalog();
    }
    await populateSettingsForm();
    showMainView("settings");
  }

  function closeSettingsView() {
    showMainView("chat");
    if (currentSessionId) {
      const currentSession = [...sessions, ...workflowSessions, ...archivedSessions].find((s) => s.id === currentSessionId);
      headerTitle.textContent = currentSession?.name || currentSession?.folder?.split("/").pop() || "RemoteLab Chat";
      sessionTabs.classList.add("visible");
      switchSessionTab(activeSessionTab || "chat");
    } else {
      headerTitle.textContent = "RemoteLab Chat";
      sessionTabs.classList.remove("visible");
    }
  }

  async function saveAutomationSettings() {
    const patch = {
      chatDefaults: {
        defaultTool: automationChatTool.value || "codex",
        codexModel: automationChatCodexModel.value.trim() || "gpt-5.4",
        claudeModel: automationChatClaudeModel.value.trim() || "opus[1m]",
        namingTool: automationChatNamingTool.value || "codex",
        namingModel: automationChatNamingModel.value.trim() || "gpt-5.4-mini",
      },
      automationDefaults: {
        workflowTool: automationWorkflowTool.value || "codex",
        workflowModel: automationWorkflowModel.value.trim() || "gpt-5.4",
        workflowForceModel: !!automationWorkflowForceModel.checked,
        sessionMessageTool: automationSessionMessageTool.value || "inherit",
        sessionMessageModel: automationSessionMessageModel.value.trim() || "gpt-5.4",
        sessionMessageForceModel: !!automationSessionMessageForceModel.checked,
      },
      automationOverrides: {
        workflowOverrides: collectWorkflowOverrides(),
        scheduleOverrides: collectScheduleOverrides(),
      },
    };
    const res = await fetch('/api/ui-settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error('Failed to save settings');
    chatDefaults = { ...chatDefaults, ...patch.chatDefaults };
    automationDefaults = { ...automationDefaults, ...patch.automationDefaults };
    automationOverrides = { ...automationOverrides, ...patch.automationOverrides };
    settingsSaveStatus.textContent = "Saved";
    setTimeout(() => {
      if (settingsSaveStatus.textContent === "Saved") settingsSaveStatus.textContent = "";
    }, 1800);
    await loadInlineTools();
    await loadInlineModels(selectedTool, null);
  }

  function getLabelById(id) {
    return sessionLabels.find(l => l.id === id) || null;
  }

  function closeLabelPopover() {
    const existing = document.querySelector('.label-popover');
    if (existing) existing.remove();
  }

  function showLabelPopover(logoEl, session) {
    closeLabelPopover();
    const popover = document.createElement('div');
    popover.className = 'label-popover';

    const currentLabel = session.label || null;

    // Render label options
    for (const label of sessionLabels) {
      const opt = document.createElement('div');
      opt.className = 'label-option' + (currentLabel === label.id ? ' active' : '');
      opt.innerHTML = `<span class="label-color-dot" style="background:${label.color}"></span>${esc(label.name)}`;
      opt.addEventListener('click', (e) => {
        e.stopPropagation();
        wsSend({ action: 'set-label', sessionId: session.id, label: label.id });
        // Optimistic update
        const s = sessions.find(x => x.id === session.id);
        if (s) s.label = label.id;
        closeLabelPopover();
        renderSessionList();
      });
      popover.appendChild(opt);
    }

    // Clear option (if has label)
    if (currentLabel) {
      const sep = document.createElement('div');
      sep.className = 'label-separator';
      popover.appendChild(sep);

      const clearOpt = document.createElement('div');
      clearOpt.className = 'label-option';
      clearOpt.innerHTML = `<span class="label-color-dot" style="background:var(--text-muted)"></span>Clear label`;
      clearOpt.addEventListener('click', (e) => {
        e.stopPropagation();
        wsSend({ action: 'set-label', sessionId: session.id, label: null });
        const s = sessions.find(x => x.id === session.id);
        if (s) delete s.label;
        closeLabelPopover();
        renderSessionList();
      });
      popover.appendChild(clearOpt);
    }

    // Separator + Add new label
    const sep2 = document.createElement('div');
    sep2.className = 'label-separator';
    popover.appendChild(sep2);

    const addBtn = document.createElement('div');
    addBtn.className = 'label-option';
    addBtn.textContent = '＋ Add new label';
    let formVisible = false;
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (formVisible) return;
      formVisible = true;
      addBtn.style.display = 'none';
      const form = document.createElement('div');
      form.className = 'label-add-form';
      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.placeholder = 'Label name';
      form.appendChild(nameInput);

      const colorPicker = document.createElement('div');
      colorPicker.className = 'color-picker-dots';
      let selectedColor = LABEL_PRESET_COLORS[0];
      for (const c of LABEL_PRESET_COLORS) {
        const dot = document.createElement('span');
        dot.className = 'color-picker-dot' + (c === selectedColor ? ' selected' : '');
        dot.style.background = c;
        dot.addEventListener('click', (ev) => {
          ev.stopPropagation();
          selectedColor = c;
          colorPicker.querySelectorAll('.color-picker-dot').forEach(d => d.classList.remove('selected'));
          dot.classList.add('selected');
        });
        colorPicker.appendChild(dot);
      }
      form.appendChild(colorPicker);

      const confirmBtn = document.createElement('button');
      confirmBtn.className = 'label-add-confirm';
      confirmBtn.textContent = 'Add';
      confirmBtn.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        const name = nameInput.value.trim();
        if (!name) return;
        try {
          const res = await fetch('/api/session-labels', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, color: selectedColor }),
          });
          const data = await res.json();
          if (data.label) {
            sessionLabels.push(data.label);
            // Also apply it to this session
            wsSend({ action: 'set-label', sessionId: session.id, label: data.label.id });
            const s = sessions.find(x => x.id === session.id);
            if (s) s.label = data.label.id;
          }
        } catch {}
        closeLabelPopover();
        renderSessionList();
      });
      form.appendChild(confirmBtn);
      popover.appendChild(form);
      nameInput.focus();
    });
    popover.appendChild(addBtn);

    // Position popover next to logo
    document.body.appendChild(popover);
    const rect = logoEl.getBoundingClientRect();
    popover.style.position = 'fixed';
    popover.style.left = (rect.right + 4) + 'px';
    popover.style.top = rect.top + 'px';
    // Keep within viewport
    requestAnimationFrame(() => {
      const pr = popover.getBoundingClientRect();
      if (pr.bottom > window.innerHeight) {
        popover.style.top = Math.max(4, window.innerHeight - pr.height - 4) + 'px';
      }
      if (pr.right > window.innerWidth) {
        popover.style.left = (rect.left - pr.width - 4) + 'px';
      }
    });

    // Close on click outside
    const closeHandler = (e) => {
      if (!popover.contains(e.target)) {
        closeLabelPopover();
        document.removeEventListener('click', closeHandler, true);
      }
    };
    setTimeout(() => document.addEventListener('click', closeHandler, true), 0);
  }

  // ---- Session list ----
  // Persisted folder order for drag-to-reorder
  let folderOrderList = JSON.parse(localStorage.getItem("folderOrder") || "[]");

  function saveFolderOrder(order) {
    folderOrderList = order;
    localStorage.setItem("folderOrder", JSON.stringify(order));
    fetch('/api/ui-settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folderOrder: order }) }).catch(() => {});
  }

  function rebuildKnownFolders() {
    knownFolders = new Set();
    for (const s of sessions) knownFolders.add(s.folder || "?");
    for (const s of archivedSessions) knownFolders.add(s.folder || "?");
  }

  // Shared rendering logic for both sessions and workflow sessions.
  // opts.allowAdd — show the "+" button to create a new session in the folder
  // opts.allowDrag — enable drag-to-reorder folders
  function renderSessionItems(sessArr, containerEl, opts = {}) {
    const { allowAdd = false, allowDrag = false } = opts;
    containerEl.innerHTML = "";

    const groups = new Map();
    for (const s of sessArr) {
      const folder = s.folder || "?";
      if (!groups.has(folder)) groups.set(folder, []);
      groups.get(folder).push(s);
    }
    // Keep folders visible even when all their sessions are archived
    for (const folder of knownFolders) {
      if (!groups.has(folder)) groups.set(folder, []);
    }

    let sortedFolders;
    if (allowDrag) {
      // Stable folder ordering: manual order first, then by earliest created time
      sortedFolders = [...groups.keys()].sort((a, b) => {
        const idxA = folderOrderList.indexOf(a);
        const idxB = folderOrderList.indexOf(b);
        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        if (idxA !== -1) return -1;
        if (idxB !== -1) return 1;
        const earliestA = groups.get(a).reduce((min, s) => s.created && s.created < min ? s.created : min, "z");
        const earliestB = groups.get(b).reduce((min, s) => s.created && s.created < min ? s.created : min, "z");
        return earliestA.localeCompare(earliestB);
      });
      // Sync folderOrder to include all current folders (add new ones at end)
      const currentOrder = [...folderOrderList.filter(f => groups.has(f))];
      for (const f of sortedFolders) {
        if (!currentOrder.includes(f)) currentOrder.push(f);
      }
      if (JSON.stringify(currentOrder) !== JSON.stringify(folderOrderList)) {
        saveFolderOrder(currentOrder);
      }
    } else {
      // Simple sort by earliest created time
      sortedFolders = [...groups.keys()].sort((a, b) => {
        const ea = groups.get(a).reduce((min, s) => s.created && s.created < min ? s.created : min, "z");
        const eb = groups.get(b).reduce((min, s) => s.created && s.created < min ? s.created : min, "z");
        return ea.localeCompare(eb);
      });
    }

    for (const folder of sortedFolders) {
      const folderSessions = groups.get(folder);
      const group = document.createElement("div");
      group.className = "folder-group";
      group.dataset.folder = folder;

      const shortFolder = folder.replace(/^\/Users\/[^/]+/, "~");
      const folderName = shortFolder.split("/").pop() || shortFolder;

      const header = document.createElement("div");
      header.className =
        "folder-group-header" + (collapsedFolders[folder] ? " collapsed" : "");
      const runningCount = folderSessions.filter(s => s.status === "running").length;
      const runningBadge = runningCount > 0
        ? `<span class="folder-running-badge"><svg width="12" height="12" viewBox="0 0 100 100" fill="none"><g stroke="currentColor" stroke-width="6" fill="none"><circle cx="50" cy="28" r="19"/><circle cx="72" cy="50" r="19"/><circle cx="50" cy="72" r="19"/><circle cx="28" cy="50" r="19"/></g><circle cx="50" cy="50" r="5" fill="currentColor"/></svg>${runningCount}</span>`
        : "";
      header.innerHTML = `${allowDrag ? `<span class="folder-drag-handle" title="Drag to reorder">⠿</span>` : ""}
        <span class="folder-chevron">&#9660;</span>
        <span class="folder-name" title="${esc(shortFolder)}">${esc(folderName)}</span>
        <span class="folder-count">${folderSessions.length}</span>${runningBadge}
        ${allowAdd ? `<button class="folder-add-btn" title="New session">+</button>` : ""}
        ${allowAdd ? `<button class="folder-del-btn" title="Delete folder">&times;</button>` : ""}`;
      header.addEventListener("click", (e) => {
        if (e.target.classList.contains("folder-add-btn")) return;
        if (e.target.classList.contains("folder-del-btn")) return;
        if (allowDrag && e.target.classList.contains("folder-drag-handle")) return;
        header.classList.toggle("collapsed");
        collapsedFolders[folder] = header.classList.contains("collapsed");
        localStorage.setItem("collapsedFolders", JSON.stringify(collapsedFolders));
        fetch('/api/ui-settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ collapsedFolders }) }).catch(() => {});
      });
      if (allowAdd) {
        header.querySelector(".folder-add-btn").addEventListener("click", (e) => {
          e.stopPropagation();
          if (!isDesktop) closeSidebarFn();
          const tool = selectedTool || (toolsList.length > 0 ? toolsList[0].id : "claude");
          wsSend({ action: "create", folder, tool, name: "" });
          const handler = (ev) => {
            let msg;
            try { msg = JSON.parse(ev.data); } catch { return; }
            if (msg.type === "session" && msg.session) {
              ws.removeEventListener("message", handler);
              attachSession(msg.session.id, msg.session);
              wsSend({ action: "list" });
            }
          };
          ws.addEventListener("message", handler);
        });

        header.querySelector(".folder-del-btn").addEventListener("click", (e) => {
          e.stopPropagation();
          const count = folderSessions.length;
          if (count > 0 && !confirm(`This folder has ${count} session${count > 1 ? "s" : ""}. Delete all?`)) return;
          // Delete all sessions in this folder
          for (const s of folderSessions) {
            wsSend({ action: "delete", sessionId: s.id });
          }
          // Remove folder from folderOrder and collapsedFolders
          folderOrderList = folderOrderList.filter(f => f !== folder);
          delete collapsedFolders[folder];
          localStorage.setItem("folderOrder", JSON.stringify(folderOrderList));
          localStorage.setItem("collapsedFolders", JSON.stringify(collapsedFolders));
          fetch('/api/ui-settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folderOrder: folderOrderList, collapsedFolders }) }).catch(() => {});
          // Remove the folder group from DOM immediately
          group.remove();
        });
      }

      const items = document.createElement("div");
      items.className = "folder-group-items";

      for (const s of folderSessions) {
        const div = document.createElement("div");
        div.className =
          "session-item" + (s.id === currentSessionId ? " active" : "");

        const displayName = s.name || s.tool || "session";
        const label = s.label ? getLabelById(s.label) : null;
        const queuedMeta = s.queuedMessageCount > 0
          ? `<span class="queued-count">${s.queuedMessageCount} queued</span>`
          : "";
        let metaHtml;
        if (s.status === "running") {
          metaHtml = `<span class="status-running">● running</span>${queuedMeta ? ` <span class="queued-count-sep">·</span> ${queuedMeta}` : ""}`;
        } else if (label) {
          metaHtml = `<span style="color:${label.color}">● ${esc(label.name)}</span>${queuedMeta ? ` <span class="queued-count-sep">·</span> ${queuedMeta}` : ""}`;
        } else if (s.tool && s.name) {
          metaHtml = `<span>${esc(s.tool)}</span>${queuedMeta ? ` <span class="queued-count-sep">·</span> ${queuedMeta}` : ""}`;
        } else if (queuedMeta) {
          metaHtml = queuedMeta;
        } else {
          metaHtml = "";
        }

        const logoRunning = s.status === "running" ? " running" : "";
        const logoColor = (s.status !== "running" && label) ? ` style="color:${label.color}"` : "";
        div.innerHTML = `
          <div class="session-item-logo${logoRunning}"${logoColor} title="Set label">
            <svg width="16" height="16" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
              <g stroke="currentColor" stroke-width="6" fill="none">
                <circle cx="50" cy="28" r="19"/>
                <circle cx="72" cy="50" r="19"/>
                <circle cx="50" cy="72" r="19"/>
                <circle cx="28" cy="50" r="19"/>
              </g>
              <circle cx="50" cy="50" r="5" fill="currentColor"/>
            </svg>
          </div>
          <div class="session-item-info">
            <div class="session-item-name">${esc(displayName)}</div>
            <div class="session-item-meta">${metaHtml}</div>
          </div>
          <div class="session-item-actions">
            <button class="session-action-btn rename" title="Rename" data-id="${s.id}">&#9998;</button>
            <button class="session-action-btn archive" title="Archive" data-id="${s.id}">&#8863;</button>
            <button class="session-action-btn del" title="Delete" data-id="${s.id}">&times;</button>
            <button class="session-menu-btn" title="More" data-id="${s.id}">&#8942;</button>
          </div>`;

        // Logo click → label popover (stop propagation to prevent session switch)
        const logoEl = div.querySelector('.session-item-logo');
        logoEl.addEventListener('click', (e) => {
          e.stopPropagation();
          showLabelPopover(logoEl, s);
        });

        div.addEventListener("click", (e) => {
          if (
            e.target.classList.contains("rename") ||
            e.target.classList.contains("archive") ||
            e.target.classList.contains("del") ||
            e.target.classList.contains("session-menu-btn") ||
            e.target.closest(".session-item-logo")
          )
            return;
          attachSession(s.id, s);
          if (!isDesktop) closeSidebarFn();
        });

        div.querySelector(".rename").addEventListener("click", (e) => {
          e.stopPropagation();
          startRename(div, s);
        });

        div.querySelector(".archive").addEventListener("click", (e) => {
          e.stopPropagation();
          wsSend({ action: "archive", sessionId: s.id, archived: true });
        });

        div.querySelector(".del").addEventListener("click", (e) => {
          e.stopPropagation();
          if (confirm("Delete this session?")) {
            wsSend({ action: "delete", sessionId: s.id });
          }
        });

        div.querySelector(".session-menu-btn").addEventListener("click", (e) => {
          e.stopPropagation();
          showSessionDropdown(e.currentTarget, s, div);
        });

        items.appendChild(div);
      }

      if (allowDrag) {
        // Drag-to-reorder: desktop (HTML5 drag) + mobile (touch)
        header.querySelector(".folder-drag-handle").addEventListener("mousedown", () => {
          group.draggable = true;
        });
        group.addEventListener("dragend", () => {
          group.classList.remove("dragging");
          group.draggable = false;
        });
        group.addEventListener("dragstart", (e) => {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", folder);
          group.classList.add("dragging");
        });
        group.addEventListener("dragover", (e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          const dragging = containerEl.querySelector(".folder-group.dragging");
          if (dragging && dragging !== group) {
            const rect = group.getBoundingClientRect();
            const midY = rect.top + rect.height / 2;
            if (e.clientY < midY) {
              containerEl.insertBefore(dragging, group);
            } else {
              containerEl.insertBefore(dragging, group.nextSibling);
            }
          }
        });
        group.addEventListener("drop", (e) => {
          e.preventDefault();
          const newOrder = [...containerEl.querySelectorAll(".folder-group")].map(g => g.dataset.folder);
          saveFolderOrder(newOrder);
        });

        // Touch drag for mobile
        const handle = header.querySelector(".folder-drag-handle");
        let touchDragState = null;
        handle.addEventListener("touchstart", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const touch = e.touches[0];
          touchDragState = { startY: touch.clientY, el: group, placeholder: null };
          group.classList.add("dragging");
          const ph = document.createElement("div");
          ph.className = "folder-drag-placeholder";
          ph.style.height = group.offsetHeight + "px";
          group.parentNode.insertBefore(ph, group);
          touchDragState.placeholder = ph;
          group.style.position = "fixed";
          group.style.zIndex = "1000";
          group.style.width = group.offsetWidth + "px";
          group.style.left = group.getBoundingClientRect().left + "px";
          group.style.top = touch.clientY - group.offsetHeight / 2 + "px";
          group.style.pointerEvents = "none";
        }, { passive: false });

        handle.addEventListener("touchmove", (e) => {
          if (!touchDragState) return;
          e.preventDefault();
          const touch = e.touches[0];
          const group = touchDragState.el;
          group.style.top = touch.clientY - group.offsetHeight / 2 + "px";
          const groups = [...containerEl.querySelectorAll(".folder-group:not(.dragging)")];
          for (const g of groups) {
            const rect = g.getBoundingClientRect();
            if (touch.clientY < rect.top + rect.height / 2) {
              containerEl.insertBefore(touchDragState.placeholder, g);
              return;
            }
          }
          containerEl.appendChild(touchDragState.placeholder);
        }, { passive: false });

        handle.addEventListener("touchend", () => {
          if (!touchDragState) return;
          const group = touchDragState.el;
          group.classList.remove("dragging");
          group.style.position = "";
          group.style.zIndex = "";
          group.style.width = "";
          group.style.left = "";
          group.style.top = "";
          group.style.pointerEvents = "";
          if (touchDragState.placeholder.parentNode) {
            touchDragState.placeholder.parentNode.insertBefore(group, touchDragState.placeholder);
            touchDragState.placeholder.remove();
          }
          touchDragState = null;
          const newOrder = [...containerEl.querySelectorAll(".folder-group")].map(g => g.dataset.folder);
          saveFolderOrder(newOrder);
        });
      }

      group.appendChild(header);
      group.appendChild(items);
      containerEl.appendChild(group);
    }
    if (allowDrag) updateFloatingLogo();
  }

  function renderSessionList() {
    renderSessionItems(sessions, sessionList, { allowAdd: true, allowDrag: true });
    renderArchivedSection();
  }

  function renderArchivedSection() {
    // Remove old archived section if any
    const old = sessionList.querySelector(".archived-section");
    if (old) old.remove();

    if (archivedSessions.length === 0) return;

    const section = document.createElement("div");
    section.className = "archived-section";

    const toggle = document.createElement("div");
    toggle.className = "archived-section-toggle";
    toggle.innerHTML = `<span class="archived-chevron">${showArchived ? "&#9660;" : "&#9654;"}</span> ${archivedSessions.length} archived`;
    toggle.addEventListener("click", () => {
      showArchived = !showArchived;
      renderArchivedSection();
    });
    section.appendChild(toggle);

    if (showArchived) {
      const container = document.createElement("div");
      container.className = "archived-items";
      // Newest first — recently archived sessions are more likely to be needed
      const sorted = [...archivedSessions].sort((a, b) => (b.created || "").localeCompare(a.created || ""));
      for (const s of sorted) {
        const div = document.createElement("div");
        div.className = "session-item archived" + (s.id === currentSessionId ? " active" : "");
        const displayName = s.name || s.tool || "session";
        div.innerHTML = `
          <div class="session-item-logo">
            <svg width="16" height="16" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
              <g stroke="currentColor" stroke-width="6" fill="none">
                <circle cx="50" cy="28" r="19"/>
                <circle cx="72" cy="50" r="19"/>
                <circle cx="50" cy="72" r="19"/>
                <circle cx="28" cy="50" r="19"/>
              </g>
              <circle cx="50" cy="50" r="5" fill="currentColor"/>
            </svg>
          </div>
          <div class="session-item-info">
            <div class="session-item-name">${esc(displayName)}</div>
            <div class="session-item-meta"><span>${esc(s.tool || "")}</span></div>
          </div>
          <div class="session-item-actions">
            <button class="session-action-btn unarchive" title="Unarchive" data-id="${s.id}">&#8862;</button>
            <button class="session-action-btn del" title="Delete" data-id="${s.id}">&times;</button>
            <button class="session-menu-btn" title="More" data-id="${s.id}">&#8942;</button>
          </div>`;

        div.addEventListener("click", (e) => {
          if (e.target.classList.contains("unarchive") || e.target.classList.contains("del") || e.target.classList.contains("session-menu-btn")) return;
          attachSession(s.id, s);
          if (!isDesktop) closeSidebarFn();
        });
        div.querySelector(".unarchive").addEventListener("click", (e) => {
          e.stopPropagation();
          wsSend({ action: "archive", sessionId: s.id, archived: false });
        });
        div.querySelector(".del").addEventListener("click", (e) => {
          e.stopPropagation();
          if (confirm("Delete this session?")) {
            wsSend({ action: "delete", sessionId: s.id });
          }
        });
        div.querySelector(".session-menu-btn").addEventListener("click", (e) => {
          e.stopPropagation();
          showArchivedDropdown(e.currentTarget, s);
        });
        container.appendChild(div);
      }
      section.appendChild(container);
    }

    sessionList.appendChild(section);
  }

  // ---- Task panel (schedules in sidebar tab) ----

  function formatCron(cron) {
    if (!cron) return "Manual only";
    const parts = cron.split(/\s+/);
    if (parts.length < 5) return cron;
    const [min, hour, dom, mon, dow] = parts;
    // Convert UTC cron time to user's local timezone
    const d = new Date();
    d.setUTCHours(parseInt(hour, 10), parseInt(min, 10), 0, 0);
    const localTime = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "local";
    const tzShort = tz.split("/").pop().replace(/_/g, " ");
    if (dom === "*" && mon === "*" && dow === "*") return `Daily at ${localTime} (${tzShort})`;
    if (dom === "*" && mon === "*" && dow !== "*") {
      const days = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
      // UTC dow might differ from local dow after timezone conversion
      if (/^\d$/.test(dow)) {
        d.setUTCHours(parseInt(hour, 10), parseInt(min, 10), 0, 0);
        // Set to a known date for that UTC dow, then read local dow
        const today = new Date();
        const diff = (parseInt(dow, 10) - today.getUTCDay() + 7) % 7;
        d.setUTCDate(today.getUTCDate() + diff);
        const localDay = days[d.getDay()];
        return `${localDay} at ${localTime} (${tzShort})`;
      }
      return `${dow} at ${localTime} (${tzShort})`;
    }
    return `${localTime} (${tzShort}) ${cron}`;
  }

  // Compute the next UTC trigger time for a cron expression (daily/weekly subset).
  // Mirrors scheduler.mjs msUntilNextCron but works in the browser using UTC methods.
  function nextCronUTC(cron) {
    if (!cron) return null;
    const parts = cron.split(/\s+/);
    if (parts.length < 5) return null;
    const [min, hour, , , dow] = parts;
    const minute = parseInt(min, 10);
    const hourVal = parseInt(hour, 10);
    const now = new Date();
    const next = new Date();
    next.setUTCHours(hourVal, minute, 0, 0);
    if (dow !== "*") {
      const targetDay = parseInt(dow, 10);
      const currentDay = now.getUTCDay();
      let daysAhead = targetDay - currentDay;
      if (daysAhead < 0) daysAhead += 7;
      if (daysAhead === 0 && next <= now) daysAhead = 7;
      next.setUTCDate(next.getUTCDate() + daysAhead);
    } else {
      if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
    }
    return next;
  }

  // Format milliseconds remaining as "Xh Ym" or "Ym" or "< 1m"
  function formatCountdown(ms) {
    if (ms <= 0) return "now";
    const totalMin = Math.ceil(ms / 60_000);
    if (totalMin < 1) return "< 1m";
    if (totalMin < 60) return `${totalMin}m`;
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }

  function formatRunAt(runAt) {
    if (!runAt) return null;
    const diff = new Date(runAt).getTime() - Date.now();
    if (diff <= 0) return "past due";
    if (diff < 3_600_000) return `in ${Math.ceil(diff / 60_000)} min`;
    if (diff < 86_400_000) return `in ${Math.floor(diff / 3_600_000)}h ${Math.ceil((diff % 3_600_000) / 60_000)}m`;
    return new Date(runAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  function formatInterval(ms) {
    if (!ms) return null;
    const totalMin = Math.round(ms / 60000);
    if (totalMin < 60) return `Every ${totalMin}m`;
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return m > 0 ? `Every ${h}h ${m}m` : `Every ${h}h`;
  }

  async function loadTaskSection() {
    try {
      const schedRes = await fetch("/api/schedules");
      const { schedules = [] } = await schedRes.json();

      taskPanel.innerHTML = "";

      if (schedules.length === 0) {
        taskPanel.innerHTML = '<div style="padding:16px;font-size:12px;color:var(--text-muted);text-align:center">No tasks configured</div>';
        return;
      }

      // Panel header with refresh
      const hdr = document.createElement("div");
      hdr.className = "task-panel-header";
      hdr.innerHTML = `
        <span class="task-panel-label">Schedules</span>
        <button class="task-panel-refresh" title="Refresh">↻</button>
      `;
      hdr.querySelector(".task-panel-refresh").addEventListener("click", (e) => { e.stopPropagation(); loadTaskSection(); });
      taskPanel.appendChild(hdr);

      for (const sched of schedules) {
        let enabled = sched.enabled !== false;

        // Build summary line: cron or runAt or "Manual only"
        let summaryText = formatCron(sched.cron);
        const runAtLabel = formatRunAt(sched.runAt);
        if (runAtLabel) summaryText = runAtLabel;
        if (sched.intervalMs) summaryText = formatInterval(sched.intervalMs);

        const item = document.createElement("div");
        item.className = "task-item" + (enabled ? "" : " disabled") + (sched.id === currentTaskDetailId ? " active" : "");

        const disposableBadge = sched.disposable ? ' <span title="Disposable">\u{1F5D1}\uFE0F</span>' : "";

        // Header row: name + badge, toggle, run
        const headerRow = document.createElement("div");
        headerRow.className = "task-item-header";
        headerRow.innerHTML = `
          <span class="task-item-name">${escapeHtml(sched.id)}${disposableBadge}</span>
          <label class="task-item-toggle" title="${enabled ? "Enabled" : "Disabled"}">
            <input type="checkbox" ${enabled ? "checked" : ""}>
            <span class="toggle-track"></span>
            <span class="toggle-thumb"></span>
          </label>
          <button class="task-item-trigger">Run</button>
        `;

        // Summary line below header
        const summaryRow = document.createElement("div");
        summaryRow.className = "task-item-summary";
        summaryRow.textContent = summaryText;

        const triggerBtn = headerRow.querySelector(".task-item-trigger");
        const toggleInput = headerRow.querySelector(".task-item-toggle input");

        // Toggle enable/disable (stop propagation so card click doesn't fire)
        // Must stop on the <label> itself, not just <input>, because clicking
        // toggle-track/toggle-thumb hits the label first and would bubble to item
        headerRow.querySelector(".task-item-toggle").addEventListener("click", (e) => e.stopPropagation());
        toggleInput.addEventListener("change", async () => {
          const newEnabled = toggleInput.checked;
          enabled = newEnabled;
          item.classList.toggle("disabled", !newEnabled);
          headerRow.querySelector(".task-item-toggle").title = newEnabled ? "Enabled" : "Disabled";
          try {
            const res = await fetch("/api/schedules/" + encodeURIComponent(sched.id), {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ enabled: newEnabled }),
            });
            if (!res.ok) throw new Error("PATCH failed");
          } catch (err) {
            console.error("Failed to toggle schedule:", err);
            enabled = !newEnabled;
            toggleInput.checked = !newEnabled;
            item.classList.toggle("disabled", newEnabled);
            headerRow.querySelector(".task-item-toggle").title = !newEnabled ? "Enabled" : "Disabled";
          }
        });

        // Trigger button
        triggerBtn.addEventListener("click", async (e) => {
          e.stopPropagation();
          triggerBtn.disabled = true;
          triggerBtn.textContent = "…";
          try {
            const res = await fetch("/api/schedules/" + encodeURIComponent(sched.id) + "/trigger", { method: "POST" });
            triggerBtn.textContent = res.ok ? "OK" : "Err";
          } catch { triggerBtn.textContent = "Err"; }
          setTimeout(() => { triggerBtn.textContent = "Run"; triggerBtn.disabled = false; }, 2000);
        });

        // Click card → show task detail in main content area
        item.addEventListener("click", () => {
          openTaskDetail(sched.id);
          if (!isDesktop) closeSidebarFn();
        });

        item.appendChild(headerRow);
        item.appendChild(summaryRow);
        taskPanel.appendChild(item);
      }
    } catch (err) {
      console.warn("Failed to load task panel:", err);
    }
  }

  // ---- Task detail (main content area) ----
  function showTaskDetailView() {
    // Switch main content to show task detail (same pattern as workflowView)
    currentSessionId = null;
    filesView.classList.remove("visible");
    gitView.classList.remove("visible");
    sessionTabs.classList.remove("visible");
    showMainView("workflow");
    resetHeaderContext();
    renderSessionList();
  }

  async function openTaskDetail(scheduleId) {
    // Clear any previous countdown/poll intervals before opening a new detail panel
    if (taskDetailCountdownInterval) {
      clearInterval(taskDetailCountdownInterval);
      taskDetailCountdownInterval = null;
    }
    if (activeRunPollInterval) {
      clearInterval(activeRunPollInterval);
      activeRunPollInterval = null;
    }
    currentTaskDetailId = scheduleId;
    showTaskDetailView();
    headerTitle.textContent = scheduleId;
    workflowView.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-muted)">Loading…</div>';

    try {
      const [schedulesRes, runsRes] = await Promise.all([
        fetch("/api/schedules"),
        fetch("/api/workflow-runs"),
      ]);
      const { schedules = [] } = await schedulesRes.json();
      const { runs = [] } = await runsRes.json();

      const sched = schedules.find(s => s.id === scheduleId);
      if (!sched) {
        workflowView.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-muted)">Task not found.</div>';
        return;
      }

      let enabled = sched.enabled !== false;
      workflowView.innerHTML = "";

      const container = document.createElement("div");
      container.className = "tdp-container";

      // ── Header ──
      const header = document.createElement("div");
      header.className = "tdp-header";
      header.innerHTML = `
        <span class="tdp-title">${escapeHtml(sched.id)}</span>
        <span class="tdp-status-badge ${enabled ? "enabled" : "disabled"}">${enabled ? "Enabled" : "Disabled"}</span>
      `;
      container.appendChild(header);

      // ── Body ──
      const body = document.createElement("div");
      body.className = "tdp-body";

      // ── Basic Info ──
      const infoSection = document.createElement("div");
      infoSection.className = "tdp-section";
      const cronLabel = sched.intervalMs ? formatInterval(sched.intervalMs) : formatCron(sched.cron);
      const runAtLabel = formatRunAt(sched.runAt);
      const runCountDisplay = sched.maxRuns != null
        ? `${sched.runCount || 0} / ${sched.maxRuns}`
        : `${sched.runCount || 0} / \u221E`;

      // Compute next run info for cron schedules
      let nextRunDate = nextCronUTC(sched.cron);
      if (!nextRunDate && sched.intervalMs) {
        const base = sched.lastRun ? new Date(sched.lastRun).getTime() : Date.now();
        nextRunDate = new Date(base + sched.intervalMs);
      }
      const nextRunLocalStr = nextRunDate
        ? nextRunDate.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
        : null;

      infoSection.innerHTML = `
        <div class="tdp-section-title">Basic Info</div>
        <div class="tdp-info-grid">
          <span class="tdp-info-label">Schedule</span>
          <span class="tdp-info-value">${escapeHtml(cronLabel)}</span>
          ${runAtLabel ? `<span class="tdp-info-label">Run At</span><span class="tdp-info-value">${escapeHtml(runAtLabel)}</span>` : ""}
          ${nextRunLocalStr ? `<span class="tdp-info-label">Next Run</span><span class="tdp-info-value">${escapeHtml(nextRunLocalStr)}</span>` : ""}
          ${nextRunDate ? `<span class="tdp-info-label">Countdown</span><span class="tdp-info-value tdp-countdown"></span>` : ""}
          <span class="tdp-info-label">Disposable</span>
          <span class="tdp-info-value">${sched.disposable ? "Yes" : "No"}</span>
          <span class="tdp-info-label">Runs</span>
          <span class="tdp-info-value">${escapeHtml(runCountDisplay)}</span>
        </div>
      `;
      body.appendChild(infoSection);

      // Countdown: update every minute
      if (nextRunDate) {
        const countdownEl = infoSection.querySelector(".tdp-countdown");
        const updateCountdown = () => {
          countdownEl.textContent = formatCountdown(nextRunDate.getTime() - Date.now());
        };
        updateCountdown();
        taskDetailCountdownInterval = setInterval(updateCountdown, 60_000);
      }

      // ── Actions (toggle + run) ──
      const actionsSection = document.createElement("div");
      actionsSection.className = "tdp-actions";
      actionsSection.innerHTML = `
        <label class="tdp-toggle" title="${enabled ? "Enabled" : "Disabled"}">
          <input type="checkbox" ${enabled ? "checked" : ""}>
          <span class="toggle-track"></span>
          <span class="toggle-thumb"></span>
        </label>
        <span class="tdp-toggle-label">${enabled ? "Enabled" : "Disabled"}</span>
        <button class="tdp-run-btn">Run Now</button>
      `;

      const panelToggle = actionsSection.querySelector(".tdp-toggle input");
      const panelToggleLabel = actionsSection.querySelector(".tdp-toggle-label");
      const statusBadge = header.querySelector(".tdp-status-badge");
      const panelRunBtn = actionsSection.querySelector(".tdp-run-btn");

      panelToggle.addEventListener("change", async () => {
        const newEnabled = panelToggle.checked;
        enabled = newEnabled;
        panelToggleLabel.textContent = newEnabled ? "Enabled" : "Disabled";
        statusBadge.textContent = newEnabled ? "Enabled" : "Disabled";
        statusBadge.className = "tdp-status-badge " + (newEnabled ? "enabled" : "disabled");
        try {
          const res = await fetch("/api/schedules/" + encodeURIComponent(sched.id), {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ enabled: newEnabled }),
          });
          if (!res.ok) throw new Error("PATCH failed");
          loadTaskSection();
        } catch (err) {
          console.error("Failed to toggle schedule:", err);
          enabled = !newEnabled;
          panelToggle.checked = !newEnabled;
          panelToggleLabel.textContent = !newEnabled ? "Enabled" : "Disabled";
          statusBadge.textContent = !newEnabled ? "Enabled" : "Disabled";
          statusBadge.className = "tdp-status-badge " + (!newEnabled ? "enabled" : "disabled");
        }
      });

      panelRunBtn.addEventListener("click", async () => {
        panelRunBtn.disabled = true;
        panelRunBtn.textContent = "Running…";
        try {
          const res = await fetch("/api/schedules/" + encodeURIComponent(sched.id) + "/trigger", { method: "POST" });
          const data = await res.json();
          if (res.ok && data.runId) {
            addLiveRunEntry(data.runId, runSection);
            pollRunStatus(data.runId, runSection);
          }
          panelRunBtn.textContent = res.ok ? "Triggered!" : "Error";
        } catch { panelRunBtn.textContent = "Error"; }
        setTimeout(() => { panelRunBtn.textContent = "Run Now"; panelRunBtn.disabled = false; }, 2500);
      });

      body.appendChild(actionsSection);

      // ── Workflow Detail ──
      if (sched.workflow) {
        const wfSection = document.createElement("div");
        wfSection.className = "tdp-section";
        wfSection.innerHTML = `<div class="tdp-section-title">Workflow Detail</div>
          <div style="font-size:11px;color:var(--text-muted)">Loading workflow…</div>`;
        body.appendChild(wfSection);
        loadWorkflowIntoPanel(sched.workflow, wfSection);
      } else if (sched.inlineWorkflow) {
        const wfSection = document.createElement("div");
        wfSection.className = "tdp-section";
        renderInlineWorkflow(sched.inlineWorkflow, wfSection);
        body.appendChild(wfSection);
      }

      // ── Run History ──
      const schedRuns = runs.filter(r => {
        if (sched.workflow) return r.workflow === sched.workflow;
        return r.scheduleId === sched.id;
      });
      const runSection = document.createElement("div");
      runSection.className = "tdp-section";
      runSection.innerHTML = `<div class="tdp-section-title">Run History</div>`;
      if (schedRuns.length === 0) {
        runSection.innerHTML += '<div class="tdp-empty">No runs yet</div>';
      } else {
        const runList = document.createElement("div");
        runList.style.cssText = "display:flex;flex-direction:column;gap:4px";
        for (const run of schedRuns) {
          const entry = document.createElement("div");
          const startedAt = run.startedAt ? relativeTime(new Date(run.startedAt).getTime()) : "—";
          const status = run.status || "unknown";
          entry.innerHTML = `
            <div class="tdp-run-entry">
              <span class="tdp-run-id">${escapeHtml(run.runId.slice(0, 8))}</span>
              <span class="tdp-run-status ${escapeHtml(status)}">${escapeHtml(status)}</span>
              <span class="tdp-run-time">${escapeHtml(startedAt)}</span>
            </div>
            <div class="tdp-run-detail"></div>
          `;
          const detail = entry.querySelector(".tdp-run-detail");
          entry.querySelector(".tdp-run-entry").addEventListener("click", () => {
            const isOpen = detail.classList.contains("open");
            runList.querySelectorAll(".tdp-run-detail.open").forEach(el => el.classList.remove("open"));
            if (isOpen) return;
            detail.classList.add("open");
            if (!detail.dataset.loaded) {
              detail.dataset.loaded = "1";
              buildRunTasksHtml(run, detail);
            }
          });
          runList.appendChild(entry);
        }
        runSection.appendChild(runList);
      }
      body.appendChild(runSection);

      container.appendChild(body);
      workflowView.appendChild(container);
    } catch (err) {
      console.error("Failed to open task detail:", err);
      workflowView.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-muted)">Failed to load task details.</div>';
    }
  }

  function renderInlineWorkflow(inlineWf, container) {
    container.innerHTML = `<div class="tdp-section-title">Workflow: ${escapeHtml(inlineWf.name || "inline")}</div>`;
    const steps = inlineWf.steps || [];
    for (const step of steps) {
      const stepEl = document.createElement("div");
      stepEl.className = "tdp-step";
      const stepType = step.type || "sequential";
      stepEl.innerHTML = `<div class="tdp-step-header">${escapeHtml(step.id || "step")} <span style="font-weight:400;color:var(--text-muted);font-size:11px">(${escapeHtml(stepType)})</span></div>`;
      const tasks = step.tasks || [];
      for (const task of tasks) {
        const taskEl = document.createElement("div");
        taskEl.className = "tdp-task";
        const target = task.sessionId ? `session: ${task.sessionId.slice(0, 8)}…` : (task.workspace || "—");
        const prompt = task.text || task.prompt || "";
        taskEl.innerHTML = `
          <div class="tdp-task-id">${escapeHtml(task.id || "task")}${task.type ? ` <span style="color:var(--text-muted);font-size:11px">(${escapeHtml(task.type)})</span>` : ""}</div>
          <div class="tdp-task-meta">target: ${escapeHtml(target)}</div>
          ${prompt ? `<div class="tdp-task-prompt">${escapeHtml(prompt)}</div>` : ""}
        `;
        stepEl.appendChild(taskEl);
      }
      container.appendChild(stepEl);
    }
  }

  async function loadWorkflowIntoPanel(workflowName, container) {
    try {
      const res = await fetch("/api/workflows");
      if (!res.ok) throw new Error("Failed to fetch workflows");
      const { workflows = [] } = await res.json();
      const wf = workflows.find(w => w.id === workflowName || w.name === workflowName);
      if (!wf) {
        container.innerHTML = '<div class="tdp-section-title">Workflow Detail</div><div class="tdp-empty">Workflow definition not found</div>';
        return;
      }
      container.innerHTML = `<div class="tdp-section-title">Workflow: ${escapeHtml(wf.name || wf.id)}</div>`;
      const steps = wf.steps || [];
      if (steps.length === 0) {
        container.innerHTML += '<div class="tdp-empty">No steps defined</div>';
        return;
      }
      for (const step of steps) {
        const stepEl = document.createElement("div");
        stepEl.className = "tdp-step";
        const stepType = step.type || "sequential";
        stepEl.innerHTML = `<div class="tdp-step-header">${escapeHtml(step.id || "step")} <span style="font-weight:400;color:var(--text-muted);font-size:11px">(${escapeHtml(stepType)})</span></div>`;
        const tasks = step.tasks || [];
        for (const task of tasks) {
          const taskEl = document.createElement("div");
          taskEl.className = "tdp-task";
          const workspace = task.workspace || "—";
          const model = task.model || "—";
          const prompt = task.prompt || "";
          taskEl.innerHTML = `
            <div class="tdp-task-id">${escapeHtml(task.id || "task")}</div>
            <div class="tdp-task-meta">workspace: ${escapeHtml(workspace)} · model: ${escapeHtml(model)}</div>
            ${prompt ? `<div class="tdp-task-prompt">${escapeHtml(prompt)}</div>` : ""}
          `;
          stepEl.appendChild(taskEl);
        }
        container.appendChild(stepEl);
      }
    } catch (err) {
      console.error("Failed to load workflow detail:", err);
      container.innerHTML = '<div class="tdp-section-title">Workflow Detail</div><div class="tdp-empty">Failed to load</div>';
    }
  }

  function startRename(itemEl, session) {
    const nameEl = itemEl.querySelector(".session-item-name");
    const current = session.name || session.tool || "";
    const input = document.createElement("input");
    input.className = "session-rename-input";
    input.value = current;
    nameEl.replaceWith(input);
    input.focus();
    input.select();

    const rerender = renderSessionList;

    function commit() {
      const newName = input.value.trim();
      if (newName && newName !== current) {
        wsSend({ action: "rename", sessionId: session.id, name: newName });
      } else {
        rerender(); // revert
      }
    }

    input.addEventListener("blur", commit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        input.blur();
      }
      if (e.key === "Escape") {
        input.removeEventListener("blur", commit);
        rerender();
      }
    });
  }

  function showSessionDropdown(btn, session, itemEl) {
    const existing = document.querySelector(".session-dropdown");
    if (existing) {
      const wasSameBtn = existing._triggerBtn === btn;
      existing.remove();
      if (wasSameBtn) return;
    }

    const dropdown = document.createElement("div");
    dropdown.className = "session-dropdown";
    dropdown._triggerBtn = btn;
    const curLabel = session.label ? getLabelById(session.label) : null;
    const dotColor = curLabel ? curLabel.color : 'var(--text-muted)';
    dropdown.innerHTML = `
      <div class="session-dropdown-item rename-action">&#9998;&nbsp; Rename</div>
      <div class="session-dropdown-item label-action"><span class="session-dropdown-label-dot" style="background:${dotColor}"></span>&nbsp; Label</div>
      <div class="session-dropdown-item archive-action">&#8863;&nbsp; Archive</div>
      <div class="session-dropdown-item del-action del">&#215;&nbsp; Delete</div>`;
    document.body.appendChild(dropdown);

    // Position below button, right-aligned, clamped to viewport
    const btnRect = btn.getBoundingClientRect();
    const dRect = dropdown.getBoundingClientRect();
    let top = btnRect.bottom + 4;
    let left = btnRect.right - dRect.width;
    if (left < 4) left = 4;
    if (top + dRect.height > window.innerHeight - 8) top = btnRect.top - dRect.height - 4;
    dropdown.style.top = top + "px";
    dropdown.style.left = left + "px";

    dropdown.querySelector(".rename-action").addEventListener("click", (e) => {
      e.stopPropagation();
      dropdown.remove();
      startRename(itemEl, session);
    });

    dropdown.querySelector(".label-action").addEventListener("click", (e) => {
      e.stopPropagation();
      dropdown.remove();
      showLabelPopover(itemEl.querySelector(".session-item-logo"), session);
    });

    dropdown.querySelector(".archive-action").addEventListener("click", (e) => {
      e.stopPropagation();
      dropdown.remove();
      wsSend({ action: "archive", sessionId: session.id, archived: true });
    });

    dropdown.querySelector(".del-action").addEventListener("click", (e) => {
      e.stopPropagation();
      dropdown.remove();
      if (confirm("Delete this session?")) {
        wsSend({ action: "delete", sessionId: session.id });
      }
    });

    function onOutsideEvent(e) {
      if (!dropdown.isConnected) {
        document.removeEventListener("click", onOutsideEvent, true);
        document.removeEventListener("touchstart", onOutsideEvent, true);
        return;
      }
      if (!dropdown.contains(e.target) && e.target !== btn) {
        dropdown.remove();
        document.removeEventListener("click", onOutsideEvent, true);
        document.removeEventListener("touchstart", onOutsideEvent, true);
      }
    }
    setTimeout(() => {
      document.addEventListener("click", onOutsideEvent, true);
      document.addEventListener("touchstart", onOutsideEvent, true);
    }, 0);
  }

  function showArchivedDropdown(btn, session) {
    const existing = document.querySelector(".session-dropdown");
    if (existing) {
      const wasSameBtn = existing._triggerBtn === btn;
      existing.remove();
      if (wasSameBtn) return;
    }
    const dropdown = document.createElement("div");
    dropdown.className = "session-dropdown";
    dropdown._triggerBtn = btn;
    dropdown.innerHTML = `
      <div class="session-dropdown-item unarchive-action">&#8862;&nbsp; Unarchive</div>
      <div class="session-dropdown-item del-action del">&#215;&nbsp; Delete</div>`;
    document.body.appendChild(dropdown);

    const btnRect = btn.getBoundingClientRect();
    const dRect = dropdown.getBoundingClientRect();
    let top = btnRect.bottom + 4;
    let left = btnRect.right - dRect.width;
    if (left < 4) left = 4;
    if (top + dRect.height > window.innerHeight - 8) top = btnRect.top - dRect.height - 4;
    dropdown.style.top = top + "px";
    dropdown.style.left = left + "px";

    dropdown.querySelector(".unarchive-action").addEventListener("click", (e) => {
      e.stopPropagation();
      dropdown.remove();
      wsSend({ action: "archive", sessionId: session.id, archived: false });
    });
    dropdown.querySelector(".del-action").addEventListener("click", (e) => {
      e.stopPropagation();
      dropdown.remove();
      if (confirm("Delete this session?")) {
        wsSend({ action: "delete", sessionId: session.id });
      }
    });

    function onOutsideEvent(e) {
      if (!dropdown.isConnected) {
        document.removeEventListener("click", onOutsideEvent, true);
        document.removeEventListener("touchstart", onOutsideEvent, true);
        return;
      }
      if (!dropdown.contains(e.target) && e.target !== btn) {
        dropdown.remove();
        document.removeEventListener("click", onOutsideEvent, true);
        document.removeEventListener("touchstart", onOutsideEvent, true);
      }
    }
    setTimeout(() => {
      document.addEventListener("click", onOutsideEvent, true);
      document.addEventListener("touchstart", onOutsideEvent, true);
    }, 0);
  }

  // ---- URL hash state management (browser back/forward support) ----
  // Hash format: #s/<sessionId>  |  #s/<sessionId>/files/<path>  |  #s/<sessionId>/git
  function buildHash(sessionId, tab, filePath) {
    if (!sessionId) return "";
    let h = "#s/" + sessionId;
    if (tab === "files" && filePath) {
      h += "/files/" + filePath;
    } else if (tab === "files") {
      h += "/files";
    } else if (tab === "git") {
      h += "/git";
    }
    // "chat" is the default, no suffix needed
    return h;
  }

  function parseHash(hash) {
    if (!hash || !hash.startsWith("#s/")) return null;
    const rest = hash.slice(3); // remove "#s/"
    // Pattern: <sessionId>[/files[/<path>]] or <sessionId>/git
    const slashIdx = rest.indexOf("/");
    if (slashIdx === -1) return { sessionId: rest, tab: "chat", filePath: null };
    const sessionId = rest.slice(0, slashIdx);
    const suffix = rest.slice(slashIdx + 1);
    if (suffix === "git") return { sessionId, tab: "git", filePath: null };
    if (suffix === "files") return { sessionId, tab: "files", filePath: null };
    if (suffix.startsWith("files/")) {
      return { sessionId, tab: "files", filePath: suffix.slice(6) };
    }
    return { sessionId, tab: "chat", filePath: null };
  }

  function pushHashState() {
    if (suppressHashPush) return;
    const hash = buildHash(currentSessionId, activeSessionTab, selectedFilePath);
    if (hash && window.location.hash !== hash) {
      window.history.pushState({ rl: true }, "", hash);
    }
  }

  function replaceHashState() {
    const hash = buildHash(currentSessionId, activeSessionTab, selectedFilePath);
    if (hash) {
      window.history.replaceState({ rl: true }, "", hash);
    }
  }

  window.addEventListener("popstate", function (e) {
    const parsed = parseHash(window.location.hash);
    if (!parsed) {
      // No hash = no session selected, show empty state
      if (currentSessionId) {
        currentSessionId = null;
        showEmpty();
        headerTitle.textContent = "Remote Lab";
        sessionTabs.classList.remove("visible");
        messagesEl.style.display = "";
        document.getElementById("inputArea").style.display = "";
        filesView.classList.remove("visible");
        gitView.classList.remove("visible");
        renderSessionList();
      }
      return;
    }
    suppressHashPush = true;

    const needsSessionSwitch = parsed.sessionId !== currentSessionId;
    if (needsSessionSwitch) {
      const allSess = [...sessions, ...workflowSessions, ...archivedSessions];
      const s = allSess.find(x => x.id === parsed.sessionId);
      if (s) attachSession(parsed.sessionId, s);
    }

    const restoreTabAndFile = () => {
      if (parsed.tab !== activeSessionTab) {
        switchSessionTab(parsed.tab);
      }
      if (parsed.tab === "files" && parsed.filePath) {
        const s = [...sessions, ...workflowSessions, ...archivedSessions].find(x => x.id === currentSessionId);
        if (s?.folder) {
          const waitForTree = () => {
            if (fileTreeCache[s.folder]) {
              selectedFilePath = parsed.filePath;
              loadFileContent(s.folder, parsed.filePath);
              expandTreeToPath(parsed.filePath);
              suppressHashPush = false;
            } else {
              setTimeout(waitForTree, 200);
            }
          };
          setTimeout(waitForTree, 100);
          return; // suppressHashPush cleared in waitForTree
        }
      }
      suppressHashPush = false;
    };

    // If session changed, wait for attach to settle before restoring tab
    if (needsSessionSwitch) {
      setTimeout(restoreTabAndFile, 100);
    } else {
      restoreTabAndFile();
    }
  });

  // ---- ?open= deep link handler ----
  let openFileHandled = false;
  function handleOpenFileParam() {
    if (openFileHandled) return;
    const params = new URLSearchParams(window.location.search);
    const openPath = params.get("open");
    if (!openPath) return;
    openFileHandled = true;
    // Clear the URL param — will be replaced with hash-based state after file opens
    const url = new URL(window.location);
    url.searchParams.delete("open");
    window.history.replaceState({ rl: true }, "", url.pathname + url.search);

    // Find a session whose folder is a prefix of the absolute path
    const allSess = [...sessions, ...archivedSessions, ...workflowSessions];
    const match = allSess
      .filter(s => s.folder && openPath.startsWith(s.folder + "/"))
      .sort((a, b) => b.folder.length - a.folder.length)[0]; // longest match first
    if (!match) {
      alert("No session found for path: " + openPath);
      return;
    }
    const relPath = openPath.slice(match.folder.length + 1);
    attachSession(match.id, match);
    // Wait for session attach to complete, then switch to Files and open the file
    setTimeout(() => {
      switchSessionTab("files");
      // Give file tree time to load, then select the file
      const waitForTree = () => {
        if (fileTreeCache[match.folder]) {
          selectedFilePath = relPath;
          loadFileContent(match.folder, relPath);
          expandTreeToPath(relPath);
          replaceHashState(); // Update URL to reflect file view
        } else {
          setTimeout(waitForTree, 200);
        }
      };
      setTimeout(waitForTree, 300);
    }, 100);
  }

  // ---- Hash-based deep link handler (on initial page load) ----
  let hashOnLoadHandled = false;
  function handleHashOnLoad() {
    if (hashOnLoadHandled) return;
    const parsed = parseHash(window.location.hash);
    if (!parsed) return;
    hashOnLoadHandled = true;
    suppressHashPush = true;
    const allSess = [...sessions, ...archivedSessions, ...workflowSessions];
    const s = allSess.find(x => x.id === parsed.sessionId);
    if (!s) { suppressHashPush = false; return; }
    attachSession(parsed.sessionId, s);
    if (parsed.tab === "chat") {
      suppressHashPush = false;
      return;
    }
    setTimeout(() => {
      switchSessionTab(parsed.tab);
      if (parsed.tab === "files" && parsed.filePath && s.folder) {
        const waitForTree = () => {
          if (fileTreeCache[s.folder]) {
            selectedFilePath = parsed.filePath;
            loadFileContent(s.folder, parsed.filePath);
            expandTreeToPath(parsed.filePath);
            suppressHashPush = false;
          } else {
            setTimeout(waitForTree, 200);
          }
        };
        setTimeout(waitForTree, 300);
      } else {
        suppressHashPush = false;
      }
    }, 100);
  }

  function expandTreeToPath(relPath) {
    const parts = relPath.split("/");
    let currentEl = filesTree;
    for (let i = 0; i < parts.length - 1; i++) {
      const dirEls = currentEl.querySelectorAll(":scope > .files-tree-dir");
      for (const d of dirEls) {
        const nameEl = d.querySelector(":scope > .files-tree-item .files-tree-name");
        if (nameEl && nameEl.textContent === parts[i]) {
          d.classList.add("open");
          const icon = d.querySelector(":scope > .files-tree-item .files-tree-icon");
          if (icon) icon.textContent = "▼";
          currentEl = d.querySelector(".files-tree-children") || d;
          break;
        }
      }
    }
    // Highlight the file
    const fileName = parts[parts.length - 1];
    const fileItems = filesTree.querySelectorAll(".files-tree-item");
    fileItems.forEach(item => {
      item.classList.remove("selected");
      const nameEl = item.querySelector(".files-tree-name");
      if (nameEl && nameEl.textContent === fileName) {
        item.classList.add("selected");
        item.scrollIntoView({ block: "nearest" });
      }
    });
  }

  // ---- Files tab: tree & content viewer ----

  function switchSessionTab(tab) {
    if (tab !== "files" && !checkUnsavedEdits()) return;
    activeMainView = "chat";
    activeSessionTab = tab;
    sessionTabChat.classList.toggle("active", tab === "chat");
    sessionTabFiles.classList.toggle("active", tab === "files");
    sessionTabGit.classList.toggle("active", tab === "git");
    messagesEl.style.display = tab === "chat" ? "" : "none";
    document.getElementById("inputArea").style.display = tab === "chat" ? "" : "none";
    settingsView.style.display = "none";
    workflowView.style.display = "none";
    filesView.classList.toggle("visible", tab === "files");
    gitView.classList.toggle("visible", tab === "git");
    if (tab === "files" && currentSessionId) {
      const s = [...sessions, ...workflowSessions, ...archivedSessions].find(x => x.id === currentSessionId);
      if (s?.folder) loadFileTree(s.folder);
    }
    if (tab === "git" && currentSessionId) {
      const s = [...sessions, ...workflowSessions, ...archivedSessions].find(x => x.id === currentSessionId);
      if (s?.folder) loadGitSubTab(s.folder, activeGitSubTab);
    }
    pushHashState();
  }

  sessionTabChat.addEventListener("click", () => switchSessionTab("chat"));
  sessionTabFiles.addEventListener("click", () => switchSessionTab("files"));
  sessionTabGit.addEventListener("click", () => switchSessionTab("git"));

  async function loadFileTree(folder) {
    if (fileTreeCache[folder]) {
      renderFileTree(folder, fileTreeCache[folder]);
      return;
    }
    filesTree.innerHTML = '<div class="files-loading">Loading...</div>';
    try {
      const res = await fetch(`/api/folders/${encodeURIComponent(folder)}/files`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const tree = data.tree || data; // API returns { tree: [...] }
      fileTreeCache[folder] = tree;
      renderFileTree(folder, tree);
    } catch (err) {
      filesTree.innerHTML = `<div class="files-error">Failed to load files: ${err.message}</div>`;
    }
  }

  function renderFileTree(folder, nodes) {
    filesTree.innerHTML = "";
    const container = document.createDocumentFragment();
    buildTreeNodes(container, nodes, folder, "", 0);
    filesTree.appendChild(container);
  }

  function buildTreeNodes(parent, nodes, folder, pathPrefix, depth) {
    for (const node of nodes) {
      const fullPath = pathPrefix ? pathPrefix + "/" + node.name : node.name;
      if (node.type === "dir") {
        const dirEl = document.createElement("div");
        dirEl.className = "files-tree-dir";
        const item = document.createElement("div");
        item.className = "files-tree-item";
        item.style.paddingLeft = (12 + depth * 16) + "px";
        item.innerHTML = `<span class="files-tree-icon">&#9654;</span><span class="files-tree-name">${esc(node.name)}</span>`;
        item.addEventListener("click", () => {
          dirEl.classList.toggle("open");
          const icon = item.querySelector(".files-tree-icon");
          icon.innerHTML = dirEl.classList.contains("open") ? "&#9660;" : "&#9654;";
        });
        dirEl.appendChild(item);
        if (node.children && node.children.length > 0) {
          const childrenEl = document.createElement("div");
          childrenEl.className = "files-tree-children";
          buildTreeNodes(childrenEl, node.children, folder, fullPath, depth + 1);
          dirEl.appendChild(childrenEl);
        }
        parent.appendChild(dirEl);
      } else {
        const item = document.createElement("div");
        item.className = "files-tree-item";
        item.style.paddingLeft = (12 + depth * 16) + "px";
        item.dataset.path = fullPath;
        item.innerHTML = `<span class="files-tree-icon" style="color:var(--text-muted);font-size:11px">&#128196;</span><span class="files-tree-name">${esc(node.name)}</span>`;
        item.addEventListener("click", () => {
          if (!checkUnsavedEdits()) return;
          const prev = filesTree.querySelector(".files-tree-item.selected");
          if (prev) prev.classList.remove("selected");
          item.classList.add("selected");
          selectedFilePath = fullPath;
          loadFileContent(folder, fullPath);
          pushHashState();
        });
        parent.appendChild(item);
      }
    }
  }

  function extToLang(filename) {
    const ext = filename.split(".").pop().toLowerCase();
    const map = { js: "javascript", mjs: "javascript", ts: "typescript", tsx: "tsx", jsx: "jsx", py: "python", rb: "ruby", rs: "rust", go: "go", java: "java", c: "c", cpp: "cpp", h: "c", hpp: "cpp", cs: "csharp", sh: "bash", bash: "bash", zsh: "bash", json: "json", yaml: "yaml", yml: "yaml", toml: "toml", md: "markdown", html: "xml", htm: "xml", xml: "xml", css: "css", scss: "scss", sql: "sql", swift: "swift", kt: "kotlin", lua: "lua", r: "r", php: "php", vue: "xml", svelte: "xml" };
    return map[ext] || "";
  }

  function getFileType(filename) {
    const ext = filename.split(".").pop().toLowerCase();
    if (["mp4", "webm", "mov", "avi", "mkv"].includes(ext)) return "video";
    if (["mp3", "wav", "aac", "ogg", "flac"].includes(ext)) return "audio";
    if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"].includes(ext)) return "image";
    if (ext === "pdf") return "pdf";
    if (ext === "md") return "markdown";
    if (["tex", "latex"].includes(ext)) return "latex";
    return "text";
  }

  function getAbsolutePath(folder, relPath) {
    return folder + (folder.endsWith("/") ? "" : "/") + relPath;
  }

  function checkUnsavedEdits() {
    if (isFileEditing) {
      const ta = filesContent.querySelector(".files-editor");
      if (ta && ta.value !== rawFileContent) {
        if (!confirm("Unsaved changes will be lost. Continue?")) return false;
      }
    }
    isFileEditing = false;
    rawFileContent = null;
    return true;
  }

  function renderFileReadonly(path, content) {
    const fileType = getFileType(path);
    const s = [...sessions, ...workflowSessions, ...archivedSessions].find(x => x.id === currentSessionId);
    const absPath = s?.folder ? getAbsolutePath(s.folder, path) : path;
    const downloadUrl = `/api/download?path=${encodeURIComponent(absPath)}`;

    // Header with download button
    const headerHtml = `<div class="files-content-header-row">
      <span>${esc(path)}</span>
      <div class="files-edit-actions">
        ${fileType === "text" || fileType === "markdown" || fileType === "latex" ? '<button class="file-edit-btn">Edit</button><button class="file-save-btn" disabled>Save</button>' : ''}
        <a class="file-download-btn" href="${esc(downloadUrl)}" title="Download">↓ Download</a>
      </div>
    </div>`;

    if (fileType === "video") {
      const inlineUrl = `/api/download?path=${encodeURIComponent(absPath)}&inline=1`;
      filesContent.innerHTML = headerHtml +
        `<div class="files-preview-media"><video controls playsinline preload="metadata" src="${esc(inlineUrl)}"></video></div>`;
      return;
    }

    if (fileType === "audio") {
      const inlineUrl = `/api/download?path=${encodeURIComponent(absPath)}&inline=1`;
      filesContent.innerHTML = headerHtml +
        `<div class="files-preview-media"><audio controls preload="metadata" src="${esc(inlineUrl)}"></audio></div>`;
      return;
    }

    if (fileType === "image") {
      const inlineUrl = `/api/download?path=${encodeURIComponent(absPath)}&inline=1`;
      filesContent.innerHTML = headerHtml +
        `<div class="files-preview-media"><img src="${esc(inlineUrl)}" alt="${esc(path)}" loading="lazy" /></div>`;
      return;
    }

    if (fileType === "pdf") {
      const inlineUrl = `/api/download?path=${encodeURIComponent(absPath)}&inline=1`;
      filesContent.innerHTML = headerHtml +
        `<div class="files-preview-pdf"><iframe src="${esc(inlineUrl)}" frameborder="0"></iframe></div>`;
      return;
    }

    if (fileType === "markdown") {
      const renderedHtml = typeof marked !== "undefined" ? marked.parse(content) : esc(content);
      filesContent.innerHTML = headerHtml +
        `<div class="files-preview-markdown">${renderedHtml}</div>`;
      // Highlight code blocks within rendered markdown
      if (typeof hljs !== "undefined") {
        filesContent.querySelectorAll("pre code").forEach(el => hljs.highlightElement(el));
      }
      // Render LaTeX in markdown if KaTeX is available
      if (typeof renderMathInElement !== "undefined") {
        renderMathInElement(filesContent.querySelector(".files-preview-markdown"), {
          delimiters: [
            { left: "$$", right: "$$", display: true },
            { left: "$", right: "$", display: false },
            { left: "\\[", right: "\\]", display: true },
            { left: "\\(", right: "\\)", display: false },
          ],
          throwOnError: false,
        });
      }
      filesContent.querySelector(".file-edit-btn")?.addEventListener("click", () => enterEditMode());
      filesContent.querySelector(".file-save-btn")?.addEventListener("click", () => saveFile());
      return;
    }

    if (fileType === "latex") {
      // Show rendered LaTeX if KaTeX available, otherwise show source
      let latexHtml = `<pre><code class="language-latex">${esc(content)}</code></pre>`;
      if (typeof katex !== "undefined") {
        try {
          latexHtml = `<div class="files-preview-latex">${katex.renderToString(content, { displayMode: true, throwOnError: false })}</div>`;
        } catch { /* fall back to source */ }
      }
      filesContent.innerHTML = headerHtml + latexHtml;
      if (typeof hljs !== "undefined") {
        const codeEl = filesContent.querySelector("code");
        if (codeEl) hljs.highlightElement(codeEl);
      }
      filesContent.querySelector(".file-edit-btn")?.addEventListener("click", () => enterEditMode());
      filesContent.querySelector(".file-save-btn")?.addEventListener("click", () => saveFile());
      return;
    }

    // Default: syntax-highlighted text
    const lang = extToLang(path);
    filesContent.innerHTML = headerHtml +
      `<pre><code class="${lang ? "language-" + lang : ""}">${esc(content)}</code></pre>`;
    if (typeof hljs !== "undefined") {
      const codeEl = filesContent.querySelector("code");
      if (codeEl) hljs.highlightElement(codeEl);
    }
    filesContent.querySelector(".file-edit-btn")?.addEventListener("click", () => enterEditMode());
    filesContent.querySelector(".file-save-btn")?.addEventListener("click", () => saveFile());
  }

  function enterEditMode() {
    isFileEditing = true;
    const pre = filesContent.querySelector("pre");
    if (pre) pre.style.display = "none";
    const existing = filesContent.querySelector(".files-editor");
    if (existing) { existing.style.display = ""; existing.focus(); }
    else {
      const ta = document.createElement("textarea");
      ta.className = "files-editor";
      ta.value = rawFileContent;
      ta.spellcheck = false;
      filesContent.appendChild(ta);
      ta.focus();
    }
    const editBtn = filesContent.querySelector(".file-edit-btn");
    const saveBtn = filesContent.querySelector(".file-save-btn");
    if (editBtn) editBtn.disabled = true;
    if (saveBtn) saveBtn.disabled = false;
  }

  async function saveFile() {
    const ta = filesContent.querySelector(".files-editor");
    if (!ta || !selectedFilePath) return;
    const s = [...sessions, ...workflowSessions, ...archivedSessions].find(x => x.id === currentSessionId);
    if (!s?.folder) return;
    const saveBtn = filesContent.querySelector(".file-save-btn");
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "Saving..."; }
    try {
      const res = await fetch(`/api/folders/${encodeURIComponent(s.folder)}/file`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: selectedFilePath, content: ta.value })
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${res.status}`);
      }
      rawFileContent = ta.value;
      isFileEditing = false;
      renderFileReadonly(selectedFilePath, rawFileContent);
      // Brief "Saved!" flash
      const actions = filesContent.querySelector(".files-edit-actions");
      if (actions) {
        const ok = document.createElement("span");
        ok.className = "save-ok";
        ok.textContent = "Saved!";
        actions.appendChild(ok);
        setTimeout(() => ok.remove(), 2000);
      }
    } catch (err) {
      alert("Save failed: " + err.message);
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = "Save"; }
    }
  }

  async function loadFileContent(folder, path) {
    filesContent.innerHTML = '<div class="files-loading">Loading...</div>';
    const fileType = getFileType(path);

    // Binary files (video, audio, image, pdf) — no need to fetch content, just render preview
    if (["video", "audio", "image", "pdf"].includes(fileType)) {
      rawFileContent = null;
      isFileEditing = false;
      renderFileReadonly(path, "");
      return;
    }

    try {
      const res = await fetch(`/api/folders/${encodeURIComponent(folder)}/file?path=${encodeURIComponent(path)}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      rawFileContent = data.content;
      isFileEditing = false;
      renderFileReadonly(path, data.content);
    } catch (err) {
      filesContent.innerHTML = `<div class="files-error">${esc(err.message)}</div>`;
    }
  }

  // ---- Git tab ----

  function gitApiUrl(folder, action) {
    return `/api/folders/${encodeURIComponent(folder)}/git/${action}`;
  }

  function relativeTime(dateStr) {
    const now = Date.now();
    const then = new Date(dateStr).getTime();
    const diff = Math.max(0, now - then);
    const s = Math.floor(diff / 1000);
    if (s < 60) return "just now";
    const m = Math.floor(s / 60);
    if (m < 60) return m + "m ago";
    const h = Math.floor(m / 60);
    if (h < 24) return h + "h ago";
    const d = Math.floor(h / 24);
    if (d < 30) return d + "d ago";
    return new Date(dateStr).toLocaleDateString();
  }

  function statusClass(s) {
    if (s === "A" || s === "?") return s === "A" ? "added" : "untracked";
    if (s === "M") return "modified";
    if (s === "D") return "deleted";
    if (s === "R") return "renamed";
    return "modified";
  }

  function getCurrentFolder() {
    const s = [...sessions, ...workflowSessions, ...archivedSessions].find(x => x.id === currentSessionId);
    return s?.folder;
  }

  // Sub-tab switching
  document.querySelector(".git-sub-tabs")?.addEventListener("click", (e) => {
    const btn = e.target.closest(".git-sub-tab");
    if (!btn) return;
    const tab = btn.dataset.tab;
    activeGitSubTab = tab;
    document.querySelectorAll(".git-sub-tab").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
    gitChanges.style.display = tab === "changes" ? "" : "none";
    gitHistory.style.display = tab === "history" ? "" : "none";
    gitBranches.style.display = tab === "branches" ? "" : "none";
    const folder = getCurrentFolder();
    if (folder) loadGitSubTab(folder, tab);
  });

  function loadGitSubTab(folder, tab) {
    if (tab === "changes") loadGitStatus(folder);
    else if (tab === "history") loadGitLog(folder);
    else if (tab === "branches") loadGitBranches(folder);
  }

  async function loadGitStatus(folder) {
    gitChanges.innerHTML = '<div class="git-empty">Loading...</div>';
    try {
      const res = await fetch(gitApiUrl(folder, "status"));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      renderGitChanges(folder, data);
    } catch (err) {
      gitChanges.innerHTML = `<div class="git-empty">${esc(err.message)}</div>`;
    }
  }

  function renderGitChanges(folder, data) {
    const staged = data.files.filter(f => f.staged);
    const unstaged = data.files.filter(f => !f.staged);
    let trackingHtml = '';
    if (data.tracking) {
      const aheadCls = data.ahead > 0 ? 'git-ahead' : 'git-ahead zero';
      const behindCls = data.behind > 0 ? 'git-behind' : 'git-behind zero';
      trackingHtml = `<span class="git-branch-badge">${esc(data.branch)}</span>
        <span style="color:var(--text-muted);margin:0 2px">→</span>
        <span style="color:var(--text-secondary);font-size:12px">${esc(data.tracking)}</span>
        <span class="git-ahead-behind">
          <span class="${aheadCls}">↑${data.ahead}</span>
          <span class="${behindCls}">↓${data.behind}</span>
        </span>`;
    } else {
      trackingHtml = `<span class="git-branch-badge">${esc(data.branch || "unknown")}</span>
        <span style="color:var(--text-muted);font-size:11px;margin-left:4px">(no remote)</span>`;
    }
    let html = `<div class="git-branch-bar">
      ${trackingHtml}
      <button class="git-btn" data-action="pull" title="Pull from remote">Pull</button>
      <button class="git-btn" data-action="push" title="Push to remote">Push</button>
    </div>`;

    if (staged.length) {
      html += `<div class="git-section-label">Staged (${staged.length})</div>`;
      staged.forEach(f => {
        html += `<div class="git-file-row">
          <span class="git-file-status ${statusClass(f.status)}">${esc(f.status)}</span>
          <span class="git-file-path" title="${esc(f.path)}">${esc(f.path)}</span>
          <span class="git-file-actions">
            <button class="git-btn" data-action="unstage" data-file="${esc(f.path)}">Unstage</button>
            <button class="git-btn" data-action="diff" data-file="${esc(f.path)}" data-staged="true">Diff</button>
          </span>
        </div>`;
      });
    }

    if (unstaged.length) {
      html += `<div class="git-section-label">Changes (${unstaged.length})</div>`;
      unstaged.forEach(f => {
        html += `<div class="git-file-row">
          <span class="git-file-status ${statusClass(f.status)}">${esc(f.status)}</span>
          <span class="git-file-path" title="${esc(f.path)}">${esc(f.path)}</span>
          <span class="git-file-actions">
            <button class="git-btn" data-action="stage" data-file="${esc(f.path)}">Stage</button>
            <button class="git-btn" data-action="diff" data-file="${esc(f.path)}">Diff</button>
          </span>
        </div>`;
      });
      html += `<div style="margin-top:8px"><button class="git-btn" data-action="stage-all">Stage All</button></div>`;
    }

    if (!staged.length && !unstaged.length) {
      html += `<div class="git-empty">Working tree clean</div>`;
    }

    // Commit area
    html += `<div class="git-commit-area">
      <textarea class="git-commit-input" id="gitCommitMsg" rows="2" placeholder="Commit message..."></textarea>
      <button class="git-btn primary" id="gitCommitBtn"${!staged.length ? " disabled" : ""}>Commit</button>
    </div>`;

    gitChanges.innerHTML = html;

    // Commit button
    document.getElementById("gitCommitBtn")?.addEventListener("click", async () => {
      const msg = document.getElementById("gitCommitMsg")?.value.trim();
      if (!msg) return;
      const btn = document.getElementById("gitCommitBtn");
      btn.disabled = true; btn.textContent = "Committing...";
      try {
        const r = await fetch(gitApiUrl(folder, "commit"), {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: msg })
        });
        if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || `HTTP ${r.status}`); }
        loadGitStatus(folder);
      } catch (err) {
        btn.textContent = "Error: " + err.message;
        setTimeout(() => { btn.textContent = "Commit"; btn.disabled = false; }, 2000);
      }
    });
  }

  // Delegated click handler for git changes actions
  gitChanges.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const folder = getCurrentFolder();
    if (!folder) return;
    const action = btn.dataset.action;
    const file = btn.dataset.file;

    if (action === "stage") {
      btn.disabled = true;
      await fetch(gitApiUrl(folder, "stage"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files: [file] })
      });
      loadGitStatus(folder);
    } else if (action === "unstage") {
      btn.disabled = true;
      await fetch(gitApiUrl(folder, "unstage"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files: [file] })
      });
      loadGitStatus(folder);
    } else if (action === "stage-all") {
      btn.disabled = true;
      await fetch(gitApiUrl(folder, "stage"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true })
      });
      loadGitStatus(folder);
    } else if (action === "diff") {
      showGitDiff(folder, file, btn.dataset.staged === "true");
    } else if (action === "pull") {
      btn.disabled = true; btn.textContent = "Pulling...";
      try {
        const r = await fetch(gitApiUrl(folder, "pull"), {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({})
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
        btn.textContent = d.output || "Done"; btn.disabled = false;
        setTimeout(() => { btn.textContent = "Pull"; }, 2000);
        loadGitStatus(folder);
      } catch (err) {
        btn.textContent = "Error"; btn.disabled = false;
        setTimeout(() => { btn.textContent = "Pull"; }, 2000);
      }
    } else if (action === "push") {
      btn.disabled = true; btn.textContent = "Pushing...";
      try {
        const r = await fetch(gitApiUrl(folder, "push"), {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({})
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
        btn.textContent = d.output || "Done"; btn.disabled = false;
        setTimeout(() => { btn.textContent = "Push"; }, 2000);
        loadGitStatus(folder);
      } catch (err) {
        btn.textContent = "Error"; btn.disabled = false;
        setTimeout(() => { btn.textContent = "Push"; }, 2000);
      }
    }
  });

  async function showGitDiff(folder, file, staged) {
    let url = gitApiUrl(folder, "diff") + `?file=${encodeURIComponent(file)}`;
    if (staged) url += "&staged=true";
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const lines = (data.diff || "No diff available").split("\n");
      let linesHtml = lines.map(line => {
        let cls = "";
        if (line.startsWith("+") && !line.startsWith("+++")) cls = "add";
        else if (line.startsWith("-") && !line.startsWith("---")) cls = "del";
        else if (line.startsWith("@@")) cls = "hunk";
        return `<div class="git-diff-line ${cls}">${esc(line)}</div>`;
      }).join("");

      const overlay = document.createElement("div");
      overlay.className = "git-diff-overlay";
      overlay.innerHTML = `<div class="git-diff-modal">
        <div class="git-diff-header">
          <span>${esc(file)}${staged ? " (staged)" : ""}</span>
          <button class="git-diff-close">&times;</button>
        </div>
        <div class="git-diff-body">${linesHtml}</div>
      </div>`;
      document.body.appendChild(overlay);
      overlay.querySelector(".git-diff-close").addEventListener("click", () => overlay.remove());
      overlay.addEventListener("click", (ev) => { if (ev.target === overlay) overlay.remove(); });
    } catch (err) {
      alert("Failed to load diff: " + err.message);
    }
  }

  async function loadGitLog(folder) {
    gitHistory.innerHTML = '<div class="git-empty">Loading...</div>';
    try {
      const res = await fetch(gitApiUrl(folder, "log") + "?limit=30");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data.commits?.length) {
        gitHistory.innerHTML = '<div class="git-empty">No commits yet</div>';
        return;
      }
      gitHistory.innerHTML = data.commits.map(c =>
        `<div class="git-log-item" data-hash="${esc(c.hash)}">
          <span class="git-log-hash">${esc(c.short || c.hash?.slice(0,7))}</span>
          <span class="git-log-msg">${esc(c.message)}</span>
          <span class="git-log-time">${relativeTime(c.date)}</span>
        </div>`
      ).join("");
    } catch (err) {
      gitHistory.innerHTML = `<div class="git-empty">${esc(err.message)}</div>`;
    }
  }

  function renderBranchCard(b) {
    const indicator = b.current ? '<span class="git-branch-indicator current"></span>' : (b.remote ? '' : '<span class="git-branch-indicator other"></span>');
    const nameCls = b.current ? 'git-branch-name current' : 'git-branch-name';
    let abHtml = '';
    if (!b.remote && (b.ahead != null || b.behind != null)) {
      const aCls = b.ahead > 0 ? 'git-ahead' : 'git-ahead zero';
      const bCls = b.behind > 0 ? 'git-behind' : 'git-behind zero';
      abHtml = `<span class="git-ahead-behind"><span class="${aCls}">↑${b.ahead || 0}</span><span class="${bCls}">↓${b.behind || 0}</span></span>`;
    }
    const hashBadge = `<span class="git-branch-hash">${esc(b.short)}</span>`;
    const timeStr = b.date ? relativeTime(b.date) : '';
    const checkoutBtn = b.current ? '' : `<button class="git-btn" data-checkout="${esc(b.name)}">Checkout</button>`;
    return `<div class="git-branch-card">
      <div class="git-branch-card-top">
        ${indicator}
        <span class="${nameCls}">${esc(b.name)}</span>
        ${hashBadge}
        ${abHtml}
        ${checkoutBtn}
      </div>
      <div class="git-branch-card-bottom">
        <span class="git-branch-msg" title="${esc(b.message)}">${esc(b.message)}</span>
        ${timeStr ? `<span class="git-branch-time">${timeStr}</span>` : ''}
      </div>
    </div>`;
  }

  async function loadGitBranches(folder) {
    gitBranches.innerHTML = '<div class="git-empty">Loading...</div>';
    try {
      const res = await fetch(gitApiUrl(folder, "branches"));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data.branches?.length) {
        gitBranches.innerHTML = '<div class="git-empty">No branches found</div>';
        return;
      }
      const localBranches = data.branches.filter(b => !b.remote);
      const remoteBranches = data.branches.filter(b => b.remote);
      let bhtml = '';
      if (localBranches.length) {
        bhtml += `<div class="git-section-group"><div class="git-section-group-label">Local branches</div>`;
        bhtml += localBranches.map(b => renderBranchCard(b)).join('');
        bhtml += `</div>`;
      }
      if (remoteBranches.length) {
        bhtml += `<div class="git-section-group"><div class="git-section-group-label">Remote branches</div>`;
        bhtml += remoteBranches.map(b => renderBranchCard(b)).join('');
        bhtml += `</div>`;
      }
      gitBranches.innerHTML = bhtml;
    } catch (err) {
      gitBranches.innerHTML = `<div class="git-empty">${esc(err.message)}</div>`;
    }
  }

  // Delegated click handler for branch checkout
  gitBranches.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-checkout]");
    if (!btn) return;
    const folder = getCurrentFolder();
    if (!folder) return;
    btn.disabled = true; btn.textContent = "Switching...";
    try {
      const r = await fetch(gitApiUrl(folder, "checkout"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branch: btn.dataset.checkout })
      });
      if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || `HTTP ${r.status}`); }
      loadGitBranches(folder);
      loadGitStatus(folder); // refresh changes too
    } catch (err) {
      btn.textContent = "Error";
      setTimeout(() => { btn.textContent = "Checkout"; btn.disabled = false; }, 2000);
    }
  });

  function attachSession(id, session) {
    // Hide workflow/task-detail view and restore normal chat layout
    showMainView("chat");
    // Show session tabs, reset to Chat tab
    sessionTabs.classList.add("visible");
    switchSessionTab("chat");
    filesContent.innerHTML = '<div class="files-content-empty">Select a file to view</div>';
    selectedFilePath = null;
    isFileEditing = false;
    rawFileContent = null;
    // Reset git view
    gitChanges.innerHTML = "";
    gitHistory.innerHTML = "";
    gitBranches.innerHTML = "";
    activeGitSubTab = "changes";

    currentTaskDetailId = null;
    if (taskDetailCountdownInterval) {
      clearInterval(taskDetailCountdownInterval);
      taskDetailCountdownInterval = null;
    }
    if (activeRunPollInterval) {
      clearInterval(activeRunPollInterval);
      activeRunPollInterval = null;
    }

    currentSessionId = id;
    clearMessages();
    resetHeaderContext();
    wsSend({ action: "attach", sessionId: id });

    const displayName =
      session?.name || session?.folder?.split("/").pop() || "Session";
    headerTitle.textContent = displayName;
    currentQueuedMessages = Array.isArray(session?.queuedMessages) ? session.queuedMessages : [];
    msgInput.disabled = false;
    sendBtn.disabled = false;
    imgBtn.disabled = false;
    inlineToolSelect.disabled = false;
    inlineModelSelect.disabled = false;
    thinkingToggle.disabled = false;

    if (session?.tool && toolsList.some((t) => t.id === session.tool)) {
      inlineToolSelect.value = session.tool;
      selectedTool = session.tool;
      localStorage.setItem("selectedTool", selectedTool);
      loadInlineModels(selectedTool, session.model || null);
    }

    loadQuickReplies(session?.folder);
    renderQueuedFollowUps();
    msgInput.focus();
    renderSessionList();
    pushHashState();
  }

  // ---- Sidebar ----
  function openSidebar() {
    sidebarOverlay.classList.add("open");
  }
  function closeSidebarFn() {
    sidebarOverlay.classList.remove("open");
  }

  menuBtn.addEventListener("click", openSidebar);
  closeSidebar.addEventListener("click", closeSidebarFn);
  sidebarOverlay.addEventListener("click", (e) => {
    if (e.target === sidebarOverlay && !isDesktop) closeSidebarFn();
  });

  // ---- New Session Modal ----
  newSessionBtn.addEventListener("click", () => {
    if (!isDesktop) closeSidebarFn();
    newSessionModal.classList.add("open");
    loadTools();
    folderInput.value = "";
    folderSuggestions.innerHTML = "";
    folderInput.focus();
  });

  cancelModal.addEventListener("click", () =>
    newSessionModal.classList.remove("open"),
  );
  newSessionModal.addEventListener("click", (e) => {
    if (e.target === newSessionModal) newSessionModal.classList.remove("open");
  });

  folderInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); createSessionBtn.click(); }
  });

  createSessionBtn.addEventListener("click", () => {
    const folder = folderInput.value.trim();
    const tool = toolSelect.value;
    if (!folder) {
      folderInput.focus();
      return;
    }
    wsSend({ action: "create", folder, tool, name: "" });
    newSessionModal.classList.remove("open");

    const handler = (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      if (msg.type === "session" && msg.session) {
        ws.removeEventListener("message", handler);
        attachSession(msg.session.id, msg.session);
        wsSend({ action: "list" });
      }
    };
    ws.addEventListener("message", handler);
  });

  async function loadTools() {
    try {
      const res = await fetch("/api/tools");
      const data = await res.json();
      toolSelect.innerHTML = "";
      let preferredTool = null;
      for (const t of data.tools || []) {
        if (!t.available) continue;
        const opt = document.createElement("option");
        opt.value = t.id;
        opt.textContent = t.name;
        toolSelect.appendChild(opt);
        if (!preferredTool && t.id === chatDefaults.defaultTool) {
          preferredTool = t.id;
        }
        if (!preferredTool) {
          preferredTool = t.id;
        }
      }
      if (preferredTool) {
        toolSelect.value = preferredTool;
      }
    } catch {}
  }

  // Folder autocomplete
  let acTimer = null;
  folderInput.addEventListener("input", () => {
    clearTimeout(acTimer);
    acTimer = setTimeout(async () => {
      const q = folderInput.value.trim();
      if (q.length < 2) {
        folderSuggestions.innerHTML = "";
        return;
      }
      try {
        const res = await fetch(`/api/autocomplete?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        folderSuggestions.innerHTML = "";
        for (const s of (data.suggestions || []).slice(0, 5)) {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.textContent = s.replace(/^\/Users\/[^/]+/, "~");
          btn.onclick = () => {
            folderInput.value = s;
            folderSuggestions.innerHTML = "";
          };
          folderSuggestions.appendChild(btn);
        }
      } catch {}
    }, 200);
  });

  // ---- Image handling ----
  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = reader.result.split(",")[1];
        resolve({
          data: base64,
          mimeType: file.type || "image/png",
          objectUrl: URL.createObjectURL(file),
        });
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function randomId() {
    return Math.random().toString(36).slice(2, 10);
  }

  async function addAttachmentFiles(files) {
    for (const file of files) {
      if (file.type.startsWith("image/")) {
        if (pendingAttachments.filter((attachment) => attachment.mimeType?.startsWith("image/")).length >= 4) continue;
        const image = await fileToBase64(file);
        pendingAttachments.push({
          localId: randomId(),
          file,
          originalName: file.name || "image",
          mimeType: image.mimeType,
          data: image.data,
          objectUrl: image.objectUrl,
          renderAs: "image",
        });
        continue;
      }
      pendingAttachments.push({
        localId: randomId(),
        file,
        originalName: file.name || "attachment",
        mimeType: file.type || "application/octet-stream",
        renderAs: "file",
      });
    }
    renderImagePreviews();
  }

  function renderImagePreviews() {
    imgPreviewStrip.innerHTML = "";
    if (pendingAttachments.length === 0) {
      imgPreviewStrip.classList.remove("has-images");
      return;
    }
    imgPreviewStrip.classList.add("has-images");
    pendingAttachments.forEach((attachment, i) => {
      const isImage = attachment.mimeType?.startsWith("image/") && attachment.objectUrl;
      const item = document.createElement("div");
      item.className = isImage ? "img-preview-item" : "file-preview-item";
      if (isImage) {
        const imgEl = document.createElement("img");
        imgEl.src = attachment.objectUrl;
        item.appendChild(imgEl);
      } else {
        const nameEl = document.createElement("span");
        nameEl.className = "file-preview-name";
        nameEl.textContent = attachment.originalName;
        nameEl.title = attachment.originalName;
        item.appendChild(nameEl);
      }
      const removeBtn = document.createElement("button");
      removeBtn.className = "remove-img";
      removeBtn.innerHTML = "&times;";
      removeBtn.onclick = () => {
        if (attachment.objectUrl) URL.revokeObjectURL(attachment.objectUrl);
        pendingAttachments.splice(i, 1);
        renderImagePreviews();
      };
      item.appendChild(removeBtn);
      imgPreviewStrip.appendChild(item);
    });
  }

  imgBtn.addEventListener("click", () => imgFileInput.click());
  imgFileInput.addEventListener("change", () => {
    if (imgFileInput.files.length > 0) addAttachmentFiles(imgFileInput.files);
    imgFileInput.value = "";
  });

  msgInput.addEventListener("paste", (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const attachmentFiles = [];
    for (const item of items) {
      if (item.type.startsWith("image/") || item.kind === "file") {
        const file = item.getAsFile();
        if (file) attachmentFiles.push(file);
      }
    }
    if (attachmentFiles.length > 0) {
      e.preventDefault();
      addAttachmentFiles(attachmentFiles);
    }
  });

  // ---- Send message ----
  async function sendMessage() {
    const text = msgInput.value.trim();
    if ((!text && pendingAttachments.length === 0) || !currentSessionId) return;

    let uploadedAttachments = [];
    if (pendingAttachments.length > 0) {
      const attachmentsToUpload = [...pendingAttachments];
      pendingAttachments = [];
      renderImagePreviews();
      for (const attachment of attachmentsToUpload) {
        try {
          const res = await fetch(
            `/api/attachments?name=${encodeURIComponent(attachment.originalName)}&mimeType=${encodeURIComponent(attachment.mimeType || "application/octet-stream")}&sessionId=${encodeURIComponent(currentSessionId)}`,
            { method: "POST", body: attachment.file || (attachment.data ? Uint8Array.from(atob(attachment.data), c => c.charCodeAt(0)) : null) }
          );
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            alert(`Upload failed: ${err.error || res.statusText}`);
            continue;
          }
          const data = await res.json();
          uploadedAttachments.push({
            filename: data.filename,
            originalName: data.originalName || attachment.originalName,
            mimeType: data.mimeType || attachment.mimeType,
            sizeBytes: data.sizeBytes,
            url: data.url,
            downloadUrl: data.downloadUrl,
            renderAs: attachment.renderAs || data.renderAs || "file",
          });
        } catch (e) {
          alert(`Upload failed: ${e.message}`);
        }
      }
    }

    const msg = { action: "send", text: text || "(attachment)" };
    if (currentSessionId) sessionLastMessage[currentSessionId] = text || "(attachment)";
    if (selectedTool) msg.tool = selectedTool;
    msg.model = selectedModel;
    msg.thinking = thinkingEnabled;
    if (uploadedAttachments.length > 0) {
      msg.attachments = uploadedAttachments;
    }
    wsSend(msg);
    msgInput.value = "";
    autoResizeInput();
  }

  cancelBtn.addEventListener("click", () => wsSend({ action: "cancel" }));

  // ---- Quick Replies (per-folder, persistent) ----
  let qrButtons = [];
  let qrFolder = null;
  let qrEditing = false;

  function renderQuickReplies() {
    quickReplies.innerHTML = "";
    quickReplies.classList.toggle("editing", qrEditing);
    for (const text of qrButtons) {
      const btn = document.createElement("button");
      btn.className = "qr-btn";
      btn.dataset.text = text;
      btn.textContent = text;
      if (qrEditing) {
        const del = document.createElement("span");
        del.className = "qr-del";
        del.textContent = "\u00d7";
        btn.appendChild(del);
      }
      quickReplies.appendChild(btn);
    }
    if (qrEditing) {
      const addBtn = document.createElement("button");
      addBtn.className = "qr-add";
      addBtn.textContent = "＋";
      addBtn.addEventListener("click", () => {
        const text = prompt("Button text:");
        if (text && text.trim()) {
          qrButtons.push(text.trim());
          saveQuickReplies();
          renderQuickReplies();
        }
      });
      quickReplies.appendChild(addBtn);
    }
    const editBtn = document.createElement("button");
    editBtn.className = "qr-edit-toggle";
    editBtn.textContent = qrEditing ? "✓" : "\u270e";
    editBtn.title = qrEditing ? "Finish editing" : "Edit shortcuts";
    editBtn.addEventListener("click", () => {
      qrEditing = !qrEditing;
      renderQuickReplies();
    });
    quickReplies.appendChild(editBtn);
  }

  async function loadQuickReplies(folder) {
    if (!folder) return;
    qrFolder = folder;
    try {
      const res = await fetch("/api/quick-replies?folder=" + encodeURIComponent(folder));
      const data = await res.json();
      qrButtons = data.buttons || [];
    } catch {
      qrButtons = ["Continue", "Agree", "Commit this", "Restart", "Update your memory"];
    }
    qrEditing = false;
    renderQuickReplies();
  }

  async function saveQuickReplies() {
    if (!qrFolder) return;
    try {
      await fetch("/api/quick-replies", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder: qrFolder, buttons: qrButtons }),
      });
    } catch {}
  }

  quickReplies.addEventListener("click", (e) => {
    const del = e.target.closest(".qr-del");
    if (del && qrEditing) {
      const btn = del.closest(".qr-btn");
      const idx = qrButtons.indexOf(btn.dataset.text);
      if (idx >= 0) {
        qrButtons.splice(idx, 1);
        saveQuickReplies();
        renderQuickReplies();
      }
      return;
    }
    const btn = e.target.closest(".qr-btn");
    if (btn && !qrEditing) {
      const text = btn.dataset.text;
      const cur = msgInput.value;
      msgInput.value = cur ? cur + " " + text : text;
      msgInput.focus();
    }
  });

  sendBtn.addEventListener("click", sendMessage);
  msgInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      sendMessage();
    }
  });

  // Auto-resize textarea: 3 lines default, 10 lines max
  function autoResizeInput() {
    msgInput.style.height = "auto";
    const lineH = parseFloat(getComputedStyle(msgInput).lineHeight) || 24;
    const minH = lineH * 3;
    const maxH = lineH * 10;
    const newH = Math.min(Math.max(msgInput.scrollHeight, minH), maxH);
    msgInput.style.height = newH + "px";
  }
  msgInput.addEventListener("input", autoResizeInput);
  // Set initial height
  requestAnimationFrame(() => autoResizeInput());

  // ---- Progress sidebar ----
  let activeTab = "sessions"; // "sessions" | "progress"
  let progressPollTimer = null;
  let lastProgressState = { sessions: {} };
  function switchTab(tab) {
    activeTab = tab;
    tabSessions.classList.toggle("active", tab === "sessions");
    tabProgress.classList.toggle("active", tab === "progress");
    tabTasks.classList.toggle("active", tab === "tasks");
    sessionList.style.display = tab === "sessions" ? "" : "none";
    progressPanel.classList.toggle("visible", tab === "progress");
    taskPanel.classList.toggle("visible", tab === "tasks");
    newSessionBtn.classList.toggle("hidden", tab !== "sessions");
    if (tab === "progress") {
      startTaskFlowPolling();
    } else {
      stopTaskFlowPolling();
    }
    if (tab === "tasks") {
      loadTaskSection();
    }
  }

  tabSessions.addEventListener("click", () => switchTab("sessions"));
  tabProgress.addEventListener("click", () => switchTab("progress"));
  tabTasks.addEventListener("click", () => switchTab("tasks"));

  function relativeTime(ts) {
    const diff = Date.now() - ts;
    if (diff < 60_000) return "just now";
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return `${Math.floor(diff / 86_400_000)}d ago`;
  }

  // ---- Task Flow board (kanban by status) ----

  let _taskFlowTimer = null;

  function renderProgressPanel() {
    // Fetch tasks from API and render kanban board
    fetch("/api/tasks")
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(data => renderTaskFlowBoard(data.tasks || []))
      .catch(() => renderTaskFlowBoard([]));
  }

  function renderTaskFlowBoard(tasks) {
    progressPanel.innerHTML = "";

    if (tasks.length === 0) {
      const empty = document.createElement("div");
      empty.className = "tf-empty";
      empty.textContent = "No tasks. Create tasks via Orchestrator.";
      progressPanel.appendChild(empty);
      return;
    }

    const board = document.createElement("div");
    board.className = "tf-board";

    const columns = [
      { key: "in_progress", label: "In Progress" },
      { key: "blocked", label: "Blocked" },
      { key: "pending", label: "Pending" },
      { key: "completed", label: "Completed" },
    ];

    for (const col of columns) {
      const colTasks = tasks.filter(t => t.status === col.key);
      if (colTasks.length === 0) continue;

      const colEl = document.createElement("div");
      colEl.className = "tf-column";

      const header = document.createElement("div");
      header.className = `tf-column-header status-${col.key}`;
      header.innerHTML = `<span class="tf-status-dot ${col.key}"></span> ${escapeHtml(col.label)} <span class="tf-count">${colTasks.length}</span>`;
      colEl.appendChild(header);

      for (const task of colTasks) {
        const card = document.createElement("div");
        card.className = "tf-card";

        // Find session name for display
        let sessionLabel = "";
        if (task.assigned_session_id) {
          const sess = sessions.find(s => s.id === task.assigned_session_id);
          sessionLabel = sess ? (sess.name || sess.id.slice(0, 8)) : task.assigned_session_id.slice(0, 8);
        }

        card.innerHTML = `
          <div class="tf-card-title">${escapeHtml(task.subject)}</div>
          <div class="tf-card-meta">
            ${sessionLabel ? `<span class="tf-card-session">${escapeHtml(sessionLabel)}</span>` : ""}
            ${task.created_at ? `<span>${relativeTime(new Date(task.created_at).getTime())}</span>` : ""}
          </div>
          ${task.blocked_by && task.blocked_by.length > 0 ? `<div class="tf-card-deps">Waiting: ${task.blocked_by.map(id => escapeHtml(id.slice(0, 8))).join(", ")}</div>` : ""}
        `;

        // Click to jump to assigned session
        if (task.assigned_session_id) {
          card.addEventListener("click", () => {
            const session = sessions.find(s => s.id === task.assigned_session_id);
            if (session) {
              switchTab("sessions");
              attachSession(session.id, session);
              if (!isDesktop) closeSidebarFn();
            }
          });
        }

        colEl.appendChild(card);
      }

      board.appendChild(colEl);
    }

    progressPanel.appendChild(board);
  }

  // Auto-refresh task flow every 10 seconds when tab is active
  function startTaskFlowPolling() {
    stopTaskFlowPolling();
    renderProgressPanel();
    _taskFlowTimer = setInterval(renderProgressPanel, 10000);
  }
  function stopTaskFlowPolling() {
    if (_taskFlowTimer) { clearInterval(_taskFlowTimer); _taskFlowTimer = null; }
  }


  // ---- Live run helpers ----

  function addLiveRunEntry(runId, runSection) {
    const entry = document.createElement("div");
    entry.id = `run-${runId}`;
    entry.innerHTML = `
      <div class="tdp-run-entry">
        <span class="tdp-run-id">${runId.slice(0, 8)}</span>
        <span class="tdp-run-status running">running</span>
        <span class="tdp-run-time">just now</span>
      </div>
      <div class="tdp-run-detail open">
        <div class="tdp-run-live-status" style="padding:8px;font-size:11px;color:var(--text-muted)">
          Starting workflow…
        </div>
      </div>
    `;
    const title = runSection.querySelector(".tdp-section-title");
    if (title && title.nextSibling) {
      runSection.insertBefore(entry, title.nextSibling);
    } else {
      runSection.appendChild(entry);
    }
    const empty = runSection.querySelector(".tdp-empty");
    if (empty) empty.remove();
  }

  function pollRunStatus(runId, runSection) {
    if (activeRunPollInterval) clearInterval(activeRunPollInterval);
    activeRunPollInterval = setInterval(async () => {
      try {
        const res = await fetch(`/api/workflow-runs/${encodeURIComponent(runId)}`);
        if (!res.ok) return;
        const meta = await res.json();

        const entry = document.getElementById(`run-${runId}`);
        if (!entry) { clearInterval(activeRunPollInterval); activeRunPollInterval = null; return; }

        const statusEl = entry.querySelector(".tdp-run-status");
        if (statusEl) {
          statusEl.textContent = meta.status;
          statusEl.className = `tdp-run-status ${meta.status}`;
        }

        const liveStatus = entry.querySelector(".tdp-run-live-status");
        if (liveStatus && meta.steps) {
          const stepEntries = Object.entries(meta.steps);
          if (stepEntries.length === 0) {
            liveStatus.textContent = "Starting workflow…";
          } else {
            liveStatus.innerHTML = stepEntries.map(([stepId, step]) =>
              `<div><strong>${escapeHtml(stepId)}</strong>: ${escapeHtml(step.status)}</div>`
            ).join('');
          }
        }

        if (meta.status === 'completed' || meta.status === 'failed') {
          clearInterval(activeRunPollInterval);
          activeRunPollInterval = null;
          if (liveStatus) {
            liveStatus.innerHTML = '';
            buildRunTasksHtml(meta, liveStatus);
          }
        }
      } catch (err) {
        console.warn('Poll run status failed:', err);
      }
    }, 3000);
  }

  // ---- Workflow main view (reserved for future run history detail) ----
  function buildRunTasksHtml(run, container) {
    const steps = run.steps || {};
    const stepEntries = Object.entries(steps);
    if (stepEntries.length === 0) {
      container.innerHTML = '<div class="workflow-empty" style="padding:6px 8px">No steps recorded</div>';
      return;
    }
    for (const [stepId, stepInfo] of stepEntries) {
      for (const taskId of (stepInfo.tasks || [])) {
        const taskRow = document.createElement("div");
        taskRow.className = "workflow-task-row";
        taskRow.innerHTML = `
          <div class="workflow-task-header">
            <span class="workflow-task-id">${escapeHtml(stepId + "/" + taskId)}</span>
            <span class="workflow-task-chevron">▶</span>
          </div>
          <div class="workflow-task-body"></div>
        `;
        const taskHeader = taskRow.querySelector(".workflow-task-header");
        const body = taskRow.querySelector(".workflow-task-body");
        const chevron = taskRow.querySelector(".workflow-task-chevron");
        taskHeader.addEventListener("click", async () => {
          const wasOpen = body.classList.contains("open");
          body.classList.toggle("open", !wasOpen);
          chevron.style.transform = wasOpen ? "" : "rotate(90deg)";
          if (!wasOpen && !body.dataset.loaded) {
            body.textContent = "Loading…";
            try {
              const res = await fetch(`/api/workflow-runs/${encodeURIComponent(run.runId)}/task/${encodeURIComponent(taskId)}`);
              const data = await res.json();
              body.textContent = data.text || "(empty)";
              body.dataset.loaded = "1";
            } catch {
              body.textContent = "(failed to load)";
            }
          }
        });
        container.appendChild(taskRow);
      }
    }
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function fetchSidebarState() {
    try {
      const res = await fetch("/api/sidebar");
      if (!res.ok) return;
      const state = await res.json();
      // Clear pending flag for sessions whose summary just arrived or updated
      for (const [sessionId, entry] of Object.entries(state.sessions || {})) {
        if (pendingSummary.has(sessionId)) {
          const prev = lastSidebarUpdatedAt[sessionId] || 0;
          if ((entry.updatedAt || 0) > prev) {
            pendingSummary.delete(sessionId);
          }
        }
        lastSidebarUpdatedAt[sessionId] = entry.updatedAt || 0;
      }
      lastProgressState = state;
    } catch {}
  }

  // ---- Report System ----

  const reportBell = document.getElementById("reportBell");
  const reportBadge = document.getElementById("reportBadge");
  const reportPanel = document.getElementById("reportPanel");
  const reportPanelBackdrop = document.getElementById("reportPanelBackdrop");
  const reportPanelClose = document.getElementById("reportPanelClose");
  const reportListEl = document.getElementById("reportList");
  const reportDetail = document.getElementById("reportDetail");
  const reportDetailTitle = document.getElementById("reportDetailTitle");
  const reportBack = document.getElementById("reportBack");
  const reportDetailClose = document.getElementById("reportDetailClose");
  const reportGotoSession = document.getElementById("reportGotoSession");
  const reportIframe = document.getElementById("reportIframe");

  const reportManager = {
    reports: [],
    unreadCount: 0,
    currentReportId: null,

    async loadReports() {
      try {
        const res = await fetch("/api/reports");
        this.reports = await res.json();
        this.unreadCount = this.reports.filter((r) => !r.read).length;
        this.updateBadge();
        this.renderList();
      } catch {}
    },

    updateBadge() {
      if (this.unreadCount > 0) {
        reportBadge.textContent = this.unreadCount;
        reportBadge.classList.remove("hidden");
      } else {
        reportBadge.classList.add("hidden");
      }
    },

    renderList() {
      if (this.reports.length === 0) {
        reportListEl.innerHTML =
          '<div class="report-list-empty">No reports yet</div>';
        return;
      }
      reportListEl.innerHTML = "";
      for (const r of this.reports) {
        const item = document.createElement("div");
        item.className = "report-item" + (r.read ? "" : " unread");
        const time = new Date(r.createdAt);
        const timeStr =
          time.toLocaleDateString("zh-CN", {
            month: "short",
            day: "numeric",
          }) +
          " " +
          time.toLocaleTimeString("zh-CN", {
            hour: "2-digit",
            minute: "2-digit",
          });
        item.innerHTML =
          '<div class="report-item-title"></div>' +
          '<div class="report-item-meta">' +
          "<span></span>" +
          "<span></span>" +
          '<button class="report-item-delete" title="Delete">&times;</button>' +
          "</div>";
        item.querySelector(".report-item-title").textContent = r.title;
        const metaSpans = item.querySelectorAll(".report-item-meta span");
        metaSpans[0].textContent = r.source;
        metaSpans[1].textContent = timeStr;
        item
          .querySelector(".report-item-delete")
          .addEventListener("click", (e) => {
            e.stopPropagation();
            this.deleteReport(r.id);
          });
        item.addEventListener("click", () => this.openDetail(r.id));
        reportListEl.appendChild(item);
      }
    },

    async openDetail(id) {
      // Mark as read
      const report = this.reports.find((r) => r.id === id);
      if (report && !report.read) {
        report.read = true;
        this.unreadCount = Math.max(0, this.unreadCount - 1);
        this.updateBadge();
        this.renderList();
        fetch(`/api/reports/${id}/read`, { method: "PATCH" }).catch(() => {});
        wsSend({ action: "mark-report-read", reportId: id });
      }
      // Open in new tab
      window.open(`/reports/${id}`, '_blank');
    },

    closeDetail() {
      reportDetail.classList.add("hidden");
      reportIframe.src = "about:blank";
      this.currentReportId = null;
    },

    gotoSession() {
      const report = this.reports.find(
        (r) => r.id === this.currentReportId,
      );
      if (report?.sessionId) {
        this.closeDetail();
        reportPanel.classList.add("hidden");
        reportPanelBackdrop.classList.add("hidden");
        const sess = sessions.find((s) => s.id === report.sessionId);
        if (sess) attachSession(sess.id, sess);
      }
    },

    async deleteReport(id) {
      try {
        await fetch(`/api/reports/${id}`, { method: "DELETE" });
        const idx = this.reports.findIndex((r) => r.id === id);
        if (idx !== -1) {
          if (!this.reports[idx].read) {
            this.unreadCount = Math.max(0, this.unreadCount - 1);
            this.updateBadge();
          }
          this.reports.splice(idx, 1);
          this.renderList();
        }
        if (this.currentReportId === id) this.closeDetail();
      } catch {}
    },

    handleNewReport(report) {
      this.reports.unshift(report);
      this.unreadCount++;
      this.updateBadge();
      this.renderList();
      // Browser system notification
      if (
        "Notification" in window &&
        Notification.permission === "granted"
      ) {
        const n = new Notification(report.title, {
          body: `From: ${report.source}`,
          tag: `report-${report.id}`,
        });
        n.onclick = () => {
          window.focus();
          this.openDetail(report.id);
          n.close();
        };
      }
    },

    togglePanel() {
      const isHidden = reportPanel.classList.contains("hidden");
      if (isHidden) {
        // Request notification permission on first open
        if (
          "Notification" in window &&
          Notification.permission === "default"
        ) {
          Notification.requestPermission();
        }
        reportPanel.classList.remove("hidden");
        reportPanelBackdrop.classList.remove("hidden");
      } else {
        reportPanel.classList.add("hidden");
        reportPanelBackdrop.classList.add("hidden");
      }
    },
  };

  reportBell.addEventListener("click", () => reportManager.togglePanel());
  reportPanelClose.addEventListener("click", () => {
    reportPanel.classList.add("hidden");
    reportPanelBackdrop.classList.add("hidden");
  });
  reportPanelBackdrop.addEventListener("click", () => {
    reportPanel.classList.add("hidden");
    reportPanelBackdrop.classList.add("hidden");
  });
  reportBack.addEventListener("click", () => reportManager.closeDetail());
  reportDetailClose.addEventListener("click", () =>
    reportManager.closeDetail(),
  );
  reportGotoSession.addEventListener("click", () =>
    reportManager.gotoSession(),
  );

  // ---- Intercept file preview links for SPA navigation ----
  // Links like /api/download?path=...&preview=1 would cause a full page reload.
  // Instead, navigate within the SPA by opening the file in the Files tab.
  document.addEventListener("click", function (e) {
    const a = e.target.closest("a[href]");
    if (!a) return;
    const href = a.getAttribute("href");
    if (!href) return;

    // Match /api/download?path=<abs_path>&preview=1 (or &preview=1 anywhere in query)
    let match;
    try {
      const url = new URL(href, window.location.origin);
      if (url.pathname === "/api/download" && url.searchParams.get("preview") === "1") {
        match = url.searchParams.get("path");
      }
    } catch (_) {}

    // Also match /?open=<abs_path> links
    if (!match) {
      try {
        const url = new URL(href, window.location.origin);
        if ((url.pathname === "/" || url.pathname === "") && url.searchParams.get("open")) {
          match = url.searchParams.get("open");
        }
      } catch (_) {}
    }

    if (!match) return;

    e.preventDefault();
    // Navigate to the file within the SPA — single history entry for the whole jump
    const allSess = [...sessions, ...archivedSessions, ...workflowSessions];
    const sess = allSess
      .filter(s => s.folder && match.startsWith(s.folder + "/"))
      .sort((a, b) => b.folder.length - a.folder.length)[0];
    if (!sess) {
      alert("No session found for path: " + match);
      return;
    }
    const relPath = match.slice(sess.folder.length + 1);
    // Suppress all intermediate pushState calls; we push once at the very end
    suppressHashPush = true;
    if (sess.id !== currentSessionId) {
      attachSession(sess.id, sess);
    }
    setTimeout(() => {
      switchSessionTab("files");
      const waitForTree = () => {
        if (fileTreeCache[sess.folder]) {
          selectedFilePath = relPath;
          loadFileContent(sess.folder, relPath);
          expandTreeToPath(relPath);
          // Now push exactly one history entry for the final state
          suppressHashPush = false;
          pushHashState();
        } else {
          setTimeout(waitForTree, 200);
        }
      };
      setTimeout(waitForTree, 300);
    }, sess.id !== currentSessionId ? 100 : 0);
  });

  // ---- Init ----
  applyTheme();
  setInterval(applyTheme, 60000); // recheck time every minute for auto mode
  themeBtn.addEventListener("click", function (e) { e.stopPropagation(); toggleThemePicker(); });
  settingsBtn.addEventListener("click", function () { openSettingsView().catch((err) => alert(err.message || "Failed to load settings")); });
  settingsBackBtn.addEventListener("click", function () { closeSettingsView(); });
  automationChatTool.addEventListener("change", function () {
    syncChatDefaultModelFields();
  });
  automationChatNamingTool.addEventListener("change", function () {
    populateSettingsModelSelect(
      automationChatNamingModel,
      automationChatNamingTool.value || "codex",
      automationChatNamingModel.value || chatDefaults.namingModel || "gpt-5.4-mini"
    ).catch(() => {});
  });
  automationWorkflowTool.addEventListener("change", function () {
    populateSettingsModelSelect(
      automationWorkflowModel,
      automationWorkflowTool.value || "codex",
      automationWorkflowModel.value || automationDefaults.workflowModel || "gpt-5.4"
    ).catch(() => {});
  });
  automationSessionMessageTool.addEventListener("change", function () {
    const toolId = automationSessionMessageTool.value && automationSessionMessageTool.value !== "inherit"
      ? automationSessionMessageTool.value
      : (chatDefaults.defaultTool || "codex");
    populateSettingsModelSelect(
      automationSessionMessageModel,
      toolId,
      automationSessionMessageModel.value || automationDefaults.sessionMessageModel || "gpt-5.4"
    ).catch(() => {});
  });
  workflowOverrideList.addEventListener("change", function (e) {
    const target = e.target;
    if (!(target instanceof HTMLSelectElement)) return;
    if (target.dataset.field !== "tool") return;
    const card = target.closest("[data-workflow-key]");
    if (!card) return;
    populateSettingsModelSelect(
      card.querySelector('[data-field="model"]'),
      target.value || automationDefaults.workflowTool || "codex",
      ""
    ).catch(() => {});
  });
  scheduleOverrideList.addEventListener("change", function (e) {
    const target = e.target;
    if (!(target instanceof HTMLSelectElement)) return;
    const card = target.closest("[data-schedule-key]");
    if (!card) return;
    if (target.dataset.field === "workflowTool") {
      populateSettingsModelSelect(
        card.querySelector('[data-field="workflowModel"]'),
        target.value || automationDefaults.workflowTool || "codex",
        ""
      ).catch(() => {});
    }
    if (target.dataset.field === "sessionMessageTool") {
      const toolId = target.value && target.value !== "inherit"
        ? target.value
        : (automationDefaults.sessionMessageTool !== "inherit" ? automationDefaults.sessionMessageTool : chatDefaults.defaultTool || "codex");
      populateSettingsModelSelect(
        card.querySelector('[data-field="sessionMessageModel"]'),
        toolId,
        ""
      ).catch(() => {});
    }
  });
  automationSave.addEventListener("click", async function () {
    try {
      await saveAutomationSettings();
    } catch (err) {
      settingsSaveStatus.textContent = err.message || "Failed to save settings";
    }
  });
  initResponsiveLayout();
  loadSessionLabels();
  loadUiSettings().then(() => {
    loadInlineTools().then(() => loadInlineModels());
  });
  reportManager.loadReports();
  connect();
})();
