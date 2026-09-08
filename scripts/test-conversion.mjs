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
      if (code === 0) {
        resolve(Buffer.concat(chunks));
      } else {
        reject(new Error(`ffmpeg exited with code ${code}`));
      }
    });

    ffmpeg.on("error", (err) => reject(err));

    ffmpeg.stdin.write(webmBuffer);
    ffmpeg.stdin.end();
  });
}

console.log("Reading test_sample.webm...");
const webmBuffer = await readFile("test_sample.webm");

console.log("Converting WEBM -> WAV using ffmpeg pipe...");
const wavBuffer = await convertWebmToWav(webmBuffer);
console.log("Converted WAV buffer size:", wavBuffer.length);

const blob = new Blob([wavBuffer], { type: "audio/wav" });
const form = new FormData();
form.append("file", blob, "audio.wav");
form.append("model", model);
form.append("language", "th");

console.log("Sending converted WAV to Pathumma STT...");
const response = await fetch(`${baseUrl}/audio/transcriptions`, {
  method: "POST",
  headers: { Authorization: `Bearer ${apiKey}` },
  body: form
});

console.log("Status:", response.status, response.statusText);
const text = await response.text();
console.log("Response:", text);
