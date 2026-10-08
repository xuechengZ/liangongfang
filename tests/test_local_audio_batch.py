import importlib.util
import hashlib
import csv
import json
from pathlib import Path
import subprocess
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/import_local_pronunciation.py'


def batch():
    if not SCRIPT.exists():
        raise AssertionError('Batch local audio importer is not implemented')
    spec = importlib.util.spec_from_file_location('local_audio_batch', SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class BatchAlignmentTests(unittest.TestCase):
    def test_detected_silences_preserve_first_and_last_speech_intervals(self):
        log = 'silence_start: 1\nsilence_end: 2\nsilence_start: 3\nsilence_end: 4\n'
        self.assertEqual(batch().speech_intervals(log, 5), [
            {'start': 0, 'end': 1}, {'start': 2, 'end': 3}, {'start': 4, 'end': 5},
        ])

    def test_missing_and_extra_recordings_do_not_shift_later_words(self):
        words = ['ability', 'abstract', 'accountant', 'accuracy']
        candidates = ['Test paper one', 'Ability.', 'accountant', 'unexpected', 'Accuracy!']
        self.assertEqual(batch().align_words(words, candidates), {0: 1, 2: 2, 3: 4})

    def test_similar_sounding_words_are_not_fuzzily_accepted(self):
        self.assertEqual(batch().align_words(['activity', 'actor', 'adult'], ['activities', 'Actor', 'adult']), {1: 1, 2: 2})

    def test_word_order_disambiguates_repeated_words(self):
        self.assertEqual(batch().align_words(['ability', 'able', 'ability', 'action'], ['ability', 'action']), {2: 0, 3: 1})

    def test_hyphen_spacing_and_explicit_dictionary_alias_are_supported(self):
        self.assertEqual(batch().align_words(['highly-trained', 'verbalisation=verbalization'], ['highly trained.', 'Verbalization']), {0: 0, 1: 1})

    def test_publish_excludes_failed_unverified_and_unmatched_recordings(self):
        words = [{'name': 'ability'}, {'name': 'abstract', 'localAudio': 'old.mp3'}, {'name': 'actor'}, {'name': 'adult'}]
        records = [
            {'index': 0, 'status': 'matched', 'qualityVerified': True, 'localAudio': 'ieltsWang3/0000-original.mp3'},
            {'index': 1, 'status': 'failed', 'qualityVerified': False},
            {'index': 2, 'status': 'matched', 'qualityVerified': False, 'localAudio': 'unsafe.mp3'},
            {'index': 3, 'status': 'unmatched', 'qualityVerified': False},
        ]
        published = batch().publication_words(words, records)
        self.assertEqual(published[0]['localAudio'], 'ieltsWang3/0000-original.mp3')
        self.assertTrue(all('localAudio' not in word for word in published[1:]))
        self.assertEqual(words[1]['localAudio'], 'old.mp3', 'Do not mutate the original input')

    def test_totals_keep_unprocessed_and_processing_failure_separate(self):
        records = [{'status': 'matched'}, {'status': 'unmatched'}, {'status': 'failed'}]
        self.assertEqual(batch().report_totals(records, 5), {'total': 5, 'matched': 1, 'unmatched': 1, 'failed': 1, 'unprocessed': 2, 'fallback': 2})

    def test_incomplete_analysis_cannot_modify_any_dictionary(self):
        module = batch()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            module.PROJECT = root
            dictionaries = root / 'public/dicts'
            dictionaries.mkdir(parents=True)
            original = '[{"name":"ability","localAudio":"approved.mp3"}]'
            for chapter in (3, 4, 5, 11):
                (dictionaries / f'IELTS_WANG_{chapter}.json').write_text(original)
            with self.assertRaisesRegex(ValueError, 'Incomplete analysis'):
                module.publish(root / 'audio')
            self.assertTrue(all(path.read_text() == original for path in dictionaries.iterdir()))

    def test_changed_source_recording_invalidates_cached_analysis(self):
        module = batch()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            module.PROJECT = root
            dictionaries = root / 'public/dicts'
            dictionaries.mkdir(parents=True)
            for chapter in (3, 4, 5, 11):
                (dictionaries / f'IELTS_WANG_{chapter}.json').write_text('[{"name":"ability"}]')
            source = root / 'source.mp3'
            source.write_bytes(b'changed audio')
            cache = root / 'batch-analysis'
            cache.mkdir()
            for chapter, count in ((3, 9), (4, 4), (5, 12), (11, 4)):
                for index in range(count):
                    (cache / f'C{chapter}-{index:02d}.json').write_text(json.dumps({
                        'source': str(source), 'sourceHash': 'stale-hash', 'candidates': [],
                    }))
            with self.assertRaisesRegex(ValueError, 'Source recording changed'):
                module.publish(root)

    def test_only_unaligned_segments_are_independently_retried_and_cached(self):
        calls = []
        candidates = [{'recognized': 'Ability'}, {'recognized': ''}, {'recognized': 'accountant'}]
        def recognize(span):
            calls.append(span)
            return 'Abstract.'
        module = batch()
        self.assertTrue(callable(getattr(module, 'retry_unaligned', None)), 'Exception-only retry not implemented')
        module.retry_unaligned(['ability', 'abstract', 'accountant'], candidates, recognize)
        self.assertEqual(len(calls), 1)
        self.assertEqual(candidates[1]['recognized'], 'Abstract.')
        self.assertEqual(candidates[1]['method'], 'independent-clip-asr')
        module.retry_unaligned(['ability', 'abstract', 'accountant'], candidates, recognize)
        self.assertEqual(len(calls), 1, 'A repeated run must not repeat recognition work')

    def test_joined_recordings_cannot_be_relabelled_as_one_of_their_words(self):
        candidates = [{'recognized': 'company computer'}]
        module = batch()
        self.assertTrue(callable(getattr(module, 'retry_unaligned', None)), 'Exception-only retry not implemented')
        module.retry_unaligned(['company', 'computer'], candidates, lambda _: 'Company')
        self.assertEqual(candidates[0]['recognized'], 'company computer')
        self.assertEqual(module.align_words(['company', 'computer'], [candidates[0]['recognized']]), {})

    def test_statistics_export_separates_anomalies_and_preserves_csv_word_text(self):
        module = batch()
        self.assertTrue(callable(getattr(module, 'write_report', None)), 'Statistics export not implemented')
        report = {'C5': {'totals': {'total': 2, 'matched': 1, 'unmatched': 1, 'failed': 0, 'unprocessed': 0, 'fallback': 1},
                         'records': [{'index': 0, 'word': 'ability', 'status': 'matched'},
                                     {'index': 1, 'word': 'vary by type, shape', 'status': 'unmatched',
                                      'reason': 'no-confident-audio-match', 'action': 'existing-pronunciation-chain'}]}}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            module.write_report(root, report)
            self.assertEqual(json.loads((root / 'batch-report.json').read_text()), report)
            with (root / 'batch-anomalies.csv').open(encoding='utf-8-sig', newline='') as file:
                rows = list(csv.DictReader(file))
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]['word'], 'vary by type, shape')
            self.assertEqual(rows[0]['action'], 'existing-pronunciation-chain')
            self.assertIn('| C5 | 2 | 1 | 1 | 0 | 0 | 1 |', (root / 'batch-report.md').read_text())


class BatchQualityTests(unittest.TestCase):
    def test_original_packets_and_spoken_pcm_are_preserved_but_reencoding_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'source.mp3'
            subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-f', 'lavfi', '-i',
                            'aevalsrc=if(between(t\\,1\\,1.7)\\,0.2*sin(2*PI*440*t)\\,0):s=44100:d=3',
                            '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '128k', str(source)], check=True)
            copied = root / 'copied.mp3'
            compressed = root / 'compressed.mp3'
            for target, codec in [(copied, ['-c:a', 'copy']), (compressed, ['-c:a', 'libmp3lame', '-b:a', '128k'])]:
                subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-ss', '0.75', '-to', '1.85', '-i', str(source),
                                '-map', '0:a:0', *codec, str(target)], check=True)
            verifier = batch().SourceQuality(source)
            try:
                self.assertEqual(verifier.verify(copied, .75, 1.85), (True, 'original-packets-and-pcm'))
                self.assertFalse(verifier.verify(compressed, .75, 1.85)[0])
            finally:
                verifier.close()

    def test_rejected_new_audio_never_overwrites_a_previously_approved_file(self):
        module = batch()
        class RejectingQuality:
            def __init__(self, source):
                pass
            def verify(self, clip, start, end):
                return False, 'spoken-pcm-changed'
            def close(self):
                pass
        module.SourceQuality = RejectingQuality
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            module.PROJECT = root
            source = root / 'source.mp3'
            subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
                            '-c:a', 'libmp3lame', str(source)], check=True)
            output = root / 'audio'
            cache = output / 'batch-analysis'
            cache.mkdir(parents=True)
            dictionaries = root / 'public/dicts'
            dictionaries.mkdir(parents=True)
            for chapter, count in ((3, 9), (4, 4), (5, 12), (11, 4)):
                (dictionaries / f'IELTS_WANG_{chapter}.json').write_text('[{"name":"ability"}]')
                for index in range(count):
                    (cache / f'C{chapter}-{index:02d}.json').write_text(json.dumps({
                        'source': str(source), 'sourceHash': hashlib.sha256(source.read_bytes()).hexdigest(),
                        'candidates': [] if index else [{'source': str(source), 'start': 1, 'end': 2, 'duration': 3,
                                                        'recognized': 'Ability', 'method': 'batch-independent-asr'}],
                    }))
            approved = output / 'ieltsWang3/0000-original.mp3'
            approved.parent.mkdir()
            approved.write_bytes(b'previous-approved-audio')
            module.publish(output)
            self.assertEqual(approved.read_bytes(), b'previous-approved-audio')
            report = json.loads((output / 'batch-report.json').read_text())
            self.assertEqual(report['C3']['totals']['failed'], 1)


if __name__ == '__main__':
    unittest.main()
