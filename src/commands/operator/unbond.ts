import * as inquirer from 'inquirer'

import {CliUx, Command} from '@oclif/core'
import color from '@oclif/color'
import {BigNumber} from '@ethersproject/bignumber'
import {TransactionReceipt} from '@ethersproject/providers'
import {formatUnits} from '@ethersproject/units'
const Table = require('cli-table3')

import CoreChainService from '../../services/core-chain-service'
import OperatorChainService from '../../services/operator-chain-service'
import {ensureConfigFileIsValid} from '../../utils/config'
import {NetworkMonitor} from '../../utils/network-monitor'
import {SelectOption} from '../../utils/validation'

interface NetworkBondInfo {
  networkOption: SelectOption
  bondedAmount: BigNumber
  operatorChainService: OperatorChainService
}

/**
 * Unbond
 * Description: Unbond an operator from pod.
 */
export default class Unbond extends Command {
  static description = 'Un-bond an operator from a pod'

  static examples = ['$ <%= config.bin %> <%= command.id %>']

  networkMonitor!: NetworkMonitor

  async getBondInfoFromNetwork(networkOption: SelectOption): Promise<NetworkBondInfo> {
    const network = networkOption.value

    CliUx.ux.action.start(`Loading ${networkOption.name} network RPC provider`)
    await this.networkMonitor.run(true)
    CliUx.ux.action.stop()

    // Setup the contracts and chain services
    const coreChainService = new CoreChainService(network, this.networkMonitor)
    await coreChainService.initialize()
    const operatorContract = await coreChainService.getOperator()
    const operatorChainService = new OperatorChainService(network, this.networkMonitor, operatorContract)
    const operator = operatorChainService.operator

    const bondedAmount = await operator.getBondedAmount(coreChainService.wallet.address)

    return {
      networkOption,
      bondedAmount,
      operatorChainService,
    }
  }

  async run(): Promise<void> {
    this.log('Loading user configurations...')
    const {userWallet, configFile, supportedNetworksOptions} = await ensureConfigFileIsValid(
      this.config.configDir,
      undefined,
      true,
    )

    this.networkMonitor = new NetworkMonitor({
      parent: this,
      configFile: configFile,
      networks: supportedNetworksOptions.map(networkOption => networkOption.value),
      debug: this.debug,
      userWallet: userWallet,
      verbose: false,
    })

    const networksBondInfo: any[] = []

    // instantiate
    const table = new Table({
      head: ['Network', 'Status', 'Bonded Amount'],
    })

    for (const networkOption of supportedNetworksOptions) {
      const info = await this.getBondInfoFromNetwork(networkOption)
      networksBondInfo.push(info)

      const status = info.bondedAmount.gt(BigNumber.from('0')) ? 'BONDED' : 'UNBONDED'

      table.push([info.networkOption.name, status, formatUnits(info.bondedAmount, 'ether')])
    }

    this.log(table.toString())

    const possibleNetworksToUnbond: NetworkBondInfo[] = networksBondInfo.filter(info =>
      info.bondedAmount.gt(BigNumber.from('0')),
    )

    if (possibleNetworksToUnbond.length === 0) {
      this.exit()
    }

    const prompt: any = await inquirer.prompt([
      {
        type: 'checkbox',

        name: 'networks',
        message: 'Which networks do you want to unbond?',
        choices: possibleNetworksToUnbond.map(networkInfo => networkInfo.networkOption),
        validate: async (input: any) => {
          if (input.length > 0) {
            return true
          }

          return 'Please select at least 1 network. Use the arrow keys and space-bar to select.'
        },
      },
    ])
    const providedNetworks = prompt.networks

    const selectedNetworksToUnbond = possibleNetworksToUnbond.filter(networkInfo =>
      providedNetworks.includes(networkInfo.networkOption.value),
    )

    for (const networkToUnbond of selectedNetworksToUnbond) {
      this.log(`Unbonding from network: ${networkToUnbond.networkOption.name}`)

      const unbondReceipt: TransactionReceipt | null = await networkToUnbond.operatorChainService.unbondUtilityToken()

      if (unbondReceipt === null) {
        this.log(color.red(`Could not confirm the success of unbonding transaction.`))
        this.exit()
      }

      this.log('Successfully unbonded. Exiting...')
      this.exit()
    }
  }
}
