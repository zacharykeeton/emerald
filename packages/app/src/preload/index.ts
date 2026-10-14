import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { IpcRendererEvent } from 'electron';
import type { FireAndForget, HooksStatus, OpenExtra, RendererPush, EmeraldApi } from './api.ts';

const api: EmeraldApi = {
  files: {
    list: (dir, keep) => ipcRenderer.invoke('emerald:files-list', dir, keep),
    read: (path) => ipcRenderer.invoke('emerald:files-read', path),
    write: (path, text, format, stamp) => ipcRenderer.invoke('emerald:files-write', path, text, format, stamp),
    mkdir: (path) => ipcRenderer.invoke('emerald:files-mkdir', path),
    create: (path) => ipcRenderer.invoke('emerald:files-create', path),
    rename: (from, to) => ipcRenderer.invoke('emerald:files-rename', from, to),
    trash: (path) => ipcRenderer.invoke('emerald:files-trash', path),
    search: (root, needle, mode) => ipcRenderer.invoke('emerald:files-search', root, needle, mode),
    stopSearch: () => ipcRenderer.invoke('emerald:files-search-stop'),
    watch: (dirs) => ipcRenderer.invoke('emerald:files-watch', dirs),
    onChanged: (handler) => {
      const listener = (_event: IpcRendererEvent, dir: string, info?: { renamed: boolean }) => handler(dir, info);
      ipcRenderer.on('emerald:files-changed', listener);
      return () => ipcRenderer.off('emerald:files-changed', listener);
    },
    open: (path) => ipcRenderer.invoke('emerald:files-open', path),
    reveal: (path) => ipcRenderer.invoke('emerald:files-reveal', path),
    openFolder: (path) => ipcRenderer.invoke('emerald:files-open-folder', path),
    pathFor: (file) => webUtils.getPathForFile(file),
    stat: (path) => ipcRenderer.invoke('emerald:files-stat', path),
    openExternal: (url) => ipcRenderer.invoke('emerald:files-open-external', url),
    gitStatus: (dir) => ipcRenderer.invoke('emerald:files-git-status', dir),
    gitChanges: (dir) => ipcRenderer.invoke('emerald:files-git-changes', dir),
    gitLog: (dir) => ipcRenderer.invoke('emerald:files-git-log', dir),
    gitGraph: (dir, options) => ipcRenderer.invoke('emerald:files-git-graph', dir, options ?? {}),
    gitWatch: (dirs) => ipcRenderer.invoke('emerald:git-watch', dirs),
    gitInit: (dir) => ipcRenderer.invoke('emerald:git-init', dir),
    folderIcon: (dir) => ipcRenderer.invoke('emerald:folder-icon', dir),
    gitReview: (dir, base) => ipcRenderer.invoke('emerald:files-git-review', dir, base),
    gitShow: (dir, hash, rel) => ipcRenderer.invoke('emerald:files-git-show', dir, hash, rel),
    gitRevert: (dir, rel) => ipcRenderer.invoke('emerald:files-git-revert', dir, rel),
    onOpen: (handler) => {
      const listener = (_event: IpcRendererEvent, path: string, pane: boolean, extra?: OpenExtra) => handler(path, pane, extra ?? {});
      ipcRenderer.on('emerald:open-file', listener);
      // The main process holds a path that arrived before this (a launch
      // with a file) until the renderer says it is listening.
      ipcRenderer.send('emerald:open-file-ready');
      return () => ipcRenderer.off('emerald:open-file', listener);
    },
  },
  usage: {
    get: (ask) => ipcRenderer.invoke('emerald:usage-get', ask),
  },
  schemes: {
    list: () => ipcRenderer.invoke('emerald:schemes-list'),
  },
  notify: {
    post: (req) => ipcRenderer.send('emerald:notify', req),
    attention: (req) => ipcRenderer.send('emerald:attention', req),
    onClicked: (handler) => {
      const listener = (_event: IpcRendererEvent, sessionId: string) => handler(sessionId);
      ipcRenderer.on('emerald:notify-clicked', listener);
      return () => ipcRenderer.off('emerald:notify-clicked', listener);
    },
  },
  history: {
    scan: () => ipcRenderer.invoke('emerald:history-scan'),
    turns: (path) => ipcRenderer.invoke('emerald:history-turns', path),
    usage: (conversation, known) => ipcRenderer.invoke('emerald:history-usage', conversation, known),
    cost: (path) => ipcRenderer.invoke('emerald:history-cost', path),
    agentsRunning: (conversation) => ipcRenderer.invoke('emerald:history-agents', conversation),
    project: (dir) => ipcRenderer.invoke('emerald:history-project', dir),
    watch: (on) => ipcRenderer.invoke('emerald:history-watch', on),
    onChanged: (handler) => {
      const listener = () => handler();
      ipcRenderer.on('emerald:history-changed', listener);
      return () => ipcRenderer.off('emerald:history-changed', listener);
    },
  },
  clipboard: {
    read: () => ipcRenderer.invoke('emerald:clipboard-read'),
    write: (text) => ipcRenderer.invoke('emerald:clipboard-write', text),
    writeImage: (dataUrl) => ipcRenderer.invoke('emerald:clipboard-write-image', dataUrl),
  },
  whatsNew: {
    read: () => ipcRenderer.invoke('emerald:whats-new-read'),
  },
  update: {
    state: () => ipcRenderer.invoke('emerald:update-state'),
    act: () => ipcRenderer.invoke('emerald:update-act'),
  },
  info: () => ipcRenderer.invoke('emerald:info'),
  setSkin: (skin) => ipcRenderer.send('emerald:skin-set', skin),
  mainSkin: () => ipcRenderer.sendSync('emerald:skin-get'),
  pickFolder: (defaultPath) => ipcRenderer.invoke('emerald:pick-folder', defaultPath),
  pickFile: (defaultPath) => ipcRenderer.invoke('emerald:pick-file', defaultPath),
  hooksStatus: () => ipcRenderer.invoke('emerald:hooks-status'),
  hooksInstall: () => ipcRenderer.invoke('emerald:hooks-install'),
  hooksTest: () => ipcRenderer.invoke('emerald:hooks-test'),
  onHooksChanged: (handler) => {
    const listener = (_e: IpcRendererEvent, s: HooksStatus) => handler(s);
    ipcRenderer.on('emerald:hooks-changed', listener);
    return () => ipcRenderer.off('emerald:hooks-changed', listener);
  },
  restartDaemon: () => ipcRenderer.invoke('emerald:daemon-restart'),
  daemonInfo: () => ipcRenderer.invoke('emerald:daemon-info'),
  request: (type, body) => ipcRenderer.invoke('emerald:request', type, body),
  send: (msg: FireAndForget) => ipcRenderer.send('emerald:send', msg),
  on: (handler) => {
    const listener = (_event: IpcRendererEvent, msg: RendererPush) => handler(msg);
    ipcRenderer.on('emerald:message', listener);
    return () => ipcRenderer.off('emerald:message', listener);
  },
};

contextBridge.exposeInMainWorld('emerald', api);
