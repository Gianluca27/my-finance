import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './auth';
import '@fontsource-variable/schibsted-grotesk';
// Solo subsets latinos: la UI está en español, no hace falta cirílico/vietnamita.
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import '@fontsource/ibm-plex-mono/latin-600.css';
import '@fontsource/ibm-plex-mono/latin-ext-400.css';
import '@fontsource/ibm-plex-mono/latin-ext-500.css';
import '@fontsource/ibm-plex-mono/latin-ext-600.css';
// Newsreader: serif editorial para cifras grandes (roman) y rótulos de sección (itálica).
import '@fontsource/newsreader/latin-400.css';
import '@fontsource/newsreader/latin-500.css';
import '@fontsource/newsreader/latin-600.css';
import '@fontsource/newsreader/latin-400-italic.css';
import '@fontsource/newsreader/latin-500-italic.css';
import './styles.css';

// En producción el API vive en otro origen (Railway): abrir la conexión
// (DNS + TLS) apenas carga la página, antes del primer fetch.
const apiUrl = import.meta.env.VITE_API_URL;
if (apiUrl) {
  const link = document.createElement('link');
  link.rel = 'preconnect';
  link.href = new URL(apiUrl).origin;
  link.crossOrigin = 'anonymous';
  document.head.appendChild(link);
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
