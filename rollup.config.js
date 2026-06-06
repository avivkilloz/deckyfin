import commonjs from '@rollup/plugin-commonjs';
import resolve from '@rollup/plugin-node-resolve';
import typescript from '@rollup/plugin-typescript';
import css from 'rollup-plugin-import-css';
import { defineConfig } from 'rollup';

export default defineConfig({
  input: './src/index.tsx',
  output: {
    file: './dist/index.js',
    format: 'esm',
    sourcemap: true,
    exports: 'default',
  },
  external: ['decky-frontend-lib'],
  plugins: [
    css(),
    resolve(),
    commonjs(),
    typescript(),
  ],
});
