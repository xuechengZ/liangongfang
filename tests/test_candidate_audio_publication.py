import importlib.util
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
import test_ordered_audio_refinement as fixtures


SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/publish_candidate_pronunciation.py'


def candidate_module():
    if not SCRIPT.exists():
        raise AssertionError('Provisional first-candidate publication is not implemented')
    sys.path.insert(0, str(SCRIPT.parent))
    spec = importlib.util.spec_from_file_location('candidate_publication', SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class CandidatePublicationTests(unittest.TestCase):
    write = fixtures.OrderedPublicationTests.write

    def setUp(self):
        fixtures.OrderedPublicationTests.setUp(self)
        review = json.loads((self.root / 'review/review-report.json').read_text())
        review['rows'][0]['candidates'][0]['recognized'] = 'cop it'
        self.write(self.root / 'review/review-report.json', review)

    def publish(self):
        module = candidate_module()
        module.PROJECT = self.project
        return module

    def test_first_candidate_is_playable_but_stays_unconfirmed_and_keeps_other_fields(self):
        review = json.loads((self.root / 'review/review-report.json').read_text())
        review['rows'][0]['candidates'].append({'audio': 'nonexistent-second-candidate.mp3'})
        self.write(self.root / 'review/review-report.json', review)
        self.assertEqual(self.publish().publish(self.root), 1)
        words = json.loads(self.dictionary.read_text())
        self.assertTrue(words[1]['localAudioUncertain'])
        self.assertEqual(words[1]['localAudio'], 'ieltsWang3/0001-original.mp3')
        self.assertEqual(words[0], self.words[0])
        self.assertEqual(words[2], self.words[2])
        self.assertEqual({k: v for k, v in words[1].items() if k not in ('localAudio', 'localAudioUncertain')}, self.words[1])
        self.assertEqual((self.root / words[1]['localAudio']).read_bytes(), (self.root / 'review/clips/test.mp3').read_bytes())
        report = json.loads((self.root / 'batch-report.json').read_text())['C3']
        record = report['records'][1]
        self.assertEqual(record['status'], 'unmatched')
        self.assertEqual(record['method'], 'first-candidate-user-policy')
        self.assertTrue(record['qualityVerified'])
        self.assertEqual(report['totals']['matched'], 2)
        self.assertEqual(report['totals']['provisional'], 1)
        self.assertEqual(report['totals']['fallback'], 0)
        self.assertEqual(self.publish().publish(self.root), 0)

    def test_no_candidate_keeps_online_fallback_and_does_not_use_context_audio(self):
        review = json.loads((self.root / 'review/review-report.json').read_text())
        review['rows'][0]['candidates'] = []
        self.write(self.root / 'review/review-report.json', review)
        before = self.dictionary.read_bytes()
        self.assertEqual(self.publish().publish(self.root), 0)
        self.assertEqual(self.dictionary.read_bytes(), before)

    def test_stale_original_or_dictionary_is_rejected_before_live_changes(self):
        changed = json.loads(self.dictionary.read_text())
        changed[1]['name'] = 'changed word'
        self.write(self.dictionary, changed)
        with self.assertRaisesRegex(ValueError, 'Dictionary words changed'):
            self.publish().publish(self.root)
        self.assertFalse((self.root / 'ieltsWang3/0001-original.mp3').exists())
        self.write(self.dictionary, self.words)
        (self.project / 'source.mp3').write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError, 'Original recording changed'):
            self.publish().publish(self.root)
        self.assertFalse((self.root / 'ieltsWang3/0001-original.mp3').exists())

    def test_bad_quality_never_changes_live_dictionary_or_audio(self):
        module = self.publish()
        before = self.dictionary.read_bytes()
        with patch.object(module.SourceQuality, 'verify', return_value=(False, 'changed audio')):
            with self.assertRaisesRegex(ValueError, 'quality'):
                module.publish(self.root)
        self.assertEqual(self.dictionary.read_bytes(), before)
        self.assertFalse((self.root / 'ieltsWang3/0001-original.mp3').exists())

    def test_pending_review_keeps_provisional_items_available_for_human_confirmation(self):
        self.publish().publish(self.root)
        sys.path.insert(0, str(SCRIPT.parent))
        from review_local_pronunciation import remaining_review
        rows = json.loads((self.root / 'review/review-report.json').read_text())['rows']
        reports = json.loads((self.root / 'batch-report.json').read_text())
        self.assertEqual(remaining_review(rows, reports), rows)


if __name__ == '__main__':
    unittest.main()
