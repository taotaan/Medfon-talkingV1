import { readFile } from "node:fs/promises";

const envFile = await readFile(new URL("../.env", import.meta.url), "utf8").catch(() => "");
for (const line of envFile.split(/\r?\n/)) {
  const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "").trim();
}

const apiKey = process.env.STT_API_KEY || process.env.PATHUMMA_API_KEY;
const baseUrl = (process.env.STT_BASE_URL || process.env.PATHUMMA_BASE_URL || "https://tokenmind.pathumma.in.th/v1").replace(/\/$/, "");
const model = process.env.STT_MODEL || "ptm-asr-diart";

async function testAudioFile(filename, mimeType) {
  const buffer = await readFile(filename);
  const blob = new Blob([buffer], { type: mimeType });
  const form = new FormData();
  form.append("file", blob, filename);
  form.append("model", model);
  form.append("language", "th");

  console.log(`\nTesting ${filename} (${mimeType})...`);
  const response = await fetch(`${baseUrl}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form
  });
  console.log("Status:", response.status, response.statusText);
  const text = await response.text();
  console.log("Response:", text);
}

await testAudioFile("test_sample.wav", "audio/wav");
await testAudioFile("test_sample.webm", "audio/webm");
