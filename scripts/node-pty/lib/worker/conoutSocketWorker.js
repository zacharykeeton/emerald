"use strict";
/**
 * Copyright (c) 2020, Microsoft Corporation (MIT License).
 */
// emerald fix 1156: one conout worker for every pty, copied over node-pty 1.1.0's by scripts/patch-node-pty.mjs.
//
// What changed and why. node-pty's worker served one conout pipe, named in
// its workerData, for the life of the thread. This one serves every pty of
// the process: the main side (windowsConoutConnection.js) posts
// { type: 'add' } and { type: 'remove' } with a conoutPipeName, and for each
// name the worker connects the conout pipe, serves it on `<pipe>-worker`,
// pipes it into every socket that connects there, and posts { type: 'ready' }
// once the server listens.
//
// The risk, stated plainly: this one thread now carries every pty's output.
// A stall here stops the drain of every pty at once and can hold every pty
// in the ClosePseudoConsole deadlock the worker exists to avoid; a throw
// here takes the daemon down with every session's output behind it. So an
// error on one pty's pipe or server closes that entry alone and is posted
// back as { type: 'error' }, and an error on one accepted socket destroys
// that socket alone. A remove never touches another name's entry.
Object.defineProperty(exports, "__esModule", { value: true });
const worker_threads_1 = require("worker_threads");
const net_1 = require("net");
const conout_1 = require("../shared/conout");
if (!worker_threads_1.parentPort) {
    throw new Error('worker_threads parentPort is null');
}
const parentPort = worker_threads_1.parentPort;
// conoutPipeName -> { conout: net.Socket, server: net.Server | null, clients: Set<net.Socket> }
const entries = new Map();
function close(name, entry) {
    if (entries.get(name) !== entry)
        return false;
    entries.delete(name);
    for (const client of entry.clients)
        client.destroy();
    entry.clients.clear();
    entry.conout.destroy();
    if (entry.server !== null)
        entry.server.close();
    return true;
}
function add(name) {
    if (entries.has(name))
        return;
    const conout = new net_1.Socket();
    const entry = { conout, server: null, clients: new Set() };
    entries.set(name, entry);
    const fail = (err) => {
        if (close(name, entry)) {
            parentPort.postMessage({ type: 'error', conoutPipeName: name, message: err && err.message ? err.message : String(err) });
        }
    };
    conout.setEncoding('utf8');
    conout.on('error', fail);
    conout.connect(name, () => {
        if (entries.get(name) !== entry)
            return;
        const server = net_1.createServer((workerSocket) => {
            entry.clients.add(workerSocket);
            // The main side's own end closing is how this socket normally goes.
            workerSocket.on('error', () => workerSocket.destroy());
            workerSocket.on('close', () => entry.clients.delete(workerSocket));
            conout.pipe(workerSocket);
        });
        entry.server = server;
        server.on('error', fail);
        server.listen(conout_1.getWorkerPipeName(name), () => {
            if (entries.get(name) !== entry)
                return;
            parentPort.postMessage({ type: 'ready', conoutPipeName: name });
        });
    });
}
parentPort.on('message', (message) => {
    if (!message || typeof message.conoutPipeName !== 'string')
        return;
    if (message.type === 'add') {
        add(message.conoutPipeName);
    }
    else if (message.type === 'remove') {
        const entry = entries.get(message.conoutPipeName);
        if (entry !== undefined)
            close(message.conoutPipeName, entry);
    }
});
