import { setStorageAdapter } from '@chappie/shared';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

setStorageAdapter(window.localStorage);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
