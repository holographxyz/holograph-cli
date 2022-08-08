import {IncomingMessage, ServerResponse} from 'node:http'
import http from 'node:http'

const requestListener = function (req: IncomingMessage, res: ServerResponse) {
  res.setHeader('Content-Type', 'application/json')
  if (req.url === '/healthcheck') {
    res.writeHead(200)
    res.end(JSON.stringify({status: 'alive'}))
  } else {
    res.writeHead(200)
    res.end(JSON.stringify({hello: 'evil person'}))
  }
}

export function startHealthcheckServer(): void {
  const host = '0.0.0.0'
  const port = 6000
  const server = http.createServer(requestListener)

  server.listen(6000, host, () => {
    console.log(`Server is running on http://${host}:${port}`)
  })
}
