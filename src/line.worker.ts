import { simulateLine } from './core/line/engine';
import type { LineConfig } from './core/line/types';
self.onmessage = (event: MessageEvent<LineConfig>) => {
  try {
    self.postMessage({ type: 'result', result: simulateLine(event.data) });
  } catch (error) {
    self.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
