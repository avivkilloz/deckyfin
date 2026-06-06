import commonjs from '@rollup/plugin-commonjs';
import resolve from '@rollup/plugin-node-resolve';
import typescript from '@rollup/plugin-typescript';
import replace from '@rollup/plugin-replace';
import externalGlobals from 'rollup-plugin-external-globals';
import del from 'rollup-plugin-delete';
import css from 'rollup-plugin-import-css';
import { defineConfig } from 'rollup';

export default defineConfig({
  input: './src/index.tsx',
  output: {
    dir: 'dist',
    format: 'esm',
    sourcemap: true,
    exports: 'default',
  },
  context: 'window',
  external: ['decky-frontend-lib', 'react', 'react-dom', 'react/jsx-runtime'],
  plugins: [
    del({ targets: 'dist/*', force: true }),
    css(),
    resolve({
      browser: true,
    }),
    commonjs(),
    externalGlobals({
      react: 'SP_REACT',
      'react-dom': 'SP_REACTDOM',
      'react/jsx-runtime': 'SP_JSX',
      'decky-frontend-lib': 'DFL',
    }),
    replace({
      'process.env.NODE_ENV': JSON.stringify('production'),
      preventAssignment: true,
    }),
    typescript(),
  ],
});
