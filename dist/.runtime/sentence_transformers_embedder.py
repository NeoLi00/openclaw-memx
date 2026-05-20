#!/usr/bin/env python3
import argparse
import json
import os
import subprocess
import sys
import tempfile
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--device", default="auto")
    parser.add_argument("--cache-dir", default=None)
    parser.add_argument("--launch-server", action="store_true")
    parser.add_argument("--serve", action="store_true")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=0)
    parser.add_argument("--token", default=None)
    parser.add_argument("--state-file", default=None)
    return parser.parse_args()


def resolve_device(requested: str) -> str:
    if requested and requested != "auto":
      return requested

    try:
        import torch  # type: ignore

        if torch.cuda.is_available():
            return "cuda"
        if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            return "mps"
    except Exception:
        pass
    return "cpu"


def load_model(model_name: str, cache_dir: str | None, device: str):
    try:
        from sentence_transformers import SentenceTransformer  # type: ignore
    except Exception as exc:
        raise RuntimeError(
            "sentence-transformers is not installed. Run `python3 -m pip install sentence-transformers torch`."
        ) from exc

    return SentenceTransformer(
        model_name,
        cache_folder=cache_dir,
        device=device,
    )


def prefixed_texts(mode: str, texts: list[str]) -> list[str]:
    prefix = "query: " if mode == "query" else "passage: "
    return [prefix + (text.strip() if isinstance(text, str) else "") for text in texts]


def encode_texts(model, mode: str, texts: list[str]) -> list[list[float]]:
    encoded = model.encode(
        prefixed_texts(mode, texts),
        normalize_embeddings=True,
        convert_to_numpy=True,
        show_progress_bar=False,
        batch_size=max(1, min(32, len(texts))),
    )
    embeddings = encoded.tolist() if hasattr(encoded, "tolist") else list(encoded)
    return embeddings


def write_state(state_file: str | None, payload: dict):
    if not state_file:
        return
    state_path = Path(state_file)
    state_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = state_path.with_suffix(state_path.suffix + ".tmp")
    tmp_path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf8")
    tmp_path.replace(state_path)


def launch_server(args):
    if not args.token:
        raise RuntimeError("--token is required with --launch-server")
    state_file = args.state_file or os.path.join(
        tempfile.gettempdir(),
        f"memx-embedder-{os.getpid()}.json",
    )
    command = [
        sys.executable,
        __file__,
        "--serve",
        "--model",
        args.model,
        "--device",
        args.device,
        "--host",
        args.host,
        "--port",
        str(args.port),
        "--token",
        args.token,
        "--state-file",
        state_file,
    ]
    if args.cache_dir:
        command.extend(["--cache-dir", args.cache_dir])
    creation_kwargs = {}
    if os.name != "nt":
        creation_kwargs["start_new_session"] = True
    proc = subprocess.Popen(
        command,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        close_fds=True,
        **creation_kwargs,
    )
    state_path = Path(state_file)
    deadline = time.monotonic() + 300
    while time.monotonic() < deadline:
        if proc.poll() is not None and not state_path.exists():
            raise RuntimeError(f"embedding server exited before startup (code {proc.returncode})")
        if state_path.exists():
            payload = json.loads(state_path.read_text(encoding="utf8"))
            payload["pid"] = proc.pid
            if payload.get("error"):
                raise RuntimeError(str(payload["error"]))
            sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
            sys.stdout.flush()
            return
        time.sleep(0.05)
    proc.terminate()
    raise RuntimeError("embedding server startup timed out")


def serve(args):
    if not args.token:
        raise RuntimeError("--token is required with --serve")
    try:
        device = resolve_device(args.device)
        model = load_model(args.model, args.cache_dir, device)
    except Exception as exc:
        write_state(args.state_file, {"error": str(exc)})
        raise

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, format, *args):  # noqa: A002
            return

        def _authorized(self) -> bool:
            return self.headers.get("x-memx-token") == args.token

        def _write_json(self, status: int, payload: dict):
            body = json.dumps(payload, ensure_ascii=False).encode("utf8")
            self.send_response(status)
            self.send_header("content-type", "application/json; charset=utf-8")
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_POST(self):
            if not self._authorized():
                self._write_json(403, {"error": "forbidden"})
                return
            if self.path == "/shutdown":
                self._write_json(200, {"ok": True})
                Thread(target=self.server.shutdown, daemon=True).start()
                return
            if self.path != "/embed":
                self._write_json(404, {"error": "not found"})
                return
            try:
                length = int(self.headers.get("content-length") or "0")
                payload = json.loads(self.rfile.read(length).decode("utf8"))
                texts = payload.get("texts") or []
                mode = payload.get("mode") or "passage"
                self._write_json(200, {"embeddings": encode_texts(model, mode, texts)})
            except Exception as exc:
                self._write_json(500, {"error": str(exc)})

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    host, port = server.server_address[:2]
    write_state(args.state_file, {"url": f"http://{host}:{port}", "token": args.token})
    server.serve_forever()


def run_stdio(args):
    device = resolve_device(args.device)
    model = load_model(args.model, args.cache_dir, device)

    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue
        response_id = None
        try:
            payload = json.loads(line)
            response_id = payload.get("id")
            texts = payload.get("texts") or []
            mode = payload.get("mode") or "passage"
            sys.stdout.write(
                json.dumps(
                    {
                        "id": response_id,
                        "embeddings": encode_texts(model, mode, texts),
                    },
                    ensure_ascii=False,
                )
                + "\n"
            )
            sys.stdout.flush()
        except Exception as exc:
            sys.stdout.write(
                json.dumps(
                    {
                        "id": response_id,
                        "error": str(exc),
                    },
                    ensure_ascii=False,
                )
                + "\n"
            )
            sys.stdout.flush()


def main():
    args = parse_args()
    if args.launch_server:
        launch_server(args)
        return
    if args.serve:
        serve(args)
        return
    run_stdio(args)


if __name__ == "__main__":
    main()
