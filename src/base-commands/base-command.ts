import {Command, Flags, Interfaces} from '@oclif/core'
import {IncomingMessage, ServerResponse} from 'node:http'
import http from 'node:http'
import {portValidator} from '../utils/validation'
import {NetworkMonitor} from '../utils/network-monitor'

type startHealthCheckServerProps = {
  networkMonitor: NetworkMonitor
  healthCheckPort?: number
}

export class BaseCommand extends Command {
  static flags = {
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

  async run(): Promise<void> {
    const {flags} = await this.parse(BaseCommand)

    const enableHealthCheckServer = flags.healthCheck
    const healthCheckPort = flags.healthCheckPort

    if (enableHealthCheckServer) {
      if (!portValidator(healthCheckPort)) {
        this.error('The port should be in the [3000, 65535] range.')
      }
    }
  }
}
