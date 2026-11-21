import { createGatewayServer } from './_server.js'

const server = createGatewayServer()

export default function handler(req: any, res: any) {
  return new Promise<void>((resolve, reject) => {
    res.once('finish', resolve)
    res.once('close', resolve)
    res.once('error', reject)
    server.emit('request', req, res)
  })
}
