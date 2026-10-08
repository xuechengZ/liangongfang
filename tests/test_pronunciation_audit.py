import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import struct
import sys
import tempfile
import unittest
import wave


SCRIPT = Path(__file__).resolve().parents[1] / "scripts/verify-local-pronunciation-sample.py"
MODEL = Path.home() / ".cache/huggingface/hub/models--Systran--faster-whisper-small.en/snapshots/d1d751a5f8271d482d14ca55d9e2deeebbae577f"


class PronunciationAuditTests(unittest.TestCase):
    def audit(self):
        if not SCRIPT.exists():
            self.fail("Local pronunciation audit is not implemented")
        spec = importlib.util.spec_from_file_location("pronunciation_audit", SCRIPT)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def test_case_and_sentence_punctuation_do_not_create_a_false_mismatch(self):
        record = self.audit().classify("ability", "0000.mp3", " Ability. ")
        self.assertEqual(record["status"], "matched")
        self.assertEqual(record["action"], "use-local-audio")
        self.assertEqual(record["recognized"], " Ability. ")

    def test_similar_but_different_word_requires_existing_pronunciation(self):
        record = self.audit().classify("activity", "0006.mp3", "activities")
        self.assertEqual(record["status"], "unmatched")
        self.assertEqual(record["reason"], "recognition-mismatch")
        self.assertEqual(record["action"], "existing-pronunciation-chain")

    def test_empty_recognition_is_a_mismatch_not_a_processing_error(self):
        record = self.audit().classify("acid", "0004.mp3", "")
        self.assertEqual(record["status"], "unmatched")

    def test_decode_failure_is_not_counted_as_a_recognition_mismatch(self):
        record = self.audit().classify("adult", "0008.mp3", "", "Audio decode failed")
        self.assertEqual(record["status"], "failed")
        self.assertEqual(record["reason"], "Audio decode failed")
        self.assertEqual(record["action"], "existing-pronunciation-chain")

    def test_report_separates_attempted_failures_from_unprocessed_words(self):
        records = [
            {"status": "matched"},
            {"status": "unmatched"},
            {"status": "failed"},
        ]
        report = self.audit().build_report(records, 5)
        self.assertEqual(report["totals"], {
            "processed": 3, "matched": 1, "unmatched": 1,
            "failed": 1, "fallbackRequired": 2, "unprocessed": 2,
        })
        self.assertEqual(report["records"], records)

    def test_audit_continues_after_a_failed_clip_and_counts_it_separately(self):
        entries = [
            {"word": "ability", "file": "missing.mp3"},
            {"word": "acid", "file": "acid.mp3"},
        ]

        def recognize(path):
            if path.name == "missing.mp3":
                raise ValueError("Audio decode failed")
            return "Acid."

        audit = self.audit()
        self.assertTrue(callable(getattr(audit, "audit_entries", None)), "Clip audit not implemented")
        records = audit.audit_entries(entries, Path("/audio"), recognize)
        self.assertEqual([record["status"] for record in records], ["failed", "matched"])
        self.assertEqual(records[0]["reason"], "Audio decode failed")
        self.assertEqual(records[1]["recognized"], "Acid.")

    def test_ffmpeg_decodes_actual_pcm_audio_to_mono_float32(self):
        with tempfile.TemporaryDirectory() as directory:
            audio = Path(directory) / "sample.wav"
            with wave.open(str(audio), "wb") as output:
                output.setnchannels(1)
                output.setsampwidth(2)
                output.setframerate(16000)
                output.writeframes(struct.pack("<160h", *([8192] * 160)))
            audit = self.audit()
            self.assertTrue(callable(getattr(audit, "decode_audio", None)), "Audio decoder not implemented")
            decoded = audit.decode_audio(audio)
            self.assertEqual(len(decoded), 640)
            self.assertEqual(struct.unpack("<160f", decoded), (0.25,) * 160)

    def test_missing_local_model_blocks_cli_without_claiming_words_were_processed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest = root / "manifest.json"
            manifest.write_text(json.dumps([
                {"word": "ability", "file": "0000.mp3", "start": 49.1, "end": 50.2},
            ]))
            output = root / "audit.json"
            result = subprocess.run([
                sys.executable, str(SCRIPT), "--manifest", str(manifest),
                "--model", str(root / "missing-model"), "--output", str(output),
            ], capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertTrue(output.exists(), result.stderr)
            report = json.loads(output.read_text())
            self.assertEqual(report["totals"]["processed"], 0)
            self.assertEqual(report["totals"]["unmatched"], 0)
            self.assertEqual(report["totals"]["failed"], 0)
            self.assertEqual(report["totals"]["unprocessed"], 1)
            self.assertIn("Local model directory", report["error"])

    @unittest.skipUnless(os.environ.get("RUN_LOCAL_ASR_AUDIT_TEST") and MODEL.is_dir() and shutil.which("uv"),
                         "Optional integration requires cached local ASR dependencies/model")
    def test_silent_audio_is_processed_then_blocked_as_an_unmatched_clip(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with wave.open(str(root / "silent.wav"), "wb") as audio:
                audio.setnchannels(1)
                audio.setsampwidth(2)
                audio.setframerate(16000)
                audio.writeframes(bytes(32000))
            manifest = root / "manifest.json"
            manifest.write_text(json.dumps([{"word": "ability", "file": "silent.wav", "start": 0, "end": 1}]))
            output = root / "audit.json"
            result = subprocess.run([
                "uv", "--offline", "run", "--with", "faster-whisper", "python", str(SCRIPT),
                "--manifest", str(manifest), "--model", str(MODEL), "--output", str(output),
            ], capture_output=True, text=True)
            report = json.loads(output.read_text())
            self.assertEqual(report["totals"], {
                "processed": 1, "matched": 0, "unmatched": 1,
                "failed": 0, "fallbackRequired": 1, "unprocessed": 0,
            }, result.stderr)
            self.assertEqual(result.returncode, 1)
            self.assertEqual(report["records"][0]["action"], "existing-pronunciation-chain")


if __name__ == "__main__":
    unittest.main()
