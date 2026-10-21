// Starts the backend (port 4000) and the Vite dev server (port 3000) together.
// Open http://localhost:3000 while developing; Vite forwards /api to the backend.
import { spawn } from 'node:child_process';

const apps = [
  { name: 'backend ', dir: 'backend', color: '\x1b[36m' },
  { name: 'frontend', dir: 'frontend', color: '\x1b[35m' },
];

const children = apps.map(({ name, dir, color }) => {
  const child = spawn('npm', ['run', 'dev'], { cwd: dir, shell: true });
  const prefix = `${color}[${name}]\x1b[0m `;
  const pipe = (stream, out) => stream.on('data', chunk => {
    for (const line of chunk.toString().split(/\r?\n/)) {
      if (line.trim()) out.write(prefix + line + '\n');
    }
  });
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', code => {
    console.log(`${prefix}exited with code ${code}`);
    shutdown();
  });
  return child;
});

let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode === null) {
      // On Windows the npm shell must be killed with its whole process tree
      if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F']);
      else child.kill('SIGTERM');
    }
  }
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
