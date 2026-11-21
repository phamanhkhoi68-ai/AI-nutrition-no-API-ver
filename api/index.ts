import { createGatewayServer } from '../server/index.js'

const server = createGatewayServer()

export default function handler(req: any, res: any) {
  return server.emit('request', req, res)
}
