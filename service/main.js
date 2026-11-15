"use strict";

/*
 * Local service for the 痛PC MOD OpenChamber extension.
 *
 * The service is deliberately thin: it only runs the PowerShell scripts that
 * already live in this package (install.ps1 / uninstall.ps1) and reports what
 * it can see on disk. All renderer patching stays in those scripts, so there
 * is one implementation of the MOD, not two.
 *
 * Host contract: packages/sdk/GUEST_SERVICES.md
 *   OPENCHAMBER_SERVICE_PORT / OPENCHAMBER_SERVICE_TOKEN
 *   GET /health, Authorization: Bearer <token>
 */

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");

const PORT = Number(process.env.OPENCHAMBER_SERVICE_PORT || 0);
const TOKEN = process.env.OPENCHAMBER_SERVICE_TOKEN || "";
const DATA_DIR = process.env.OPENCHAMBER_SERVICE_DATA_DIR
  || path.join(os.tmpdir(), "openchamber-itachou-mod");
const PACKAGE_ROOT = path.resolve(__dirname, "..");
const VERSION = readPackageVersion();

// Keep these in sync with install.ps1 / uninstall.ps1.
const MARKER = "<!-- itachou-mod -->";
const CSS_NAME = "itachou.css";
const BG_NAME = "itachou-bg.jpg";

const MAX_BODY = 1_000_000;
const MAX_OUTPUT = 64 * 1024;
const SCRIPT_TIMEOUT_MS = 180_000;
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

let busy = false;

if (!PORT || !TOKEN) {
  log("missing OPENCHAMBER_SERVICE_PORT or OPENCHAMBER_SERVICE_TOKEN; exiting");
  process.exit(1);
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((error) => {
    log(`unhandled: ${error && error.stack ? error.stack : error}`);
    const status = Number(error && error.status) || 500;
    sendJson(res, status, { ok: false, error: errorMessage(error) });
  });
});

server.listen(PORT, "127.0.0.1", () => {
  log(`listening on 127.0.0.1:${PORT} (package ${PACKAGE_ROOT})`);
});

server.on("error", (error) => {
  log(`listen failed: ${error && error.message ? error.message : error}`);
  process.exit(1);
});

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}

async function handle(req, res) {
  if (!isAuthorized(req)) {
    sendJson(res, 401, { ok: false, error: "unauthorized" });
    return;
  }

  const url = new URL(req.url || "/", "http://127.0.0.1");

  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, { ok: true, version: VERSION });
    return;
  }

  if (req.method === "GET" && url.pathname === "/status") {
    sendJson(res, 200, { ok: true, ...statusPayload() });
    return;
  }

  if (req.method === "POST" && url.pathname === "/apply") {
    const body = await readBody(req);
    const result = await apply(body);
    sendJson(res, 200, { ok: true, ...result });
    return;
  }

  if (req.method === "POST" && url.pathname === "/uninstall") {
    const body = await readBody(req);
    const result = await uninstall(body);
    sendJson(res, 200, { ok: true, ...result });
    return;
  }

  if (req.method === "GET" && url.pathname === "/log") {
    sendText(res, 200, readLog());
    return;
  }

  sendJson(res, 404, { ok: false, error: "not found" });
}

function isAuthorized(req) {
  const expected = `Bearer ${TOKEN}`;
  const actual = req.headers.authorization || "";
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > MAX_BODY) {
        reject(httpError(413, "リクエストが大きすぎます。"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!raw.trim()) {
        resolve({});
        return;
      }
      try {
        let value = JSON.parse(raw);
        // The host forwards the guest's `body` string as-is. Accept a second
        // JSON layer too, in case a proxy serializes the payload once more.
        if (typeof value === "string") {
          try {
            value = JSON.parse(value);
          } catch {
            // Keep the plain string; the route will treat it as no options.
          }
        }
        resolve(value && typeof value === "object" ? value : {});
      } catch {
        reject(httpError(400, "リクエストの JSON を読めません。"));
      }
    });
    req.on("error", reject);
  });
}

async function apply(body) {
  if (busy) throw httpError(409, "別の処理を実行中です。");

  const image = typeof body.image === "string" ? body.image.trim() : "";
  const requestedWebDist = typeof body.webDist === "string" ? body.webDist.trim() : "";
  const saved = readSettings();

  if (image && !path.isAbsolute(image)) {
    throw httpError(400, "背景画像は絶対パスで指定してください。");
  }
  if (image && !IMAGE_EXTENSIONS.has(path.extname(image).toLowerCase())) {
    throw httpError(400, "背景画像は .jpg / .jpeg / .png / .webp を指定してください。");
  }
  if (image && !fs.existsSync(image)) {
    throw httpError(400, `背景画像が見つかりません: ${image}`);
  }
  if (image) {
    let stat = null;
    try {
      stat = fs.statSync(image);
    } catch {
      throw httpError(400, `背景画像が見つかりません: ${image}`);
    }
    if (!stat.isFile()) {
      throw httpError(400, `背景画像がファイルではありません: ${image}`);
    }
  }
  if (!image && !fs.existsSync(path.join(PACKAGE_ROOT, "bg.jpg"))) {
    throw httpError(400, "背景画像の絶対パスを指定してください（パッケージに bg.jpg がありません）。");
  }

  const webDist = resolveForWrite(requestedWebDist, saved);
  if (!webDist) {
    throw httpError(400, "OpenChamber の web-dist が見つかりません。");
  }

  const args = ["-WebDist", webDist];
  if (image) args.push("-Image", image);

  const result = await runScript("install.ps1", args);
  if (result.ok) {
    saveSettings({ image: image || null, webDist });
  }
  return { ...result, status: inspectWebDist(webDist) };
}

async function uninstall(body) {
  if (busy) throw httpError(409, "別の処理を実行中です。");

  const requestedWebDist = typeof body.webDist === "string" ? body.webDist.trim() : "";
  const saved = readSettings();
  const webDist = resolveForWrite(requestedWebDist, saved);
  if (!webDist) {
    throw httpError(400, "OpenChamber の web-dist が見つかりません。");
  }

  const result = await runScript("uninstall.ps1", ["-WebDist", webDist]);
  return { ...result, status: inspectWebDist(webDist) };
}

function runScript(scriptName, args) {
  return new Promise((resolve, reject) => {
    const powershell = findPowerShell();
    if (!powershell) {
      reject(httpError(500, "PowerShell が見つかりません（pwsh または powershell が必要です）。"));
      return;
    }

    const scriptPath = path.join(PACKAGE_ROOT, scriptName);
    if (!fs.existsSync(scriptPath)) {
      reject(httpError(500, `${scriptName} がパッケージ内に見つかりません。`));
      return;
    }

    busy = true;
    const startedAt = Date.now();
    const child = spawn(
      powershell,
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath, ...args],
      {
        cwd: PACKAGE_ROOT,
        windowsHide: true,
        env: process.env,
      },
    );

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout = (stdout + chunk).slice(-MAX_OUTPUT);
    });
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk).slice(-MAX_OUTPUT);
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, SCRIPT_TIMEOUT_MS);

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      busy = false;
      logRun(scriptName, args, null, false, stdout, stderr);
      reject(httpError(500, `PowerShell を起動できません: ${error.message}`));
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      busy = false;
      const ok = code === 0 && !timedOut;
      logRun(scriptName, args, code, timedOut, stdout, stderr);
      resolve({
        ok,
        exitCode: code,
        timedOut,
        durationMs: Date.now() - startedAt,
        stdout: tail(stdout),
        stderr: tail(stderr),
        script: scriptName,
        powershell,
      });
    });
  });
}

function statusPayload() {
  const saved = readSettings();
  let webDist = null;
  try {
    webDist = resolveWebDist(saved.webDist || null);
  } catch {
    webDist = resolveWebDist(null);
  }

  const powershell = findPowerShell();
  return {
    version: VERSION,
    platform: process.platform,
    webDist,
    ...inspectWebDist(webDist),
    bundledImage: fs.existsSync(path.join(PACKAGE_ROOT, "bg.jpg")),
    lastImage: typeof saved.image === "string" && saved.image ? saved.image : null,
    powershell,
    powershellName: powershell ? path.basename(powershell) : null,
    scripts: {
      install: fs.existsSync(path.join(PACKAGE_ROOT, "install.ps1")),
      uninstall: fs.existsSync(path.join(PACKAGE_ROOT, "uninstall.ps1")),
    },
    dataDir: DATA_DIR,
    logPath: logPath(),
  };
}

function inspectWebDist(webDist) {
  if (!webDist) {
    return { webDist: null, marker: false, css: false, background: false, installed: false };
  }

  let html = "";
  try {
    html = fs.readFileSync(path.join(webDist, "index.html"), "utf8");
  } catch {
    html = "";
  }

  const marker = html.includes(MARKER);
  const css = fs.existsSync(path.join(webDist, "assets", CSS_NAME));
  const background = fs.existsSync(path.join(webDist, "assets", BG_NAME));

  return {
    webDist,
    marker,
    css,
    background,
    installed: marker && css && background,
  };
}

function resolveWebDist(explicit) {
  if (explicit) {
    const full = path.resolve(explicit);
    if (!fs.existsSync(path.join(full, "index.html"))) {
      throw httpError(400, `index.html が見つかりません: ${full}`);
    }
    return full;
  }

  for (const candidate of webDistCandidates()) {
    if (fs.existsSync(path.join(candidate, "index.html"))) return candidate;
  }
  return null;
}

// A saved path can go stale after an app move or reinstall. An explicit path
// from the caller is an error when invalid; a saved one falls back to the
// auto-detected install.
function resolveForWrite(requestedWebDist, saved) {
  if (requestedWebDist) return resolveWebDist(requestedWebDist);
  try {
    return resolveWebDist(saved.webDist || null);
  } catch {
    return resolveWebDist(null);
  }
}

function webDistCandidates() {
  const candidates = [];
  const exeDir = path.dirname(process.execPath || "");
  if (exeDir) candidates.push(path.join(exeDir, "resources", "web-dist"));

  if (process.env.LOCALAPPDATA) {
    candidates.push(path.join(process.env.LOCALAPPDATA, "Programs", "@openchamberelectron", "resources", "web-dist"));
  }
  if (process.env.ProgramFiles) {
    candidates.push(path.join(process.env.ProgramFiles, "@openchamberelectron", "resources", "web-dist"));
  }

  return [...new Set(candidates)];
}

function findPowerShell() {
  const pwsh = [];
  const windowsPowerShell = [];

  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    if (!dir) continue;
    const pwshPath = path.join(dir, "pwsh.exe");
    if (fs.existsSync(pwshPath) && !pwsh.includes(pwshPath)) pwsh.push(pwshPath);
    const psPath = path.join(dir, "powershell.exe");
    if (fs.existsSync(psPath) && !windowsPowerShell.includes(psPath)) windowsPowerShell.push(psPath);
  }

  const systemPowerShell = path.join(
    process.env.SystemRoot || "C:\\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  if (fs.existsSync(systemPowerShell) && !windowsPowerShell.includes(systemPowerShell)) {
    windowsPowerShell.push(systemPowerShell);
  }

  return pwsh[0] || windowsPowerShell[0] || null;
}

function settingsPath() {
  return path.join(DATA_DIR, "settings.json");
}

function readSettings() {
  try {
    const value = JSON.parse(fs.readFileSync(settingsPath(), "utf8"));
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function saveSettings(patch) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const next = { ...readSettings(), ...patch };
    fs.writeFileSync(settingsPath(), `${JSON.stringify(next, null, 2)}\n`, "utf8");
  } catch (error) {
    log(`could not save settings: ${errorMessage(error)}`);
  }
}

function readPackageVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8"));
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function logPath() {
  return path.join(DATA_DIR, "service.log");
}

function log(line) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.appendFileSync(logPath(), `${new Date().toISOString()} ${line}\n`, "utf8");
  } catch {
    // Logging must never take the service down.
  }
}

function readLog() {
  try {
    return tail(fs.readFileSync(logPath(), "utf8"));
  } catch {
    return "";
  }
}

function logRun(scriptName, args, code, timedOut, stdout, stderr) {
  const safeArgs = args.map((arg) => (path.isAbsolute(arg) ? path.basename(arg) : arg));
  log(`${scriptName} ${safeArgs.join(" ")} -> ${code === null ? "spawn-error" : code}${timedOut ? " (timeout)" : ""}`);
  if (stdout.trim()) log(`stdout: ${tail(stdout).trim()}`);
  if (stderr.trim()) log(`stderr: ${tail(stderr).trim()}`);
}

function tail(value) {
  return value.length > MAX_OUTPUT ? value.slice(-MAX_OUTPUT) : value;
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function errorMessage(error) {
  if (!error) return "unknown error";
  return error.message || String(error);
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function sendText(res, status, text) {
  res.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(text),
  });
  res.end(text);
}
