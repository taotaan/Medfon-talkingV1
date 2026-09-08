import { readFile } from "node:fs/promises";

const envFile = await readFile(new URL("../.env", import.meta.url), "utf8").catch(() => "");
for (const line of envFile.split(/\r?\n/)) {
  const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "").trim();
}

const apiKey = process.env.STT_API_KEY || process.env.PATHUMMA_API_KEY;
const baseUrl = (process.env.STT_BASE_URL || process.env.PATHUMMA_BASE_URL || "https://tokenmind.pathumma.in.th/v1").replace(/\/$/, "");
const model = process.env.STT_MODEL || "ptm-asr-1";

console.log("Testing STT API with audio file:");
console.log("Base URL:", baseUrl);
console.log("Model:", model);

// Create a small 1-second silent WAV file buffer
const header = Buffer.from([
  0x52, 0x49, 0x46, 0x46, // "RIFF"
  0x24, 0x08, 0x00, 0x00, // Size
  0x57, 0x41, 0x56, 0x45, // "WAVE"
  0x66, 0x6d, 0x74, 0x20, // "fmt "
  0x10, 0x00, 0x00, 0x00, // Subchunk1Size (16)
  0x01, 0x00, 0x01, 0x00, // PCM, 1 channel
  0x44, 0xac, 0x00, 0x00, // 44100 Hz
  0x88, 0x58, 0x01, 0x00, // ByteRate
  0x02, 0x00, 0x10, 0x00, // BlockAlign, 16 bits
  0x64, 0x61, 0x74, 0x61, // "data"
  0x00, 0x08, 0x00, 0x00  // Subchunk2Size (2048)
]);
const silenceData = Buffer.alloc(2048);
const wavBuffer = Buffer.concat([header, silenceData]);

const blob = new Blob([wavBuffer], { type: "audio/wav" });
const form = new FormData();
form.append("file", blob, "sample.wav");
form.append("model", model);

try {
  const response = await fetch(`${baseUrl}/audio/transcriptions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`
    },
    body: form
  });
  console.log("Status:", response.status);
  console.log("Status text:", response.statusText);
  const text = await response.text();
  console.log("Response text:", text);
} catch (err) {
  console.error("Fetch error:", err.message);
}
