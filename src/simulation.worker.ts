import { simulate } from './core/simulation';
import type { Config } from './core/types';
self.onmessage = (event: MessageEvent<Config>) => {
  try {
    const result = simulate(event.data, (progress) =>
      self.postMessage({ type: 'progress', progress }),
    );
    self.postMessage({ type: 'result', result });
  } catch (error) {
    self.postMessage({
      type: 'error',
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
