import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import { initPwa } from './pwa/state';
import { SlsDb } from './persist/store';
import './ui/tokens.css';

initPwa(registerSW);
createRoot(document.getElementById('root')!).render(<StrictMode><App db={new SlsDb()} /></StrictMode>);
