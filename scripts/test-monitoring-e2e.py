"""Run the actual Electron-side HTTP client against a local Monitoraggio API and isolated DB.

Use Monitoraggio's Python environment: python scripts/test-monitoring-e2e.py /path/to/monitoraggio
"""
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

monitoraggio = Path(sys.argv[1]).resolve()
atlas = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix="atlas-monitoring-e2e-") as directory:
    env = {**os.environ, "MONITORAGGIO_DB_PATH": str(Path(directory) / "test.db"), "MONITORAGGIO_ALLOW_LOCAL_HTTP": "1"}
    os.environ.update({key: env[key] for key in ["MONITORAGGIO_DB_PATH", "MONITORAGGIO_ALLOW_LOCAL_HTTP"]})
    sys.path.insert(0, str(monitoraggio))
    from database.schema import init_db
    from database.connection import get_db
    from data.atlas_repo import create_integration, list_inbox, promote
    init_db()
    token = create_integration("Local E2E test")
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    with open(Path(directory) / "api.log", "w+") as log:
        server = subprocess.Popen([sys.executable, "-m", "uvicorn", "api:app", "--host", "127.0.0.1", "--port", str(port), "--no-proxy-headers"], cwd=monitoraggio, env=env, stdout=log, stderr=log)
        try:
            base = f"http://127.0.0.1:{port}"
            for attempt in range(100):
                try:
                    request = urllib.request.Request(base + "/api/v1/integration", headers={"Authorization": "Bearer " + token})
                    with urllib.request.urlopen(request, timeout=1) as response:
                        assert response.status == 200
                    break
                except Exception:
                    if server.poll() is not None:
                        log.seek(0)
                        raise RuntimeError(log.read())
                    time.sleep(0.1)
            else:
                raise RuntimeError("API did not become ready")
            result = subprocess.run(["node", "--import", "tsx", "--test", "--test-name-pattern=live local Monitoraggio", "tests/monitoring.test.ts"], cwd=atlas, env={**env, "MONITORING_LIVE_URL": base, "MONITORING_LIVE_TOKEN": token})
            if result.returncode:
                raise SystemExit(result.returncode)
            rows = list_inbox()
            assert len(rows) == 1 and rows[0]["payload"]["estimate"]["total_hours"] == 20
            conn = get_db()
            assert conn.execute("SELECT COUNT(*) FROM rapp_issues").fetchone()[0] == 0
            project = conn.execute("SELECT p.id FROM domini_progetti p JOIN domini_aree a ON a.id = p.area_id WHERE a.nome = 'AM' LIMIT 1").fetchone()
            user = conn.execute("SELECT id FROM users LIMIT 1").fetchone()[0]
            conn.execute("INSERT INTO rapp_applicativi (progetto_id, anno) VALUES (?, 2026)", (project["id"],))
            conn.commit()
            conn.close()
            inserted = promote(rows[0]["id"], rows[0]["fingerprint"], user_id=user, mese="2026-11", progetto_id=project["id"])
            conn = get_db()
            assert conn.execute("SELECT mese, stima_ore FROM rapp_issues WHERE id = ?", (inserted,)).fetchone()[:] == ("Novembre", 20)
            assert conn.execute("SELECT COUNT(*) FROM attivita").fetchone()[0] == 0
            assert conn.execute("SELECT COUNT(*) FROM ore_giornaliere").fetchone()[0] == 0
            conn.close()
            print("E2E passed: real TS client -> API -> isolated inbox -> manual November Rapportini AM issue; activities and daily hours untouched")
        finally:
            server.terminate()
            server.wait(timeout=10)
