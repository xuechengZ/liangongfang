#!/usr/bin/env python3
"""Publish candidate one under the user's provisional policy, never as a confirmed match."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil

from import_local_pronunciation import PROJECT, SourceQuality, publication_words, report_totals, write_report


def publish(root):
    review = json.loads((root / 'review/review-report.json').read_text())
    reports = json.loads((root / 'batch-report.json').read_text())
    dictionaries, grouped = {}, {}
    for row in review['rows']:
        if not row['candidates']:
            continue  # Neighboring context is not a word-pronunciation candidate.
        record = reports[row['book']]['records'][row['index']]
        if record['status'] != 'unmatched' or record['word'] != row['word']:
            raise ValueError(f'Target changed: {row["id"]}')
        span = row['candidates'][0]
        if record.get('method') == 'first-candidate-user-policy':
            if record.get('candidateClipId') != span['clipId']:
                raise ValueError(f'Candidate changed: {row["id"]}')
            continue
        grouped.setdefault(span['source'], []).append(row)
    for book in {row['book'] for rows in grouped.values() for row in rows}:
        dictionary = PROJECT / 'public/dicts' / f'IELTS_WANG_{book[1:]}.json'
        words = json.loads(dictionary.read_text())
        if [word['name'] for word in words] != [record['word'] for record in reports[book]['records']]:
            raise ValueError(f'Dictionary words changed: {book}')
        dictionaries[book] = (dictionary, words)
    staged = []
    for source, rows in grouped.items():
        digest = hashlib.sha256(Path(source).read_bytes()).hexdigest()
        if any(digest != row['candidates'][0]['sourceHash'] for row in rows):
            raise ValueError(f'Original recording changed: {source}')
        verifier = SourceQuality(Path(source))
        try:
            for row in rows:
                span = row['candidates'][0]
                valid, reason = verifier.verify(root / 'review' / span['audio'], span['clipStart'], span['clipEnd'])
                if not valid:
                    raise ValueError(f'Original quality check failed: {row["id"]}: {reason}')
                staged.append(row)
        finally:
            verifier.close()
    # Complete all original-quality checks before touching live files or dictionaries.
    for row in staged:
        span = row['candidates'][0]
        local = f'ieltsWang{row["book"][1:]}/{row["index"]:04d}-original.mp3'
        destination = root / local
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_suffix('.tmp')
        shutil.copyfile(root / 'review' / span['audio'], temporary)
        temporary.replace(destination)
        reports[row['book']]['records'][row['index']].update(
            qualityVerified=True, reason='original-packets-and-pcm', localAudio=local,
            source=span['source'], start=span['clipStart'], end=span['clipEnd'],
            action='use-provisional-local-audio', method='first-candidate-user-policy',
            candidateClipId=span['clipId'], recognized=span['recognized'], localAudioUncertain=True)
    for book in {row['book'] for row in staged}:
        dictionary, words = dictionaries[book]
        published = publication_words(words, reports[book]['records'])
        temporary = dictionary.with_suffix('.tmp')
        temporary.write_text(json.dumps(published, ensure_ascii=False, indent=4)
                             + ('\n' if dictionary.read_text().endswith('\n') else ''))
        temporary.replace(dictionary)
    if staged:
        for report in reports.values():
            report['totals'] = report_totals(report['records'], len(report['records']))
        write_report(root, reports)
    print(f'{len(staged)} first candidates published with pronunciation uncertainty labels', flush=True)
    return len(staged)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=PROJECT / '.data/local-pronunciation')
    args = parser.parse_args()
    publish(args.root)
    from review_local_pronunciation import generate
    generate(args.root)
