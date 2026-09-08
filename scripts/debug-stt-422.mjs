import { readFile } from "node:fs/promises";

const envFile = await readFile(new URL("../.env", import.meta.url), "utf8").catch(() => "");
for (const line of envFile.split(/\r?\n/)) {
  const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "").trim();
}

const apiKey = process.env.STT_API_KEY || process.env.PATHUMMA_API_KEY;
const baseUrl = (process.env.STT_BASE_URL || process.env.PATHUMMA_BASE_URL || "https://tokenmind.pathumma.in.th/v1").replace(/\/$/, "");
const model = process.env.STT_MODEL || "ptm-asr-diart";

async function testParams(label, buildForm) {
  const form = new FormData();
  buildForm(form);
  try {
    const response = await fetch(`${baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form
    });
    console.log(`\n--- Test: ${label} ---`);
    console.log("Status:", response.status, response.statusText);
    const text = await response.text();
    console.log("Response:", text);
  } catch (err) {
    console.error(`Test ${label} failed:`, err.message);
  }
}

// 1. WAV file with model and language="th"
const wavBlob = new Blob([Buffer.alloc(1000)], { type: "audio/wav" });
await testParams("WAV with model & language=th", (form) => {
  form.append("file", wavBlob, "file.wav");
  form.append("model", model);
  form.append("language", "th");
});

// 2. WEBM file with model & language=th (like browser MediaRecorder)
const webmBlob = new Blob([Buffer.alloc(1000)], { type: "audio/webm;codecs=opus" });
await testParams("WEBM with model & language=th", (form) => {
  form.append("file", webmBlob, "file.webm");
  form.append("model", model);
  form.append("language", "th");
});

// 3. WEBM file with model & extra OpenAI fields (like whisperLoadMP3)
await testParams("WEBM with extra OpenAI fields", (form) => {
  form.append("file", webmBlob, "file.webm");
  form.append("model", model);
  form.append("response_format", "verbose_json");
  form.append("prompt", "test");
  form.append("timestamp_granularities[]", "word");
  form.append("timestamp_granularities[]", "segment");
});
