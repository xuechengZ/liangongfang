"""Match existing tagged dictionary meanings; never infer POS from an IELTS book category."""
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MARKER = re.compile(r'(?<![A-Za-z])(n|adj|adv|a|ad|vt|vi|v|prep|pron|conj|num|art|det|interj|int)\.(?=\s|[\u3400-\u9fff])')
LABELS = {'a': 'adj', 'ad': 'adv', 'vt': 'v', 'vi': 'v', 'int': 'interj'}
ORDER = ['n', 'v', 'adj', 'adv', 'prep', 'pron', 'conj', 'num', 'art', 'det', 'interj']


def meaning_tokens(text):
    text = re.sub(r'（[^）]*）|\([^)]*\)|<[^>]*>', '', text)
    return {re.sub(r'\s+', '', item).strip('-•。.!！') for item in re.split(r'[，,；;、/\n]', text) if item.strip()}


def resolve_pos(translations, sources):
    target = set().union(*(meaning_tokens(text) for text in translations))
    observed, matched = set(), set()
    for text in sources:
        text = text.replace('\\n', '\n')
        markers = list(MARKER.finditer(text))
        unaligned = any(
            LABELS.get(left.group(1), left.group(1)) != LABELS.get(right.group(1), right.group(1))
            and not text[left.end():right.start()].strip(' /&、,;；\t\n')
            for left, right in zip(markers, markers[1:])
        )
        if unaligned:
            observed.update(LABELS.get(marker.group(1), marker.group(1)) for marker in markers)
            continue
        for i, marker in enumerate(markers):
            end = markers[i + 1].start() if i + 1 < len(markers) else len(text)
            meanings = meaning_tokens(text[marker.end():end])
            if not any(re.search(r'[\u3400-\u9fff]', token) for token in meanings):
                continue
            pos = LABELS.get(marker.group(1), marker.group(1))
            observed.add(pos)
            if target & meanings:
                matched.add(pos)
    if matched:
        return ' / '.join(pos + '.' for pos in ORDER if pos in matched), 'meaning_match'
    if len(observed) == 1:
        return next(iter(observed)) + '.', 'single_observed_pos'
    return None, 'ambiguous_meaning' if observed else 'no_tagged_source'


def main():
    books = {book: json.loads((ROOT / f'public/dicts/IELTS_WANG_{book}.json').read_text()) for book in [3, 4, 5, 11]}
    needed = {word['name'].strip().lower() for words in books.values() for word in words}
    sources = defaultdict(set)
    for path in sorted((ROOT / 'public/dicts').glob('*.json')):
        data = json.loads(path.read_text())
        if not isinstance(data, list):
            continue
        for word in data:
            if not isinstance(word, dict) or not isinstance(word.get('name'), str):
                continue
            name = word['name'].strip().lower()
            if name in needed:
                sources[name].update(text for text in word.get('trans') or [] if isinstance(text, str) and MARKER.search(text))
    index, report = {}, {}
    for book, words in books.items():
        counts, missing = Counter(), []
        for word in words:
            name = word['name'].strip().lower()
            pos, reason = resolve_pos(word['trans'], sorted(sources[name]))
            counts[reason] += 1
            if pos:
                index[name + '\t' + '；'.join(word['trans'])] = pos
            else:
                missing.append({'name': word['name'], 'trans': word['trans'], 'reason': reason})
        report[f'C{book}'] = {'total': len(words), 'matched': len(words) - len(missing), 'methods': dict(counts), 'missing': missing}
    (ROOT / 'src/resources/word-parts-of-speech.json').write_text(json.dumps(index, ensure_ascii=False, sort_keys=True, indent=2) + '\n')
    (ROOT / 'docs/word-parts-of-speech-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({book: {k: v for k, v in details.items() if k != 'missing'} for book, details in report.items()}, ensure_ascii=False))


if __name__ == '__main__':
    main()
