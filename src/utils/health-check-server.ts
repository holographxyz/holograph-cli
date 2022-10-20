import {IncomingMessage, ServerResponse} from 'node:http'
import http from 'node:http'
import {Flags} from '@oclif/core'
import {NetworkMonitor} from './network-monitor'
import {portValidator} from './validation'

export const healthcheckFlag = {
  healthCheck: Flags.boolean({
    description: 'Launch server on http://localhost:6000 to make sure command is still running',
    default: false,
  }),
  healthCheckPort: Flags.integer({
    description: 'This flag allows you to choose what port the health check sever is running on.',
    default: 6000,
    dependsOn: ['healthCheck'],
  }),
}

type startHealthCheckServerProps = {
  networkMonitor: NetworkMonitor
  healthCheckPort?: number
}

export function startHealthcheckServer({networkMonitor, healthCheckPort}: startHealthCheckServerProps): void {
  const host = '0.0.0.0'
  const port = healthCheckPort ? healthCheckPort : 6000

  const server = http.createServer(function (req: IncomingMessage, res: ServerResponse) {
    res.setHeader('Content-Type', 'application/json')
    if (req.url === '/healthcheck') {
      const providerStatus = networkMonitor.getProviderStatus()
      res.writeHead(200)
      res.end(JSON.stringify({status: 'alive', providerStatus}))
    } else {
      res.writeHead(200)
      res.end(JSON.stringify({hello: 'evil person'}))
    }
  })

  server.listen(port, host, () => {
    console.log(`Server is running on http://${host}:${port}`)
  })
}
