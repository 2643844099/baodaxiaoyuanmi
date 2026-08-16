const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');
const tpl = fs.readFileSync('template.html', 'utf8');
const js = fs.readFileSync('game.js', 'utf8');

const problems = [];

// 1. 占位符应全部被替换
if (html.includes('<!-- THREE -->') || html.includes('<!-- GAME -->')) problems.push('placeholder remains');

// 2. script 标签数量应为 2
const scripts = (html.match(/<script>/g) || []).length;
if (scripts !== 2) problems.push('script count = ' + scripts);

// 3. 文件头尾完整
if (!html.trimStart().startsWith('<!DOCTYPE')) problems.push('missing DOCTYPE');
if (!html.trimEnd().endsWith('</html>')) problems.push('missing </html>');

// 4. JS 引用的所有 id 必须在 template 中存在
const ids = new Set();
for (const m of js.matchAll(/\$\('([^']+)'\)/g)) ids.add(m[1]);
for (const m of js.matchAll(/getElementById\('([^']+)'\)/g)) ids.add(m[1]);
for (const id of ids) {
  if (!tpl.includes('id="' + id + '"')) problems.push('missing element id: ' + id);
}

// 5. 危险序列检查(内联 script 中不允许)
if (js.includes('</script')) problems.push('js contains </script');

// 6. three.min.js 完整性
const three = fs.readFileSync('three.min.js', 'utf8');
if (!three.includes('THREE')) problems.push('three.min.js looks wrong');

console.log('referenced ids:', [...ids].sort().join(', '));
if (problems.length) {
  console.log('PROBLEMS:');
  problems.forEach((p) => console.log(' -', p));
  process.exit(1);
}
console.log('ALL CHECKS PASSED');
