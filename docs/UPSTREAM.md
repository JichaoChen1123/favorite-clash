# Upstream attribution and ingestion behavior

The video ingestion flow in `app/video.py` adapts the subtitle-first orchestration
and Bilibili API/track-selection flow from
[JefferyHcool/BiliNote](https://github.com/JefferyHcool/BiliNote), inspected at commit
`90940fde4d224d0f69ad99674f4af0a1ea52d3c4` on 2026-10-18.

Relevant upstream files:

- `backend/app/downloaders/bilibili_subtitle.py`: view API, per-part cid, player
  subtitle API, preference for Chinese manual captions before Chinese AI captions.
- `backend/app/downloaders/bilibili_downloader.py`: yt-dlp accessible audio flow.
- `backend/app/services/note.py`: subtitles before audio transcription.
- `backend/app/transcriber/whisper.py`: faster-whisper, CPU and int8 configuration.

Upstream is MIT, copyright (c) 2024 Jeffery Huang. Its license is retained verbatim
in [`third_party/BiliNote-LICENSE`](../third_party/BiliNote-LICENSE).

This application has a smaller independent implementation: metadata and subtitles
are fetched directly; yt-dlp extracts an accessible audio URL in an isolated
subprocess; audio is downloaded with a separate bounded request, then transcribed
locally with faster-whisper. No upstream GUI, model-provider integrations, cookie
management service, remote ASR, risk-control parameter patch, login automation,
or access-control workaround is included. No generated text is substituted for
failed ingestion.

## Bounds and configuration

- Input URLs: HTTPS Bilibili BV/av pages or b23 share links. Exact video hostname
  allowlist, no credentials, nonstandard ports, control characters or backslashes.
  Each redirect is checked. API targets and media CDN suffixes are restricted.
- Direct HTTP connections use a custom httpcore backend that resolves and checks
  every IP, then connects to that checked IP while retaining TLS hostname checks.
  Private, loopback, link-local and mixed public/private answers are rejected;
  environment proxies are disabled. The yt-dlp subprocess has independent DNS and
  socket checks for platform/CDN hosts and public IPs.
- Response limit: 2 MB captions, 4 MB short-link HTML, 96 MB audio. Up to four
  redirects; metadata/subtitle request total 35 seconds, media total 180 seconds;
  yt-dlp extraction 90 seconds. No downloaded media URL is sent to FFmpeg.
- Videos/parts over 1200 seconds are rejected before transcription. Subtitle/ASR
  timestamps must fit the selected part (3-second tolerance). At most 20000
  segments; invalid, empty, nonfinite and backwards timestamps are rejected.
- ASR subprocess: CPU/int8, up to four threads, VAD enabled, no-speech filtering.
  `WHISPER_MODEL` defaults to `small`, with `tiny` model-load fallback. It can also
  name a local model directory. First use may download a model from Hugging Face.
  `ASR_TIMEOUT_SECONDS` defaults to 900, clamped to 30–1800 seconds. Kill on timeout
  or cancellation; scratch audio and subprocess payload files are removed.
  `WHISPER_CACHE_DIR` defaults to the project's `.cache/whisper-models`, shared
  across jobs. Per-job scratch directories do not duplicate model downloads.
  Local FFmpeg decodes audio into bounded mono 16 kHz PCM before inference;
  only `file` and `pipe` input protocols are enabled. Decode time is capped at
  45 seconds. This avoids the installed PyAV 19 / faster-whisper
  `metadata_errors` incompatibility. Windows temporary model-download directories
  use ordinary inherited ACLs in the isolated worker to avoid the embedded
  Python runtime's unusable mode-0700 directory ACLs.
- Optional server-local `BILI_COOKIE_FILE` reads Netscape-format cookies exported
  by the user for their own existing session. Cookie values and signed media URLs
  are never logged, exposed in user errors, or copied into saved transcripts.
  yt-dlp gets cookies in memory and never rewrites the user's file.
- Upload formats: UTF-8 (optional BOM) SRT, WebVTT, Bilibili JSON `body`, JSON
  `segments`/plain array, or JSON3 `events`. Uploads are limited to 2 MB. Segment
  IDs are assigned after time sorting as `seg-0001`, etc.

## Live sample discovery, 2026-10-18

These are candidate comparisons, not medical recommendations or predetermined
comparison results. Metadata and durations were checked against the live view API.
All samples are under 20 minutes. No logged-in cookies were used. The anonymous
subtitle API returned no tracks for the six initially checked clips, so real
comparisons require working local ASR or user-provided subtitles.

| Group / comparison question | Video A | Video B |
| --- | --- | --- |
| 深蹲时膝盖能否超过脚尖？两位作者说明的动作、负重和人群条件是否一致？ | [左教的健身脑回路：5000字解析](https://www.bilibili.com/video/BV1dm421g77T/) · 369秒 · cid 1619189521 | [烧毁一切就是美：深蹲误区](https://www.bilibili.com/video/BV119GCzEEvM/) · 338秒 · cid 29681713519 |
| 两个视频中的“健身顺序”是在讨论同一个问题吗？能否据此认定有氧与力量的建议冲突？ | [乐森lucas：先有氧还是先无氧](https://www.bilibili.com/video/BV1ww411f7GV/) · 305秒 · cid 352476245 | [拿铁孙同学：健身一定不要忽视顺序](https://www.bilibili.com/video/BV1jKVY6sE5N/) · 149秒 · cid 38703400443 |
| 自然增肌/身体重组怎样确定蛋白质摄入量？作者对体重、能量摄入和训练水平有什么条件？ | [旺Wang健身：自然健身吃多少蛋白质](https://www.bilibili.com/video/BV1ti421v7CQ/) · 141秒 · cid 1566527427 | [纯肉饮食和轻断食：身体重组指南](https://www.bilibili.com/video/BV1JRwjzqEW3/) · 686秒 · cid 36743086460 |

Live ingestion on `BV1jKVY6sE5N` reached yt-dlp extraction and bounded audio
download successfully. Initial model load failed because inherited proxies pointed
to a refused localhost port; after disabling inherited proxies, huggingface.co
itself timed out. Setting `HF_ENDPOINT=https://hf-mirror.com` for the test allowed
the public tiny model download. No endpoint switch is made automatically by the
application. The first inference exposed PyAV 19's removed `metadata_errors`
argument; local FFmpeg decoding fixed it. CPU ASR then returned 39 real segments.

The tiny model makes noticeable homophone errors. It is a resource-saving fallback;
the default small model is preferable for Chinese accuracy. Transcripts from ASR
remain machine transcripts and should be checked against the linked video.
The checked “健身一定不要忽视顺序” clip discusses exercise selection and weekly
body-part order, not aerobic-versus-strength order. Its pair is therefore useful
for testing the `different_topic` boundary; do not invent a contradiction from
the title. Other groups above are candidates until full transcript comparison.

The subsequent small-model CPU run completed all six real sources. Segment counts
in table order are 219, 110, 107, 93, 58 and 218; total video duration is 1988
seconds. Metadata/segment times were checked, IDs are stable and ordered, and all
six final transcripts have no internal gap greater than eight seconds. This is a
coverage sanity check, not a guarantee of transcription accuracy. One video ends
its spoken section around 268 seconds despite a 338-second media duration.

Manual excerpt inspection still found likely homophone errors in the small-model
output, including `理众心肠` (around 6–8 seconds of `BV1dm421g77T`) and
`浓缩卤青蛋白` (around 118 seconds of `BV1ti421v7CQ`). The raw ASR text is retained;
the application must label it as machine transcription and keep the original video
jump link available for verification. This review does not endorse the videos'
fitness or nutrition claims.

The dubbed `BV1JRwjzqEW3` trial also revealed that an extra unconditional
`no_speech_prob < 0.6` filter discarded confidently decoded speech, leaving large
gaps. The filter was removed: faster-whisper already applies its own combined
no-speech/log-probability criteria. A regression test now preserves such decoded
speech. The final source was regenerated, recovering 96 segments, and its old
partial transcript was replaced before the protein comparison validation resumed.

The resumable live-source preparation script is
`scripts/prepare_validation_sources.py`. It processes sources sequentially with
the small model, saves each completed real transcript in
`.cache/validation_sources/{bvid}-p1.json`, and assembles three source groups in
`.cache/validation_sources.json`. It pre-fills no classifications or conclusions.
Its optional `--endpoint` argument explicitly configures the model-download
endpoint for that run. Already successful sources can be reused; failed sources
are retried on the next run. `--refresh` obtains all sources again.
`--refresh-bvid BV...` refreshes one source while reusing the other completed
sources, and can be repeated. The video module's 49 unit tests cover URL/redirect
and private-address defenses, pinned IP connections, bounds, caption formats,
subtitle preference, explicit access failure, subprocess timeout termination,
and the dubbed-speech regression.
