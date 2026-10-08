#!/usr/bin/env python3
"""Offline, resumable import. Only exact semantic matches with original-quality audio are published."""
import argparse
from array import array
from bisect import bisect_right
import copy
import csv
import hashlib
import json
import mmap
from pathlib import Path
import re
import subprocess
import tempfile
import time


PROJECT = Path(__file__).resolve().parents[1]
BOOKS = (3, 4, 5, 11)


def normalized(text):
    return ' '.join(re.sub(r"[^\w\s']", ' ', text.casefold()).split())


def speech_intervals(log, duration):
    pairs = re.findall(r'silence_start: ([\d.]+).*?silence_end: ([\d.]+)', log, re.S)
    result, previous = [], 0
    for start, end in [(float(a), float(b)) for a, b in pairs] + [(duration, duration)]:
        if start - previous > .12:
            result.append({'start': previous, 'end': start})
        previous = end
    return result


def align_words(words, recognized):
    """Exact ordered alignment tolerates insertions/deletions, never fuzzy substitutions."""
    expected = [{normalized(alias) for alias in word.split('=')} for word in words]
    actual = [normalized(text) for text in recognized]
    rows = [array('H', [0]) * (len(actual) + 1) for _ in range(len(words) + 1)]
    for i in range(len(words) - 1, -1, -1):
        row, following = rows[i], rows[i + 1]
        for j in range(len(actual) - 1, -1, -1):
            row[j] = following[j + 1] + 1 if actual[j] and actual[j] in expected[i] else max(following[j], row[j + 1])
    matches, i, j = {}, 0, 0
    while i < len(words) and j < len(actual):
        if rows[i + 1][j] == rows[i][j]:
            i += 1
        elif actual[j] and actual[j] in expected[i]:
            matches[i] = j
            i, j = i + 1, j + 1
        else:
            j += 1
    return matches


def retry_unaligned(words, candidates, recognize):
    used = set(align_words(words, [span['recognized'] for span in candidates]).values())
    targets = {normalized(alias) for word in words for alias in word.split('=')}
    for index, span in enumerate(candidates):
        if index in used or 'retryRecognized' in span:
            continue
        text = recognize(span)
        span['retryRecognized'] = text
        previous, retried = normalized(span['recognized']), normalized(text)
        # Do not approve just one word from a segment that contained two words.
        if retried in targets and (not previous or len(retried.split()) >= len(previous.split())):
            span.update(recognized=text, method='independent-clip-asr')


def publication_words(words, records):
    result = copy.deepcopy(words)
    playable = {record['index']: record for record in records if record.get('qualityVerified') and (
        record['status'] == 'matched' or (
            record['status'] == 'unmatched' and record.get('method') == 'first-candidate-user-policy'
            and record.get('localAudioUncertain') is True))}
    for index, word in enumerate(result):
        if index in playable:
            record = playable[index]
            word['localAudio'] = record['localAudio']
            if record['status'] == 'unmatched':
                word['localAudioUncertain'] = True
            else:
                word.pop('localAudioUncertain', None)
        else:
            word.pop('localAudio', None)
            word.pop('localAudioUncertain', None)
    return result


def report_totals(records, total):
    counts = {status: sum(row['status'] == status for row in records) for status in ('matched', 'unmatched', 'failed')}
    provisional = sum(row['status'] == 'unmatched' and row.get('qualityVerified', False)
                      and row.get('method') == 'first-candidate-user-policy' and row.get('localAudioUncertain') is True
                      for row in records)
    return {'total': total, **counts, 'unprocessed': total - len(records),
            'fallback': counts['unmatched'] + counts['failed'] - provisional,
            **({'provisional': provisional} if provisional else {})}


def run(args, **kwargs):
    return subprocess.run(args, check=True, capture_output=True, **kwargs)


def probe(path, packets=False):
    args = ['ffprobe', '-v', 'error', '-select_streams', 'a:0', '-of', 'json']
    args += ['-show_packets', '-show_data_hash', 'sha256', '-show_entries', 'packet=data_hash'] if packets else [
        '-show_entries', 'stream=codec_name,sample_rate,channels,bit_rate:format=duration']
    return json.loads(run([*args, str(path)]).stdout)


class SourceQuality:
    def __init__(self, source):
        self.stream = probe(source)['streams'][0]
        self.hashes = [packet['data_hash'] for packet in probe(source, True)['packets']]
        self.locations = {}
        for index, digest in enumerate(self.hashes):
            self.locations.setdefault(digest, []).append(index)
        self.file = tempfile.TemporaryFile()
        subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-i', str(source), '-map', '0:a:0', '-f', 'f32le', '-'],
                       stdout=self.file, stderr=subprocess.PIPE, check=True)
        self.pcm = mmap.mmap(self.file.fileno(), 0, access=mmap.ACCESS_READ)

    def verify(self, clip, start, end):
        stream = probe(clip)['streams'][0]
        if any(stream[key] != self.stream[key] for key in ('codec_name', 'sample_rate', 'channels')):
            return False, 'audio-format-changed'
        hashes = [packet['data_hash'] for packet in probe(clip, True)['packets']]
        if not hashes or not any(self.hashes[offset:offset + len(hashes)] == hashes for offset in self.locations.get(hashes[0], [])):
            return False, 'audio-packets-changed'
        decoded = run(['ffmpeg', '-nostdin', '-v', 'error', '-i', str(clip), '-map', '0:a:0', '-f', 'f32le', '-'])
        if decoded.stderr:
            return False, 'audio-decoding-errors'
        stride = int(self.stream['sample_rate']) * self.stream['channels'] * 4
        # Only the silent decoder-preroll is excluded, never any spoken content.
        body = decoded.stdout[round(int(self.stream['sample_rate']) * .15) * self.stream['channels'] * 4:]
        low, high = max(0, int((start - .15) * stride)), min(len(self.pcm), int((end + .15) * stride))
        if not body or self.pcm.find(body, low, high) < 0:
            return False, 'spoken-pcm-changed'
        return True, 'original-packets-and-pcm'

    def close(self):
        self.pcm.close()
        self.file.close()


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
    temporary.replace(path)


def write_report(output, reports):
    write_json(output / 'batch-report.json', reports)
    columns = ['book', 'index', 'word', 'status', 'reason', 'recognized', 'source', 'start', 'end', 'action']
    with (output / 'batch-anomalies.csv').open('w', encoding='utf-8-sig', newline='') as file:
        writer = csv.DictWriter(file, fieldnames=columns, extrasaction='ignore')
        writer.writeheader()
        for book, report in reports.items():
            for row in report['records']:
                if row['status'] != 'matched':
                    writer.writerow({'book': book, **row})
    lines = ['# 四本词书本地音频统计', '', '| 词书 | 总词数 | 本地音频 | 无法可靠对应 | 处理失败 | 未处理 | 备用发音 |',
             '| --- | ---: | ---: | ---: | ---: | ---: | ---: |']
    for book, report in reports.items():
        totals = report['totals']
        lines.append('| ' + book + ' | ' + ' | '.join(str(totals[key]) for key in
                     ('total', 'matched', 'unmatched', 'failed', 'unprocessed', 'fallback')) + ' |')
    lines += ['', '本地音频直接复制原MP3码流；逐段检查原始音频包与完整发音PCM一致。',
              '无法对应是未获得可靠识别与顺序对齐，不代表已确认原录音没有这个词。',
              '经用户授权的候选一暂用本地片段，并标记发音可能有误；不计为已确认匹配。没有候选的仍使用在线音源及系统语音。',
              '逐词结果见 batch-report.json；异常清单见 batch-anomalies.csv。', '',
              f'暂用候选一：{sum(report["totals"].get("provisional", 0) for report in reports.values())}项；本地音频列仅统计已可靠匹配项。', '']
    (output / 'batch-report.md').write_text('\n'.join(lines))


def recognize_recording(source, model):
    import numpy as np
    duration = float(probe(source)['format']['duration'])
    log = run(['ffmpeg', '-nostdin', '-hide_banner', '-nostats', '-i', str(source), '-map', '0:a:0',
               '-af', 'silencedetect=noise=-35dB:d=1.2', '-f', 'null', '-']).stderr.decode()
    intervals = [span for span in speech_intervals(log, duration) if span['end'] - span['start'] <= 8]
    decoded = run(['ffmpeg', '-nostdin', '-v', 'error', '-i', str(source), '-map', '0:a:0',
                   '-ac', '1', '-ar', '16000', '-f', 'f32le', '-']).stdout
    audio, chunks, elapsed = np.frombuffer(decoded, dtype=np.float32), [], 0
    for span in intervals:
        piece = audio[int(max(0, span['start'] - .25) * 16000):int((span['end'] + .15) * 16000)]
        span.update(montageStart=elapsed, montageEnd=elapsed + len(piece) / 16000, recognized='')
        chunks.extend([piece, np.zeros(8000, dtype=np.float32)])
        elapsed = span['montageEnd'] + .5
    starts = [span['montageStart'] for span in intervals]
    segments, _ = model.transcribe(np.concatenate(chunks), language='en', beam_size=5, temperature=0,
                                   word_timestamps=True, condition_on_previous_text=False, vad_filter=False)
    for segment in segments:
        for word in segment.words:
            middle = (word.start + word.end) / 2
            index = bisect_right(starts, middle) - 1
            if index >= 0 and middle <= intervals[index]['montageEnd']:
                intervals[index]['recognized'] += word.word
    for span in intervals:
        span.update(source=str(source), duration=duration, recognized=span['recognized'].strip(), method='batch-independent-asr')
    return intervals


def recordings(source_root, chapter):
    directory = next(path for path in source_root.iterdir() if path.name.startswith(f'Chapter {chapter} '))
    return sorted(path for path in directory.rglob('*.mp3') if not any('纵向测试' in part for part in path.parts))


def analyze(source_root, model_path, output):
    from faster_whisper import WhisperModel
    model = WhisperModel(str(model_path), device='cpu', compute_type='int8', cpu_threads=4, local_files_only=True)
    for chapter in BOOKS:
        for number, source in enumerate(recordings(source_root, chapter)):
            cache = output / 'batch-analysis' / f'C{chapter}-{number:02d}.json'
            fingerprint = hashlib.sha256(source.read_bytes()).hexdigest()
            if cache.exists() and json.loads(cache.read_text()).get('sourceHash') == fingerprint:
                print(f'C{chapter} {number + 1}: cached', flush=True)
                continue
            started = time.monotonic()
            candidates = recognize_recording(source, model)
            write_json(cache, {'source': str(source), 'sourceHash': fingerprint, 'model': str(model_path), 'candidates': candidates})
            print(f'C{chapter} {number + 1}: {len(candidates)} segments, {time.monotonic() - started:.1f}s', flush=True)


def refine(model_path, output):
    import numpy as np
    from faster_whisper import WhisperModel
    model = WhisperModel(str(model_path), device='cpu', compute_type='int8', cpu_threads=4, local_files_only=True)
    def recognize(span):
        data = run(['ffmpeg', '-nostdin', '-v', 'error', '-ss', str(max(0, span['start'] - .25)),
                    '-to', str(span['end'] + .15), '-i', span['source'], '-map', '0:a:0',
                    '-ac', '1', '-ar', '16000', '-f', 'f32le', '-']).stdout
        segments, _ = model.transcribe(np.frombuffer(data, dtype=np.float32), language='en', beam_size=5,
                                       temperature=0, condition_on_previous_text=False, vad_filter=False)
        return ' '.join(segment.text.strip() for segment in segments).strip()
    for chapter in BOOKS:
        caches = sorted((output / 'batch-analysis').glob(f'C{chapter}-*.json'))
        results = [json.loads(cache.read_text()) for cache in caches]
        candidates = [span for result in results for span in result['candidates']]
        words = [word['name'] for word in json.loads((PROJECT / 'public' / 'dicts' / f'IELTS_WANG_{chapter}.json').read_text())]
        before = len(align_words(words, [span['recognized'] for span in candidates]))
        retry_unaligned(words, candidates, recognize)
        for cache, result in zip(caches, results):
            write_json(cache, result)
        after = len(align_words(words, [span['recognized'] for span in candidates]))
        print(f'C{chapter}: {before} -> {after}/{len(words)} exact matches after exception-only recognition', flush=True)


def publish(output):
    for chapter, count in ((3, 9), (4, 4), (5, 12), (11, 4)):
        caches = sorted((output / 'batch-analysis').glob(f'C{chapter}-*.json'))
        if len(caches) != count:
            raise ValueError(f'Incomplete analysis for C{chapter}: {len(caches)}/{count} recordings')
        for cache in caches:
            result = json.loads(cache.read_text())
            if hashlib.sha256(Path(result['source']).read_bytes()).hexdigest() != result['sourceHash']:
                raise ValueError(f"Source recording changed: {result['source']}")
    reports, updates = {}, {}
    for chapter in BOOKS:
        dictionary = PROJECT / 'public' / 'dicts' / f'IELTS_WANG_{chapter}.json'
        words = json.loads(dictionary.read_text())
        candidates = []
        for cache in sorted((output / 'batch-analysis').glob(f'C{chapter}-*.json')):
            candidates.extend(json.loads(cache.read_text())['candidates'])
        matches = align_words([word['name'] for word in words], [span['recognized'] for span in candidates])
        records, by_source = [], {}
        for index, word in enumerate(words):
            row = {'index': index, 'word': word['name'], 'status': 'unmatched', 'reason': 'no-confident-audio-match',
                   'qualityVerified': False, 'action': 'existing-pronunciation-chain'}
            if index in matches:
                span = candidates[matches[index]]
                row.update(source=span['source'], recognized=span['recognized'], method=span['method'],
                           start=max(0, span['start'] - .25), end=min(span['duration'], span['end'] + .15))
                by_source.setdefault(span['source'], []).append(row)
            records.append(row)
        for source, rows in by_source.items():
            verifier = SourceQuality(Path(source))
            try:
                for row in rows:
                    filename = f"{row['index']:04d}-original.mp3"
                    clip = output / 'batch-staging' / f'ieltsWang{chapter}' / filename
                    clip.parent.mkdir(parents=True, exist_ok=True)
                    try:
                        run(['ffmpeg', '-nostdin', '-v', 'error', '-y', '-ss', str(row['start']), '-to', str(row['end']),
                             '-i', source, '-map', '0:a:0', '-c:a', 'copy', str(clip)])
                        verified, reason = verifier.verify(clip, row['start'], row['end'])
                        row.update(status='matched' if verified else 'failed', qualityVerified=verified, reason=reason)
                        if verified:
                            row.update(localAudio=f'ieltsWang{chapter}/{filename}', action='use-local-audio')
                    except subprocess.CalledProcessError as error:
                        row.update(status='failed', reason=f'audio-processing-error: {error.stderr.decode()[:300]}')
            finally:
                verifier.close()
            passed = sum(row['qualityVerified'] for row in rows)
            print(f'C{chapter}: {passed}/{len(rows)} original-quality checks passed from {Path(source).name}', flush=True)
        reports[f'C{chapter}'] = {'totals': report_totals(records, len(words)), 'records': records}
        updates[dictionary] = publication_words(words, records)
    write_report(output, reports)
    # Do not update any dictionary until analysis and quality checks for all books complete.
    for report in reports.values():
        for row in report['records']:
            if row['status'] == 'matched' and row['qualityVerified']:
                destination = output / row['localAudio']
                destination.parent.mkdir(parents=True, exist_ok=True)
                (output / 'batch-staging' / row['localAudio']).replace(destination)
    for dictionary, words in updates.items():
        newline = '\n' if dictionary.read_text().endswith('\n') else ''
        temporary = dictionary.with_suffix('.tmp')
        temporary.write_text(json.dumps(words, ensure_ascii=False, indent=4) + newline)
        temporary.replace(dictionary)
    print(json.dumps({book: report['totals'] for book, report in reports.items()}, ensure_ascii=False), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-root', type=Path, required=True)
    parser.add_argument('--model', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=PROJECT / '.data' / 'local-pronunciation')
    parser.add_argument('--stage', choices=('analyze', 'refine', 'publish'), required=True)
    args = parser.parse_args()
    if args.stage == 'analyze':
        analyze(args.source_root, args.model, args.output)
    elif args.stage == 'refine':
        refine(args.model, args.output)
    else:
        publish(args.output)


if __name__ == '__main__':
    main()
