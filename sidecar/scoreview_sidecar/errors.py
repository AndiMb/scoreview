"""Error codes a failed job reports, the same names on both renderers.

The app translates the code, not the message (docs/architecture.md E4),
and a score must read the same whichever path converted it (E3). The
status answer therefore carries ``errorCode`` beside ``error``; the names
are those of the app's ``ScoreConversion::ERROR_*``.

Only the codes the sidecar itself can tell apart. Everything a renderer
reports without one is ``conversion_failed`` - a fault of this score, not
of the service; the app's own codes for an unreachable or busy sidecar come
from the HTTP layer, not from here.
"""

NO_PAGES = "no_pages"
TIMEOUT = "timeout"
CONVERSION_FAILED = "conversion_failed"

# convert.mjs's exit codes that name a cause (scoreview/converter/lib/
# errors.mjs, the one list; tests/test_errors.py checks this copy against
# it). Every other non-zero exit is CONVERSION_FAILED.
CONVERTER_EXIT_CODES = {
    3: NO_PAGES,
}


class ConversionError(RuntimeError):
    """A failed conversion with the code the status answer reports."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def code_of(exc: BaseException) -> str:
    """The code for any exception a renderer raised."""
    return exc.code if isinstance(exc, ConversionError) else CONVERSION_FAILED
