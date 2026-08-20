import { readFile } from "node:fs/promises";

const envFile = await readFile(new URL("../.env", import.meta.url), "utf8").catch(() => "");
for (const line of envFile.split(/\r?\n/)) {
  const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
}

const apiKey = process.env.PATHUMMA_API_KEY || process.env.TTS_API_KEY;
const baseUrl = (process.env.TTS_BASE_URL || process.env.PATHUMMA_BASE_URL || "https://tokenmind.pathumma.in.th/v1").replace(/\/$/, "");
const model = process.env.TTS_MODEL || "ptm-tts-1";
const voice = process.env.TTS_VOICE || "female";

if (!apiKey) {
  console.error("No PATHUMMA_API_KEY or TTS_API_KEY found in .env");
  process.exit(1);
}

async function check(label, extra = {}) {
  const body = {
    model,
    voice,
    input: "Hello, how are you?",
    response_format: "mp3",
    ...extra
  };
  const response = await fetch(`${baseUrl}/audio/speech`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const contentType = response.headers.get("content-type") || "";
  const bytes = Buffer.from(await response.arrayBuffer());
  console.log(`\n${label}`);
  console.log(`status: ${response.status}`);
  console.log(`content-type: ${contentType}`);
  console.log(`bytes: ${bytes.length}`);

  if (contentType.includes("json")) {
    const text = bytes.toString("utf8");
    try {
      const json = JSON.parse(text);
      console.log(`json keys: ${Object.keys(json).join(", ") || "(none)"}`);
      if (json.error) console.log(`error: ${json.error.message || JSON.stringify(json.error)}`);
    } catch {
      console.log("json: invalid JSON response");
    }
  } else if (bytes.length >= 3 && bytes.subarray(0, 3).toString() === "ID3") {
    console.log("audio: MP3 (no JSON metadata in response)");
  } else {
    console.log(`audio signature: ${bytes.subarray(0, 12).toString("hex")}`);
  }
}

try {
  await check("baseline");
  await check("metadata request", {
    return_timestamps: true,
    return_visemes: true,
    timestamps: true,
    alignment: true
  });
} catch (error) {
  console.error(`request failed: ${error.message}`);
  process.exit(1);
}
