# 本地原音频小样验收

## 范围与统计

本轮只处理雅思wang C3 的前10词，未开始四本书的全量导入。

| 词书 | 总词数 | 本地小样已对应 | 尚未处理 |
| --- | ---: | ---: | ---: |
| C3 | 1135 | 10 | 1125 |
| C4 | 346 | 0 | 346 |
| C5 | 1569 | 0 | 1569 |
| C11 | 1738 | 0 | 1738 |
| 合计 | 4788 | 10 | 4778 |

小样审计：已处理10、识别对应10、无法对应0、处理失败0、需回退0。
尚未处理的词不计入“无法对应”，也不计入小样成功率。

逐词结果保存在 `.data/local-pronunciation/ieltsWang3/validation-report.json`。
每条记录包含目标词、文件、识别文本、状态、原因和处理方式。

## 音质门槛

- 旧小样的64 kbps单声道重新编码已撤换；新小样直接复制原MP3码流。
- 保持原文件128 kbps、双声道、44.1 kHz，不做音量处理或重新压缩。
- 新文件使用 `-original.mp3` 名称，避开浏览器缓存的旧版本。
- MP3只能按帧切分，留0.25秒前置静音供解码器恢复状态。
- 测试逐段验证参数、原始音频包SHA256连续一致、解码无错误；
  跳过前0.15秒静音预热后，包含完整发音的PCM样本与原文件完全一致。
- 语音识别内部的16 kHz单声道分析数据仅存在于内存，不写回播放文件。

直接复制码流的依据：[FFmpeg官方说明](https://ffmpeg.org/ffmpeg.html#Streamcopy)。

## 工程化处理与异常规则

现有小样已经由脚本完成静音检测、切分、音质测试、离线识别和统计，
不依赖Codex逐词检查。识别不提供目标单词提示，不做模糊匹配放行。

- `matched`：仅大小写、标点和空白归一化后完全一致。
- `unmatched`：识别文本不同或为空，记录原文和原因，留待异常复核。
- `failed`：文件、解码或识别处理失败，单独统计。
- `unprocessed`：没有尝试处理，不能当作识别失败。
- 有异常或未处理项时，审计返回失败；异常条目不得写入网页的
  `localAudio`，保留现有在线音源及系统语音备用链路。

全量阶段应先按录音时间顺序进行程序化词表对齐，不能假设静音段数
等于词数或直接按下标配对。先跑小样检查覆盖与错位，再自动处理普通项，
只复核异常项，并按C3/C4/C5/C11分别汇总上述计数和原因。
该全量对齐、筛选发布步骤尚未实现，不能把当前小样脚本直接视作全量工具。

## 复现

在项目目录内生成小样：

```sh
node scripts/extract-local-pronunciation-sample.mjs \
  --input '/Users/zxc/Desktop/听力/01点击进入，音频做横向，纵向不用管/Chapter 3 雅思听力特别名词语料库/01 横向测试/01 Test 1-横向测试_对应表3.3-1.mp3' \
  --words scripts/local-pronunciation/ieltsWang3-test1.words.json \
  --output .data/local-pronunciation/ieltsWang3 --start-at 47 --count 10
```

使用已有离线模型审计，不下载模型、不调用付费接口：

```sh
uv --offline run --with faster-whisper python scripts/verify-local-pronunciation-sample.py \
  --manifest .data/local-pronunciation/ieltsWang3/manifest.json \
  --model /Users/zxc/.cache/huggingface/hub/models--Systran--faster-whisper-small.en/snapshots/d1d751a5f8271d482d14ca55d9e2deeebbae577f \
  --output .data/local-pronunciation/ieltsWang3/validation-report.json

node --test tests/*.test.mjs
PYTHONDONTWRITEBYTECODE=1 RUN_LOCAL_ASR_AUDIT_TEST=1 python3 -m unittest discover -s tests -p 'test_pronunciation_audit.py' -v
```

审计输出是发布前检查，不会自动修改网页数据。
