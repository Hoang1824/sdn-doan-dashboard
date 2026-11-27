from __future__ import annotations

import base64
import json
import os
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator


STREAMS = ("ryu_events.jsonl", "timeline.jsonl", "events.jsonl")
_RUN_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$")


class RunNotFoundError(Exception):
    pass


class SourceUnavailableError(Exception):
    pass


class InvalidRunIdError(Exception):
    pass


class InvalidCursorError(Exception):
    pass


class ResyncRequiredError(InvalidCursorError):
    pass


class InvalidJsonlError(Exception):
    def __init__(self, stream: str, offset: int, reason: str) -> None:
        super().__init__(f"Invalid complete JSONL record in {stream} at byte {offset}: {reason}")
        self.stream = stream
        self.offset = offset


@dataclass(frozen=True)
class CursorFile:
    offset: int
    identity: str | None


@dataclass(frozen=True)
class ResumeCursor:
    run_id: str
    files: dict[str, CursorFile]


@dataclass(frozen=True)
class JsonlRecord:
    stream: str
    offset: int
    identity: str
    value: dict[str, Any]


@dataclass(frozen=True)
class EventPage:
    events: list[dict[str, Any]]
    next_cursor: str
    has_more: bool


def _file_identity(path: Path) -> str | None:
    try:
        stat = path.stat()
    except FileNotFoundError:
        return None
    if not path.is_file():
        raise SourceUnavailableError(f"Expected a regular log file: {path.name}")
    return f"{stat.st_dev:x}:{stat.st_ino:x}"


def _safe_child(directory: Path, name: str) -> Path:
    path = (directory / name).resolve()
    try:
        if os.path.commonpath((str(directory), str(path))) != str(directory):
            raise SourceUnavailableError(f"Log source escapes its run directory: {name}")
    except ValueError as error:
        raise SourceUnavailableError(f"Log source escapes its run directory: {name}") from error
    return path


def _encode_cursor(cursor: ResumeCursor) -> str:
    body = {
        "v": 1,
        "run_id": cursor.run_id,
        "files": {
            stream: {"offset": item.offset, "identity": item.identity}
            for stream, item in cursor.files.items()
        },
    }
    encoded = json.dumps(body, separators=(",", ":"), sort_keys=True).encode("utf-8")
    return base64.urlsafe_b64encode(encoded).decode("ascii").rstrip("=")


def _decode_cursor(token: str, run_id: str) -> ResumeCursor:
    if not token or len(token) > 8192 or not re.fullmatch(r"[A-Za-z0-9_-]+", token):
        raise InvalidCursorError("Cursor is malformed.")
    try:
        raw = base64.urlsafe_b64decode(token + "=" * (-len(token) % 4))
        value = json.loads(raw)
    except (ValueError, json.JSONDecodeError) as error:
        raise InvalidCursorError("Cursor is malformed.") from error
    if not isinstance(value, dict) or value.get("v") != 1 or value.get("run_id") != run_id:
        raise InvalidCursorError("Cursor version or run_id does not match.")
    raw_files = value.get("files")
    if not isinstance(raw_files, dict) or set(raw_files) != set(STREAMS):
        raise InvalidCursorError("Cursor does not contain the expected stream offsets.")

    files: dict[str, CursorFile] = {}
    for stream in STREAMS:
        entry = raw_files[stream]
        if not isinstance(entry, dict):
            raise InvalidCursorError("Cursor stream entry is malformed.")
        offset = entry.get("offset")
        identity = entry.get("identity")
        if type(offset) is not int or offset < 0:
            raise InvalidCursorError("Cursor offset must be a nonnegative integer.")
        if identity is not None and not isinstance(identity, str):
            raise InvalidCursorError("Cursor file identity is malformed.")
        files[stream] = CursorFile(offset, identity)
    return ResumeCursor(run_id, files)


class JsonlRunReader:
    """Read-only reader for complete JSONL lines in one validated run directory."""

    def __init__(self, log_root: Path) -> None:
        self.log_root = log_root.expanduser().resolve()

    def run_dir(self, run_id: str) -> Path:
        if not _RUN_ID.fullmatch(run_id):
            raise InvalidRunIdError("run_id contains unsupported characters.")
        if not self.log_root.is_dir():
            raise SourceUnavailableError(f"Configured log root is not readable: {self.log_root}")
        unresolved = self.log_root / run_id
        if unresolved.is_symlink():
            raise InvalidRunIdError("run_id must not be a symbolic link.")
        candidate = unresolved.resolve()
        try:
            if os.path.commonpath((str(self.log_root), str(candidate))) != str(self.log_root):
                raise InvalidRunIdError("run_id resolves outside the configured log root.")
        except ValueError as error:
            raise InvalidRunIdError("run_id resolves outside the configured log root.") from error
        if not candidate.is_dir():
            raise RunNotFoundError(f"Run not found: {run_id}")
        return candidate

    def list_runs(self) -> list[dict[str, Any]]:
        if not self.log_root.is_dir():
            raise SourceUnavailableError(f"Configured log root is not readable: {self.log_root}")
        runs: list[dict[str, Any]] = []
        for path in sorted(self.log_root.iterdir(), key=lambda item: item.name):
            if path.is_symlink() or not path.is_dir() or not _RUN_ID.fullmatch(path.name):
                continue
            resolved = path.resolve()
            try:
                if os.path.commonpath((str(self.log_root), str(resolved))) != str(self.log_root):
                    continue
            except ValueError:
                continue
            try:
                manifest = self.read_manifest(path.name, required=False)
            except SourceUnavailableError as error:
                runs.append(
                    {
                        "run_id": path.name,
                        "manifest": None,
                        "metadata_error": str(error),
                    }
                )
            else:
                runs.append({"run_id": path.name, "manifest": manifest})
        return runs

    def latest_complete_activity(self, run_id: str) -> dict[str, Any]:
        directory = self.run_dir(run_id)
        latest_mtime: float | None = None
        latest_stream: str | None = None
        for stream in STREAMS:
            path = _safe_child(directory, stream)
            try:
                with path.open("rb") as file:
                    stat = os.fstat(file.fileno())
                    if stat.st_size == 0:
                        continue
                    file.seek(-1, os.SEEK_END)
                    if file.read(1) != b"\n":
                        continue
            except FileNotFoundError:
                continue
            if latest_mtime is None or stat.st_mtime > latest_mtime:
                latest_mtime = stat.st_mtime
                latest_stream = stream

        if latest_mtime is None:
            return {
                "last_activity_at": None,
                "last_activity_mtime": None,
                "last_activity_stream": None,
            }
        return {
            "last_activity_at": datetime.fromtimestamp(
                latest_mtime, timezone.utc
            ).isoformat().replace("+00:00", "Z"),
            "last_activity_mtime": latest_mtime,
            "last_activity_stream": latest_stream,
        }

    def iter_complete_records(self, run_id: str, stream: str) -> Iterator[JsonlRecord]:
        if stream not in STREAMS:
            raise SourceUnavailableError(f"Unsupported JSONL stream: {stream}")
        directory = self.run_dir(run_id)
        path = _safe_child(directory, stream)
        identity = _file_identity(path)
        if identity is None:
            return

        with path.open("rb") as file:
            stat = os.fstat(file.fileno())
            opened_identity = f"{stat.st_dev:x}:{stat.st_ino:x}"
            if opened_identity != identity:
                raise ResyncRequiredError(f"{stream} changed while it was being read.")
            cutoff = stat.st_size
            while file.tell() < cutoff:
                offset = file.tell()
                line = file.readline()
                if not line.endswith(b"\n") or file.tell() > cutoff:
                    break
                if not line.strip():
                    continue
                try:
                    value = json.loads(line.decode("utf-8"))
                except (json.JSONDecodeError, UnicodeDecodeError) as error:
                    raise InvalidJsonlError(
                        stream, offset, "line is not valid UTF-8 JSON"
                    ) from error
                if not isinstance(value, dict):
                    raise InvalidJsonlError(stream, offset, "record must be a JSON object")
                yield JsonlRecord(stream, offset, identity, value)

    def read_manifest(self, run_id: str, required: bool = True) -> dict[str, Any] | None:
        directory = self.run_dir(run_id)
        path = _safe_child(directory, "manifest.json")
        try:
            with path.open("r", encoding="utf-8") as file:
                value = json.load(file)
        except FileNotFoundError:
            if required:
                raise SourceUnavailableError(f"manifest.json is missing for run {run_id}.")
            return None
        except (json.JSONDecodeError, UnicodeDecodeError) as error:
            raise SourceUnavailableError(f"manifest.json is invalid for run {run_id}.") from error
        if not isinstance(value, dict):
            raise SourceUnavailableError(f"manifest.json must contain a JSON object for run {run_id}.")
        return value

    def initial_cursor(self, run_id: str) -> str:
        directory = self.run_dir(run_id)
        return _encode_cursor(
            ResumeCursor(
                run_id,
                {
                    stream: CursorFile(0, _file_identity(_safe_child(directory, stream)))
                    for stream in STREAMS
                },
            )
        )

    def _cursor_for_run(self, run_id: str, token: str) -> tuple[Path, dict[str, int], dict[str, str | None]]:
        directory = self.run_dir(run_id)
        cursor = _decode_cursor(token, run_id)
        offsets: dict[str, int] = {}
        identities: dict[str, str | None] = {}
        for stream in STREAMS:
            path = _safe_child(directory, stream)
            saved = cursor.files[stream]
            current_identity = _file_identity(path)
            current_size = path.stat().st_size if current_identity is not None else 0
            if saved.identity is not None and saved.identity != current_identity:
                raise ResyncRequiredError(f"{stream} was replaced; fetch a new snapshot.")
            if current_identity is None and saved.offset != 0:
                raise ResyncRequiredError(f"{stream} is no longer available; fetch a new snapshot.")
            if saved.offset > current_size:
                raise ResyncRequiredError(f"{stream} was truncated; fetch a new snapshot.")
            if saved.offset and not self._ends_on_record_boundary(path, saved.offset):
                raise ResyncRequiredError(f"Cursor is not at a complete record boundary in {stream}.")
            offsets[stream] = saved.offset
            identities[stream] = current_identity
        return directory, offsets, identities

    def cursor_includes_record(
        self,
        run_id: str,
        token: str,
        stream: str,
        record_offset: int,
    ) -> bool:
        if stream not in STREAMS:
            raise InvalidCursorError("Cursor stream is not recognized.")
        _, offsets, _ = self._cursor_for_run(run_id, token)
        return offsets[stream] > record_offset

    @staticmethod
    def _ends_on_record_boundary(path: Path, offset: int) -> bool:
        with path.open("rb") as file:
            file.seek(offset - 1)
            return file.read(1) == b"\n"

    def read_page(
        self,
        run_id: str,
        after: str,
        limit: int,
        normalize: Any,
        manifest: dict[str, Any],
        data_mode: str,
    ) -> EventPage:
        directory, offsets, identities = self._cursor_for_run(run_id, after)
        events: list[dict[str, Any]] = []
        for stream in STREAMS:
            path = _safe_child(directory, stream)
            identity = identities[stream]
            if identity is None:
                continue
            with path.open("rb") as file:
                file.seek(offsets[stream])
                while len(events) < limit:
                    start = file.tell()
                    line = file.readline()
                    if not line:
                        break
                    if not line.endswith(b"\n"):
                        break
                    offsets[stream] = file.tell()
                    if not line.strip():
                        continue
                    try:
                        value = json.loads(line.decode("utf-8"))
                    except (json.JSONDecodeError, UnicodeDecodeError) as error:
                        raise InvalidJsonlError(stream, start, "line is not valid UTF-8 JSON") from error
                    if not isinstance(value, dict):
                        raise InvalidJsonlError(stream, start, "record must be a JSON object")
                    token = _encode_cursor(
                        ResumeCursor(
                            run_id,
                            {
                                name: CursorFile(offsets[name], identities[name])
                                for name in STREAMS
                            },
                        )
                    )
                    events.append(
                        normalize(
                            run_id=run_id,
                            stream=stream,
                            offset=start,
                            identity=identity,
                            raw=value,
                            manifest=manifest,
                            data_mode=data_mode,
                            cursor=token,
                        )
                    )
                if len(events) >= limit:
                    break

        next_cursor = _encode_cursor(
            ResumeCursor(
                run_id,
                {
                    stream: CursorFile(offsets[stream], identities[stream])
                    for stream in STREAMS
                },
            )
        )
        has_more = self._has_complete_record(directory, offsets, identities)
        return EventPage(events, next_cursor, has_more)

    @staticmethod
    def _has_complete_record(
        directory: Path,
        offsets: dict[str, int],
        identities: dict[str, str | None],
    ) -> bool:
        for stream in STREAMS:
            if identities[stream] is None:
                continue
            with _safe_child(directory, stream).open("rb") as file:
                file.seek(offsets[stream])
                line = file.readline()
                if line.endswith(b"\n"):
                    return True
        return False

    def iter_all(
        self,
        run_id: str,
        normalize: Any,
        manifest: dict[str, Any],
        data_mode: str,
        page_size: int = 500,
    ) -> Iterator[dict[str, Any]]:
        cursor = self.initial_cursor(run_id)
        while True:
            page = self.read_page(run_id, cursor, page_size, normalize, manifest, data_mode)
            yield from page.events
            cursor = page.next_cursor
            if not page.has_more:
                break

    def scan_snapshot(
        self,
        run_id: str,
        normalize: Any,
        manifest: dict[str, Any],
        data_mode: str,
        consume: Any,
    ) -> str:
        """Reduce one bounded view of all streams and return its resume cursor."""
        directory = self.run_dir(run_id)
        identities: dict[str, str | None] = {}
        cutoffs: dict[str, int] = {}
        offsets = {stream: 0 for stream in STREAMS}
        for stream in STREAMS:
            path = _safe_child(directory, stream)
            identities[stream] = _file_identity(path)
            cutoffs[stream] = path.stat().st_size if identities[stream] is not None else 0

        for stream in STREAMS:
            identity = identities[stream]
            if identity is None:
                continue
            path = _safe_child(directory, stream)
            with path.open("rb") as file:
                opened = os.fstat(file.fileno())
                opened_identity = f"{opened.st_dev:x}:{opened.st_ino:x}"
                if opened_identity != identity:
                    raise ResyncRequiredError(f"{stream} changed while the snapshot was read.")
                while file.tell() < cutoffs[stream]:
                    start = file.tell()
                    line = file.readline()
                    if not line.endswith(b"\n") or file.tell() > cutoffs[stream]:
                        break
                    offsets[stream] = file.tell()
                    if not line.strip():
                        continue
                    try:
                        value = json.loads(line.decode("utf-8"))
                    except (json.JSONDecodeError, UnicodeDecodeError) as error:
                        raise InvalidJsonlError(stream, start, "line is not valid UTF-8 JSON") from error
                    if not isinstance(value, dict):
                        raise InvalidJsonlError(stream, start, "record must be a JSON object")
                    token = _encode_cursor(
                        ResumeCursor(
                            run_id,
                            {
                                name: CursorFile(offsets[name], identities[name])
                                for name in STREAMS
                            },
                        )
                    )
                    consume(
                        normalize(
                            run_id=run_id,
                            stream=stream,
                            offset=start,
                            identity=identity,
                            raw=value,
                            manifest=manifest,
                            data_mode=data_mode,
                            cursor=token,
                        )
                    )

        return _encode_cursor(
            ResumeCursor(
                run_id,
                {
                    stream: CursorFile(offsets[stream], identities[stream])
                    for stream in STREAMS
                },
            )
        )

