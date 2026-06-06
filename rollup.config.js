import commonjs from '@rollup/plugin-commonjs';
import resolve from '@rollup/plugin-node-resolve';
import typescript from '@rollup/plugin-typescript';
import replace from '@rollup/plugin-replace';
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
  external: ['decky-frontend-lib', 'react', 'react-dom'],
  plugins: [
    css(),
    resolve(),
    commonjs(),
    replace({
      'process.env.NODE_ENV': JSON.stringify('production'),
      preventAssignment: true,
    }),
    typescript(),
  ],
});
