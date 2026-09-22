"""Local development launcher; production uses docker compose."""
import os,subprocess,sys
from pathlib import Path
root=Path(__file__).resolve().parents[1]
os.chdir(root)
env={**os.environ,'PYTHONPATH':str(root/'backend'),'QUEUE_MODE':'local','LOCAL_MODE':'true','APP_ORIGIN':'http://localhost:5173'}
subprocess.run([sys.executable,'scripts/bootstrap.py'],check=True,env=env)
subprocess.run([sys.executable,'-m','alembic','-c','backend/alembic.ini','upgrade','head'],check=True,env=env)
subprocess.run([sys.executable,'scripts/import_legacy.py'],check=True,env=env)
processes=[]
try:
    processes.append(subprocess.Popen([sys.executable,'-m','uvicorn','akis.main:app','--host','127.0.0.1','--port','8000','--no-access-log'],env=env))
    processes.append(subprocess.Popen(['node','node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5173'],env=env))
    print('Akış: http://localhost:5173/  (Ctrl+C to stop)',flush=True)
    for process in processes:
        if process.wait()!=0: raise RuntimeError('One service stopped. Check the output above.')
except KeyboardInterrupt: pass
finally:
    for process in processes:
        if process.poll() is None: process.terminate()
