import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
let html = await readFile(new URL('index.html', import.meta.url), 'utf8');
const css = await readFile(new URL('style.css', import.meta.url), 'utf8') + '\n' + await readFile(new URL('brand.css', import.meta.url), 'utf8');
const model = (await readFile(new URL('model.js', import.meta.url), 'utf8')).replace(/^export /gm, '');
const app = (await readFile(new URL('app.js', import.meta.url), 'utf8')).replace(/^import .*from '\.\/model\.js';\n/m, '');
html = html.replace('<link rel="stylesheet" href="style.css">', () => `<style>${css}</style>`).replace('<link rel="stylesheet" href="brand.css">', '').replace('<script type="module" src="app.js"></script>', () => `<script>\n(() => {\n${model}\n${app}\n})();\n</script>`);
for (const [path, mime] of [
  ['assets/milo.png', 'image/png'],
  ['assets/kampawng-top-banner.jpg', 'image/jpeg'],
  ['assets/kampawng-texture-plaid.jpg', 'image/jpeg'],
  ['assets/kampawng-app-icon.png', 'image/png'],
  ['assets/LondrinaSolid-Light.ttf', 'font/ttf']
]) {
  const encoded = (await readFile(new URL(path, import.meta.url))).toString('base64');
  html = html.replaceAll(path, () => `data:${mime};base64,${encoded}`);
}
const license = (await readFile(new URL('assets/OFL-LondrinaSolid.txt', import.meta.url), 'utf8')).replaceAll('&', '&amp;').replaceAll('<', '&lt;');
html = html.replace('</body>', () => `<template id="font-license"><pre>${license}</pre></template>\n</body>`);
await mkdir(new URL('dist/', import.meta.url), { recursive: true });
for (const name of ['kampawng-demo.html', 'index.html']) {
  const next = new URL(`dist/.${name}.next`, import.meta.url);
  await writeFile(next, html);
  await rename(next, new URL(`dist/${name}`, import.meta.url));
}
console.log(`Portable demo built (${(Buffer.byteLength(html) / 1024 / 1024).toFixed(2)} MB). Open dist/kampawng-demo.html directly; no network is needed.`);
let sandbox = await readFile(new URL('sandbox.html', import.meta.url), 'utf8');
const sandboxApp = await readFile(new URL('sandbox.js', import.meta.url), 'utf8');
sandbox = sandbox.replace('<link rel="stylesheet" href="style.css">', () => `<style>${css}</style>`).replace('<link rel="stylesheet" href="brand.css">', '').replace('<script type="module" src="sandbox.js"></script>', () => `<script>\n(() => {\n${sandboxApp}\n})();\n</script>`);
for (const [path, mime] of [['assets/milo.png', 'image/png'], ['assets/kampawng-top-banner.jpg', 'image/jpeg'], ['assets/kampawng-texture-plaid.jpg', 'image/jpeg'], ['assets/kampawng-app-icon.png', 'image/png'], ['assets/LondrinaSolid-Light.ttf', 'font/ttf']]) {
  const encoded = (await readFile(new URL(path, import.meta.url))).toString('base64');
  sandbox = sandbox.replaceAll(path, () => `data:${mime};base64,${encoded}`);
}
sandbox = sandbox.replace('</body>', () => `<template id="font-license"><pre>${license}</pre></template></body>`);
await writeFile(new URL('dist/.sandbox.next', import.meta.url), sandbox);
await rename(new URL('dist/.sandbox.next', import.meta.url), new URL('dist/sandbox.html', import.meta.url));
console.log('API-backed sandbox page built separately; it requires the protected server.');
