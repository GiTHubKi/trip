/**
 * 生成完全独立的单文件版本 index.standalone.html（把 css/style.css 与 js/app.js 内联进去）。
 *
 * 用法（可选，日常使用不需要执行）：
 *   node build-standalone.js
 *
 * 说明：多文件版 index.html 才是主版本；单文件版仅用于「只想发一个 html 给别人」的场景。
 */
const fs = require('fs');
const path = require('path');

const root = __dirname;
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');
const js = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');

// 防止脚本内容中出现 </script> 提前闭合标签（当前代码中没有，仅作保险）
const safeJs = js.replace(/<\/script>/gi, '<\\/script>');

const out = html
  .replace(
    '<link rel="stylesheet" href="css/style.css">',
    '<style>\n' + css + '\n</style>'
  )
  .replace(
    '<script src="js/app.js"></script>',
    '<script>\n' + safeJs + '\n</script>'
  )
  .replace(
    '<title>婴儿车选购评分器</title>',
    '<title>婴儿车选购评分器（单文件版）</title>'
  );

if (out.indexOf('<style>') < 0 || out.indexOf('css/style.css') >= 0) {
  console.error('内联失败：未找到样式引用，请检查 index.html');
  process.exit(1);
}

fs.writeFileSync(path.join(root, 'index.standalone.html'), out, 'utf8');
console.log('已生成 index.standalone.html（' + (Buffer.byteLength(out) / 1024).toFixed(1) + ' KB）');
