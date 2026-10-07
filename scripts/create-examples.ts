import { mkdir, writeFile } from 'node:fs/promises';
import { cloneConfig } from '../src/core/config';
const examples = [
  { file: 'orbit', config: cloneConfig() },
  { file: 'sphere', config: cloneConfig() },
  { file: 'fixed-orientation', config: cloneConfig() },
  { file: 'outside-workspace', config: cloneConfig() },
  { file: 'unreachable', config: cloneConfig() },
];
examples[1].config.workspace.type = 'sphere';
examples[2].config.trajectory.orientation = true;
examples[3].config.workspace.min[2] = 0;
Object.assign(examples[3].config.trajectory, { duration: 0.4, step: 0.1 });
Object.assign(examples[4].config.trajectory, {
  x: '4000',
  y: '0',
  z: '400',
  duration: 0.4,
  step: 0.1,
});
await mkdir('examples', { recursive: true });
for (const { file, config } of examples) {
  config.name = file;
  await writeFile(`examples/${file}.json`, JSON.stringify(config, null, 2) + '\n');
}
