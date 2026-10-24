"""Coverage-aware history: a gap (>= 15 min without any edit) restarts the history. Pure logic, no MongoDB.
Run: docker compose run --rm --no-deps --entrypoint python detector tests/test_coverage.py"""
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from radar_ingest.detector import Coverage  # noqa: E402

T = datetime(2026, 10, 15, 19, 0, tzinfo=timezone.utc)
mins = [T + timedelta(minutes=i) for i in range(0, 120)]                       # 2 h of data
mins += [T + timedelta(days=7) + timedelta(minutes=i) for i in range(0, 60)]    # after a 7-day hole
mins += [T + timedelta(days=7, hours=1, minutes=10) + timedelta(minutes=i) for i in range(0, 5)]  # 10-min hole = still covered
cov = Coverage(mins)
assert cov.segment_start(T + timedelta(minutes=90)) == T
assert cov.segment_start(T + timedelta(days=3)) is None                         # inside the hole
assert cov.segment_start(T + timedelta(days=7, minutes=30)) == T + timedelta(days=7)
assert cov.segment_start(T + timedelta(days=7, hours=1, minutes=12)) == T + timedelta(days=7)  # <15 min hole ignored
assert cov.segment_start(T - timedelta(hours=1)) is None
print("coverage tests passed")
