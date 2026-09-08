import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = fileURLToPath(new URL(".", import.meta.url));
const envFile = await readFile(join(root, ".env"), "utf8").catch(() => "");
for (const line of envFile.split(/\r?\n/)) {
  const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "").trim();
}

const port = Number(process.env.PORT || 3000);
const googleTtsKey = process.env.GOOGLE_TTS_API_KEY || "";
const pathummaKey = process.env.PATHUMMA_API_KEY || process.env.TTS_API_KEY || "";
const pathummaBaseUrl = process.env.TTS_BASE_URL || process.env.PATHUMMA_BASE_URL || "https://tokenmind.pathumma.in.th/v1";
const ttsModel = process.env.TTS_MODEL || "ptm-tts-1";
const ttsVoice = process.env.TTS_VOICE || "female";

function convertAudioToWav(audioBuffer) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", [
      "-y",
      "-i", "pipe:0",
      "-f", "wav",
      "-acodec", "pcm_s16le",
      "-ar", "16000",
      "-ac", "1",
      "pipe:1"
    ]);

    const chunks = [];
    ffmpeg.stdout.on("data", (chunk) => chunks.push(chunk));
    ffmpeg.stderr.on("data", () => {});

    ffmpeg.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`ffmpeg exited with code ${code}`));
    });

    ffmpeg.on("error", (err) => reject(err));

    ffmpeg.stdin.write(audioBuffer);
    ffmpeg.stdin.end();
  });
}

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

async function proxyRaw(req, res, target, extraHeaders = {}, body = null) {
  const headers = { ...extraHeaders };
  if (req.headers["content-type"]) {
    headers["content-type"] = req.headers["content-type"];
  }

  const response = await fetch(target, {
    method: req.method,
    headers: headers,
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
    const urlPath = new URL(req.url, "http://localhost").pathname;

    if (req.method === "GET" && urlPath === "/app/jwt/get") {
      return sendJson(res, 200, { jwt: "" });
    }

    if (req.method === "POST" && (urlPath === "/gtts/" || urlPath === "/gtts")) {
      if (!googleTtsKey) return sendJson(res, 500, { error: "GOOGLE_TTS_API_KEY is not configured" });
      return await proxyJson(
        req,
        res,
        `https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(googleTtsKey)}`
      );
    }

    if (req.method === "POST" && urlPath.startsWith("/pathumma/v1/")) {
      if (!pathummaKey) return sendJson(res, 500, { error: "PATHUMMA_API_KEY is not configured" });
      const target = `${pathummaBaseUrl}${urlPath.slice("/pathumma/v1".length)}`;
      let body = await readBody(req);
      if (urlPath === "/pathumma/v1/audio/speech") {
        const payload = JSON.parse(body.toString("utf8"));
        payload.model = ttsModel;
        payload.voice = ttsVoice;
        body = JSON.stringify(payload);
      }
      return await proxyJson(req, res, target, { Authorization: `Bearer ${pathummaKey}` }, body);
    }

    if (req.method === "POST" && (urlPath.startsWith("/openai/v1/") || urlPath === "/openai/v1/audio/transcriptions")) {
      const apiKey = (process.env.STT_API_KEY || process.env.PATHUMMA_API_KEY || process.env.OPENAI_API_KEY || "").trim();
      if (!apiKey) return sendJson(res, 500, { error: "STT_API_KEY is not configured in .env" });
      const baseUrl = (process.env.STT_BASE_URL || process.env.PATHUMMA_BASE_URL || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").trim().replace(/\/$/, "");
      const modelName = (process.env.STT_MODEL || "ptm-asr-diart").trim();

      const subPath = urlPath.slice("/openai/v1".length);
      const target = `${baseUrl}${subPath}`;
      let body = await readBody(req);

      try {
        const parsedForm = await new Response(body, { headers: { "content-type": req.headers["content-type"] } }).formData();
        const outboundForm = new FormData();

        for (const [key, value] of parsedForm.entries()) {
          if (key === "file" && value instanceof File) {
            console.log(`[STT Proxy] File received: ${value.name}, type: ${value.type}, size: ${value.size} bytes`);
            let fileBuffer = Buffer.from(await value.arrayBuffer());
            if (value.name.endsWith(".webm") || value.type.includes("webm") || value.type.includes("mp4") || value.type.includes("ogg") || value.name.endsWith(".blob")) {
              try {
                fileBuffer = await convertAudioToWav(fileBuffer);
                console.log(`[STT Proxy] FFmpeg converted audio to WAV: ${fileBuffer.length} bytes`);
              } catch (convErr) {
                console.error("[STT Proxy] FFmpeg conversion error:", convErr.message);
              }
            }
            outboundForm.append("file", new Blob([fileBuffer], { type: "audio/wav" }), "audio.wav");
          } else if (key === "model") {
            outboundForm.append("model", modelName);
          } else {
            outboundForm.append(key, value);
          }
        }

        console.log(`[STT Proxy] Forwarding to: ${target} (model: ${modelName})`);
        const response = await fetch(target, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}` },
          body: outboundForm
        });

        console.log(`[STT Proxy] Response status: ${response.status} ${response.statusText}`);
        const responseBuffer = Buffer.from(await response.arrayBuffer());

        if (response.status !== 200) {
          console.error(`[STT Proxy] Upstream error body:`, responseBuffer.toString("utf8"));
        }

        const contentType = response.headers.get("content-type") || "application/json";
        res.writeHead(response.status, {
          "Content-Type": contentType,
          "Access-Control-Allow-Origin": "*"
        });
        res.end(responseBuffer);
        return;
      } catch (err) {
        console.error("[STT Proxy] Processing error:", err);
        return await proxyRaw(req, res, target, { Authorization: `Bearer ${apiKey}` }, body);
      }
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
