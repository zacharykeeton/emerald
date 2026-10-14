/// <reference types="vite/client" />
import type { Environment } from 'monaco-editor/editor/editor.api.js';
import type { EmeraldApi } from '../../preload/api.ts';

declare global {
  interface Window {
    emerald: EmeraldApi;
    // Where Monaco looks for its worker factory (monaco.ts sets it).
    MonacoEnvironment?: Environment;
  }
}
