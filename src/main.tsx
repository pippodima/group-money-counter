import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { StorageProbe } from './screens/StorageProbe.js';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('missing #root');

createRoot(root).render(
  <StrictMode>
    <StorageProbe />
  </StrictMode>,
);
