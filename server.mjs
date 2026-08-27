import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const envFile = await readFile(join(root, ".env"), "utf8").catch(() => "");
for (const line of envFile.split(/\r?\n/)) {
  const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
}

const port = Number(process.env.PORT || 3000);
const googleTtsKey = process.env.GOOGLE_TTS_API_KEY || "";
const pathummaKey = process.env.PATHUMMA_API_KEY || process.env.TTS_API_KEY || "";
const pathummaBaseUrl = process.env.TTS_BASE_URL || process.env.PATHUMMA_BASE_URL || "https://tokenmind.pathumma.in.th/v1";
const ttsModel = process.env.TTS_MODEL || "ptm-tts-1";
const ttsVoice = process.env.TTS_VOICE || "female";

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".glb": "model/gltf-binary",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".wav": "audio/wav"
};

function sendJson(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*"
  });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function proxyJson(req, res, target, extraHeaders = {}, body = null) {
  const response = await fetch(target, {
    method: req.method,
    headers: { "Content-Type": "application/json", ...extraHeaders },
    body: body || await readBody(req)
  });
  const contentType = response.headers.get("content-type") || "application/json";
  res.writeHead(response.status, {
    "Content-Type": contentType,
    "Access-Control-Allow-Origin": "*"
  });
  response.body.pipeTo(new WritableStream({
    write(chunk) {
      res.write(Buffer.from(chunk));
    },
    close() {
      res.end();
    }
  }));
}

async function handle(req, res) {
  const startedAt = Date.now();
  console.log(`[${new Date().toISOString()}] --> ${req.method} ${req.url}`);
  res.on("finish", () => {
    console.log(`[${new Date().toISOString()}] <-- ${req.method} ${req.url} ${res.statusCode} ${Date.now() - startedAt}ms`);
  });

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
    });
    return res.end();
  }

  try {
    if (req.method === "GET" && req.url === "/app/jwt/get") {
      return sendJson(res, 200, { jwt: "" });
    }

    if (req.method === "POST" && req.url === "/gtts/") {
      if (!googleTtsKey) return sendJson(res, 500, { error: "GOOGLE_TTS_API_KEY is not configured" });
      return await proxyJson(
        req,
        res,
        `https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(googleTtsKey)}`
      );
    }

    if (req.method === "POST" && req.url.startsWith("/pathumma/v1/")) {
      if (!pathummaKey) return sendJson(res, 500, { error: "PATHUMMA_API_KEY is not configured" });
      const target = `${pathummaBaseUrl}${req.url.slice("/pathumma/v1".length)}`;
      let body = await readBody(req);
      if (req.url === "/pathumma/v1/audio/speech") {
        const payload = JSON.parse(body.toString("utf8"));
        payload.model = ttsModel;
        payload.voice = ttsVoice;
        body = JSON.stringify(payload);
      }
      return await proxyJson(req, res, target, { Authorization: `Bearer ${pathummaKey}` }, body);
    }

    if (req.method === "GET") {
      const requestedPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
      const relativePath = requestedPath === "/" ? "/index.html" : requestedPath;
      const filePath = normalize(join(root, relativePath));
      if (!filePath.startsWith(root)) return sendJson(res, 403, { error: "Forbidden" });
      const content = await readFile(filePath);
      res.writeHead(200, {
        "Content-Type": mimeTypes[extname(filePath)] || "application/octet-stream",
        "Access-Control-Allow-Origin": "*"
      });
      return res.end(content);
    }

    return sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    console.error(error);
    return sendJson(res, 502, { error: "Upstream request failed" });
  }
}

createServer(handle).listen(port, () => {
  console.log(`TalkingHead server running at http://localhost:${port}`);
});
