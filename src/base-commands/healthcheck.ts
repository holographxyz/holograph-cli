import {Command, Flags, Interfaces} from '@oclif/core'
import {portValidator} from '../utils/validation'

export abstract class HealthCheck extends Command {
  static flags = {
    healthCheck: Flags.boolean({
      description: 'Launch server on http://localhost:6000 to make sure command is still running',
      default: false,
    }),
    healthCheckPort: Flags.integer({
      description: 'This flag allows you to choose what port the health check sever is running on.',
      dependsOn: ['healthCheck'],
      default: 6000,
    }),
  }

  async init(): Promise<void> {
    await super.init()
    const {flags} = await this.parse(this.constructor as Interfaces.Command.Class)

    const enableHealthCheckServer = flags.healthCheck
    const healthCheckPort = flags.healthCheckPort

    if (enableHealthCheckServer && !portValidator(healthCheckPort)) {
      this.error('The port should be in the [3000, 65535] range.')
    }
  }
}
