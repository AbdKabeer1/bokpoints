import { App } from '../App';
import { ErrorBoundary } from './components/ErrorBoundary';

export function Root() {
  return (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}
