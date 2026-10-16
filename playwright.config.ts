import {defineConfig,devices} from '@playwright/test';
import {existsSync} from 'node:fs';

const virtualenvPython=process.platform==='win32'?'.venv\\Scripts\\python.exe':'.venv/bin/python';
const pythonCommand=existsSync(virtualenvPython)?virtualenvPython:(process.platform==='win32'?'python':'python3');

export default defineConfig({
  testDir:'./e2e',
  fullyParallel:false,
  retries:process.env.CI?1:0,
  reporter:process.env.CI?'github':'list',
  use:{
    baseURL:'http://127.0.0.1:5173',
    trace:'retain-on-failure',
    ...devices['Desktop Chrome']
  },
  webServer:{
    command:`${pythonCommand} scripts/e2e_server.py`,
    url:'http://127.0.0.1:5173/api/health',
    reuseExistingServer:false,
    timeout:120_000
  }
});
