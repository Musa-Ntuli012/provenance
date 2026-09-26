import React from 'react';
import ReactDOM from 'react-dom/client';

// Self-hosted fonts (fontsource), no external requests at runtime.
import '@fontsource/dm-serif-display/400.css';
import '@fontsource/cormorant-garamond/500-italic.css';
import '@fontsource/cormorant-garamond/600-italic.css';
import '@fontsource/montserrat/400.css';
import '@fontsource/montserrat/500.css';
import '@fontsource/montserrat/600.css';
import '@fontsource/montserrat/700.css';
import '@fontsource/dm-mono/400.css';
import '@fontsource/dm-mono/500.css';

import './styles/tokens.css';
import './styles/ui.css';
import './styles/app.css';

import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
