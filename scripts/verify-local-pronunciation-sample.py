#!/usr/bin/env python3
"""Audit local clips without changing website metadata; exclude mismatches from deployment."""

import argparse
import json
from pathlib import Path
import re
import subprocess


def normalize(text):
    return " ".join(re.sub(r"[^\w\s'-]", "", text.casefold()).split())


def classify(word, file, recognized, error=None):
    if error:
        status, reason = "failed", str(error)
    elif normalize(recognized) == normalize(word):
        status, reason = "matched", "exact-normalized-match"
    else:
        status, reason = "unmatched", "recognition-mismatch"
    return {
        "word": word, "file": file, "recognized": recognized,
        "status": status, "reason": reason,
        "action": "use-local-audio" if status == "matched" else "existing-pronunciation-chain",
    }


def build_report(records, total):
    counts = {status: sum(record["status"] == status for record in records)
              for status in ("matched", "unmatched", "failed")}
    return {"totals": {
        "processed": len(records), **counts,
        "fallbackRequired": counts["unmatched"] + counts["failed"],
        "unprocessed": total - len(records),
    }, "records": records}


def decode_audio(path):
    result = subprocess.run([
        "ffmpeg", "-nostdin", "-v", "error", "-i", str(path),
        "-map", "0:a:0", "-ac", "1", "-ar", "16000", "-f", "f32le", "-",
    ], capture_output=True, check=True)
    return result.stdout


def audit_entries(entries, directory, recognize):
    records = []
    for entry in entries:
        try:
            record = classify(entry["word"], entry["file"], recognize(directory / entry["file"]))
        except Exception as exception:
            record = classify(entry["word"], entry["file"], "", exception)
        records.append(record)
    return records


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--model", type=Path, required=True, help="Existing local Whisper model directory")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    entries = json.loads(args.manifest.read_text())
    records, error = [], None
    try:
        if not args.model.is_dir():
            raise ValueError(f"Local model directory does not exist: {args.model}")
        import numpy as np
        from faster_whisper import WhisperModel

        model = WhisperModel(str(args.model.resolve()), device="cpu", compute_type="int8", local_files_only=True)

        def recognize(path):
            audio = np.frombuffer(decode_audio(path), dtype=np.float32)
            segments, _ = model.transcribe(audio, language="en", beam_size=5,
                                           vad_filter=False, condition_on_previous_text=False)
            return " ".join(segment.text.strip() for segment in segments).strip()

        records = audit_entries(entries, args.manifest.parent, recognize)
    except Exception as exception:
        error = str(exception)
    report = build_report(records, len(entries))
    if error:
        report["error"] = error
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(report["totals"]))
    return int(bool(error or report["totals"]["fallbackRequired"] or report["totals"]["unprocessed"]))


if __name__ == "__main__":
    raise SystemExit(main())
