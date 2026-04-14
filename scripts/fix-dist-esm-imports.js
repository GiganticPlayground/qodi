#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { dirname, extname, join, resolve } from 'path';

const outDir = resolve(process.argv[2] ?? 'dist');

function listJsFiles(rootDir) {
  const files = [];

  for (const entry of readdirSync(rootDir)) {
    const fullPath = join(rootDir, entry);
    const stats = statSync(fullPath);

    if (stats.isDirectory()) {
      files.push(...listJsFiles(fullPath));
      continue;
    }

    if (stats.isFile() && extname(fullPath) === '.js') {
      files.push(fullPath);
    }
  }

  return files;
}

function hasKnownExtension(specifier) {
  return ['.js', '.mjs', '.cjs', '.json'].includes(extname(specifier));
}

function resolveReplacement(filePath, specifier) {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
    return specifier;
  }

  if (hasKnownExtension(specifier)) {
    return specifier;
  }

  const absoluteBase = resolve(dirname(filePath), specifier);

  if (existsSync(`${absoluteBase}.js`)) {
    return `${specifier}.js`;
  }

  if (existsSync(join(absoluteBase, 'index.js'))) {
    return `${specifier}/index.js`;
  }

  return specifier;
}

function rewriteImports(filePath) {
  const source = readFileSync(filePath, 'utf8');
  const pattern =
    /\b(?:import|export)\b[\s\S]*?\bfrom\s*['"](\.[^'"]*)['"]|import\s*\(\s*['"](\.[^'"]*)['"]\s*\)/g;

  const rewritten = source.replace(pattern, (match, staticSpecifier, dynamicSpecifier) => {
    const originalSpecifier = staticSpecifier ?? dynamicSpecifier;
    const nextSpecifier = resolveReplacement(filePath, originalSpecifier);

    if (nextSpecifier === originalSpecifier) {
      return match;
    }

    return match.replace(originalSpecifier, nextSpecifier);
  });

  if (rewritten !== source) {
    writeFileSync(filePath, rewritten, 'utf8');
  }
}

for (const filePath of listJsFiles(outDir)) {
  rewriteImports(filePath);
}
