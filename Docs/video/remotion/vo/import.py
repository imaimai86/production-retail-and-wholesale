"""Import kokoro-tts MCP output for one VO script into public/vo/<name>/ and write its manifest.

The MCP `narrate` tool saves <name>-<line id>.wav in its output folder (call it with the voice and
speed from vo/<name>.json). This trims the silence the tool pads around each clip, so scene timing
follows the speech, and records each clip's length in manifest.json for src/timeline.ts. A line
with the same text as one already imported for another video (the CTA) is reused from there.

Usage: python3 vo/import.py <name> [mcp_output_dir]   (default ~/kokoro-tts/output), run from Docs/video/remotion
"""
import glob, json, os, shutil, subprocess, sys

name = sys.argv[1]
src_dir = os.path.expanduser(sys.argv[2] if len(sys.argv) > 2 else "~/kokoro-tts/output")
spec = json.load(open(f"vo/{name}.json"))
out_dir = f"public/vo/{name}"
os.makedirs(out_dir, exist_ok=True)

shared = {}
for path in glob.glob("public/vo/*/manifest.json"):
    if os.path.dirname(path) != out_dir:
        for line in json.load(open(path)):
            if line.get("voice") == spec["voice"]:
                shared.setdefault(line["text"], os.path.join(os.path.dirname(path), line["file"]))

trim = ("silenceremove=start_periods=1:start_threshold=-50dB,areverse,"
        "silenceremove=start_periods=1:start_threshold=-50dB,areverse")
manifest = []
for line in spec["lines"]:
    dst = os.path.join(out_dir, line["id"] + ".wav")
    src = os.path.join(src_dir, f"{name}-{line['id']}.wav")
    if os.path.exists(src):
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src, "-af", trim, dst], check=True)
    elif line["text"] in shared:
        shutil.copyfile(shared[line["text"]], dst)
    else:
        sys.exit(f"missing {src}: narrate it first")
    seconds = float(subprocess.check_output(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", dst]))
    manifest.append({**line, "voice": spec["voice"], "file": os.path.basename(dst), "seconds": round(seconds, 3)})
    print(f'{line["id"]}: {manifest[-1]["seconds"]} s')
json.dump(manifest, open(os.path.join(out_dir, "manifest.json"), "w"), indent=2)
print(f"total {sum(l['seconds'] for l in manifest):.1f} s")
