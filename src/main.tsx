import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { LineStudio } from './line/LineStudio';
import './styles.css';
function Studio() {
  const [page, setPage] = React.useState(window.location.hash);
  React.useEffect(() => {
    const change = () => setPage(window.location.hash);
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  return page === '#line' ? <LineStudio /> : <App />;
}
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Studio />
  </React.StrictMode>,
);
