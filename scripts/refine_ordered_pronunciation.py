#!/usr/bin/env python3
"""Cross-check one-word/one-segment candidates with cached offline models and exact contextual anchors."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil

from import_local_pronunciation import PROJECT, SourceQuality, normalized, publication_words, report_totals, run, write_json, write_report


MODELS = ('tiny.en', 'base.en')


def decide(row, texts, context=None):
    if (row['category'] != 'position-only' or len(row['gapWords']) != 1 or row['gapSegmentCount'] != 1
            or len(row['candidates']) != 1 or not row['previousWord'] or not row['nextWord']
            or len(row['contexts']) != 1 or row['contexts'][0]['source'] != row['candidates'][0]['source']):
        return False
    aliases = {normalized(alias) for alias in row['word'].split('=')}
    exact_models = all(normalized(texts.get(model, '')) in aliases for model in MODELS)
    anchored_context = context is not None and all(normalized(context.get(key, '')) in {
        normalized(alias) for alias in expected.split('=')
    } for key, expected in [('previous', row['previousWord']), ('word', row['word']), ('next', row['nextWord'])])
    return exact_models or anchored_context


def context_text(row, tokens):
    span, context = row['candidates'][0], row['contexts'][0]
    parts = {'previous': [], 'word': [], 'next': []}
    for token in tokens:
        middle = (token['start'] + token['end']) / 2 + context['clipStart']
        key = 'previous' if middle < span['clipStart'] else 'next' if middle > span['clipEnd'] else 'word'
        parts[key].append(token['word'])
    return {key: ' '.join(words).strip() for key, words in parts.items()}


def analyze(root, models):
    import numpy as np
    from faster_whisper import WhisperModel
    report = json.loads((root / 'review/review-report.json').read_text())
    destination = root / 'ordered-refinement.json'
    audit = json.loads(destination.read_text()) if destination.exists() else {}
    if audit.get('reportId') != report['reportId'] or audit.get('models') != models:
        audit = {'reportId': report['reportId'], 'models': models, 'records': {}}
    targets = [row for row in report['rows'] if row['category'] == 'position-only']
    hashes = {}
    for name, path in models.items():
        pending = [row for row in targets if name not in audit['records'].get(row['id'], {}).get('texts', {})]
        if not pending:
            continue
        model = WhisperModel(path, device='cpu', compute_type='int8', cpu_threads=4, local_files_only=True)
        for row in pending:
            span = row['candidates'][0]
            if span['source'] not in hashes:
                hashes[span['source']] = hashlib.sha256(Path(span['source']).read_bytes()).hexdigest()
            if hashes[span['source']] != span['sourceHash']:
                raise ValueError(f'Original recording changed: {span["source"]}')
            record = audit['records'].setdefault(row['id'], {'word': row['word'], 'clipId': span['clipId'],
                                                            'sourceHash': span['sourceHash'], 'texts': {}})
            if record['word'] != row['word'] or record['clipId'] != span['clipId']:
                raise ValueError(f'Stale cached recognition for {row["id"]}')
            is_context = name == 'small.en-context'
            input_span = row['contexts'][0] if is_context else span
            decoded = run(['ffmpeg', '-nostdin', '-v', 'error', '-i', str(root / 'review' / input_span['audio']),
                           '-ac', '1', '-ar', '16000', '-f', 'f32le', '-']).stdout
            segments, _ = model.transcribe(np.frombuffer(decoded, dtype=np.float32), language='en', beam_size=5,
                                           temperature=0, condition_on_previous_text=False, vad_filter=False,
                                           word_timestamps=is_context)
            segments = list(segments)
            record['texts'][name] = ' '.join(segment.text.strip() for segment in segments).strip()
            if is_context:
                record['contextTokens'] = [{'word': word.word, 'start': word.start, 'end': word.end}
                                           for segment in segments for word in segment.words]
                record['context'] = context_text(row, record['contextTokens'])
                record['contextClipId'] = input_span['clipId']
            record['approvedByRecognition'] = decide(row, record['texts'], record.get('context'))
            write_json(destination, audit)
            print(f'{name} {row["id"]} {row["word"]}: {record["texts"][name]}', flush=True)
        del model
    print(f'{sum(decide(row, audit["records"][row["id"]]["texts"], audit["records"][row["id"]].get("context")) for row in targets)}/{len(targets)} pass ordered cross-check', flush=True)


def publish(root):
    review = json.loads((root / 'review/review-report.json').read_text())
    audit = json.loads((root / 'ordered-refinement.json').read_text())
    if audit['reportId'] != review['reportId']:
        raise ValueError('Review source report changed; do not publish stale recognition')
    reports = json.loads((root / 'batch-report.json').read_text())
    dictionaries = {}
    staged, grouped = [], {}
    for row in review['rows']:
        check = audit['records'].get(row['id'], {})
        if not decide(row, check.get('texts', {}), check.get('context')):
            continue
        span = row['candidates'][0]
        if check.get('word') != row['word'] or check.get('clipId') != span['clipId'] or check.get('sourceHash') != span['sourceHash']:
            raise ValueError(f'Review candidate changed: {row["id"]}')
        if check.get('context') and check.get('contextClipId') != row['contexts'][0]['clipId']:
            raise ValueError(f'Review context changed: {row["id"]}')
        if reports[row['book']]['records'][row['index']]['status'] != 'unmatched':
            raise ValueError(f'Target already changed: {row["id"]}')
        grouped.setdefault(span['source'], []).append(row)
    for book in {row['book'] for rows in grouped.values() for row in rows}:
        dictionary = PROJECT / 'public/dicts' / f'IELTS_WANG_{book[1:]}.json'
        words = json.loads(dictionary.read_text())
        if [word['name'] for word in words] != [record['word'] for record in reports[book]['records']]:
            raise ValueError(f'Dictionary words changed: {book}')
        dictionaries[book] = (dictionary, words)
    for source, rows in grouped.items():
        if hashlib.sha256(Path(source).read_bytes()).hexdigest() != rows[0]['candidates'][0]['sourceHash']:
            raise ValueError(f'Original recording changed: {source}')
        verifier = SourceQuality(Path(source))
        try:
            for row in rows:
                span, check = row['candidates'][0], audit['records'][row['id']]
                clip = root / 'review' / span['audio']
                valid, reason = verifier.verify(clip, span['clipStart'], span['clipEnd'])
                if valid and check.get('context'):
                    context = row['contexts'][0]
                    valid, reason = verifier.verify(root / 'review' / context['audio'], context['clipStart'], context['clipEnd'])
                check.update(qualityVerified=valid, qualityReason=reason, published=False)
                if valid:
                    staged.append(row)
        finally:
            verifier.close()
    # All source and quality checks complete before any live audio or word metadata changes.
    for row in staged:
        span, check = row['candidates'][0], audit['records'][row['id']]
        local = f'ieltsWang{row["book"][1:]}/{row["index"]:04d}-original.mp3'
        destination = root / local
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_suffix('.tmp')
        shutil.copyfile(root / 'review' / span['audio'], temporary)
        temporary.replace(destination)
        reports[row['book']]['records'][row['index']].update(
            status='matched', qualityVerified=True, reason='original-packets-and-pcm', localAudio=local,
            source=span['source'], start=span['clipStart'], end=span['clipEnd'], action='use-local-audio',
            method='ordered-asr-crosscheck', recognized=check.get('context', {}).get('word') or check['texts']['base.en'],
            asrCrosscheck={'texts': check['texts'], 'context': check.get('context')})
        check['published'] = True
    for book in {row['book'] for row in staged}:
        dictionary, words = dictionaries[book]
        words = publication_words(words, reports[book]['records'])
        temporary = dictionary.with_suffix('.tmp')
        temporary.write_text(json.dumps(words, ensure_ascii=False, indent=4) + ('\n' if dictionary.read_text().endswith('\n') else ''))
        temporary.replace(dictionary)
    if staged:
        for report in reports.values():
            report['totals'] = report_totals(report['records'], len(report['records']))
        write_report(root, reports)
    write_json(root / 'ordered-refinement.json', audit)
    print(f'{len(staged)} verified original recordings published', flush=True)
    return len(staged)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=PROJECT / '.data/local-pronunciation')
    parser.add_argument('--stage', choices=('analyze', 'publish'), default='analyze')
    parser.add_argument('--tiny-model', type=Path)
    parser.add_argument('--base-model', type=Path)
    parser.add_argument('--context-model', type=Path)
    args = parser.parse_args()
    if args.stage == 'analyze':
        if not all((args.tiny_model, args.base_model, args.context_model)):
            parser.error('analyze requires the three cached model paths')
        analyze(args.root, {'tiny.en': str(args.tiny_model.resolve()), 'base.en': str(args.base_model.resolve()),
                            'small.en-context': str(args.context_model.resolve())})
    else:
        publish(args.root)
        from review_local_pronunciation import generate
        generate(args.root)
