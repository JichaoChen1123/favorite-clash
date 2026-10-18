"""Fetch real public source transcripts, sequentially, with resumable source files.

Run from the project root with its virtualenv. Model mirror use is explicit:
  python scripts/prepare_validation_sources.py --endpoint https://hf-mirror.com
No comparison classifications or conclusions are prefilled.
"""
from __future__ import annotations

import argparse
import asyncio
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.video import VideoError, load_transcript, resolve_video

GROUPS = [
    {"id": "squat", "question": "深蹲时膝盖能否超过脚尖？两位作者说明的动作、负重和人群条件是否一致？",
     "bvids": ["BV1dm421g77T", "BV119GCzEEvM"]},
    {"id": "order", "question": "两个视频中的‘健身顺序’是在讨论同一个问题吗？能否据此认定有氧与力量的建议冲突？",
     "bvids": ["BV1ww411f7GV", "BV1jKVY6sE5N"]},
    {"id": "protein", "question": "自然增肌与身体重组怎样确定蛋白质摄入量？作者对体重、能量摄入和训练水平有什么条件？",
     "bvids": ["BV1ti421v7CQ", "BV1JRwjzqEW3"]},
]


def save_json(path: Path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".writing")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)


async def prepare(args):
    os.environ["WHISPER_MODEL"] = args.model
    os.environ["WHISPER_CACHE_DIR"] = str(ROOT / ".cache" / "whisper-models")
    os.environ["ASR_TIMEOUT_SECONDS"] = str(args.timeout)
    if args.endpoint:
        os.environ["HF_ENDPOINT"] = args.endpoint
    os.environ.setdefault("HF_HUB_DISABLE_XET", "1")
    cache = ROOT / ".cache" / "validation_sources"
    cache.mkdir(parents=True, exist_ok=True)
    output = {"created_at": datetime.now(timezone.utc).isoformat(), "model": args.model,
              "notice": "真实视频及本地 ASR 转写；没有预填比较结论。ASR 可能存在错字，引用需复听原视频。", "groups": []}
    for group in GROUPS:
        result = {"id": group["id"], "question": group["question"], "sources": []}
        output["groups"].append(result)
        for bvid in group["bvids"]:
            path = cache / f"{bvid}-p1.json"
            source = None
            if path.exists() and not args.refresh and bvid not in args.refresh_bvid:
                saved = json.loads(path.read_text(encoding="utf-8"))
                if saved.get("model") == args.model and saved.get("source", {}).get("status") == "ready":
                    source = saved["source"]
                    print(f"REUSE {bvid}: {len(source['segments'])} segments", flush=True)
            if source is None:
                print(f"START {bvid} ({args.model}, CPU)", flush=True)
                try:
                    metadata = await resolve_video(bvid)
                    page = metadata["pages"][0]
                    source = {"id": bvid + "-p1", "url": page["url"], "bvid": bvid, "page": 1,
                              "cid": page["cid"], "title": metadata["title"], "author": metadata["author"],
                              "duration": page["duration"], "status": "fetching", "error": None,
                              "transcript_kind": None, "segments": []}
                    transcript = await load_transcript(source, cache / "scratch", lambda message: print(f"  {bvid}: {message}", flush=True))
                    if transcript["kind"] == "asr" and transcript.get("asr_model") != args.model:
                        raise VideoError("validation_model_fallback", "本次 ASR 未使用指定模型，保留失败记录以便重试。")
                    source.update(status="ready", transcript_kind=transcript["kind"], segments=transcript["segments"])
                    print(f"READY {bvid}: {len(source['segments'])} segments, {source['duration']} seconds", flush=True)
                except VideoError as exc:
                    source = source or {"id": bvid + "-p1", "url": f"https://www.bilibili.com/video/{bvid}/?p=1", "bvid": bvid,
                                        "page": 1, "cid": None, "title": None, "author": None, "duration": None,
                                        "transcript_kind": None, "segments": []}
                    source.update(status="failed", error=f"{exc.code}: {exc.message}")
                    print(f"FAILED {bvid}: {exc.code} {exc.message}", flush=True)
                save_json(path, {"model": args.model, "checked_at": datetime.now(timezone.utc).isoformat(), "source": source})
            result["sources"].append(source)
            save_json(ROOT / ".cache" / "validation_sources.json", output)
    good = sum(s["status"] == "ready" for group in output["groups"] for s in group["sources"])
    print(f"FINISHED {good}/6 sources ready", flush=True)
    return 0 if good == 6 else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", default="small")
    parser.add_argument("--endpoint", help="Explicit optional model Hub endpoint/mirror")
    parser.add_argument("--timeout", default=1800, type=int, help="Per-source process bound, seconds (max 1800)")
    parser.add_argument("--refresh", action="store_true")
    parser.add_argument("--refresh-bvid", action="append", default=[], help="Refresh one successful source; can be repeated")
    raise SystemExit(asyncio.run(prepare(parser.parse_args())))
