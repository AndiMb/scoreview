"""The second renderer: the scoreview-engine under Node, as on the app's
local path.

The image carries ``scoreview/converter`` unchanged (see Dockerfile), and
this module calls its ``convert.mjs`` exactly the way
``Service\\LocalConverter`` does in the app - same arguments, same output
files, same self-test. What the sidecar adds on top is only the container
around it.

Deliberately free of Flask and of the job registry, like ``musescore``.
"""

import json
import os
import subprocess
import tempfile
from pathlib import Path

from . import config, errors

# Same reasoning as in musescore.py: `timeout` kills its process group, and
# subprocess reports that as -9.
_KILLED_BY_SIGKILL = -9

# Node optimises the engine's 9.5 MB WebAssembly module in the background and
# waits for that work when the process ends - every run is a fresh process
# that converts once, so the optimised code never runs. Measured on the
# local path: 3.2-4.0 s with the baseline compiler only, 23-29 s without
# (Service\ConverterRuntime, where the same flag is set).
_NODE_WASM_FLAG = "--liftoff-only"

# Artifacts of one run, in the shape the job registry hands out.
BASE_FILES = ("score.mid", "timing.json", "measures.json", "meta.json")
VARIANT_FILES = ("timing.json", "measures.json", "meta.json")


def _command(read: list[Path], write: list[Path], args: list[str]) -> list[str]:
    """The Node call, locked in with the permission model (Node 22.13+): the
    converter may read its own directory and the paths it is given, and
    write only into its output directory - S11 as on the local path. The
    container is the outer wall; this keeps a crafted score from reaching
    another job's files inside it."""
    paths_read = [config.CONVERTER_DIR, *read]
    return [
        "timeout", "--signal=KILL", config.TIMEOUT_SECONDS,
        config.NODE_BIN, _NODE_WASM_FLAG, "--permission",
        *[f"--allow-fs-read={p}" for p in paths_read],
        *[f"--allow-fs-write={p}" for p in write],
        str(config.CONVERTER_DIR / "convert.mjs"),
        *args,
    ]


def _environment() -> dict:
    """The minimum, not the container's environment.

    Node's permission model does not cover environment variables, and the
    container's carries SCOREVIEW_SIDECAR_SECRET. A converter run on an
    untrusted score has no business reading it."""
    return {
        "PATH": "/usr/local/bin:/usr/bin:/bin",
        "LANG": "C.UTF-8",
        "HOME": str(Path(tempfile.gettempdir())),
    }


def _run(read: list[Path], write: list[Path], args: list[str], workdir: Path) -> str:
    """Runs convert.mjs and returns its one line of stdout.

    stdout and stderr go to anonymous files, as in musescore.run_score_media:
    nothing piles up in a pipe buffer, and a grandchild that survives the
    SIGKILL cannot block collecting the output."""
    with tempfile.TemporaryFile(dir=workdir) as out, tempfile.TemporaryFile(dir=workdir) as err:
        result = subprocess.run(
            _command(read, write, args),
            stdout=out, stderr=err, cwd=str(config.CONVERTER_DIR), env=_environment(),
        )
        if result.returncode == _KILLED_BY_SIGKILL:
            raise errors.ConversionError(
                errors.TIMEOUT,
                "the engine exceeded the time limit "
                f"(MSCORE_TIMEOUT_SECONDS={config.TIMEOUT_SECONDS}) and was killed",
            )
        if result.returncode != 0:
            # The exit code names the cause where the converter knows one
            # (a score without pages), the message is for people.
            raise errors.ConversionError(
                errors.CONVERTER_EXIT_CODES.get(result.returncode, errors.CONVERSION_FAILED),
                f"engine conversion failed: {last_line(_read_tail(err, 4000))}",
            )
        out.seek(0)
        return out.read(1024 * 1024).decode("utf-8", "replace")


def _read_tail(fh, limit: int) -> str:
    fh.seek(0, os.SEEK_END)
    size = fh.tell()
    fh.seek(max(0, size - limit))
    return fh.read().decode("utf-8", "replace")


def last_line(text: str) -> str:
    """The message line of a Node error: the last line that is not a stack
    frame. Node writes `Error: message` first and the `at ...` frames
    below; the last line would always be a frame (see
    LocalConverter::lastLine(), the same rule)."""
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    messages = [line for line in lines if not line.startswith("at ")]
    if messages:
        return messages[-1]
    return lines[-1] if lines else "no error output"


def convert(input_path: Path, out_dir: Path) -> list[Path]:
    """Base conversion into `out_dir`: page-1.svg ... page-N.svg plus
    BASE_FILES. Returns the pages in order."""
    out_dir.mkdir(parents=True, exist_ok=True)
    _run([input_path], [out_dir], [str(input_path), str(out_dir)], input_path.parent)
    return _pages(out_dir)


def convert_variant(input_path: Path, key: str, base_dir: Path, out_dir: Path) -> list[Path]:
    """A display variant (E19) into `out_dir`: pages plus VARIANT_FILES, no
    MIDI. `base_dir` holds the base's timing.json and measures.json; the
    converter checks the variant against them and writes nothing if it
    breaks an invariant."""
    out_dir.mkdir(parents=True, exist_ok=True)
    _run(
        [input_path, base_dir], [out_dir],
        ["--variant", key, "--base", str(base_dir), str(input_path), str(out_dir)],
        input_path.parent,
    )
    return _pages(out_dir)


def selftest(workdir: Path) -> dict:
    """`convert.mjs --selftest`: five scores bundled with the converter,
    checked for M2/M4/M7, M10, the score facts, lyrics, meters and display
    variants. Same answer shape as the MuseScore self-test."""
    output = _run([], [], ["--selftest"], workdir)
    try:
        result = json.loads(output)
    except ValueError as exc:
        raise RuntimeError(f"engine self-test answered without JSON: {output[:200]!r}") from exc
    if not isinstance(result, dict) or "ok" not in result:
        raise RuntimeError(f"engine self-test answered without an ok field: {output[:200]!r}")
    return result


def _pages(out_dir: Path) -> list[Path]:
    # Counted by number rather than a sorted listing: page-10 would sort
    # before page-2.
    pages = []
    number = 1
    while (out_dir / f"page-{number}.svg").is_file():
        pages.append(out_dir / f"page-{number}.svg")
        number += 1
    if not pages:
        raise errors.ConversionError(errors.NO_PAGES, "the engine returned no SVG page")
    return pages
