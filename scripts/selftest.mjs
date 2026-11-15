import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.join(os.tmpdir(), `openchamber-itachou-selftest-${process.pid}`);
const webDist = path.join(root, "web-dist");
const assets = path.join(webDist, "assets");
const dataDir = path.join(root, "data");
const image = path.join(root, "test image.jpg");
const token = "selftest-token";

let child;
let exitCode = 0;
const results = [];

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

async function waitForHealth(port) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await request(port, "GET", "/health");
      if (response.status === 200) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("service did not become healthy");
}

try {
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(assets, { recursive: true });
  fs.writeFileSync(
    path.join(webDist, "index.html"),
    "<!doctype html>\n<html>\n<head>\n<title>fixture</title>\n</head>\n<body>fixture</body>\n</html>\n",
    "utf8",
  );
  fs.writeFileSync(image, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

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

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });

  await waitForHealth(port);

  const unauthorized = await request(port, "GET", "/health", undefined, false);
  check("rejects a request without the token", unauthorized.status === 401, String(unauthorized.status));

  const initial = await request(port, "GET", "/status");
  check("status answers", initial.status === 200);
  check("status finds a web-dist", Boolean(initial.json?.webDist), initial.json?.webDist || "");
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

  const relative = await request(port, "POST", "/apply", { webDist, image: "bg.jpg" });
  check("rejects a relative image path", relative.status === 400, String(relative.status));

  fs.writeFileSync(path.join(root, "not-an-image.txt"), "not an image", "utf8");
  const wrongType = await request(port, "POST", "/apply", { webDist, image: path.join(root, "not-an-image.txt") });
  check("rejects a non-image extension", wrongType.status === 400, String(wrongType.status));

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
