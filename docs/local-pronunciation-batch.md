# 四本词书本地音频导入

只修改C3/C4/C5/C11的单词音频映射。原MP3不改动、不上传；网页其他功能不变。

## 工程化流程

1. 对29个横向/综合录音检测停顿；排除纵向测试。压缩长静音生成仅供分析的临时音频。
2. 使用已有的本地small.en语音识别模型，独立识别文本与时间戳；不提供目标词提示。
3. 与词表做严格的顺序对齐。支持大小写、标点、连字符空格及词表明确列出的等号别名；
   不按下标硬配，不用模糊相似词代替缺失词。
4. 只对未对齐片段单独重试识别，记录结果，避免后续运行重复消耗计算。
   不能把包含两个词的录音强行标为其中一个词。
5. 直接复制原MP3音频包，保留原采样率与声道、不再编码。原文件可能是不同码率，
   不强制改成统一码率；以原始音频包一致性检验是否保真。
6. 每段检验编码参数、连续音频包SHA256、解码状态及完整发音的原始PCM一致性。
   前0.25秒静音用于恢复MP3解码器状态，只排除其中前0.15秒静音预热参与PCM比较。
7. 先放入隔离目录；所有词书处理完后，仅发布语义匹配且音质检查通过的片段。
   分析缺文件或原录音变化时，阻止发布。失败片段不会覆盖已通过验收的旧音频。
8. 按词书汇总本地匹配、无法对应、处理失败、未处理及备用发音数量。
   未可靠对应的词不写入`localAudio`，继续使用已有的在线音源/系统语音备用链路。

离线识别分析过程可以降采样，但只操作内存中的分析数据，不能写回播放文件。
词书的顺序、拼写、释义、音标及网页交互保持原样。

成熟工具依据：[FFmpeg原码流复制](https://ffmpeg.org/ffmpeg.html#Streamcopy)、
[faster-whisper本地识别与时间戳](https://github.com/SYSTRAN/faster-whisper)。
语音识别并非绝对准确，因此没有可靠证据的片段保守回退，而不是强行提高覆盖率。

## 复现与续跑

在项目目录内执行。使用已有离线环境和模型，不调用付费接口。

```sh
SOURCE='/Users/zxc/Desktop/听力/01点击进入，音频做横向，纵向不用管'
MODEL='/Users/zxc/.cache/huggingface/hub/models--Systran--faster-whisper-small.en/snapshots/d1d751a5f8271d482d14ca55d9e2deeebbae577f'

uv --offline run --with faster-whisper python -u scripts/import_local_pronunciation.py \
  --source-root "$SOURCE" --model "$MODEL" --stage analyze
uv --offline run --with faster-whisper python -u scripts/import_local_pronunciation.py \
  --source-root "$SOURCE" --model "$MODEL" --stage refine
uv --offline run --with faster-whisper python -u scripts/import_local_pronunciation.py \
  --source-root "$SOURCE" --model "$MODEL" --stage publish
```

分析结果按录音缓存，包含原录音SHA256；独立重试结果也缓存。
单个识别进程使用4个CPU线程，结束后退出，不作为网站常驻服务。
这消耗一次性的本机计算时间，不依赖Codex逐词调用与判断。

## 输出与统计口径

输出位于`.data/local-pronunciation`，不提交原音频到Git：

- `ieltsWang3/`、`ieltsWang4/`、`ieltsWang5/`、`ieltsWang11/`：原音质逐词MP3。
- `batch-analysis/`：每个录音的独立识别结果及原文件指纹。
- `batch-report.json`：全部目标词的映射、处理状态、理由及质量检验结果。
- `batch-report.md`：按书汇总的可读报告。
- `batch-anomalies.csv`：无法对应和失败条目，保留原因及实际处理方式。

“无法可靠对应”不等于已证明原录音没有该词，也可能是词表版本差异、语音识别
不确定、一个区间合并了多个词。只按现有证据分类，不把未处理项算成失败。

## 回归验证

```sh
node --test tests/*.test.mjs
PYTHONDONTWRITEBYTECODE=1 RUN_LOCAL_ASR_AUDIT_TEST=1 \
  python3 -m unittest discover -s tests -p 'test_*.py' -v
PLAYWRIGHT_HTML_OPEN=never npx playwright test tests/e2e/pronunciation.spec.ts --project=chromium
npm run build
npm run lint
```

浏览器测试使用实际本地音频验证四本书的来源与播放时间推进，另保留快捷键
切换和播放失败回退测试。程序验证不能证明扬声器或耳机硬件当时是否真的出声。
