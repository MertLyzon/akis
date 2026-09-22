import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath,URL} from 'node:url';
export default defineConfig({plugins:[react()],resolve:{alias:{'@':fileURLToPath(new URL('.',import.meta.url))}},// Phones running `tauri android/ios dev` reach the dev server over the LAN via TAURI_DEV_HOST.
server:{host:process.env.TAURI_DEV_HOST||'127.0.0.1',port:5173,strictPort:true,proxy:{'/api':{target:'http://127.0.0.1:8000',changeOrigin:false}}},clearScreen:false,envPrefix:['VITE_','TAURI_ENV_'],build:{outDir:'dist',emptyOutDir:true,target:process.env.TAURI_ENV_PLATFORM==='windows'?'chrome105':'safari15'}});
