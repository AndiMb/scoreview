"""Clearing JOBS_DIR when the service starts.

The registry lives in memory; after a restart the reaper no longer knows
the directories of the jobs that were running or waiting, and each holds an
upload of up to MAX_UPLOAD_BYTES. The app has given up on those jobs and
submits again, so the start clears them.
"""

import pytest

from scoreview_sidecar import config, jobs


@pytest.fixture()
def jobs_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "JOBS_DIR", tmp_path)
    return tmp_path


def test_raeumt_verwaiste_jobordner_beim_start(jobs_dir):
    for job_id in ("a1", "b2"):
        (jobs_dir / job_id / "out").mkdir(parents=True)
        (jobs_dir / job_id / "input.mscz").write_bytes(b"x" * 10)

    assert jobs.clear_jobs_dir() == 2
    assert list(jobs_dir.iterdir()) == []


def test_laesst_lose_dateien_stehen(jobs_dir):
    # JOBS_DIR may be a mount that also holds other things; a stray file is
    # not a job.
    (jobs_dir / "notiz.txt").write_text("bleibt", encoding="utf-8")
    (jobs_dir / "c3").mkdir()

    assert jobs.clear_jobs_dir() == 1
    assert [p.name for p in jobs_dir.iterdir()] == ["notiz.txt"]


def test_ein_fehlendes_verzeichnis_ist_kein_fehler(jobs_dir):
    jobs_dir.rmdir()
    assert jobs.clear_jobs_dir() == 0


def test_der_einstiegspunkt_raeumt_vor_dem_ersten_auftrag(monkeypatch):
    # wsgi.py, not create_app(): the tests build an app per test against a
    # shared JOBS_DIR.
    import importlib
    import sys

    aufrufe = []
    monkeypatch.setattr(jobs, "clear_jobs_dir", lambda: aufrufe.append(True) or 0)
    monkeypatch.setattr("scoreview_sidecar.app.jobs.start_reaper", lambda: None)
    sys.modules.pop("wsgi", None)
    importlib.import_module("wsgi")
    sys.modules.pop("wsgi", None)

    assert aufrufe == [True]
