import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { registerSW } from 'virtual:pwa-register';

// Registro del Service Worker para capacidades 100% offline sin recargas bruscas
registerSW({
  immediate: true,
  onNeedRefresh() {
    console.info('PWA: Nueva versión lista en caché.');
  },
  onOfflineReady() {
    console.info('PWA: App precacheada y lista para trabajar offline sin internet.');
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
