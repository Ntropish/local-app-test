import OpfsWorker from './opfs-worker.ts?worker'
const sw = self as unknown as SharedWorkerGlobalScope

const ports = new Set<MessagePort>()
const opfsWorker = new OpfsWorker()

let opfsWorkerReady = false
const messageQueue: any[] = []

opfsWorker.onmessage = (e: MessageEvent) => {
  if (e.data.type === 'init-finished') {
    opfsWorkerReady = true
    while (messageQueue.length > 0) {
      opfsWorker.postMessage(messageQueue.shift())
    }
  }
  ports.forEach((p) => p.postMessage(e.data))
}

sw.addEventListener('connect', (e: MessageEvent) => {
  const port = e.ports[0]
  ports.add(port)

  port.onmessage = (msg: MessageEvent) => {
    if (opfsWorkerReady) {
      opfsWorker.postMessage(msg.data)
    } else {
      messageQueue.push(msg.data)
    }
  }
})
