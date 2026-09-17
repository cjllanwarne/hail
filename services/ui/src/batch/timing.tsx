import { createRoot } from 'react-dom/client';
import { BatchTimingWidget } from './components/BatchTimingWidget';

const rootEl = document.getElementById('batch-timing-root');
if (rootEl) {
  const basePath = rootEl.dataset.basePath ?? '';
  const batchId = Number(rootEl.dataset.batchId);

  const root = createRoot(rootEl);
  root.render(
    <BatchTimingWidget
      basePath={basePath}
      batchId={batchId}
    />
  );
}
