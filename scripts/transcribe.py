import sys
from faster_whisper import WhisperModel

model = WhisperModel("small", device="cpu", compute_type="int8")

def transcribe(path, out):
    segments, info = model.transcribe(path, language="es", beam_size=5)
    lines = []
    for seg in segments:
        lines.append(f"[{int(seg.start//60):02d}:{int(seg.start%60):02d}] {seg.text.strip()}")
    with open(out, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print(f"DONE {out} ({len(lines)} segments)")

if __name__ == "__main__":
    transcribe(sys.argv[1], sys.argv[2])
