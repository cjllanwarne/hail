import { createRoot } from 'react-dom/client';
import { getSystemPermissions } from './shared';
import { IndexPage } from './IndexPage';

const rootEl = document.getElementById('batch-driver-react-root');
if (rootEl) {
  const { page, basePath = '', csrfToken = '' } = rootEl.dataset;
  const root = createRoot(rootEl);

  if (page === 'index') {
    root.render(
      <IndexPage
        basePath={basePath}
        csrfToken={csrfToken}
        permissions={getSystemPermissions()}
      />,
    );
  }
}
