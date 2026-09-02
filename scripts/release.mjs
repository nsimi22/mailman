#!/usr/bin/env node
// Bump every workspace to the given version, commit, and tag it. Pushing the tag
// triggers .github/workflows/release.yml, which builds and publishes installers.
//   npm run release -- 0.2.0
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version ?? '')) {
  console.error('usage: npm run release -- <x.y.z>');
  process.exit(1);
}
if (execSync('git status --porcelain').toString().trim()) {
  console.error('working tree is not clean; commit or stash first');
  process.exit(1);
}
for (const file of ['package.json', 'server/package.json', 'client/package.json', 'desktop/package.json']) {
  const json = JSON.parse(readFileSync(file, 'utf8'));
  json.version = version;
  if (json.dependencies?.['@mailman/server']) json.dependencies['@mailman/server'] = version;
  writeFileSync(file, JSON.stringify(json, null, 2) + '\n');
}
execSync('npm install --package-lock-only --ignore-scripts', { stdio: 'inherit' });
execSync(`git commit -am "Release v${version}"`, { stdio: 'inherit' });
execSync(`git tag -a v${version} -m "v${version}"`, { stdio: 'inherit' });
console.log(`\nTagged v${version}. Now run:\n  git push && git push origin v${version}\n`);
