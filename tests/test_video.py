import asyncio
import json
import socket
from pathlib import Path
import uuid
from types import SimpleNamespace

import httpx
import pytest

from app import video


@pytest.mark.parametrize("url", [
    "http://www.bilibili.com/video/BV1dm421g77T/", "https://bilibili.com.evil.test/video/BV1dm421g77T/",
    "https://www.bilibili.com@127.0.0.1/video/BV1dm421g77T/", "https://www.bilibili.com:444/video/BV1dm421g77T/",
    "https://www.bilibili.com./video/BV1dm421g77T/", "https://127.0.0.1/", "https://[::1]/",
    "file:///etc/passwd", "https://www.bilibili.com\\@evil.test/", "https://www.bilibili.com/\nfoo",
    "https://user:password@www.bilibili.com/", "https://b23.tv:80/x",
])
def test_reject_unsafe_urls(url):
    with pytest.raises(video.VideoError):
        video._validate_url(url)


def test_share_text_and_multiple_links():
    assert video._extract_link("分享【深蹲】 https://b23.tv/abc。") == "https://b23.tv/abc"
    assert video._extract_link("BV1dm421g77T") == "https://www.bilibili.com/video/BV1dm421g77T"
    with pytest.raises(video.VideoError):
        video._extract_link("https://b23.tv/a https://b23.tv/b")


@pytest.mark.parametrize("url", ["https://hdslb.com.evil.test/sub.json", "https://169.254.169.254/a", "http://i0.hdslb.com/a"])
def test_cdn_validation(url):
    with pytest.raises(video.VideoError):
        video._validate_url(url, "cdn")


def test_mixed_dns_rejected(monkeypatch):
    monkeypatch.setattr(socket, "getaddrinfo", lambda *a, **k: [
        (2, 1, 6, "", ("8.8.8.8", 443)), (2, 1, 6, "", ("127.0.0.1", 443))])
    with pytest.raises(video.VideoError, match="网络地址"):
        video._public_dns("www.bilibili.com")


@pytest.mark.asyncio
async def test_redirect_to_private_target_is_never_requested(monkeypatch):
    requests = []
    def handler(request):
        requests.append(str(request.url))
        return httpx.Response(302, headers={"Location": "https://127.0.0.1/latest/meta-data/"})
    class Transport(httpx.MockTransport):
        def __init__(self):
            super().__init__(handler)
            self._pool = type("Pool", (), {})()
    monkeypatch.setattr(video.httpx, "AsyncHTTPTransport", Transport)
    with pytest.raises(video.VideoError) as exc:
        await video._fetch("https://b23.tv/abc", "video")
    assert exc.value.code == "unsafe_url"
    assert requests == ["https://b23.tv/abc"]


@pytest.mark.asyncio
async def test_connection_backend_rejects_private_dns(monkeypatch):
    monkeypatch.setattr(socket, "getaddrinfo", lambda *a: [(2, 1, 6, "", ("10.0.0.1", 443))])
    with pytest.raises(video.VideoError):
        await video._PublicNetworkBackend().connect_tcp("api.bilibili.com", 443)


@pytest.mark.asyncio
async def test_connection_uses_vetted_ip_without_second_dns_lookup(monkeypatch):
    monkeypatch.setattr(socket, "getaddrinfo", lambda *a: [(2, 1, 6, "", ("8.8.8.8", 443))])
    connections = []
    async def connect(self, host, port, *args):
        connections.append((host, port))
        return "stream"
    monkeypatch.setattr(video.AutoBackend, "connect_tcp", connect)
    assert await video._PublicNetworkBackend().connect_tcp("api.bilibili.com", 443) == "stream"
    assert connections == [("8.8.8.8", 443)]


@pytest.mark.asyncio
async def test_bounded_stream_rejects_oversized_response(monkeypatch):
    class Transport(httpx.MockTransport):
        def __init__(self):
            super().__init__(lambda request: httpx.Response(200, content=b"1234"))
            self._pool = type("Pool", (), {})()
    monkeypatch.setattr(video.httpx, "AsyncHTTPTransport", Transport)
    with pytest.raises(video.VideoError) as exc:
        await video._fetch("https://api.bilibili.com/x/test", "api", limit=3)
    assert exc.value.code == "too_large"


@pytest.mark.asyncio
async def test_resolve_explicit_multipart(monkeypatch):
    async def api(*a, **k):
        return {"bvid": "BV1dm421g77T", "title": "视频", "owner": {"name": "作者"},
                "pages": [{"page": 1, "cid": 11, "part": "上", "duration": 100},
                          {"page": 2, "cid": 12, "part": "下", "duration": 200}]}
    monkeypatch.setattr(video, "_api", api)
    result = await video.resolve_video("分享 https://www.bilibili.com/video/BV1dm421g77T/?p=2")
    assert result["url"].endswith("?p=2")
    assert result["pages"][1]["cid"] == 12
    with pytest.raises(video.VideoError) as exc:
        await video.resolve_video("https://www.bilibili.com/video/BV1dm421g77T/?p=3")
    assert exc.value.code == "invalid_page"


def test_srt_unicode_bom_multiline_sorted_stable():
    raw = "\ufeff2\r\n00:00:02,000 --> 00:00:03,500\r\n<b>膝盖</b> &amp; 脚尖\r\n都可以\r\n\r\n1\r\n00:00:00,100 --> 00:00:01,000\r\n深蹲\r\n".encode()
    segments = video.parse_subtitle(raw, "字幕.SRT")
    assert segments == [{"id": "seg-0001", "start": .1, "end": 1., "text": "深蹲"},
                        {"id": "seg-0002", "start": 2., "end": 3.5, "text": "膝盖 & 脚尖 都可以"}]
    assert video.parse_subtitle(raw, "test.srt") == segments


def test_vtt_comments_settings():
    raw = b"WEBVTT\n\nNOTE comment\nignore\n\ncue-a\n00:01.000 --> 00:03.500 align:start position:10%\nHello <i>there</i>\n"
    assert video.parse_subtitle(raw, "x.vtt")[0]["text"] == "Hello there"


@pytest.mark.parametrize("value", [
    [{"start": 1, "end": 2, "text": "hello"}],
    {"body": [{"from": 1, "to": 2, "content": "hello"}]},
    {"segments": [{"start": 1, "end": 2, "text": "hello"}]},
    {"events": [{"tStartMs": 1000, "dDurationMs": 1000, "segs": [{"utf8": "hello"}]}]},
])
def test_json_formats(value):
    assert video.parse_subtitle(json.dumps(value).encode(), "x.json") == [
        {"id": "seg-0001", "start": 1., "end": 2., "text": "hello"}]


@pytest.mark.parametrize("raw,name", [
    (b"", "x.srt"), (b"[]", "x.json"), (b"{}", "x.json"), (b"null", "x.json"),
    (b"garbage", "x.vtt"), (b"\xff", "x.srt"), (b"1\n00:00:61,000 --> 00:01:03,000\nbad", "x.srt"),
    (b"1\n00:00:02,000 --> 00:00:01,000\nbad", "x.srt"),
    (b'[{"start":-1,"end":1,"text":"bad"}]', "x.json"),
    (b'[{"start":0,"end":NaN,"text":"bad"}]', "x.json"),
    (b'[{"start":false,"end":1,"text":"bad"}]', "x.json"),
    (b'[{"start":0,"end":1,"text":" "}]', "x.json"),
    (b'[{"start":0,"end":1,"text":42}]', "x.json"),
    (b'[{"start":0,"end":0.0001,"text":"bad"}]', "x.json"),
    (b"anything", "x.exe"),
])
def test_invalid_subtitles_rejected(raw, name):
    with pytest.raises(video.VideoError) as exc:
        video.parse_subtitle(raw, name)
    assert exc.value.code == "invalid_subtitle"


def test_subtitle_size_bound():
    with pytest.raises(video.VideoError) as exc:
        video.parse_subtitle(b"x" * (video.MAX_SUBTITLE + 1), "x.srt")
    assert exc.value.code == "too_large"


def test_confident_asr_speech_is_not_discarded_by_duplicate_no_speech_filter():
    # Whisper's own filtering keeps high-confidence speech even when the
    # no-speech score is high; dubbed speech exposed this regression live.
    raw = [SimpleNamespace(start=89., end=93., text="真实配音内容", no_speech_prob=.95, avg_logprob=-.1)]
    assert video._asr_segments(raw) == [{"id": "seg-0001", "start": 89., "end": 93., "text": "真实配音内容"}]


@pytest.mark.asyncio
async def test_subtitle_first_avoids_audio(monkeypatch):
    async def resolve(*a):
        return {"bvid": "BV1dm421g77T", "url": "https://www.bilibili.com/video/BV1dm421g77T/?p=1",
                "pages": [{"page": 1, "cid": 123, "duration": 10}]}
    async def api(*a, **k):
        return {"subtitle": {"subtitles": [{"lan": "zh-CN", "subtitle_url": "//i0.hdslb.com/sub.json"}]}}
    async def fetch(*a, **k):
        return b'{"body":[{"from":0,"to":2,"content":"real subtitle"}]}', ""
    async def worker(*a):
        pytest.fail("ASR must not run when subtitles work")
    monkeypatch.setattr(video, "resolve_video", resolve)
    monkeypatch.setattr(video, "_api", api)
    monkeypatch.setattr(video, "_fetch", fetch)
    monkeypatch.setattr(video, "_run_worker", worker)
    result = await video.load_transcript({"url": "x", "page": 1}, Path(".cache/video-tests"))
    assert result["kind"] == "subtitle"


@pytest.mark.asyncio
async def test_long_source_rejected_before_subtitle(monkeypatch):
    async def resolve(*a):
        return {"bvid": "BV1dm421g77T", "url": "https://www.bilibili.com/video/BV1dm421g77T/?p=1",
                "pages": [{"page": 1, "cid": 123, "duration": 1201}]}
    monkeypatch.setattr(video, "resolve_video", resolve)
    with pytest.raises(video.VideoError) as exc:
        await video.load_transcript({"url": "x", "page": 1}, Path(".cache/video-tests"))
    assert exc.value.code == "too_long"


@pytest.mark.asyncio
async def test_access_failure_is_reported_without_fabricated_transcript(monkeypatch):
    cache = Path(".cache") / ("video-test-" + uuid.uuid4().hex)
    async def resolve(*a):
        return {"bvid": "BV1dm421g77T", "url": "https://www.bilibili.com/video/BV1dm421g77T/?p=1",
                "pages": [{"page": 1, "cid": 123, "duration": 10, "url": "https://www.bilibili.com/video/BV1dm421g77T/?p=1"}]}
    async def api(*a, **k):
        return {"subtitle": {"subtitles": []}}
    async def worker(*a):
        raise video.VideoError("audio_unavailable", "平台未提供音频")
    monkeypatch.setattr(video, "resolve_video", resolve)
    monkeypatch.setattr(video, "_api", api)
    monkeypatch.setattr(video, "_run_worker", worker)
    try:
        with pytest.raises(video.VideoError) as exc:
            await video.load_transcript({"url": "x", "page": 1}, cache)
        assert exc.value.code == "audio_unavailable"
        assert list(cache.iterdir()) == []
    finally:
        cache.rmdir()


@pytest.mark.asyncio
async def test_process_timeout_terminates_worker(monkeypatch):
    class Process:
        returncode = None
        killed = False
        async def wait(self):
            if self.killed:
                self.returncode = -1
                return -1
            await asyncio.sleep(1)
        def kill(self):
            self.killed = True
    process = Process()
    async def spawn(*a, **k):
        return process
    monkeypatch.setattr(video.asyncio, "create_subprocess_exec", spawn)
    with pytest.raises(video.VideoError) as exc:
        await video._run_worker("extract", Path("unused"), Path("unused"), .01)
    assert exc.value.code == "process_timeout"
    assert process.killed
