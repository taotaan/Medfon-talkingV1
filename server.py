import asyncio
import mimetypes
import os
import time
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
import httpx

# Load environment variables from .env file
ROOT_DIR = Path(__file__).parent.resolve()
load_dotenv(ROOT_DIR / ".env")

PORT = int(os.getenv("PORT", "3000"))
GOOGLE_TTS_API_KEY = os.getenv("GOOGLE_TTS_API_KEY", "")
PATHUMMA_API_KEY = os.getenv("PATHUMMA_API_KEY") or os.getenv("TTS_API_KEY", "")
PATHUMMA_BASE_URL = (os.getenv("TTS_BASE_URL") or os.getenv("PATHUMMA_BASE_URL") or "https://tokenmind.pathumma.in.th/v1").rstrip("/")
TTS_MODEL = os.getenv("TTS_MODEL", "ptm-tts-1")
TTS_VOICE = os.getenv("TTS_VOICE", "female")

STT_API_KEY = (os.getenv("STT_API_KEY") or os.getenv("PATHUMMA_API_KEY") or os.getenv("OPENAI_API_KEY") or "").strip()
STT_BASE_URL = (os.getenv("STT_BASE_URL") or os.getenv("PATHUMMA_BASE_URL") or os.getenv("OPENAI_BASE_URL") or "https://api.openai.com/v1").strip().rstrip("/")
STT_MODEL = os.getenv("STT_MODEL", "ptm-asr-diart").strip()

# Register custom MIME types
mimetypes.add_type("text/css", ".css")
mimetypes.add_type("model/gltf-binary", ".glb")
mimetypes.add_type("text/html", ".html")
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/javascript", ".mjs")
mimetypes.add_type("application/json", ".json")
mimetypes.add_type("audio/mpeg", ".mp3")
mimetypes.add_type("image/png", ".png")
mimetypes.add_type("image/jpeg", ".jpg")
mimetypes.add_type("image/svg+xml", ".svg")
mimetypes.add_type("audio/wav", ".wav")

app = FastAPI(title="TalkingHead Server")

# Enable CORS for all origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def log_requests(request: Request, call_next):
    start_time = time.time()
    iso_now = datetime.utcnow().isoformat() + "Z"
    print(f"[{iso_now}] --> {request.method} {request.url.path}")
    response = await call_next(request)
    process_time = int((time.time() - start_time) * 1000)
    iso_end = datetime.utcnow().isoformat() + "Z"
    print(f"[{iso_end}] <-- {request.method} {request.url.path} {response.status_code} {process_time}ms")
    return response


async def convert_audio_to_wav(audio_bytes: bytes) -> bytes:
    """Convert audio buffer to WAV (16kHz, PCM 16-bit mono) using FFmpeg."""
    process = await asyncio.create_subprocess_exec(
        "ffmpeg",
        "-y",
        "-i", "pipe:0",
        "-f", "wav",
        "-acodec", "pcm_s16le",
        "-ar", "16000",
        "-ac", "1",
        "pipe:1",
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE
    )
    stdout, stderr = await process.communicate(input=audio_bytes)
    if process.returncode != 0:
        err_msg = stderr.decode("utf-8", errors="ignore")
        raise RuntimeError(f"ffmpeg exited with code {process.returncode}: {err_msg}")
    return stdout


@app.get("/app/jwt/get")
async def get_jwt():
    return JSONResponse(status_code=200, content={"jwt": ""})


def extract_text_from_ssml(ssml: str) -> str:
    """Strip SSML tags to extract plain text."""
    import re
    clean = re.sub(r"<[^>]+>", "", ssml)
    return clean.strip()


@app.post("/gtts")
@app.post("/gtts/")
async def proxy_gtts(request: Request):
    raw_body = await request.body()

    if GOOGLE_TTS_API_KEY:
        target_url = f"https://texttospeech.googleapis.com/v1/text:synthesize?key={GOOGLE_TTS_API_KEY}"
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(target_url, content=raw_body, headers={"Content-Type": "application/json"})
        content_type = resp.headers.get("content-type", "application/json")
        return Response(content=resp.content, status_code=resp.status_code, media_type=content_type)

    if PATHUMMA_API_KEY:
        try:
            import json
            import base64
            payload = json.loads(raw_body.decode("utf-8"))
            input_data = payload.get("input", {})
            text = ""
            if isinstance(input_data, dict):
                ssml = input_data.get("ssml", "")
                text = extract_text_from_ssml(ssml) or input_data.get("text", "")
            elif isinstance(input_data, str):
                text = extract_text_from_ssml(input_data)

            if not text:
                text = "สวัสดี"

            pathumma_payload = {
                "model": TTS_MODEL or "ptm-tts-1",
                "voice": TTS_VOICE if TTS_VOICE and TTS_VOICE != "female" else "ped",
                "input": text,
                "response_format": "mp3"
            }
            target_url = f"{PATHUMMA_BASE_URL}/audio/speech"
            headers = {
                "Authorization": f"Bearer {PATHUMMA_API_KEY}",
                "Content-Type": "application/json"
            }
            async with httpx.AsyncClient(timeout=60.0) as client:
                resp = await client.post(target_url, json=pathumma_payload, headers=headers)

            if resp.status_code == 200:
                audio_b64 = base64.b64encode(resp.content).decode("utf-8")
                return JSONResponse(status_code=200, content={"audioContent": audio_b64, "timepoints": []})
            else:
                print(f"[gTTS Pathumma Fallback] Upstream status {resp.status_code}: {resp.text}")
        except Exception as err:
            print(f"[gTTS Pathumma Fallback Error] {err}")

    return JSONResponse(status_code=500, content={"error": "GOOGLE_TTS_API_KEY and PATHUMMA_API_KEY are not configured"})


@app.post("/pathumma/v1/{subpath:path}")
async def proxy_pathumma(subpath: str, request: Request):
    if not PATHUMMA_API_KEY:
        return JSONResponse(status_code=500, content={"error": "PATHUMMA_API_KEY is not configured"})

    target_url = f"{PATHUMMA_BASE_URL}/{subpath}"
    raw_body = await request.body()

    if subpath == "audio/speech":
        try:
            import json
            payload = json.loads(raw_body.decode("utf-8"))
            payload["model"] = TTS_MODEL or "ptm-tts-1"
            voice_val = payload.get("voice") or TTS_VOICE
            if not voice_val or str(voice_val).lower() in ("female", "male", "default"):
                voice_val = "ped"
            payload["voice"] = voice_val
            raw_body = json.dumps(payload).encode("utf-8")
        except Exception as e:
            print(f"[Pathumma Proxy] Error modifying payload: {e}")

    headers = {
        "Authorization": f"Bearer {PATHUMMA_API_KEY}",
        "Content-Type": "application/json"
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(target_url, content=raw_body, headers=headers)

    content_type = resp.headers.get("content-type", "application/json")
    return Response(content=resp.content, status_code=resp.status_code, media_type=content_type)


@app.post("/openai/v1/{subpath:path}")
async def proxy_stt(subpath: str, request: Request):
    if not STT_API_KEY:
        return JSONResponse(status_code=500, content={"error": "STT_API_KEY is not configured in .env"})

    target_url = f"{STT_BASE_URL}/{subpath}"

    try:
        form_data = await request.form()
        files = []
        data = {}

        for key, value in form_data.multi_items():
            if key == "file" and hasattr(value, "filename"):
                filename = getattr(value, "filename", "audio.blob") or "audio.blob"
                content_type = getattr(value, "content_type", "") or ""
                file_bytes = await value.read()

                print(f"[STT Proxy] File received: {filename}, type: {content_type}, size: {len(file_bytes)} bytes")

                if filename.endswith(".webm") or "webm" in content_type or "mp4" in content_type or "ogg" in content_type or filename.endswith(".blob"):
                    try:
                        file_bytes = await convert_audio_to_wav(file_bytes)
                        print(f"[STT Proxy] FFmpeg converted audio to WAV: {len(file_bytes)} bytes")
                    except Exception as conv_err:
                        print(f"[STT Proxy] FFmpeg conversion error: {conv_err}")

                files.append(("file", ("audio.wav", file_bytes, "audio/wav")))
            elif key == "model":
                data["model"] = STT_MODEL
            else:
                if isinstance(value, str):
                    data[key] = value

        print(f"[STT Proxy] Forwarding to: {target_url} (model: {STT_MODEL})")

        headers = {"Authorization": f"Bearer {STT_API_KEY}"}
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(target_url, headers=headers, data=data, files=files if files else None)

        print(f"[STT Proxy] Response status: {resp.status_code}")
        if resp.status_code != 200:
            print(f"[STT Proxy] Upstream error body: {resp.text}")

        content_type = resp.headers.get("content-type", "application/json")
        return Response(content=resp.content, status_code=resp.status_code, media_type=content_type)

    except Exception as err:
        print(f"[STT Proxy] Processing error: {err}")
        # Raw proxy fallback
        raw_body = await request.body()
        content_type = request.headers.get("content-type", "application/json")
        headers = {"Authorization": f"Bearer {STT_API_KEY}", "Content-Type": content_type}
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(target_url, headers=headers, content=raw_body)
        return Response(content=resp.content, status_code=resp.status_code, media_type=resp.headers.get("content-type", "application/json"))


@app.get("/")
@app.get("/{file_path:path}")
async def serve_static(file_path: str = ""):
    if not file_path or file_path == "/":
        file_path = "index.html"

    try:
        target = (ROOT_DIR / file_path).resolve()
    except Exception:
        return JSONResponse(status_code=403, content={"error": "Forbidden"})

    if ROOT_DIR not in target.parents and target != ROOT_DIR:
        return JSONResponse(status_code=403, content={"error": "Forbidden"})

    if target.exists() and target.is_file():
        media_type, _ = mimetypes.guess_type(str(target))
        return FileResponse(target, media_type=media_type or "application/octet-stream")

    return JSONResponse(status_code=404, content={"error": "Not found"})


if __name__ == "__main__":
    import uvicorn
    print(f"TalkingHead Python server running at http://localhost:{PORT}")
    uvicorn.run("server:app", host="0.0.0.0", port=PORT, reload=False)
