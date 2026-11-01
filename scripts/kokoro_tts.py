"""Offline narrator voice (Kokoro, Apache-2.0). Free, no API key — used for test runs and as a fallback.

usage: python3 kokoro_tts.py MODEL_DIR VOICE SPEED OUT_DIR TEXT1 [TEXT2 ...]
Writes OUT_DIR/seg-0.wav, seg-1.wav, ... one file per text.
"""
import os
import sys

import soundfile as sf
from kokoro_onnx import Kokoro

model_dir, voice, speed, out_dir, *texts = sys.argv[1:]
k = Kokoro(os.path.join(model_dir, "kokoro.onnx"), os.path.join(model_dir, "voices.bin"))
for i, text in enumerate(texts):
    samples, rate = k.create(text, voice=voice, speed=float(speed), lang="en-us")
    sf.write(os.path.join(out_dir, f"seg-{i}.wav"), samples, rate)
    print(f"seg-{i}: {len(samples) / rate:.2f}s")
