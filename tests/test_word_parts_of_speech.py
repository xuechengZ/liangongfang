import importlib.util
import unittest
from pathlib import Path


class WordPartOfSpeechTests(unittest.TestCase):
    def resolver(self):
        path = Path(__file__).resolve().parents[1] / 'scripts/build-word-parts-of-speech.py'
        self.assertTrue(path.exists(), 'Missing offline part-of-speech matching implementation')
        spec = importlib.util.spec_from_file_location('word_pos', path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module.resolve_pos

    def test_same_word_different_meanings_are_not_assigned_the_same_pos(self):
        resolve = self.resolver()
        sources = ['adj. 抽象的，理论上的', 'n. 摘要，概要', 'v. 提取；抽象化']
        self.assertEqual(resolve(['摘要'], sources), ('n.', 'meaning_match'))
        self.assertEqual(resolve(['抽象的'], sources), ('adj.', 'meaning_match'))

    def test_combined_unaligned_headers_do_not_mislabel_a_specific_meaning(self):
        resolve = self.resolver()
        self.assertEqual(resolve(['学术的'], ['a. / n. 学术的，教学的', 'adj. 学术的']), ('adj.', 'meaning_match'))
        self.assertEqual(resolve(['学术的'], ['a. / n. 学术的，教学的']), (None, 'ambiguous_meaning'))

    def test_unknown_meaning_with_conflicting_labels_stays_unmatched(self):
        resolve = self.resolver()
        self.assertEqual(resolve(['未收录义项'], ['n. 摘要', 'adj. 抽象的']), (None, 'ambiguous_meaning'))

    def test_single_observed_pos_is_used_without_inventing_a_phrase_pos(self):
        resolve = self.resolver()
        self.assertEqual(resolve(['能耐'], ['n. 能力，才能']), ('n.', 'single_observed_pos'))
        self.assertEqual(resolve(['均衡饮食'], []), (None, 'no_tagged_source'))

    def test_inline_sections_and_transitivity_keep_real_labels(self):
        resolve = self.resolver()
        self.assertEqual(resolve(['记录'], ['n. 记录；vt. 记录']), ('n. / v.', 'meaning_match'))
        self.assertEqual(resolve(['有组织地'], ['- adv. 有组织地\n- 系统地']), ('adv.', 'meaning_match'))


if __name__ == '__main__':
    unittest.main()
