import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = new URL("../", import.meta.url);
const envFile = await readFile(new URL("../.env", import.meta.url), "utf8").catch(() => "");
for (const line of envFile.split(/\r?\n/)) {
  const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
}

const apiKey = process.env.PATHUMMA_API_KEY || process.env.TTS_API_KEY;
const baseUrl = (process.env.TTS_BASE_URL || process.env.PATHUMMA_BASE_URL || "https://tokenmind.pathumma.in.th/v1").replace(/\/$/, "");
const model = process.env.TTS_MODEL || "ptm-tts-1";
const configuredVoice = process.env.TTS_VOICE || "female";
const voices = (process.env.TTS_TEST_VOICES || configuredVoice).split(",").map(x => x.trim()).filter(Boolean);
const text = "Hello. This is an English voice test. The quick brown fox jumps over the lazy dog.";
const outputDir = new URL("../tmp/pathumma-voices/", import.meta.url);

if (!apiKey) {
  console.error("No PATHUMMA_API_KEY or TTS_API_KEY found in .env");
  process.exit(1);
}

await mkdir(outputDir, { recursive: true });
for (const voice of voices) {
  const response = await fetch(`${baseUrl}/audio/speech`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ model, voice, input: text, response_format: "mp3" })
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  const safeVoice = voice.replace(/[^A-Za-z0-9_-]/g, "_");
  const filePath = new URL(`./${safeVoice}.audio`, outputDir);
  await writeFile(filePath, bytes);
  console.log(`${voice}: status=${response.status}, type=${response.headers.get("content-type") || "unknown"}, bytes=${bytes.length}, file=${join("tmp", "pathumma-voices", `${safeVoice}.audio`)}`);
}

console.log("Listen to each saved file. A 200 response proves the voice is accepted, not that it is English.");
