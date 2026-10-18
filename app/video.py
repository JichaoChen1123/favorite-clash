"""Bilibili ingestion. Subtitle-first flow adapted from BiliNote (MIT).

See docs/UPSTREAM.md and third_party/BiliNote-LICENSE for attribution.
No credentials, signed media URLs, or remote response bodies are logged.
"""
from __future__ import annotations

import asyncio
import html
import http.cookiejar
import ipaddress
import json
import math
import os
from pathlib import Path
import re
import signal
import shutil
import socket
import subprocess
import sys
from typing import Callable
from urllib.parse import parse_qs, urlencode, urljoin, urlsplit
import uuid

import httpx
from httpcore._backends.auto import AutoBackend

MAX_SUBTITLE = 2 * 1024 * 1024
MAX_AUDIO = 96 * 1024 * 1024
VIDEO_HOSTS = {"bilibili.com", "www.bilibili.com", "m.bilibili.com", "b23.tv", "www.b23.tv"}
CDN_SUFFIXES = ("bilibili.com", "hdslb.com", "bilivideo.com", "bilivideo.cn")
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36"


class VideoError(Exception):
    def __init__(self, code: str, message: str):
        self.code, self.message = code, message
        super().__init__(message)


def _host_allowed(host: str, purpose: str) -> bool:
    if purpose == "video":
        return host in VIDEO_HOSTS
    if purpose == "api":
        return host == "api.bilibili.com"
    return any(host == base or host.endswith("." + base) for base in CDN_SUFFIXES)


def _validate_url(url: str, purpose: str = "video") -> str:
    try:
        p = urlsplit(url)
        if (p.scheme != "https" or not p.hostname or p.username or p.password
                or p.port not in (None, 443) or "\\" in url
                or any(ord(c) < 33 for c in url) or not _host_allowed(p.hostname.lower(), purpose)):
            raise ValueError()
    except (ValueError, UnicodeError):
        raise VideoError("unsafe_url", "仅支持 HTTPS 的哔哩哔哩视频链接，链接地址不安全。") from None
    return url


def _public_dns(host: str) -> None:
    """Reject private/link-local answers, including mixed public/private DNS answers."""
    try:
        answers = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
        if not answers or any(not ipaddress.ip_address(a[4][0]).is_global for a in answers):
            raise VideoError("unsafe_url", "视频地址解析到了不可访问的网络地址。")
    except socket.gaierror:
        raise VideoError("network", "无法解析视频服务地址，请稍后重试。") from None


class _PublicNetworkBackend(AutoBackend):
    """Pin each actual TCP connection to a vetted IP; TLS retains original SNI.

    httpcore calls start_tls with the URL's hostname on the resulting stream,
    so HTTPS certificate verification is preserved while DNS rebinding is blocked.
    """
    async def connect_tcp(self, host, port, timeout=None, local_address=None, socket_options=None):
        if port != 443 or not _host_allowed(host, "cdn") and host not in VIDEO_HOSTS:
            raise VideoError("unsafe_url", "网络连接目标不安全。")
        try:
            answers = await asyncio.to_thread(socket.getaddrinfo, host, port, 0, socket.SOCK_STREAM)
            if not answers or any(not ipaddress.ip_address(a[4][0]).is_global for a in answers):
                raise VideoError("unsafe_url", "视频地址解析到了不可访问的网络地址。")
            return await super().connect_tcp(answers[0][4][0], port, timeout, local_address, socket_options)
        except socket.gaierror:
            raise VideoError("network", "无法解析视频服务地址，请稍后重试。") from None


def _cookie_jar() -> http.cookiejar.MozillaCookieJar:
    jar = http.cookiejar.MozillaCookieJar()
    cookiefile = os.getenv("BILI_COOKIE_FILE")
    if cookiefile:
        try:
            jar.load(cookiefile, ignore_discard=True, ignore_expires=False)
        except (OSError, http.cookiejar.LoadError):
            raise VideoError("cookie_file", "本地 BILI_COOKIE_FILE 无法读取，请检查 Netscape Cookie 文件。") from None
    return jar


async def _fetch(url: str, purpose: str, *, limit: int = MAX_SUBTITLE,
                 target: Path | None = None, redirect_only: bool = False) -> tuple[bytes, str]:
    """No proxy environment or automatic redirect following; validate every hop."""
    async def fetch():
        current = url
        transport = httpx.AsyncHTTPTransport()
        # httpx 0.27/0.28 use httpcore's pool; the custom backend prevents a
        # second unvalidated DNS lookup between validation and connecting.
        transport._pool._network_backend = _PublicNetworkBackend()
        async with httpx.AsyncClient(timeout=httpx.Timeout(20, connect=10), follow_redirects=False,
                                    trust_env=False, transport=transport, cookies=_cookie_jar(),
                                    headers={"User-Agent": UA, "Referer": "https://www.bilibili.com/"}) as client:
            for _ in range(5):
                _validate_url(current, purpose)
                if redirect_only and urlsplit(current).hostname not in {"b23.tv", "www.b23.tv"}:
                    return b"", current
                async with client.stream("GET", current) as response:
                    if response.status_code in (301, 302, 303, 307, 308):
                        location = response.headers.get("location")
                        if not location:
                            raise VideoError("redirect", "视频服务返回了无效跳转。")
                        current = urljoin(current, location)
                        continue
                    if response.status_code != 200:
                        raise VideoError("access_denied", f"视频服务拒绝访问（HTTP {response.status_code}）。请确认视频公开可访问，或上传字幕。")
                    length = response.headers.get("content-length", "")
                    if length.isdigit() and int(length) > limit:
                        raise VideoError("too_large", "视频服务返回的文件过大。")
                    result, count = bytearray(), 0
                    handle = target.open("wb") if target else None
                    try:
                        async for chunk in response.aiter_bytes():
                            count += len(chunk)
                            if count > limit:
                                raise VideoError("too_large", "视频服务返回的文件过大。")
                            if handle:
                                handle.write(chunk)
                            else:
                                result.extend(chunk)
                    finally:
                        if handle:
                            handle.close()
                    if not count:
                        raise VideoError("empty_response", "视频服务返回了空文件。")
                    return bytes(result), str(response.url)
            raise VideoError("redirect", "视频链接跳转次数过多。")
    try:
        async with asyncio.timeout(180 if target else 35):
            return await fetch()
    except (httpx.HTTPError, TimeoutError, OSError):
        raise VideoError("network", "视频服务连接失败或超时，请稍后重试，或上传字幕。") from None


async def _api(path: str, **params) -> dict:
    data, _ = await _fetch("https://api.bilibili.com" + path + "?" + urlencode(params), "api")
    try:
        value = json.loads(data)
        if not isinstance(value, dict) or value.get("code") != 0 or not isinstance(value.get("data"), dict):
            code = value.get("code") if isinstance(value, dict) else None
            raise VideoError("access_denied", f"哔哩哔哩接口未提供可用内容（代码 {code}）。请确认视频公开可访问。")
        return value["data"]
    except (ValueError, UnicodeError):
        raise VideoError("bad_response", "视频服务返回的数据格式错误。") from None


def _extract_link(text: str) -> str:
    if not isinstance(text, str) or not text.strip() or len(text) > 8192:
        raise VideoError("invalid_url", "请粘贴哔哩哔哩视频链接或分享文字。")
    urls = re.findall(r"https?://[^\s<>\"'\u3000]+", text)
    if not urls:
        candidate = text.strip()
        if re.fullmatch(r"BV[0-9A-Za-z]{10}", candidate):
            return "https://www.bilibili.com/video/" + candidate
        raise VideoError("invalid_url", "没有找到哔哩哔哩视频链接。")
    if len(urls) != 1:
        raise VideoError("invalid_url", "请每次粘贴一个视频链接。")
    return _validate_url(urls[0].rstrip("。！？，；）】)}>.,!;"))


async def resolve_video(text: str) -> dict:
    url = _extract_link(text)
    if urlsplit(url).hostname in {"b23.tv", "www.b23.tv"}:
        _, url = await _fetch(url, "video", limit=4 * 1024 * 1024, redirect_only=True)
    match = re.fullmatch(r"/video/(BV[0-9A-Za-z]{10}|av[0-9]+?)/?", urlsplit(url).path)
    if not match:
        raise VideoError("invalid_url", "链接不是支持的哔哩哔哩 BV/av 视频页。")
    args = parse_qs(urlsplit(url).query)
    try:
        page = int(args.get("p", ["1"])[0])
        if len(args.get("p", [])) > 1 or page < 1:
            raise ValueError()
    except ValueError:
        raise VideoError("invalid_page", "分 P 序号无效。") from None
    ident = match[1]
    data = await _api("/x/web-interface/view", **({"bvid": ident} if ident.startswith("BV") else {"aid": ident[2:]}))
    try:
        bvid = data["bvid"]
        if not re.fullmatch(r"BV[0-9A-Za-z]{10}", bvid):
            raise ValueError()
        pages = [{"page": int(p["page"]), "cid": int(p["cid"]), "title": str(p["part"])[:500],
                  "duration": int(p["duration"]), "url": f"https://www.bilibili.com/video/{bvid}/?p={int(p['page'])}"}
                 for p in data["pages"]]
        if not pages or any(p["duration"] <= 0 or p["cid"] <= 0 for p in pages):
            raise ValueError()
        selected = next((p for p in pages if p["page"] == page), None)
        if selected is None:
            raise VideoError("invalid_page", "指定的分 P 不存在，请重新选择。")
        return {"bvid": bvid, "title": str(data["title"])[:500], "author": str(data["owner"]["name"])[:200],
                "url": selected["url"], "pages": pages}
    except (KeyError, ValueError, TypeError):
        raise VideoError("bad_response", "视频元数据不完整或无效。") from None


def _normalize_segments(rows: list) -> list[dict]:
    if not isinstance(rows, list) or not rows or len(rows) > 20000:
        raise VideoError("invalid_subtitle", "字幕为空或字幕片段过多。")
    result = []
    text_size = 0
    try:
        for row in rows:
            if not isinstance(row, dict):
                raise ValueError()
            start = row.get("start", row.get("from"))
            end = row.get("end", row.get("to"))
            if isinstance(start, bool) or isinstance(end, bool):
                raise ValueError()
            start, end = float(start), float(end)
            text = row.get("text", row.get("content"))
            if not isinstance(text, str):
                raise ValueError()
            text = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]*>", "", text))).strip()
            if not text:
                continue
            if (not math.isfinite(start) or not math.isfinite(end) or start < 0 or end <= start
                    or end > 86400 or len(text) > 10000 or "\x00" in text):
                raise ValueError()
            if round(end, 3) <= round(start, 3):
                raise ValueError()
            text_size += len(text)
            if text_size > 250000:
                raise ValueError()
            result.append({"start": round(start, 3), "end": round(end, 3), "text": text})
        if not result:
            raise ValueError()
    except (ValueError, TypeError, OverflowError):
        raise VideoError("invalid_subtitle", "字幕缺少有效的文字或起止时间。") from None
    result.sort(key=lambda row: (row["start"], row["end"]))
    return [{"id": f"seg-{i:04d}", **row} for i, row in enumerate(result, 1)]


def _timestamp(value: str) -> float:
    parts = value.strip().replace(",", ".").split(":")
    if len(parts) not in (2, 3) or not re.fullmatch(r"\d{2}\.\d{3}", parts[-1]):
        raise ValueError()
    seconds = float(parts[-1])
    minute = int(parts[-2])
    hours = int(parts[0]) if len(parts) == 3 else 0
    if minute >= 60 or seconds >= 60 or min(hours, minute, seconds) < 0:
        raise ValueError()
    return hours * 3600 + minute * 60 + seconds


def parse_subtitle(content: bytes, filename: str) -> list[dict]:
    if len(content) > MAX_SUBTITLE:
        raise VideoError("too_large", "字幕文件不能超过 2 MB。")
    ext = Path(filename).suffix.lower()
    if ext not in {".srt", ".vtt", ".json"}:
        raise VideoError("invalid_subtitle", "请上传 UTF-8 编码的 SRT、VTT 或 JSON 字幕。")
    try:
        text = content.decode("utf-8-sig").replace("\r\n", "\n").replace("\r", "\n")
        if ext == ".json":
            value = json.loads(text)
            rows = value if isinstance(value, list) else value.get("body", value.get("segments"))
            if isinstance(value, dict) and "events" in value:
                rows = [{"start": e["tStartMs"] / 1000,
                         "end": (e["tStartMs"] + e["dDurationMs"]) / 1000,
                         "text": "".join(s.get("utf8", "") for s in e.get("segs", []))}
                        for e in value["events"] if e.get("segs")]
            return _normalize_segments(rows)
        rows = []
        for block in re.split(r"\n[ \t]*\n", text.strip()):
            lines = block.strip().splitlines()
            if not lines or lines[0].startswith(("WEBVTT", "NOTE", "STYLE", "REGION")):
                continue
            index = next((i for i, line in enumerate(lines) if "-->" in line), None)
            if index is None:
                raise ValueError()
            timing = lines[index].split("-->")
            if len(timing) != 2 or index + 1 >= len(lines):
                raise ValueError()
            rows.append({"start": _timestamp(timing[0]), "end": _timestamp(timing[1].strip().split()[0]),
                         "text": " ".join(lines[index + 1:])})
        return _normalize_segments(rows)
    except (UnicodeError, ValueError, TypeError, KeyError, AttributeError):
        raise VideoError("invalid_subtitle", "字幕格式无效，请检查 UTF-8 编码、文字和时间戳。") from None


def _asr_segments(raw) -> list[dict]:
    rows = []
    for segment in raw:
        if len(rows) >= 20000 or segment.end > 1203:
            raise VideoError("invalid_transcript", "识别片段超出限制，请上传字幕。")
        # faster-whisper already combines no_speech_threshold with avg_logprob.
        # A second unconditional cutoff discards confident dubbed Chinese speech.
        if segment.text.strip():
            rows.append({"start": segment.start, "end": segment.end, "text": segment.text})
    return _normalize_segments(rows)


async def _run_worker(mode: str, input_path: Path, output_path: Path, timeout: int) -> dict:
    process = await asyncio.create_subprocess_exec(sys.executable, "-m", "app.video", mode, str(input_path), str(output_path),
                                                  cwd=str(Path(__file__).resolve().parents[1]),
                                                  stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
                                                  creationflags=(subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW) if os.name == "nt" else 0,
                                                  start_new_session=os.name != "nt")
    try:
        await asyncio.wait_for(process.wait(), timeout)
    except (TimeoutError, asyncio.CancelledError):
        if process.returncode is None:
            # Include the local FFmpeg child if cancellation arrives mid-decode.
            if hasattr(process, "pid"):
                if os.name == "nt":
                    try:
                        await asyncio.to_thread(subprocess.run,
                            [str(Path(os.environ.get("SystemRoot", "C:/Windows")) / "System32" / "taskkill.exe"),
                             "/PID", str(process.pid), "/T", "/F"],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5,
                            creationflags=subprocess.CREATE_NO_WINDOW)
                    except (OSError, subprocess.TimeoutExpired):
                        pass
                else:
                    try:
                        os.killpg(process.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
            try:
                process.kill()
            except ProcessLookupError:
                pass
            await process.wait()
        if asyncio.current_task().cancelling():
            raise
        raise VideoError("process_timeout", "音频提取或本地转写超时，请上传字幕后重试。") from None
    if not output_path.exists() or output_path.stat().st_size > MAX_SUBTITLE:
        raise VideoError("process_failed", "音频处理失败，请检查依赖或上传字幕。")
    try:
        data = json.loads(output_path.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            raise ValueError()
    except (ValueError, OSError, UnicodeError):
        raise VideoError("process_failed", "音频处理未返回有效结果，请上传字幕。") from None
    if "error" in data:
        raise VideoError(data["error"], data["message"])
    return data


async def load_transcript(source: dict, cache_dir: Path, progress: Callable[[str], None] | None = None) -> dict:
    if progress:
        progress("正在读取公开视频字幕")
    # Re-resolve to ensure cid/page/duration are actual platform metadata, not caller-controlled.
    meta = await resolve_video(source["url"])
    try:
        page_number = int(source.get("page", parse_qs(urlsplit(meta["url"]).query).get("p", ["1"])[0]))
    except (ValueError, TypeError):
        raise VideoError("invalid_page", "视频分 P 序号无效。") from None
    page = next((p for p in meta["pages"] if p["page"] == page_number), None)
    if page is None:
        raise VideoError("invalid_page", "视频分 P 不存在。")
    if page["duration"] > 1200:
        raise VideoError("too_long", "每个视频分 P 不能超过 20 分钟，请选择较短的视频。")
    try:
        data = await _api("/x/player/wbi/v2", bvid=meta["bvid"], cid=page["cid"])
        tracks = data.get("subtitle", {}).get("subtitles", [])
        def priority(track):
            chinese = str(track.get("lan", "")).startswith(("zh", "ai-zh"))
            return (not chinese, bool(track.get("ai_type")))
        for track in sorted(tracks, key=priority):
            if not track.get("subtitle_url"):
                continue
            try:
                url = str(track["subtitle_url"])
                if url.startswith("//"):
                    url = "https:" + url
                raw, _ = await _fetch(url, "cdn")
                segments = parse_subtitle(raw, "subtitle.json")
                if any(s["end"] > page["duration"] + 3 for s in segments):
                    raise VideoError("invalid_subtitle", "字幕时间超出视频长度。")
                return {"kind": "subtitle", "segments": segments}
            except VideoError:
                continue
    except VideoError:
        pass
    if progress:
        progress("未取得可用字幕，正在读取可访问音频")
    cache_dir = Path(cache_dir)
    cache_dir.mkdir(parents=True, exist_ok=True)
    scratch = cache_dir / ("video-" + uuid.uuid4().hex)
    scratch.mkdir()
    try:
        input_path, output_path = scratch / "input.json", scratch / "output.json"
        input_path.write_text(json.dumps({"url": page["url"]}), encoding="utf-8")
        media = await _run_worker("extract", input_path, output_path, 90)
        audio_path = scratch / "audio.media"
        await _fetch(media["url"], "cdn", limit=MAX_AUDIO, target=audio_path)
        if progress:
            progress("正在使用本机 CPU 识别音频；首次需下载模型")
        model_cache = Path(os.getenv("WHISPER_CACHE_DIR", str(Path(__file__).resolve().parents[1] / ".cache" / "whisper-models")))
        model_cache.mkdir(parents=True, exist_ok=True)
        input_path.write_text(json.dumps({"audio": str(audio_path.resolve()), "models": str(model_cache.resolve())}), encoding="utf-8")
        output_path.unlink(missing_ok=True)
        try:
            timeout = min(max(int(os.getenv("ASR_TIMEOUT_SECONDS", "900")), 30), 1800)
        except ValueError:
            raise VideoError("configuration", "ASR_TIMEOUT_SECONDS 必须为整数秒。") from None
        result = await _run_worker("transcribe", input_path, output_path, timeout)
        segments = _normalize_segments(result.get("segments"))
        if any(s["end"] > page["duration"] + 3 for s in segments):
            raise VideoError("invalid_transcript", "识别的时间戳超出视频长度，请上传字幕。")
        return {"kind": "asr", "segments": segments, "asr_model": result.get("asr_model")}
    finally:
        shutil.rmtree(scratch, ignore_errors=True)


def _restrict_extractor_network():
    """Network guard applies only in the disposable yt-dlp subprocess.

    Blocks private IPs even if a redirect changes host or DNS is rebound between
    the name check and socket connection. Proxies are disabled separately.
    """
    original_dns, original_connect = socket.getaddrinfo, socket.socket.connect
    def dns(host, port, *args, **kwargs):
        host = host.decode("ascii") if isinstance(host, bytes) else host
        if not isinstance(host, str) or not _host_allowed(host.lower(), "cdn") or port not in (80, 443, "80", "443"):
            raise OSError("Blocked network target")
        answers = original_dns(host, port, *args, **kwargs)
        if any(not ipaddress.ip_address(a[4][0]).is_global for a in answers):
            raise OSError("Blocked network address")
        return answers
    def connect(sock, address):
        if not isinstance(address, tuple) or address[1] not in (80, 443) or not ipaddress.ip_address(address[0]).is_global:
            raise OSError("Blocked socket target")
        return original_connect(sock, address)
    socket.getaddrinfo, socket.socket.connect = dns, connect


def _worker(mode: str, input_path: Path, output_path: Path):
    try:
        data = json.loads(input_path.read_text(encoding="utf-8"))
        if mode == "extract":
            import yt_dlp
            _validate_url(data["url"])
            _restrict_extractor_network()
            class Quiet:
                def debug(self, *_): pass
                def warning(self, *_): pass
                def error(self, *_): pass
            options = {"quiet": True, "no_warnings": True, "logger": Quiet(), "proxy": "", "noplaylist": True,
                       "socket_timeout": 15, "retries": 1, "extractor_retries": 1, "skip_download": True,
                       "http_headers": {"Referer": "https://www.bilibili.com/", "User-Agent": UA}}
            cookiefile = os.getenv("BILI_COOKIE_FILE")
            if cookiefile:
                # yt-dlp normally rewrites its cookie file on exit. Use an in-memory jar.
                options["cookiefile"] = None
            with yt_dlp.YoutubeDL(options) as ydl:
                if cookiefile:
                    for cookie in _cookie_jar():
                        ydl.cookiejar.set_cookie(cookie)
                info = ydl.extract_info(data["url"], download=False)
                formats = [f for f in info.get("formats", []) if f.get("vcodec") == "none" and f.get("acodec") != "none"
                           and f.get("url") and f.get("protocol") in ("https", "http")]
                if not formats:
                    raise VideoError("audio_unavailable", "平台未提供可访问的独立音频，请上传字幕。")
                # Prefer clear speech audio without selecting lossless streams
                # that needlessly exceed the bounded download budget.
                speech_formats = [f for f in formats if (f.get("abr") or f.get("tbr") or 0) <= 256
                                  and (f.get("filesize") or 0) <= MAX_AUDIO]
                if speech_formats:
                    chosen = max(speech_formats, key=lambda f: f.get("abr") or f.get("tbr") or 0)
                else:
                    chosen = min(formats, key=lambda f: f.get("abr") or f.get("tbr") or 0)
                url = _validate_url(chosen["url"], "cdn")
                result = {"url": url}
        elif mode == "transcribe":
            # Match the direct platform transport; desktop launch environments
            # can contain stale local proxies. This is isolated to this worker.
            for key in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
                os.environ.pop(key, None)
            if os.name == "nt":
                # The embedded Windows Python's mode-0700 tempfile directories
                # can receive unusable ACLs. HF uses them when testing symlinks.
                # Keep this compatibility fix inside the disposable worker.
                import tempfile
                def ordinary_temp_dir(suffix=None, prefix=None, dir=None):
                    base = Path(dir or tempfile.gettempdir())
                    for _ in range(10):
                        path = base / ((prefix or "tmp") + uuid.uuid4().hex + (suffix or ""))
                        try:
                            path.mkdir()
                            return str(path)
                        except FileExistsError:
                            continue
                    raise FileExistsError("Could not create scratch directory")
                tempfile.mkdtemp = ordinary_temp_dir
            from faster_whisper import WhisperModel
            model_name = os.getenv("WHISPER_MODEL", "small")
            model = None
            for name in dict.fromkeys([model_name, "tiny"]):
                try:
                    model = WhisperModel(name, device="cpu", compute_type="int8", cpu_threads=min(4, os.cpu_count() or 1),
                                         download_root=data["models"])
                    break
                except Exception:
                    continue
            if model is None:
                raise VideoError("asr_model", "无法加载本地语音模型，请检查模型下载网络，或上传字幕。")
            import numpy as np
            ffmpeg = shutil.which("ffmpeg")
            if not ffmpeg:
                raise VideoError("ffmpeg_missing", "未找到 FFmpeg，请安装后重启服务，或上传字幕。")
            # FFmpeg receives only a local path, with network protocols disabled.
            # Passing PCM also avoids PyAV/faster-whisper version incompatibility.
            decoded = subprocess.run([ffmpeg, "-v", "error", "-nostdin", "-protocol_whitelist", "file,pipe",
                                      "-i", data["audio"], "-vn", "-t", "1203", "-ac", "1", "-ar", "16000",
                                      "-f", "s16le", "pipe:1"], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=45,
                                     creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
            if decoded.returncode or not decoded.stdout or len(decoded.stdout) > 1203 * 16000 * 2:
                raise VideoError("audio_decode", "音频无法解码，请上传字幕。")
            audio = np.frombuffer(decoded.stdout, dtype=np.int16).astype(np.float32) / 32768.
            raw, info = model.transcribe(audio, beam_size=3, vad_filter=True,
                                         condition_on_previous_text=False)
            result = {"segments": _asr_segments(raw), "asr_model": name}
        else:
            raise ValueError()
    except VideoError as exc:
        result = {"error": exc.code, "message": exc.message}
    except Exception:
        result = {"error": "audio_unavailable" if mode == "extract" else "asr_failed",
                  "message": "无法取得公开视频音频，可能需要登录或受到平台访问限制。请上传字幕。" if mode == "extract"
                  else "本地语音识别失败，请检查 faster-whisper 依赖和模型，或上传字幕。"}
    output_path.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    _worker(sys.argv[1], Path(sys.argv[2]), Path(sys.argv[3]))
