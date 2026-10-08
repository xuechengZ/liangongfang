import importlib.util
from pathlib import Path
import sys
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/review_local_pronunciation.py'


def review():
    if not SCRIPT.exists():
        raise AssertionError('Pronunciation candidate review is not implemented')
    sys.path.insert(0, str(SCRIPT.parent))
    spec = importlib.util.spec_from_file_location('local_audio_review', SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def span(text, start, retry=None, source='source.mp3'):
    result = {'recognized': text, 'start': start, 'end': start + .6, 'duration': 60, 'source': source}
    if retry is not None:
        result['retryRecognized'] = retry
    return result


class CandidateReviewTests(unittest.TestCase):
    def test_verified_ordered_resolution_is_removed_from_pending_review(self):
        self.assertTrue(hasattr(review(), 'remaining_review'), 'Resolved queue filtering is missing')
        rows = [{'book': 'C3', 'index': 0, 'word': 'tea'}, {'book': 'C3', 'index': 1, 'word': 'teeth'}]
        reports = {'C3': {'records': [
            {'index': 0, 'word': 'tea', 'status': 'matched', 'qualityVerified': True, 'method': 'ordered-asr-crosscheck'},
            {'index': 1, 'word': 'teeth', 'status': 'unmatched'}]}}
        self.assertEqual(review().remaining_review(rows, reports), [{'book': 'C3', 'index': 1, 'word': 'teeth'}])
        reports['C3']['records'][0]['qualityVerified'] = False
        with self.assertRaises(ValueError):
            review().remaining_review(rows, reports)

    def test_verified_exact_same_word_and_uk_phonetic_can_be_proposed_for_reuse(self):
        self.assertTrue(hasattr(review(), 'reusable_audio'), 'Verified same-word reuse analysis is missing')
        dictionaries = {'C11': [{'name': 'moderate', 'ukphone': 'mɒdərət'}] * 2,
                        'C3': [{'name': 'moderate', 'ukphone': 'mɒdərət'}]}
        reports = {book: {'records': [{'index': 0, 'word': 'moderate', 'status': 'matched',
                    'qualityVerified': True, 'localAudio': f'{book}/original.mp3'}]} for book in dictionaries}
        rows = [{'id': 'C11-0001', 'book': 'C11', 'index': 1, 'word': 'moderate'}]
        suggestions = review().reusable_audio(rows, dictionaries, reports)
        self.assertEqual(len(suggestions), 1)
        self.assertEqual(suggestions[0]['scope'], 'same-book')
        self.assertEqual(suggestions[0]['localAudio'], 'C11/original.mp3')

    def test_different_or_unknown_uk_phonetics_and_unverified_audio_are_not_reuse_shortcuts(self):
        self.assertTrue(hasattr(review(), 'reusable_audio'), 'Verified same-word reuse analysis is missing')
        for phone, verified in [('different', True), ('', True), ('mɒdərət', False)]:
            dictionaries = {'C11': [{'name': 'moderate', 'ukphone': phone}],
                            'C3': [{'name': 'moderate', 'ukphone': 'mɒdərət'}]}
            reports = {'C3': {'records': [{'index': 0, 'word': 'moderate', 'status': 'matched',
                        'qualityVerified': verified, 'localAudio': 'C3/original.mp3'}]}, 'C11': {'records': []}}
            rows = [{'id': 'C11-0000', 'book': 'C11', 'index': 0, 'word': 'moderate'}]
            self.assertEqual(review().reusable_audio(rows, dictionaries, reports), [])

    def test_only_searches_between_nearest_ordered_exact_anchors(self):
        result = review().classify(['start', 'board', 'end', 'bored'], [
            span('start', 1), span('bored', 5), span('end', 9), span('bored', 13)])
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]['category'], 'text-candidate')
        self.assertEqual([s['start'] for s in result[0]['candidates']], [5])
        self.assertFalse(result[0]['approved'])

    def test_compact_equivalence_is_a_review_candidate_not_auto_approval(self):
        row = review().classify(['start', 'bed sit', 'end'], [
            span('start', 1), span('bedsit', 5), span('end', 9)])[0]
        self.assertEqual(row['category'], 'representation-candidate')
        self.assertEqual(row['candidates'][0]['evidence'], 'spacing-or-punctuation')
        self.assertFalse(row['approved'])

    def test_exact_retry_does_not_hide_possible_extra_spoken_words(self):
        row = review().classify(['start', 'documentary', 'end'], [
            span('start', 1), span('documentary injury', 5, 'Documentary'), span('end', 9)])[0]
        self.assertEqual(row['category'], 'extra-content-candidate')
        self.assertEqual(row['candidates'][0]['recognized'], 'documentary injury')
        self.assertFalse(row['approved'])

    def test_single_positional_candidate_does_not_claim_text_match(self):
        row = review().classify(['start', 'tea', 'end'], [
            span('start', 1), span('', 5, 'P'), span('end', 9)])[0]
        self.assertEqual(row['category'], 'position-only')
        self.assertEqual(row['candidates'][0]['evidence'], 'position-only')

    def test_shared_weak_candidate_is_not_assigned_to_two_targets(self):
        rows = review().classify(['start', 'waterproof', 'rollercoaster', 'resort', 'end'], [
            span('start', 1), span('roller coaster', 5), span('end', 9)])
        self.assertEqual([row['category'] for row in rows], [
            'ambiguous-window', 'representation-candidate', 'ambiguous-window'])
        self.assertTrue(all(not row['approved'] for row in rows))

    def test_no_independent_segment_keeps_context_not_missing_audio_claim(self):
        row = review().classify(['start', 'keyboard', 'end'], [span('start', 1), span('end', 9)])[0]
        self.assertEqual(row['category'], 'no-independent-segment')
        self.assertEqual(row['candidates'], [])
        self.assertEqual(row['contexts'], [{'source': 'source.mp3', 'start': .75, 'end': 9.75}])
        self.assertFalse(row['approved'])

    def test_recording_boundary_never_builds_a_cross_file_clip(self):
        row = review().classify(['start', 'missing', 'end'], [
            span('start', 50, source='left.mp3'), span('end', 2, source='right.mp3')])[0]
        self.assertEqual([s['source'] for s in row['contexts']], ['left.mp3', 'right.mp3'])
        self.assertTrue(all(0 <= s['start'] < s['end'] <= 60 for s in row['contexts']))


if __name__ == '__main__':
    unittest.main()
