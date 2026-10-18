// Optional fallback for environments that disallow esbuild's native subprocess.
// Uses the same TypeScript/React JSX semantics, with an unminified production bundle.
import { build } from 'vite';
import ts from 'typescript';

await build({
  configFile: false,
  esbuild: false,
  resolve: { preserveSymlinks: true },
  plugins: [{
    name: 'in-process-typescript',
    enforce: 'pre',
    transform(code, id) {
      const original = code;
      code = code.replaceAll('process.env.NODE_ENV', '"production"');
      if (!/\.tsx?$/.test(id) || id.includes('node_modules')) return code === original ? null : { code, map: null };
      const result = ts.transpileModule(code, {
        fileName: id,
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, sourceMap: true },
      });
      return { code: result.outputText, map: result.sourceMapText ? JSON.parse(result.sourceMapText) : null };
    },
  }],
  build: { target: 'esnext', minify: false, cssMinify: false },
});
