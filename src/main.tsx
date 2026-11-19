import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { LocalProvider } from './components/LocalProvider';

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Root element #root tidak ditemukan');
}

createRoot(rootEl).render(
  <StrictMode>
    <LocalProvider>
      <App />
    </LocalProvider>
  </StrictMode>,
);
