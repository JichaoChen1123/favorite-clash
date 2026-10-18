"""Own one local server instance and record the real Windows process identity."""
from __future__ import annotations

import argparse
import asyncio
import ctypes
from ctypes import wintypes
import json
import os
from pathlib import Path
import sys


def windows_identity() -> tuple[str, str]:
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.GetCurrentProcess.restype = wintypes.HANDLE
    kernel.GetModuleFileNameW.argtypes = [wintypes.HMODULE, wintypes.LPWSTR, wintypes.DWORD]
    kernel.GetModuleFileNameW.restype = wintypes.DWORD
    buffer = ctypes.create_unicode_buffer(32768)
    if not kernel.GetModuleFileNameW(None, buffer, len(buffer)):
        raise ctypes.WinError(ctypes.get_last_error())
    creation, exited, system, user = (wintypes.FILETIME() for _ in range(4))
    kernel.GetProcessTimes.argtypes = [wintypes.HANDLE] + [ctypes.POINTER(wintypes.FILETIME)] * 4
    kernel.GetProcessTimes.restype = wintypes.BOOL
    if not kernel.GetProcessTimes(kernel.GetCurrentProcess(), ctypes.byref(creation), ctypes.byref(exited), ctypes.byref(system), ctypes.byref(user)):
        raise ctypes.WinError(ctypes.get_last_error())
    file_time = creation.dwLowDateTime | (creation.dwHighDateTime << 32)
    # Windows FILETIME starts in 1601; .NET DateTime ticks start in year 1.
    return str(Path(buffer.value).resolve()), str(file_time + 504911232000000000)


async def serve(port: int, stop_file: Path, token: str) -> None:
    import uvicorn

    server = uvicorn.Server(uvicorn.Config('app.main:app', host='127.0.0.1', port=port, timeout_graceful_shutdown=8))

    async def watch_stop() -> None:
        while True:
            try:
                if stop_file.read_text(encoding='utf-8') == token:
                    server.should_exit = True
                    return
            except FileNotFoundError:
                pass
            await asyncio.sleep(0.2)

    watcher = asyncio.create_task(watch_stop())
    try:
        await server.serve()
    finally:
        watcher.cancel()
        await asyncio.gather(watcher, return_exceptions=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, required=True)
    parser.add_argument('--state', type=Path, required=True)
    parser.add_argument('--token', required=True)
    parser.add_argument('--data-dir', type=Path, required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(root))
    os.environ['CLASH_DATA_DIR'] = str(args.data_dir.resolve())
    executable, start_ticks = windows_identity()
    record = {'version': 2, 'app': 'favorite-clash', 'project_root': str(root), 'pid': os.getpid(), 'port': args.port, 'executable': executable, 'process_start_utc_ticks': start_ticks, 'instance_token': args.token, 'data_dir': str(args.data_dir.resolve())}
    state = args.state.resolve()
    stop_file = state.parent / f'server-stop-{args.token}.request'
    temporary = state.with_name(f'{state.name}.{args.token}.tmp')
    temporary.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding='utf-8')
    os.replace(temporary, state)
    try:
        asyncio.run(serve(args.port, stop_file, args.token))
    finally:
        try:
            if json.loads(state.read_text(encoding='utf-8')).get('instance_token') == args.token:
                state.unlink(missing_ok=True)
        except (FileNotFoundError, ValueError):
            pass
        stop_file.unlink(missing_ok=True)


if __name__ == '__main__':
    main()
