import { connectHost, HostRequestError } from "@openchamber/sdk";

const els = {
  badge: document.getElementById("badge"),
  notice: document.getElementById("notice"),
  state: document.getElementById("state"),
  webdist: document.getElementById("webdist"),
  bundled: document.getElementById("bundled"),
  powershell: document.getElementById("powershell"),
  image: document.getElementById("image"),
  imageHint: document.getElementById("imageHint"),
  apply: document.getElementById("apply"),
  uninstall: document.getElementById("uninstall"),
  refresh: document.getElementById("refresh"),
  logBox: document.getElementById("logBox"),
  log: document.getElementById("log"),
};

let host = null;
let status = null;
let busy = false;

try {
  host = connectHost();
} catch (error) {
  showFatal(error);
}

if (host) {
  host.onReady((context) => applyTheme(context.theme));

  els.apply.addEventListener("click", () => run("apply"));
  els.uninstall.addEventListener("click", () => run("uninstall"));
  els.refresh.addEventListener("click", () => refresh());
  els.image.addEventListener("input", () => updateActions());

  refresh();
}

async function refresh() {
  if (!host) return;

  els.refresh.disabled = true;
  try {
    const data = await call("GET", "/status");
    status = data;
    renderStatus();
  } catch (error) {
    status = null;
    renderError(error);
  } finally {
    els.refresh.disabled = false;
    updateActions();
  }
}

async function run(action) {
  if (!host || busy) return;

  const image = els.image.value.trim();
  if (action === "apply" && !image && !(status && status.bundledImage)) {
    toast("背景画像の絶対パスを入力してください。", "error");
    els.image.focus();
    return;
  }

  setBusy(true, action);
  let logged = false;
  try {
    const data = action === "apply"
      ? await call("POST", "/apply", { image })
      : await call("POST", "/uninstall", {});

    showLog(data);
    logged = true;
    if (!data.ok) {
      throw new Error(data.error || data.stderr || "処理に失敗しました。");
    }

    toast(
      action === "apply"
        ? "適用しました。Ctrl+R で反映されます。"
        : "解除しました。Ctrl+R で反映されます。",
      "success",
    );
    await refresh();
  } catch (error) {
    const message = errorMessage(error);
    if (!logged) showLog({ error: message });
    toast(message, "error");
  } finally {
    setBusy(false, action);
  }
}

async function call(method, path, body) {
  const request = { method, path };
  if (body !== undefined) request.body = JSON.stringify(body);

  const result = await host.serviceRequest(request);
  let data = {};

  if (result && result.body) {
    try {
      data = JSON.parse(result.body);
    } catch {
      data = { ok: false, error: String(result.body) };
    }
  }

  if (result && result.status >= 400) {
    throw new Error((data && data.error) || `HTTP ${result.status}`);
  }

  return data && typeof data === "object" ? data : {};
}

function renderStatus() {
  const s = status;
  if (!s) return;

  clearNotice();

  if (s.lastImage && !els.image.value.trim()) {
    els.image.value = s.lastImage;
  }

  els.state.textContent = s.installed
    ? "適用済み"
    : (s.marker || s.css || s.background ? "未完了（一部のみ）" : "未適用");

  setBadge(s.installed ? "success" : "neutral", s.installed ? "適用済み" : "未適用");

  els.webdist.textContent = s.webDist || "見つかりません";
  els.webdist.title = s.webDist || "";

  els.bundled.textContent = s.bundledImage ? "bg.jpg あり" : "なし";

  els.powershell.textContent = s.powershellName || "見つかりません";
  els.powershell.title = s.powershell || "";

  els.imageHint.textContent = s.bundledImage
    ? "空欄ならパッケージ内の bg.jpg を使います（jpg / png / webp）。"
    : "パッケージに bg.jpg がありません。jpg / png / webp の絶対パスを入力してください。";

  if (!s.webDist) {
    showNotice("warning", "OpenChamber の web-dist が見つかりません。インストール先を確認してください。");
  } else if (!s.powershell) {
    showNotice("error", "PowerShell が見つかりません。pwsh または powershell を PATH に通してください。");
  } else if (!s.scripts || !s.scripts.install) {
    showNotice("error", "install.ps1 がパッケージ内に見つかりません。");
  }

  updateActions();
}

function renderError(error) {
  setBadge("error", "エラー");
  els.state.textContent = "接続できません";
  els.webdist.textContent = "—";
  els.bundled.textContent = "—";
  els.powershell.textContent = "—";
  showNotice("error", errorMessage(error));
  updateActions();
}

function updateActions() {
  const s = status;
  const ready = Boolean(s && s.webDist && s.powershell && s.scripts && s.scripts.install);
  const hasImage = els.image.value.trim().length > 0 || Boolean(s && s.bundledImage);

  els.apply.disabled = busy || !ready || !hasImage;
  els.uninstall.disabled = busy || !ready;
  els.refresh.disabled = busy;
}

function setBusy(value, action) {
  busy = value;
  document.body.dataset.busy = value ? "true" : "false";
  els.apply.textContent = value && action === "apply" ? "適用中…" : "適用";
  els.uninstall.textContent = value && action === "uninstall" ? "解除中…" : "解除";
  updateActions();
}

function showLog(data) {
  const lines = [];
  if (data && data.error) lines.push(data.error);
  if (data && data.stdout && data.stdout.trim()) lines.push(data.stdout.trim());
  if (data && data.stderr && data.stderr.trim()) lines.push(data.stderr.trim());
  if (data && typeof data.exitCode === "number") {
    lines.push(`exit ${data.exitCode}${data.timedOut ? "（タイムアウト）" : ""}`);
  }
  if (lines.length === 0) return;

  els.log.textContent = lines.join("\n\n").slice(-8000);
  els.logBox.hidden = false;
  els.logBox.open = true;
}

function setBadge(tone, text) {
  els.badge.dataset.tone = tone;
  els.badge.textContent = text;
}

function showNotice(tone, text) {
  els.notice.dataset.tone = tone;
  els.notice.textContent = text;
  els.notice.hidden = false;
}

function clearNotice() {
  els.notice.hidden = true;
  els.notice.textContent = "";
}

function toast(message, kind) {
  if (!host) return;
  host.toast({ kind, message }).catch(() => {});
}

function applyTheme(theme) {
  if (!theme || !theme.tokens) return;

  const root = document.documentElement;
  root.dataset.mode = theme.mode === "light" ? "light" : "dark";

  const tokens = theme.tokens;
  const set = (name, value) => {
    if (typeof value === "string" && value) root.style.setProperty(name, value);
  };

  set("--oc-bg", tokens.background);
  set("--oc-elevated", tokens.elevated);
  set("--oc-fg", tokens.foreground);
  set("--oc-muted-surface", tokens.mutedSurface);
  set("--oc-muted-fg", tokens.muted);
  set("--oc-border", tokens.border);
  set("--oc-hover", tokens.hover);
  set("--oc-focus", tokens.focus);
  set("--oc-primary", tokens.primary);
  set("--oc-primary-fg", tokens.primaryForeground);
  set("--oc-success", tokens.successText);
  set("--oc-error", tokens.errorText);
}

function errorMessage(error) {
  if (error instanceof HostRequestError) {
    switch (error.code) {
      case "NO_SERVICE":
        return "ローカルサービスの権限がありません。Settings → Extensions で承認してください。";
      case "DISABLED":
        return "この拡張は一時停止されています。Settings → Extensions で有効にしてください。";
      case "SERVICE_FAILED":
        return "ローカルサービスを起動できませんでした。Settings → Extensions で権限を確認してください。";
      case "HOST_UNAVAILABLE":
        return "OpenChamber から開いてください。";
      default:
        return `${error.code}: ${error.message || ""}`.trim();
    }
  }

  if (error && error.message) return error.message;
  return String(error);
}

function showFatal(error) {
  setBadge("error", "エラー");
  els.state.textContent = "接続できません";
  showNotice("error", errorMessage(error));
  updateActions();
}
