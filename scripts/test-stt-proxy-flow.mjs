import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";

const envFile = await readFile(new URL("../.env", import.meta.url), "utf8").catch(() => "");
for (const line of envFile.split(/\r?\n/)) {
  const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "").trim();
}

const apiKey = process.env.STT_API_KEY || process.env.PATHUMMA_API_KEY;
const baseUrl = (process.env.STT_BASE_URL || process.env.PATHUMMA_BASE_URL || "https://tokenmind.pathumma.in.th/v1").replace(/\/$/, "");
const model = process.env.STT_MODEL || "ptm-asr-diart";

function convertWebmToWav(webmBuffer) {
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
    ffmpeg.stderr.on("data", (d) => {});

    ffmpeg.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`ffmpeg exited with code ${code}`));
    });

    ffmpeg.on("error", (err) => reject(err));

    ffmpeg.stdin.write(webmBuffer);
    ffmpeg.stdin.end();
  });
}

async function handleSttProxy(rawBody, contentTypeHeader) {
  const parsedForm = await new Response(rawBody, { headers: { "content-type": contentTypeHeader } }).formData();
  
  const outboundForm = new FormData();

  for (const [key, value] of parsedForm.entries()) {
    if (key === "file" && value instanceof File) {
      console.log(`Incoming file: ${value.name}, type: ${value.type}, size: ${value.size}`);
      let fileBuffer = Buffer.from(await value.arrayBuffer());
      
      // If file is webm/mp4/ogg, convert to wav via ffmpeg
      if (value.name.endsWith(".webm") || value.type.includes("webm") || value.type.includes("mp4") || value.type.includes("ogg")) {
        console.log("Converting audio to WAV via ffmpeg...");
        try {
          fileBuffer = await convertWebmToWav(fileBuffer);
          console.log("Conversion successful! Converted WAV size:", fileBuffer.length);
        } catch (e) {
          console.error("FFmpeg conversion error:", e.message);
        }
      }
      outboundForm.append("file", new Blob([fileBuffer], { type: "audio/wav" }), "audio.wav");
    } else if (key === "model") {
      outboundForm.append("model", model);
    } else {
      outboundForm.append(key, value);
    }
  }

  const response = await fetch(`${baseUrl}/audio/transcriptions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`
    },
    body: outboundForm
  });

  console.log("Pathumma response status:", response.status);
  const text = await response.text();
  console.log("Pathumma response body:", text);
}

// Create sample webm request body
const webmBuffer = await readFile("test_sample.webm");
const mockForm = new FormData();
mockForm.append("file", new Blob([webmBuffer], { type: "audio/webm" }), "file.webm");
mockForm.append("model", "whisper-1");
mockForm.append("language", "th");

const mockReq = new Response(mockForm);
const rawBody = Buffer.from(await mockReq.arrayBuffer());
const contentTypeHeader = mockReq.headers.get("content-type");

console.log("Testing end-to-end STT proxy flow...");
await handleSttProxy(rawBody, contentTypeHeader);
