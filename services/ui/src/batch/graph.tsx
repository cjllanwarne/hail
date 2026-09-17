import { createRoot } from 'react-dom/client';
import { BatchGraphWidget } from './components/BatchGraphWidget';

const rootEl = document.getElementById('batch-graph-root');
if (rootEl) {
  const basePath = rootEl.dataset.basePath ?? '';
  const batchId = Number(rootEl.dataset.batchId);

  const root = createRoot(rootEl);
  root.render(
    <BatchGraphWidget
      basePath={basePath}
      batchId={batchId}
    />
  );
}
