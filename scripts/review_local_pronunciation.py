#!/usr/bin/env python3
"""Build an offline human-review queue. Never approve audio or change dictionaries."""
import argparse
from collections import Counter
import csv
from difflib import SequenceMatcher
import hashlib
import json
from pathlib import Path
import re

from import_local_pronunciation import PROJECT, BOOKS, SourceQuality, align_words, normalized, run, write_json


LABELS = {
    'representation-candidate': '空格／标点形式差异',
    'extra-content-candidate': '重试吻合，但可能夹带其他词',
    'text-candidate': '有相近识别文本',
    'position-only': '仅顺序定位到一个片段',
    'ambiguous-window': '区间内有片段，尚无目标词线索',
    'no-independent-segment': '前后锚点间无独立片段',
}


def compact(text):
    return re.sub(r'[\W_]', '', text.casefold())


def remaining_review(rows, reports):
    expected = {(book, record['index']) for book, report in reports.items()
                for record in report['records'] if record['status'] == 'unmatched'}
    known = {(row['book'], row['index']) for row in rows}
    if not expected.issubset(known):
        raise ValueError('Current unmatched records no longer agree with source alignment')
    for row in rows:
        record = reports[row['book']]['records'][row['index']]
        if (row['book'], row['index']) not in expected and not (
                record['status'] == 'matched' and record.get('qualityVerified')
                and record.get('method') == 'ordered-asr-crosscheck'):
            raise ValueError(f'Unverified resolution for {row["word"]}')
    return [row for row in rows if (row['book'], row['index']) in expected]


def reusable_audio(rows, dictionaries, reports):
    approved = [(book, record, dictionaries[book][record['index']]) for book, report in reports.items()
                for record in report['records'] if record['status'] == 'matched' and record.get('qualityVerified')]
    suggestions = []
    for row in rows:
        target = dictionaries[row['book']][row['index']]
        options = [(book, record) for book, record, word in approved
                   if normalized(word['name']) == normalized(target['name'])
                   and target.get('ukphone') and word.get('ukphone') == target['ukphone']]
        options.sort(key=lambda option: option[0] != row['book'])
        if options:
            book, record = options[0]
            suggestions.append({'id': row['id'], 'word': row['word'], 'targetBook': row['book'],
                                'targetIndex': row['index'], 'sourceBook': book, 'sourceIndex': record['index'],
                                'localAudio': record['localAudio'], 'ukphone': target['ukphone'],
                                'scope': 'same-book' if book == row['book'] else 'other-book'})
    return suggestions


def classify(words, spans):
    matches = align_words(words, [span['recognized'] for span in spans])
    rows = []
    for index, word in enumerate(words):
        if index in matches:
            continue
        before = max((i for i in matches if i < index), default=-1)
        after = min((i for i in matches if i > index), default=len(words))
        low, high = matches.get(before, -1) + 1, matches.get(after, len(spans))
        aliases = word.split('=')
        candidates = []
        for position in range(low, high):
            span = spans[position]
            texts = [span['recognized'], span.get('retryRecognized', '')]
            score = max(SequenceMatcher(None, compact(alias), compact(text)).ratio()
                        for alias in aliases for text in texts)
            equivalent = any(compact(alias) == compact(text) and compact(text) for alias in aliases for text in texts)
            retry_exact = any(normalized(alias) == normalized(span.get('retryRecognized', '')) for alias in aliases)
            evidence = 'text-similarity' if score >= .6 else 'position-only'
            if equivalent:
                evidence = 'possible-extra-content' if retry_exact and any(
                    len(normalized(span['recognized']).split()) > len(normalized(alias).split()) for alias in aliases
                ) else 'spacing-or-punctuation'
            candidates.append({**span, 'candidateIndex': position, 'score': round(score, 3), 'evidence': evidence})
        candidates.sort(key=lambda span: span['score'], reverse=True)
        if candidates and candidates[0]['evidence'] == 'spacing-or-punctuation':
            category = 'representation-candidate'
        elif candidates and candidates[0]['evidence'] == 'possible-extra-content':
            category = 'extra-content-candidate'
        elif candidates and candidates[0]['score'] >= .6:
            category = 'text-candidate'
        elif len(candidates) == 1 and after - before == 2:
            category = 'position-only'
        else:
            category = 'ambiguous-window' if candidates else 'no-independent-segment'
        left = spans[matches[before]] if before >= 0 else (spans[low] if low < len(spans) else None)
        right = spans[matches[after]] if after < len(words) else (spans[high - 1] if high else None)
        contexts = []
        if left and right and left['source'] == right['source'] and right['end'] - left['start'] <= 30:
            contexts.append({'source': left['source'], 'start': max(0, left['start'] - .25),
                             'end': min(right['duration'], right['end'] + .15)})
        else:
            for anchor in (left, right):
                if anchor:
                    contexts.append({'source': anchor['source'], 'start': max(0, anchor['start'] - .25),
                                     'end': min(anchor['duration'], anchor['end'] + 8)})
        rows.append({'index': index, 'word': word, 'category': category, 'approved': False,
                     'gapWords': words[before + 1:after], 'gapSegmentCount': high - low,
                     'previousWord': words[before] if before >= 0 else None,
                     'nextWord': words[after] if after < len(words) else None,
                     'candidates': candidates, 'contexts': contexts})
    return rows


def generate(root):
    report = json.loads((root / 'batch-report.json').read_text())
    rows, fingerprints = [], {}
    for book in BOOKS:
        spans = []
        for path in sorted((root / 'batch-analysis').glob(f'C{book}-*.json')):
            cache = json.loads(path.read_text())
            source = cache['source']
            fingerprints[source] = hashlib.sha256(Path(source).read_bytes()).hexdigest()
            if fingerprints[source] != cache['sourceHash']:
                raise ValueError(f'Source changed: {source}')
            spans.extend(cache['candidates'])
        words = [row['word'] for row in report[f'C{book}']['records']]
        classified = classify(words, spans)
        for row in classified:
            row.update(book=f'C{book}', id=f'C{book}-{row["index"]:04d}')
        rows.extend(classified)
    pending = remaining_review(rows, report)
    destination = root / 'review'
    clips = {}
    for row in rows:
        for kind in ('candidates', 'contexts'):
            for span in row[kind]:
                start = max(0, span['start'] - .25) if kind == 'candidates' else span['start']
                end = min(span['duration'], span['end'] + .15) if kind == 'candidates' else span['end']
                source_hash = fingerprints[span['source']]
                clip_id = hashlib.sha256(f'{source_hash}:{start:.6f}:{end:.6f}'.encode()).hexdigest()
                span.update(clipId=clip_id, sourceHash=source_hash, clipStart=start, clipEnd=end,
                            audio=f'clips/{clip_id}.mp3')
                clips[clip_id] = span
    grouped = {}
    for span in clips.values():
        grouped.setdefault(span['source'], []).append(span)
    for source, segments in grouped.items():
        verifier = SourceQuality(Path(source))
        try:
            for span in segments:
                clip = destination / span['audio']
                clip.parent.mkdir(parents=True, exist_ok=True)
                if not clip.exists():
                    run(['ffmpeg', '-nostdin', '-v', 'error', '-y', '-ss', str(span['clipStart']),
                         '-to', str(span['clipEnd']), '-i', source, '-map', '0:a:0', '-c:a', 'copy', str(clip)])
                valid, reason = verifier.verify(clip, span['clipStart'], span['clipEnd'])
                if not valid:
                    raise ValueError(f'Review clip failed original quality check: {clip}: {reason}')
        finally:
            verifier.close()
        print(f'{Path(source).name}: {len(segments)} original-quality review clips verified', flush=True)
    # Fingerprint the unchanged source candidates, not the shrinking queue, to retain browser progress.
    report_id = hashlib.sha256(json.dumps(rows, sort_keys=True).encode()).hexdigest()
    original_total, resolved = len(rows), len(rows) - len(pending)
    rows = pending
    for row in rows:
        record = report[row['book']]['records'][row['index']]
        if record.get('method') == 'first-candidate-user-policy' and record.get('localAudioUncertain'):
            row['provisionalClipId'] = record['candidateClipId']
    provisional = sum('provisionalClipId' in row for row in rows)
    counts = {book: dict(Counter(row['category'] for row in rows if row['book'] == book)) for book in report}
    dictionaries = {f'C{book}': json.loads((PROJECT / 'public/dicts' / f'IELTS_WANG_{book}.json').read_text()) for book in BOOKS}
    reuse = reusable_audio(rows, dictionaries, report)
    crosscheck_path = root / 'ordered-refinement.json'
    crosscheck = json.loads(crosscheck_path.read_text()) if crosscheck_path.exists() else {}
    payload = {'rows': rows, 'labels': LABELS, 'counts': counts, 'reuseSuggestions': reuse,
               'originalTotal': original_total, 'autoResolvedCount': resolved,
               'crosschecks': crosscheck.get('records', {}) if crosscheck.get('reportId') == report_id else {},
               'total': len(rows), 'provisionalCount': provisional, 'approved': 0, 'qualityVerifiedClips': len(clips)}
    payload['reportId'] = report_id
    write_json(destination / 'review-report.json', payload)
    with (destination / 'review-reuse-suggestions.csv').open('w', encoding='utf-8-sig', newline='') as file:
        writer = csv.writer(file)
        writer.writerow(['目标ID', '目标词', '目标词书', '目标词序', '来源词书', '来源词序', '英音音标', '已验收音频', '复用范围'])
        for item in reuse:
            writer.writerow([item['id'], item['word'], item['targetBook'], item['targetIndex'] + 1,
                             item['sourceBook'], item['sourceIndex'] + 1, item['ukphone'], item['localAudio'],
                             '同书' if item['scope'] == 'same-book' else '跨书'])
    with (destination / 'review-classification.csv').open('w', encoding='utf-8-sig', newline='') as file:
        writer = csv.writer(file)
        writer.writerow(['ID', '词书', '词序(从1开始)', '目标词', '分类', '前一个词', '后一个词', '区间词数', '区间片段数', '识别文本', '重试文本'])
        for row in rows:
            writer.writerow([row['id'], row['book'], row['index'] + 1, row['word'], LABELS[row['category']],
                             row['previousWord'], row['nextWord'], len(row['gapWords']), row['gapSegmentCount'],
                             ' | '.join(s['recognized'] for s in row['candidates']),
                             ' | '.join(s.get('retryRecognized', '') for s in row['candidates'])])
    template = Path(__file__).with_name('local_pronunciation_review.html').read_text()
    (destination / 'index.html').write_text(template.replace('__REVIEW_DATA__', json.dumps(payload, ensure_ascii=False).replace('<', '\\u003c')))
    lines = ['# 未匹配音频复核分类', '', f'原始待匹配{original_total}项，顺序及识别自动复核解决{resolved}项，剩余{len(rows)}项。', '', '| 词书 | ' + ' | '.join(LABELS.values()) + ' | 合计 |',
             '| --- | ' + ' | '.join(['---:'] * (len(LABELS) + 1)) + ' |']
    for book, values in counts.items():
        lines.append('| ' + book + ' | ' + ' | '.join(str(values.get(key, 0)) for key in LABELS) + f' | {sum(values.values())} |')
    total = Counter(row['category'] for row in rows)
    lines += ['| 合计 | ' + ' | '.join(str(total[key]) for key in LABELS) + f' | {len(rows)} |', '',
              f'所有分类仍为待确认；经用户授权暂用候选一{provisional}项，听写显示发音可能有误，不视为已确认。字符相似度不是匹配概率。',
              '无独立片段表示相邻已匹配词之间没有已检测的独立区间，不能证明整份录音没有这个词。',
              '复核片段原码流复制并通过原始音频包与PCM一致性检查；原文件不变。',
              '页面可确认、标记不匹配或不确定，并导出结果。确认尚不会自动改变听写网站发音。', '',
              f'另外，同书同词且英音音标一致的已验收音频可复用建议有{sum(item["scope"] == "same-book" for item in reuse)}项；',
              f'其他书同词且英音音标一致的建议有{sum(item["scope"] == "other-book" for item in reuse)}项。',
              f'这些是以上{len(rows)}项的子集，不重复计入总数，也尚未更改映射。详见review-reuse-suggestions.csv。', '']
    (destination / 'summary.md').write_text('\n'.join(lines))
    print(json.dumps(dict(total), ensure_ascii=False), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=PROJECT / '.data/local-pronunciation')
    generate(parser.parse_args().root)
