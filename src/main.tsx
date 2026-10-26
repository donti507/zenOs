import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { initClientMonitoring, captureClientError } from './lib/monitoring';

async function bootstrap() {
  const monitoring = await initClientMonitoring();
  createRoot(document.getElementById('root')!, monitoring ? {
    onUncaughtError: captureClientError,
    onCaughtError: captureClientError,
    onRecoverableError: captureClientError,
  } : undefined).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void bootstrap();
