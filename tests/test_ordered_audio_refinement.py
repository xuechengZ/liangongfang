import importlib.util
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch


SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/refine_ordered_pronunciation.py'


def refinement():
    if not SCRIPT.exists():
        raise AssertionError('Ordered audio cross-check refinement is not implemented')
    sys.path.insert(0, str(SCRIPT.parent))
    spec = importlib.util.spec_from_file_location('ordered_audio_refinement', SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def row():
    return {'id': 'C3-0001', 'book': 'C3', 'index': 1, 'word': 'carpet', 'category': 'position-only',
            'gapWords': ['carpet'], 'gapSegmentCount': 1, 'previousWord': 'carbon', 'nextWord': 'carriage',
            'candidates': [{'source': 'original.mp3', 'clipId': 'clip-one', 'sourceHash': 'original-hash'}],
            'contexts': [{'source': 'original.mp3'}]}


class OrderedRefinementTests(unittest.TestCase):
    def test_one_word_one_segment_plus_two_exact_model_results_can_be_approved(self):
        self.assertTrue(refinement().decide(row(), {'tiny.en': 'Carpet.', 'base.en': 'carpet'}))

    def test_order_or_a_single_model_match_is_not_enough(self):
        for results in ({}, {'tiny.en': 'carpet'}, {'tiny.en': 'carpet', 'base.en': 'Cop it'},
                        {'tiny.en': 'carpet', 'base.en': 'carpets'}, {'tiny.en': 'carpet extra', 'base.en': 'carpet'}):
            self.assertFalse(refinement().decide(row(), results))

    def test_shared_interval_and_recording_boundaries_are_not_auto_approved(self):
        for overrides in ({'gapWords': ['carpet', 'carriage']}, {'gapSegmentCount': 2},
                          {'previousWord': None}, {'contexts': [{'source': 'other.mp3'}]},
                          {'category': 'ambiguous-window'}):
            candidate = {**row(), **overrides}
            self.assertFalse(refinement().decide(candidate, {'tiny.en': 'carpet', 'base.en': 'carpet'}))

    def test_explicit_word_aliases_are_allowed_but_not_fuzzy_or_plural_replacement(self):
        candidate = {**row(), 'word': 'colour=color', 'gapWords': ['colour=color']}
        self.assertTrue(refinement().decide(candidate, {'tiny.en': 'colour', 'base.en': 'color'}))
        candidate = {**row(), 'word': 'beats', 'gapWords': ['beats']}
        self.assertFalse(refinement().decide(candidate, {'tiny.en': 'beat', 'base.en': 'beat'}))

    def test_complete_context_match_with_both_exact_anchors_is_valid_evidence(self):
        context = {'previous': 'carbon', 'word': 'carpet', 'next': 'carriage'}
        self.assertTrue(refinement().decide(row(), {}, context))
        for changes in ({'previous': ''}, {'word': 'carpets'}, {'word': 'carpet extra'}, {'next': 'wrong'}):
            self.assertFalse(refinement().decide(row(), {}, {**context, **changes}))

    def test_context_words_are_assigned_by_timestamps_not_expected_word_prompts(self):
        self.assertTrue(hasattr(refinement(), 'context_text'), 'Timestamped context recognition is missing')
        candidate = row()
        candidate['contexts'][0]['clipStart'] = 10
        candidate['candidates'][0].update(clipStart=11, clipEnd=12)
        tokens = [{'word': ' carbon', 'start': 0, 'end': .6},
                  {'word': ' carpet', 'start': 1.1, 'end': 1.8},
                  {'word': ' carriage', 'start': 3, 'end': 3.8}]
        self.assertEqual(refinement().context_text(candidate, tokens),
                         {'previous': 'carbon', 'word': 'carpet', 'next': 'carriage'})


class OrderedPublicationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.project = Path(self.temporary.name)
        self.root = self.project / '.data/local-pronunciation'
        self.root.mkdir(parents=True)
        self.module = refinement()
        self.module.PROJECT = self.project
        source = self.project / 'source.mp3'
        subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono:d=1',
                        '-f', 'lavfi', '-i', 'sine=frequency=600:sample_rate=44100:duration=0.6',
                        '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono:d=1', '-filter_complex',
                        '[0:a][1:a][2:a]concat=n=3:v=0:a=1', '-c:a', 'libmp3lame', '-q:a', '2', str(source)],
                       check=True, capture_output=True)
        clip = self.root / 'review/clips/test.mp3'
        clip.parent.mkdir(parents=True)
        subprocess.run(['ffmpeg', '-v', 'error', '-ss', '0.75', '-to', '1.75', '-i', str(source),
                        '-c:a', 'copy', str(clip)], check=True, capture_output=True)
        candidate = row()
        candidate['candidates'][0].update(source=str(source), audio='clips/test.mp3',
                                          sourceHash=hashlib.sha256(source.read_bytes()).hexdigest(),
                                          clipStart=.75, clipEnd=1.75)
        candidate['contexts'][0]['source'] = str(source)
        self.write(self.root / 'review/review-report.json', {'reportId': 'stable-report', 'rows': [candidate]})
        self.write(self.root / 'ordered-refinement.json', {'reportId': 'stable-report',
                   'models': {'tiny.en': 'tiny-snapshot', 'base.en': 'base-snapshot'}, 'records': {
                   candidate['id']: {'word': 'carpet', 'clipId': 'clip-one',
                       'sourceHash': candidate['candidates'][0]['sourceHash'], 'texts': {'tiny.en': 'carpet', 'base.en': 'carpet'}}}})
        self.words = [{'name': 'carbon', 'ukphone': 'a', 'trans': ['unchanged'], 'localAudio': 'ieltsWang3/0000-original.mp3'},
                      {'name': 'carpet', 'ukphone': 'b', 'trans': ['unchanged']},
                      {'name': 'carriage', 'ukphone': 'c', 'trans': ['unchanged'], 'localAudio': 'ieltsWang3/0002-original.mp3'}]
        records = [{'index': i, 'word': word['name'], 'status': 'matched' if 'localAudio' in word else 'unmatched',
                    'qualityVerified': 'localAudio' in word, **({'localAudio': word['localAudio']} if 'localAudio' in word else {})}
                   for i, word in enumerate(self.words)]
        self.write(self.root / 'batch-report.json', {'C3': {'totals': {'total': 3}, 'records': records}})
        self.dictionary = self.project / 'public/dicts/IELTS_WANG_3.json'
        self.write(self.dictionary, self.words)

    def write(self, path, data):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data, ensure_ascii=False, indent=4) + '\n')

    def test_publish_keeps_word_data_and_copies_verified_original_packets(self):
        self.assertTrue(hasattr(self.module, 'publish'), 'Ordered publication is missing')
        self.assertEqual(self.module.publish(self.root), 1)
        words = json.loads(self.dictionary.read_text())
        self.assertEqual(words[1]['localAudio'], 'ieltsWang3/0001-original.mp3')
        for before, after in zip(self.words, words):
            self.assertEqual({k: v for k, v in before.items() if k != 'localAudio'},
                             {k: v for k, v in after.items() if k != 'localAudio'})
        self.assertEqual((self.root / words[1]['localAudio']).read_bytes(), (self.root / 'review/clips/test.mp3').read_bytes())
        report = json.loads((self.root / 'batch-report.json').read_text())
        self.assertEqual(report['C3']['totals']['matched'], 3)
        self.assertEqual(report['C3']['records'][1]['method'], 'ordered-asr-crosscheck')

    def test_stale_source_never_changes_dictionary(self):
        self.assertTrue(hasattr(self.module, 'publish'), 'Ordered publication is missing')
        before = self.dictionary.read_bytes()
        (self.project / 'source.mp3').write_bytes(b'changed original')
        with self.assertRaisesRegex(ValueError, 'changed'):
            self.module.publish(self.root)
        self.assertEqual(self.dictionary.read_bytes(), before)

    def test_quality_failure_cannot_replace_live_asset_or_dictionary(self):
        self.assertTrue(hasattr(self.module, 'publish'), 'Ordered publication is missing')
        destination = self.root / 'ieltsWang3/0001-original.mp3'
        destination.parent.mkdir()
        destination.write_bytes(b'previous audio must remain')
        before = self.dictionary.read_bytes()
        with patch.object(self.module.SourceQuality, 'verify', return_value=(False, 'audio-packets-changed')):
            self.assertEqual(self.module.publish(self.root), 0)
        self.assertEqual(destination.read_bytes(), b'previous audio must remain')
        self.assertEqual(self.dictionary.read_bytes(), before)

    def test_dictionary_drift_is_rejected_before_any_live_audio_changes(self):
        changed = json.loads(self.dictionary.read_text())
        changed[1]['name'] = 'different word'
        self.write(self.dictionary, changed)
        with self.assertRaisesRegex(ValueError, 'Dictionary words changed'):
            self.module.publish(self.root)
        self.assertFalse((self.root / 'ieltsWang3/0001-original.mp3').exists())


if __name__ == '__main__':
    unittest.main()
