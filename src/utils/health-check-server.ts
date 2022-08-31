import {IncomingMessage, ServerResponse} from 'node:http'
import http from 'node:http'


export function startHealthcheckServer({ networkMonitor }: any): any {
  const host = '0.0.0.0'
  const port = 6000

  const server = http.createServer(function (req: IncomingMessage, res: ServerResponse) {
    res.setHeader('Content-Type', 'application/json')
    if (req.url === '/healthcheck') {
      const providerStatus =  networkMonitor.getProviderStatus()
      res.writeHead(200)
      res.end(JSON.stringify({status: 'alive', providerStatus }))
    } else {
      res.writeHead(200)
      res.end(JSON.stringify({hello: 'evil person'}))
    }
  })

  server.listen(port, host, () => {
    console.log(`Server is running on http://${host}:${port}`)
  })
}

