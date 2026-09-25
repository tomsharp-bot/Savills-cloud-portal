#!/usr/bin/env python3
"""Upload M3Vision photos into a project's Photos Pool.

Photos sit in a folder, or in a zip with one subfolder per property
(``635770-Challice Way Tillman House 16/635770-Front Door1.jpg``). The pool
name is the base filename. Spaces, hyphens, the letters ``null``, and capitals
are kept. The folder path is not.

Reads PHOTO_INGEST_KEY from the environment. Lists names already in the pool,
then uploads only the missing images in batches.

    PHOTO_INGEST_KEY=... python3 scripts/photo-ingest.py \\
        --base-url https://savillscloudportal.co.uk \\
        --project "MTVH 2026" \\
        /home/photos/m3vision.zip

Prints one JSON object on stdout: {"uploaded": [...], "skipped": [...], "failed": [...]}.
Progress goes to stderr. Exit 0 when nothing failed.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"}
MIME = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".heic": "image/heic",
    ".heif": "image/heif",
}
# Match the portal: the stem is exact, the extension is lower case, .jpeg is stored as .jpg.
STORED_EXT = {".jpeg": ".jpg"}


def base_name(original: str) -> str:
    """Last path segment. Slashes and backslashes are folder separators."""
    text = str(original or "").strip().replace("\\", "/")
    parts = [part for part in text.split("/") if part and part != "."]
    return parts[-1] if parts else ""


def stored_file_name(original: str) -> str:
    """File name the portal will store, used to decide what is already there."""
    base = base_name(original)
    stem, dot, ext = base.rpartition(".")
    if not dot:
        return base
    ext = "." + ext.lower()
    if ext not in IMAGE_EXTS:
        return base
    return stem + STORED_EXT.get(ext, ext)


def match_key(original: str) -> str:
    """Case-insensitive key. The portal skips an existing name regardless of case."""
    return stored_file_name(original).casefold()


def content_type(name: str) -> str:
    ext = "." + base_name(name).rsplit(".", 1)[-1].lower() if "." in base_name(name) else ""
    return MIME.get(ext, "application/octet-stream")


class ImageFile:
    def __init__(self, name: str, read):
        self.name = name
        self._read = read

    def read(self) -> bytes:
        return self._read()


def iter_folder(root: Path):
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [name for name in dirnames if name != "__MACOSX" and not name.startswith(".")]
        for filename in sorted(filenames):
            if filename.startswith("._") or filename.startswith("."):
                continue
            path = Path(dirpath) / filename
            if path.suffix.lower() not in IMAGE_EXTS:
                continue
            yield ImageFile(filename, path.read_bytes)


def iter_zip(path: Path):
    try:
        archive = zipfile.ZipFile(path)
    except zipfile.BadZipFile as err:
        raise SystemExit(f"Could not read zip: {err}") from err
    names = sorted(info.filename for info in archive.infolist() if not info.is_dir())
    for member in names:
        filename = base_name(member)
        if not filename or filename.startswith("._") or filename.startswith("."):
            continue
        if "__MACOSX" in member.replace("\\", "/").split("/"):
            continue
        if Path(filename).suffix.lower() not in IMAGE_EXTS:
            continue

        def read(member=member, archive=archive) -> bytes:
            return archive.read(member)

        yield ImageFile(filename, read)


def find_images(path: Path):
    if path.is_dir():
        return list(iter_folder(path))
    if path.is_file() and path.suffix.lower() == ".zip":
        return list(iter_zip(path))
    raise SystemExit(f"Give a folder or a .zip file, not {path}")


def api_url(base_url: str, project: str, suffix: str) -> str:
    base = base_url.rstrip("/")
    quoted = urllib.parse.quote(project, safe="")
    return f"{base}/api/projects/{quoted}/photos{suffix}"


def request_json(url: str, key: str, data: bytes | None = None, content_type: str | None = None, timeout: int = 600):
    headers = {"Authorization": f"Bearer {key}", "Accept": "application/json"}
    if content_type:
        headers["Content-Type"] = content_type
    req = urllib.request.Request(url, data=data, headers=headers, method="POST" if data is not None else "GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            raw = res.read()
            status = res.status
    except urllib.error.HTTPError as err:
        raw = err.read()
        status = err.code
    body = raw.decode("utf-8", errors="replace")
    try:
        parsed = json.loads(body) if body else {}
    except json.JSONDecodeError:
        parsed = {"error": body.strip() or f"HTTP {status}"}
    return status, parsed


def encode_multipart(files: list[tuple[str, bytes]]) -> tuple[bytes, str]:
    boundary = "scp-photo-ingest-" + os.urandom(8).hex()
    chunks: list[bytes] = []
    for name, data in files:
        filename = base_name(name).replace('"', "")
        header = (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="files"; filename="{filename}"\r\n'
            f"Content-Type: {content_type(filename)}\r\n"
            f"\r\n"
        )
        chunks.append(header.encode("utf-8"))
        chunks.append(data)
        chunks.append(b"\r\n")
    chunks.append(f"--{boundary}--\r\n".encode("utf-8"))
    return b"".join(chunks), f"multipart/form-data; boundary={boundary}"


def fetch_existing(base_url: str, project: str, key: str) -> set[str]:
    try:
        status, body = request_json(api_url(base_url, project, ""), key, timeout=120)
    except urllib.error.URLError as err:
        raise SystemExit(f"Could not list photos: {err.reason}") from err
    if status != 200:
        raise SystemExit(body.get("error") or f"Could not list photos (HTTP {status})")
    names = body.get("names") if isinstance(body, dict) else None
    if not isinstance(names, list):
        raise SystemExit("Photo list did not include names.")
    return {match_key(str(name)) for name in names}


def upload_batch(base_url: str, project: str, key: str, batch: list[ImageFile], retries: int):
    payload = []
    local_failed: list[dict] = []
    for item in batch:
        try:
            data = item.read()
        except OSError as err:
            local_failed.append({"name": item.name, "error": str(err)})
            continue
        if not data:
            local_failed.append({"name": item.name, "error": "That file is empty."})
            continue
        payload.append((item.name, data))
    if not payload:
        return 200, {"uploaded": [], "skipped": [], "failed": local_failed}
    raw, content_type = encode_multipart(payload)
    url = api_url(base_url, project, "/ingest")
    delay = 2.0
    last_status = 0
    last_body: dict = {}
    attempts = max(1, retries)
    for attempt in range(attempts):
        try:
            last_status, last_body = request_json(url, key, raw, content_type, timeout=600)
        except (urllib.error.URLError, TimeoutError, OSError) as err:
            last_status = 0
            last_body = {"error": str(err.reason if isinstance(err, urllib.error.URLError) else err)}
        if last_status == 200 or last_status in (400, 401, 404, 413):
            if isinstance(last_body, dict):
                last_body.setdefault("failed", [])
                last_body["failed"] = list(local_failed) + list(last_body.get("failed") or [])
            return last_status, last_body
        if attempt + 1 < attempts:
            print(f"batch failed (HTTP {last_status}); retrying in {delay:.0f}s", file=sys.stderr)
            time.sleep(delay)
            delay = min(delay * 2, 30)
    if isinstance(last_body, dict):
        last_body.setdefault("failed", [])
        last_body["failed"] = list(local_failed) + list(last_body.get("failed") or [])
    return last_status, last_body


def run(base_url: str, project: str, source: Path, batch_size: int, retries: int) -> dict:
    key = os.environ.get("PHOTO_INGEST_KEY", "").strip()
    if not key:
        raise SystemExit("Set PHOTO_INGEST_KEY in the environment.")
    images = find_images(source)
    existing = fetch_existing(base_url, project, key)
    uploaded: list[str] = []
    skipped: list[str] = []
    failed: list[dict] = []
    pending: list[ImageFile] = []
    seen: set[str] = set()
    for image in images:
        key_name = match_key(image.name)
        if not key_name or key_name in existing or key_name in seen:
            skipped.append(image.name)
            seen.add(key_name)
            continue
        seen.add(key_name)
        pending.append(image)

    size = max(1, min(batch_size, 40))
    fatal = False
    for start in range(0, len(pending), size):
        if fatal:
            for item in pending[start:]:
                failed.append({"name": item.name, "error": "Not sent."})
            break
        batch = pending[start : start + size]
        status, body = upload_batch(base_url, project, key, batch, retries)
        if status != 200 or not isinstance(body, dict):
            message = body.get("error") if isinstance(body, dict) else ""
            message = message or f"HTTP {status}"
            for item in batch:
                failed.append({"name": item.name, "error": message})
            if status in (401, 404):
                fatal = True
            continue
        uploaded.extend(str(name) for name in body.get("uploaded") or [])
        skipped.extend(str(name) for name in body.get("skipped") or [])
        for item in body.get("failed") or []:
            if isinstance(item, dict):
                failed.append({"name": str(item.get("name") or ""), "error": str(item.get("error") or "Upload failed.")})
        for name in body.get("uploaded") or []:
            existing.add(match_key(str(name)))
        for name in body.get("skipped") or []:
            existing.add(match_key(str(name)))
        print(
            f"batch {start // size + 1}: uploaded {len(uploaded)}, skipped {len(skipped)}, failed {len(failed)}",
            file=sys.stderr,
        )
    return {"uploaded": uploaded, "skipped": skipped, "failed": failed}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Upload missing Photos Pool images from a folder or zip.")
    parser.add_argument("--base-url", required=True, help="Portal origin, e.g. https://savillscloudportal.co.uk")
    parser.add_argument("--project", required=True, help="Project id or exact project name, e.g. MTVH 2026")
    parser.add_argument("path", help="Folder of images, or a .zip from M3Vision")
    parser.add_argument("--batch-size", type=int, default=20, help="Files per request (default 20, max 40)")
    parser.add_argument("--retries", type=int, default=3, help="Attempts per batch when the request fails")
    args = parser.parse_args(argv)
    summary = run(args.base_url, args.project, Path(args.path), args.batch_size, args.retries)
    json.dump(summary, sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 1 if summary["failed"] else 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except BrokenPipeError:
        raise SystemExit(1)
