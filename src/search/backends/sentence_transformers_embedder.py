#!/usr/bin/env python3
import argparse
import json
import sys


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--device", default="auto")
    parser.add_argument("--cache-dir", default=None)
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


def main():
    args = parse_args()
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
            encoded = model.encode(
                prefixed_texts(mode, texts),
                normalize_embeddings=True,
                convert_to_numpy=True,
                show_progress_bar=False,
                batch_size=max(1, min(32, len(texts))),
            )
            embeddings = encoded.tolist() if hasattr(encoded, "tolist") else list(encoded)
            sys.stdout.write(
                json.dumps(
                    {
                        "id": response_id,
                        "embeddings": embeddings,
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


if __name__ == "__main__":
    main()
