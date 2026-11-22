import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.join(os.tmpdir(), `openchamber-itachou-selftest-${process.pid}`);
const dataDir = path.join(root, "data");
// Fixtures live under DATA_DIR because /apply only trusts web-dist locations
// that the service itself owns (or that the saved settings point at).
const webDist = path.join(dataDir, "web-dist");
const assets = path.join(webDist, "assets");
const webDistNoHead = path.join(dataDir, "web-dist-nohead");
const outsideWebDist = path.join(root, "outside-web-dist");
const image = path.join(root, "test image.jpg");
const token = "selftest-token";

let child;
let exitCode = 0;
const results = [];
// Hoisted so waitForHealth can report the real crash reason.
let stdout = "";
let stderr = "";

function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok) });
  if (!ok) exitCode = 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

async function request(port, method, requestPath, body, auth = true) {
  const response = await fetch(`http://127.0.0.1:${port}${requestPath}`, {
    method,
    headers: {
      ...(auth ? { authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // The /log endpoint answers text/plain.
  }
  return { status: response.status, text, json };
}

function capturedOutput() {
  return `\n--- stdout ---\n${stdout || "(empty)"}\n--- stderr ---\n${stderr || "(empty)"}`;
}

async function waitForHealth(port) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child && child.exitCode !== null) {
      throw new Error(`service exited before becoming healthy (exit ${child.exitCode})${capturedOutput()}`);
    }
    try {
      const response = await request(port, "GET", "/health");
      if (response.status === 200) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`service did not become healthy${capturedOutput()}`);
}

try {
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(assets, { recursive: true });
  fs.writeFileSync(
    path.join(webDist, "index.html"),
    "<!doctype html>\n<html>\n<head>\n<title>fixture</title>\n</head>\n<body>fixture</body>\n</html>\n",
    "utf8",
  );
  // A web-dist install.ps1 must reject: no </head> to inject into.
  fs.mkdirSync(path.join(webDistNoHead, "assets"), { recursive: true });
  fs.writeFileSync(
    path.join(webDistNoHead, "index.html"),
    "<!doctype html>\n<html>\n<head>\n<title>no-head</title>\n<body>fixture</body>\n</html>\n",
    "utf8",
  );

  // A lookalike folder outside DATA_DIR: /apply must refuse it even though it
  // has an index.html and an assets dir, so a token holder cannot rewrite
  // arbitrary directories. Keep the original bytes to prove it stayed intact.
  const outsideHtml = "<!doctype html>\n<html><head></head><body>outside</body></html>\n";
  fs.mkdirSync(path.join(outsideWebDist, "assets"), { recursive: true });
  fs.writeFileSync(path.join(outsideWebDist, "index.html"), outsideHtml, "utf8");
  fs.writeFileSync(image, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

  // Seed the saved location so /status deterministically reports the fixture
  // instead of whatever OpenChamber happens to be installed in this machine.
  const settingsFile = path.join(dataDir, "settings.json");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(settingsFile, `${JSON.stringify({ webDist })}\n`, "utf8");

  const port = await freePort();
  child = spawn(process.execPath, [path.join(repo, "service", "main.js")], {
    env: {
      ...process.env,
      OPENCHAMBER_SERVICE_PORT: String(port),
      OPENCHAMBER_SERVICE_TOKEN: token,
      OPENCHAMBER_SERVICE_DATA_DIR: dataDir,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });

  await waitForHealth(port);

  const unauthorized = await request(port, "GET", "/health", undefined, false);
  check("rejects a request without the token", unauthorized.status === 401, String(unauthorized.status));

  const initial = await request(port, "GET", "/status");
  check("status answers", initial.status === 200);
  check("status reports the seeded web-dist", initial.json?.webDist === webDist, initial.json?.webDist || "");
  check("status finds PowerShell", Boolean(initial.json?.powershell), initial.json?.powershell || "");
  check("status sees the scripts", initial.json?.scripts?.install === true && initial.json?.scripts?.uninstall === true);

  const applied = await request(port, "POST", "/apply", { webDist, image });
  check("apply succeeds", applied.status === 200 && applied.json?.ok === true, applied.text.slice(0, 240));
  check("apply reports installed", applied.json?.status?.installed === true);
  check("apply writes the marker", fs.readFileSync(path.join(webDist, "index.html"), "utf8").includes("<!-- itachou-mod -->"));
  check("apply copies the css", fs.existsSync(path.join(assets, "itachou.css")));
  check("apply copies the image", fs.existsSync(path.join(assets, "itachou-bg.jpg")));

  const again = await request(port, "POST", "/apply", { webDist, image });
  const markerCount = (fs.readFileSync(path.join(webDist, "index.html"), "utf8").match(/<!-- itachou-mod -->/g) || []).length;
  check("apply is idempotent", again.json?.ok === true && markerCount === 1);

  // The host may forward the guest's body string as-is, which the service
  // accepts as a second JSON layer (readBody parses it twice). request()
  // stringifies once more, so this produces exactly two layers. Keep that
  // documented behavior covered instead of rejecting it.
  const doubleJsonBody = JSON.stringify({ webDist, image });
  const doubleJson = await request(port, "POST", "/apply", doubleJsonBody);
  check("apply accepts a double-encoded JSON body", doubleJson.status === 200 && doubleJson.json?.ok === true, doubleJson.text.slice(0, 240));

  const untrusted = await request(port, "POST", "/apply", { webDist: outsideWebDist, image });
  check("rejects an untrusted web-dist path", untrusted.status === 400, String(untrusted.status));
  check(
    "untrusted web-dist was not modified",
    fs.readFileSync(path.join(outsideWebDist, "index.html"), "utf8") === outsideHtml
      && fs.readdirSync(path.join(outsideWebDist, "assets")).length === 0,
  );

  const relative = await request(port, "POST", "/apply", { webDist, image: "bg.jpg" });
  check("rejects a relative image path", relative.status === 400, String(relative.status));

  fs.writeFileSync(path.join(root, "not-an-image.txt"), "not an image", "utf8");
  const wrongType = await request(port, "POST", "/apply", { webDist, image: path.join(root, "not-an-image.txt") });
  check("rejects a non-image extension", wrongType.status === 400, String(wrongType.status));

  const missingImage = await request(port, "POST", "/apply", { webDist, image: path.join(root, "missing image.jpg") });
  check(
    "rejects a missing image file",
    missingImage.status === 400 && missingImage.text.includes("背景画像"),
    `${missingImage.status} ${missingImage.text.slice(0, 160)}`,
  );

  // The failure path must leave the working fixture alone.
  const noHead = await request(port, "POST", "/apply", { webDist: webDistNoHead, image });
  check("apply fails on a web-dist without </head>", noHead.status === 200 && noHead.json?.ok === false, noHead.text.slice(0, 240));
  check("failed apply reports a non-zero exit code", typeof noHead.json?.exitCode === "number" && noHead.json.exitCode !== 0, String(noHead.json?.exitCode));
  check("failed apply reports not installed", noHead.json?.status?.installed === false);
  check("failed apply leaves the working fixture installed", fs.readFileSync(path.join(webDist, "index.html"), "utf8").includes("<!-- itachou-mod -->"));

  // A corrupt settings file must not take the service down.
  fs.writeFileSync(settingsFile, "{ not valid json", "utf8");
  const corrupt = await request(port, "GET", "/status");
  const settingsWarning = corrupt.json?.settingsError || corrupt.json?.settingsWarning || "";
  check("status survives a corrupt settings.json", corrupt.status === 200, String(corrupt.status));
  check("status reports the settings problem", typeof settingsWarning === "string" && settingsWarning.length > 0, String(settingsWarning));
  fs.writeFileSync(settingsFile, `${JSON.stringify({ webDist })}\n`, "utf8");

  const removed = await request(port, "POST", "/uninstall", {});
  check("uninstall succeeds", removed.status === 200 && removed.json?.ok === true, removed.text.slice(0, 240));
  check("uninstall removes the marker", !fs.readFileSync(path.join(webDist, "index.html"), "utf8").includes("<!-- itachou-mod -->"));
  check("uninstall removes the assets", !fs.existsSync(path.join(assets, "itachou.css")) && !fs.existsSync(path.join(assets, "itachou-bg.jpg")));

  const log = await request(port, "GET", "/log");
  check("log endpoint answers", log.status === 200 && log.text.includes("install.ps1"));
} catch (error) {
  check("selftest completed", false, error && error.stack ? error.stack : String(error));
} finally {
  if (child && child.exitCode === null) {
    await new Promise((resolve) => {
      child.once("exit", resolve);
      child.kill();
      setTimeout(resolve, 2000).unref();
    });
  }
  fs.rmSync(root, { recursive: true, force: true });

  const failed = results.filter((entry) => !entry.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
}

process.exitCode = exitCode;
