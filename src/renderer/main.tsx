import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AwsProfileProvider } from './context/AwsProfileContext';
import './styles/global.css';
import { configureMonaco } from './monacoSetup';

configureMonaco();

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element not found');
}

const root = createRoot(container);
root.render(
  <React.StrictMode>
    <AwsProfileProvider>
      <App />
    </AwsProfileProvider>
  </React.StrictMode>
);
