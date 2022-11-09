import {IncomingMessage, ServerResponse} from 'node:http'
import http from 'node:http'

import {NetworkMonitor} from '../utils/network-monitor'
import {Config} from '@oclif/core'

type startHealthCheckServerProps = {
  networkMonitor: NetworkMonitor
  healthCheckPort?: number
  config: Config
}

class HealthCheckServer {
  private static _instance?: HealthCheckServer
  private readonly server: http.Server

  private constructor(options: startHealthCheckServerProps) {
    const {networkMonitor, healthCheckPort} = options

    const host = '0.0.0.0'
    const port = healthCheckPort ? healthCheckPort : 6000

    this.server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
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

    this.server.listen(port, host, () => {
      console.log(`Server is running on http://${host}:${port}`)
    })
  }

  static getInstance(options: startHealthCheckServerProps): HealthCheckServer {
    if (!HealthCheckServer._instance) HealthCheckServer._instance = new HealthCheckServer(options)

    return HealthCheckServer._instance
  }
}

const healthCheckHook = async function (options: startHealthCheckServerProps) {
  HealthCheckServer.getInstance(options)
}

export default healthCheckHook
