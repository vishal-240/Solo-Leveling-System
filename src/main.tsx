import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { SlsDb } from './persist/store';
import './ui/tokens.css';

createRoot(document.getElementById('root')!).render(<StrictMode><App db={new SlsDb()} /></StrictMode>);
