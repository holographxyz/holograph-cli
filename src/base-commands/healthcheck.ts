import {Flags, Interfaces} from '@oclif/core'
import {portValidator} from '../utils/validation'
import {BaseCommand} from './BaseCommand'

export abstract class HealthCheck extends BaseCommand {
  static flags = {
    healthCheck: Flags.boolean({
      description: 'Launch server on http://localhost:6000 to make sure command is still running',
      default: false,
    }),
    healthCheckPort: Flags.integer({
      description: 'This flag allows you to choose what port the health check sever is running on.',
      dependsOn: ['healthCheck'],
    }),
    ...BaseCommand.flags,
  }

  async init(): Promise<void> {
    await super.init()
    const {flags} = await this.parse(this.constructor as Interfaces.Command.Class)

    const enableHealthCheckServer = flags.healthCheck
    const healthCheckPort = flags.healthCheckPort || 6000

    if (enableHealthCheckServer && !portValidator(healthCheckPort)) {
      this.error('The port should be in the [3000, 65535] range.')
    }
  }
}
