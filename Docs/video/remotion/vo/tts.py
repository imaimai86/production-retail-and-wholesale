"""Render a VO script (vo/<name>.json) to one WAV per line with Kokoro, plus a timing manifest.

Usage: python tts.py <script.json> <out_dir> <model.onnx> <voices.bin>
"""
import json, sys, os
import soundfile as sf
from kokoro_onnx import Kokoro

script_path, out_dir, model, voices = sys.argv[1:5]
spec = json.load(open(script_path))
os.makedirs(out_dir, exist_ok=True)
kokoro = Kokoro(model, voices)
manifest = []
for line in spec["lines"]:
    samples, rate = kokoro.create(line["text"], voice=line.get("voice", spec["voice"]),
                                  speed=line.get("speed", spec["speed"]), lang="en-us")
    path = os.path.join(out_dir, line["id"] + ".wav")
    sf.write(path, samples, rate)
    manifest.append({**line, "file": os.path.basename(path), "seconds": round(len(samples) / rate, 3)})
    print(f'{line["id"]}: {manifest[-1]["seconds"]} s')
json.dump(manifest, open(os.path.join(out_dir, "manifest.json"), "w"), indent=2)
