/**
 * main.tsx · 应用入口
 * ---------------------------------------------------------------
 * v2.0-α Phase A：用 AuthProvider 包裹，让全树都能 useAuth。
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider } from './auth/authContext';
import App from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
);
