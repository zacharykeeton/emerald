"use strict";
/**
 * Copyright (c) 2020, Microsoft Corporation (MIT License).
 */
// emerald fix 1156: one conout worker for every pty, copied over node-pty 1.1.0's by scripts/patch-node-pty.mjs.
//
// What changed and why. node-pty starts one worker thread per pty to drain
// its conout pipe off the main thread (the deadlock in the comment on
// ConoutConnection below). Each worker is a whole V8 isolate, about 11 MB
// of a daemon's private bytes a pty, and a pty that exits on its own never
// disposes its worker (only kill() does), so a long-lived daemon kept one
// for every session that had ever exited. Here every ConoutConnection of
// the process shares one worker: the first connection starts it, each
// connection adds its pipe by message, and the leave that empties the map
// terminates it, so the next pty starts a fresh one. The out socket's
// `close` disposes the connection too, which is what a natural exit
// reaches.
//
// The risk, stated plainly: one worker now carries every pty's output. A
// stalled worker stops the drain of every pty at once, not one, and so can
// hold every pty at once in the ClosePseudoConsole deadlock the worker
// exists to avoid. A crashed worker takes the daemon down, as it did with a
// worker per pty, but now with every session's output behind it. One pty
// streaming hard shares the worker's event loop with all the others. An
// error on one pty's pipe is that pty's alone: the worker drops its entry
// and reports it, and this side raises a process warning named
// EmeraldConoutWarning, which emerald's daemon writes to its log.
//
// The constructor, onReady, dispose() and connectSocket() keep node-pty's
// API, so windowsPtyAgent.js is unchanged.
Object.defineProperty(exports, "__esModule", { value: true });
exports.conoutWorkerState = exports.ConoutConnection = void 0;
const worker_threads_1 = require("worker_threads");
const conout_1 = require("./shared/conout");
const path_1 = require("path");
const eventEmitter2_1 = require("./eventEmitter2");
/**
 * The amount of time to wait for additional data after the conpty shell process has exited before
 * shutting down the worker and sockets. The timer will be reset if a new data event comes in after
 * the timer has started.
 */
const FLUSH_DATA_INTERVAL = 1000;
// The process's one worker: null, or { worker, conns: Map<conoutPipeName, ConoutConnection> }.
let host = null;
function startHost() {
    const scriptPath = __dirname.replace('node_modules.asar', 'node_modules.asar.unpacked');
    const worker = new worker_threads_1.Worker(path_1.join(scriptPath, 'worker/conoutSocketWorker.js'));
    const h = { worker, conns: new Map() };
    worker.on('message', (message) => {
        const conn = message && typeof message.conoutPipeName === 'string' ? h.conns.get(message.conoutPipeName) : undefined;
        if (message && message.type === 'ready') {
            // A ready for a connection that has already left is dropped.
            if (conn !== undefined)
                conn._onReady.fire();
            return;
        }
        if (message && message.type === 'error') {
            process.emitWarning(`conout worker: ${message.conoutPipeName}: ${message.message}`, 'EmeraldConoutWarning');
            if (conn !== undefined)
                conn._leave();
            return;
        }
        console.warn('Unexpected ConoutWorkerMessage', message);
    });
    // No 'error' listener on purpose: an uncaught throw inside the worker
    // reaches the process's uncaughtException, as node-pty's own did.
    worker.on('exit', () => {
        if (host === h)
            host = null;
    });
    return h;
}
/**
 * Connects to and manages the lifecycle of the conout socket. This socket must be drained on
 * another thread in order to avoid deadlocks where Conpty waits for the out socket to drain
 * when `ClosePseudoConsole` is called. This happens when data is being written to the terminal when
 * the pty is closed.
 *
 * See also:
 * - https://github.com/microsoft/node-pty/issues/375
 * - https://github.com/microsoft/vscode/issues/76548
 * - https://github.com/microsoft/terminal/issues/1810
 * - https://docs.microsoft.com/en-us/windows/console/closepseudoconsole
 */
class ConoutConnection {
    constructor(_conoutPipeName, _useConptyDll) {
        this._conoutPipeName = _conoutPipeName;
        this._useConptyDll = _useConptyDll;
        this._isDisposed = false;
        this._left = false;
        this._drainTimeout = undefined;
        this._onReady = new eventEmitter2_1.EventEmitter2();
        if (host === null)
            host = startHost();
        this._host = host;
        this._host.conns.set(_conoutPipeName, this);
        this._host.worker.postMessage({ type: 'add', conoutPipeName: _conoutPipeName });
    }
    get onReady() { return this._onReady.event; }
    dispose() {
        if (!this._useConptyDll && this._isDisposed) {
            return;
        }
        this._isDisposed = true;
        // Drain all data from the socket before closing
        this._drainDataAndClose();
    }
    connectSocket(socket) {
        // A pty that exits on its own destroys its out socket and never calls
        // dispose(); its close is the one signal both exits reach.
        socket.once('close', () => this.dispose());
        socket.connect(conout_1.getWorkerPipeName(this._conoutPipeName));
    }
    _drainDataAndClose() {
        if (this._drainTimeout) {
            clearTimeout(this._drainTimeout);
        }
        this._drainTimeout = setTimeout(() => this._leave(), FLUSH_DATA_INTERVAL);
    }
    // Leaves the shared worker, once: the worker drops this pipe, or is
    // terminated when this was its last one.
    _leave() {
        if (this._left)
            return;
        this._left = true;
        this._isDisposed = true;
        if (this._drainTimeout) {
            clearTimeout(this._drainTimeout);
            this._drainTimeout = undefined;
        }
        const h = this._host;
        if (h.conns.get(this._conoutPipeName) === this)
            h.conns.delete(this._conoutPipeName);
        if (h.conns.size > 0) {
            h.worker.postMessage({ type: 'remove', conoutPipeName: this._conoutPipeName });
            return;
        }
        // The last one: a pty spawned while this worker terminates starts a
        // fresh one (conout pipe names are random per pty, so the two never meet).
        if (host === h)
            host = null;
        h.worker.terminate().catch(() => { });
    }
}
exports.ConoutConnection = ConoutConnection;
// Read by scripts/node-pty-conout.test.mjs and fix 1156's drivers, and by
// nothing in the daemon.
function conoutWorkerState() {
    return { live: host !== null, names: host === null ? [] : [...host.conns.keys()] };
}
exports.conoutWorkerState = conoutWorkerState;
