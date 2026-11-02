// Sin hilos aparte en Android: quien los use cae en su modo "en el mismo hilo".
class Worker { constructor() { throw new Error('worker_threads no disponible en Android'); } }
module.exports = { Worker, isMainThread: true, parentPort: null, workerData: null };
