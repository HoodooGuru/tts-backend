import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel
import edge_tts
import uuid
import os
import asyncio

app = FastAPI()

# Enable CORS for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Directory to store temp audio files
AUDIO_DIR = "audio_cache"
os.makedirs(AUDIO_DIR, exist_ok=True)

# SERVE STATIC FILES (e.g. embed.js)
# This allows users to load the script directly from the backend
@app.get("/embed.js")
async def get_widget_script():
    if os.path.exists("embed.js"):
        return FileResponse("embed.js", media_type="application/javascript")
    raise HTTPException(status_code=404, detail="Script not found")

class TTSRequest(BaseModel):
    text: str
    voice: str
    rate: float

@app.post("/api/tts")
async def generate_tts(request: TTSRequest):
    try:
        # Create a unique filename
        filename = f"{uuid.uuid4()}.mp3"
        filepath = os.path.join(AUDIO_DIR, filename)

        # Convert rate if necessary. Edge TTS uses "+0%" string format usually, 
        # but let's just stick to default speed or simple +/- percentages if user asks.
        # For this demo, let's map float 0.5-2.0 to string percentage.
        # 1.0 = +0%, 1.5 = +50%, 0.8 = -20%
        # rate_percent = int((request.rate - 1.0) * 100)
        # rate_str = f"{rate_percent:+d}%"

        # communicate = edge_tts.Communicate(request.text, request.voice, rate=rate_str)
        communicate = edge_tts.Communicate(request.text, request.voice) # Try without rate first
        
        # We need to capture audio and boundary events
        audio_data = bytearray()
        alignment = []

        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                audio_data.extend(chunk["data"])
            elif chunk["type"] == "WordBoundary":
                # Check actual keys in chunk. usually: 'offset', 'duration', 'text_offset', 'word_length', 'text'
                # Edge TTS returns timestamps in ticks (1 tick = 100ns).
                # offset is audio offset (ticks). duration is ticks.
                # text_offset is character index.
                start_time_seconds = chunk["offset"] / 10_000_000
                duration_seconds = chunk["duration"] / 10_000_000
                alignment.append({
                    "start": start_time_seconds,
                    "end": start_time_seconds + duration_seconds,
                    "text_offset": chunk["text_offset"],
                    "word_length": chunk["word_length"],
                    "text": chunk["text"]
                })

        # FALLBACK: If no word alignment received (common with some Edge voices/versions), 
        # estimate based on text length and audio size.
        if not alignment and len(audio_data) > 0:
            print("WARNING: No WordBoundary received. Using character-based estimation.")
            
            # 1. Estimate duration. Edge TTS 48kbps ~ 6000 bytes/sec.
            # This is a Rough Estimate.
            estimated_duration = len(audio_data) / 6000.0 
            
            # 2. Split text into words with offsets
            import re
            words_info = []
            for m in re.finditer(r'\S+', request.text):
                 words_info.append({
                     "text": m.group(0),
                     "text_offset": m.start(),
                     "word_length": len(m.group(0))
                 })
            
            if words_info:
                total_chars = sum(w["word_length"] for w in words_info)
                current_time = 0.0
                
                for w in words_info:
                    # Allocate time proportional to word length (plus a tiny bit for spacing)
                    # We'll just use length relative to total chars
                    word_duration = (w["word_length"] / total_chars) * estimated_duration
                    
                    alignment.append({
                        "start": current_time,
                        "end": current_time + word_duration,
                        "text_offset": w["text_offset"],
                        "word_length": w["word_length"],
                        "text": w["text"]
                    })
                    current_time += word_duration

        # Save audio file
        with open(filepath, "wb") as f:
            f.write(audio_data)

        # Return URL and alignment data
        return JSONResponse({
            "audio_url": f"/audio/{filename}",
            "alignment": alignment
        })

        # Save audio file
        with open(filepath, "wb") as f:
            f.write(audio_data)

        # Return URL and alignment data
        return JSONResponse({
            "audio_url": f"/audio/{filename}",
            "alignment": alignment
        })

    except Exception as e:
        print(f"Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/audio/{filename}")
async def get_audio(filename: str):
    filepath = os.path.join(AUDIO_DIR, filename)
    if os.path.exists(filepath):
        return FileResponse(filepath)
    raise HTTPException(status_code=404, detail="File not found")

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
