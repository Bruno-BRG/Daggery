import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import CampaignGate from './CampaignGate';
import { ErrorBoundary } from './components/ErrorBoundary';
import './index.css';
import './owlbear.css';
import { readPreference } from './storage';

document.documentElement.dataset.theme = readPreference('daggery:style-version') === 'owlbear' && readPreference('daggery:theme') === 'light' ? 'light' : 'dark';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Missing #root element');

createRoot(rootElement).render(
  <StrictMode>
    <ErrorBoundary><CampaignGate /></ErrorBoundary>
  </StrictMode>,
);
