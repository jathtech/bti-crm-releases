/* Builds a single self-contained HTML file (dist/index.html) with the CSS and all
   scripts inlined: handy for sharing, and the form the claude.ai artifact host
   expects (no external files, no document skeleton of its own). */
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
let html = read('index.html');
const body = html.slice(html.indexOf('<div id="app">'), html.indexOf('<script src='));
let css = read('css/style.css');
css = css.replace(/100dvh/g, '100%').replace(/100vh/g, '100%');
css = ':root { color-scheme: dark; }\n' + css;
const scripts = ['util', 'vehicle', 'physics', 'controller', 'sim', 'scenarios', 'render', 'main'].map(m => read('js/' + m + '.js')).join('\n');
const out = `<title>Burn Director</title>
<style>
${css}
</style>
${body}
<script>
${scripts}
</script>
`;
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'index.html'), out);
console.log('wrote dist/index.html', (out.length / 1024).toFixed(0) + ' KB');
