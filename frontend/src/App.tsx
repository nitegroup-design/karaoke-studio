import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { UploadPage } from './pages/UploadPage';
import { ThemeProvider } from './contexts/ThemeContext';
import { ErrorBoundary } from './components/ErrorBoundary';

const EditorPage = lazy(() => import('./pages/EditorPage').then((module) => ({ default: module.EditorPage })));
const PreviewPage = lazy(() => import('./pages/PreviewPage').then((module) => ({ default: module.PreviewPage })));

function App() {
  return (
    <ThemeProvider>
      <ErrorBoundary>
        <BrowserRouter>
          <Suspense fallback={<main className="processing-page" role="status">Đang mở studio…</main>}><Routes>
            <Route path="/" element={<UploadPage />} />
            <Route path="/editor/:songId" element={<EditorPage />} />
            <Route path="/preview/:songId" element={<PreviewPage />} />
          </Routes></Suspense>
        </BrowserRouter>
      </ErrorBoundary>
    </ThemeProvider>
  );
}

export default App;
