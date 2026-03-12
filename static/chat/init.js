// ---- Visitor mode setup ----
function applyVisitorMode() {
  visitorMode = true;
  selectedTool = null;
  selectedModel = null;
  selectedEffort = null;
  document.body.classList.add("visitor-mode");
  // Hide sidebar toggle, new session button, and management UI
  if (menuBtn) menuBtn.style.display = "none";
  if (newSessionBtn) newSessionBtn.style.display = "none";
  if (collapseBtn) collapseBtn.style.display = "none";
  // Hide tool/model selectors and context management (visitors use defaults)
  if (inlineToolSelect) inlineToolSelect.style.display = "none";
  if (inlineModelSelect) inlineModelSelect.style.display = "none";
  if (effortSelect) effortSelect.style.display = "none";
  if (thinkingToggle) thinkingToggle.style.display = "none";
  if (compactBtn) compactBtn.style.display = "none";
  if (dropToolsBtn) dropToolsBtn.style.display = "none";
  if (contextTokens) contextTokens.style.display = "none";
  if (typeof syncInputHeightForLayout === "function") syncInputHeightForLayout();
  syncCaptureButton();
  syncForkButton();
  syncShareButton();
}

// ---- Init ----
initResponsiveLayout();

async function initApp() {
  try {
    const info = await fetchJsonOrRedirect("/api/auth/me");
    if (info.role === "visitor" && info.sessionId) {
      visitorSessionId = info.sessionId;
      applyVisitorMode();
    }
  } catch {}

  const url = new URL(window.location.href);
  if (url.searchParams.has("visitor")) {
    url.searchParams.delete("visitor");
    history.replaceState(null, "", `${url.pathname}${url.search}`);
  }

  syncAddToolModal();
  syncCaptureButton();
  syncForkButton();
  syncShareButton();
  if (!visitorMode) {
    await loadInlineTools();
    await fetchAppsList();
    initializePushNotifications();
  }
  await bootstrapViaHttp();
  connect();
}

initApp();
