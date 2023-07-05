import * as inquirer from 'inquirer'

import {CliUx, Command, Flags} from '@oclif/core'
import color from '@oclif/color'
import {networks} from '@holographxyz/networks'
import {BigNumber} from '@ethersproject/bignumber'
import {TransactionReceipt} from '@ethersproject/providers'
import {formatUnits} from '@ethersproject/units'

import CoreChainService from '../../services/core-chain-service'
import OperatorChainService from '../../services/operator-chain-service'
import TokenChainService from '../../services/token-chain-service'
import {PodBondAmounts} from '../../types/holograph-operator'
import {ensureConfigFileIsValid} from '../../utils/config'
import {NetworkMonitor, networkFlag} from '../../utils/network-monitor'
import {toLong18} from '../../utils/web3'
import {checkOptionFlag} from '../../utils/validation'
import Operator from '.'

/**
 * Bond
 * Description: Bond and operator into a pod.
 */
export default class Bond extends Command {
  static description = 'Bond in to a pod.'
  static examples = ['$ <%= config.bin %> <%= command.id %> --network <string> --pod <number> --amount <number>']
  static flags = {
    ...networkFlag,
    pod: Flags.integer({
      description: 'Pod number to join',
    }),
    amount: Flags.integer({
      description: 'Amount of tokens to deposit',
    }),
  }

  networkMonitor!: NetworkMonitor

  async run(): Promise<void> {
    const {flags} = await this.parse(Bond)
    let {pod, amount} = flags
    let prompt: any

    this.log(
      color.red(
        'WARNING: To bond you must first have an operator running with the same wallet on the chain you are bonding to. Failure to do so will result in a loss of funds.',
      ),
    )
    prompt = await inquirer.prompt([
      {
        name: 'continue',
        message:
          'Do you have the operator with the wallet you are bonding from running on the network and are ready to proceed?',
        type: 'confirm',
        default: false,
      },
    ])
    if (!prompt.continue) {
      this.log('Operator is not ready to bond, please start an operator first.')
      this.exit()
    }

    this.log('Loading user configurations...')
    const {userWallet, configFile, supportedNetworksOptions} = await ensureConfigFileIsValid(
      this.config.configDir,
      undefined,
      true,
    )

    const network: string = await checkOptionFlag(
      supportedNetworksOptions,
      flags.network,
      'Select the network to bond to',
    )

    this.log(`Joining network: ${networks[network].shortKey}`)

    this.networkMonitor = new NetworkMonitor({
      parent: this,
      configFile,
      networks: [network],
      debug: this.debug,
      userWallet,
      verbose: false,
    })

    CliUx.ux.action.start('Loading network RPC provider')
    await this.networkMonitor.run(true)
    CliUx.ux.action.stop()

    // Setup the contracts and chain services
    const coreChainService = new CoreChainService(network, this.networkMonitor)
    await coreChainService.initialize()
    const tokenContract = await coreChainService.getUtilityToken()
    const tokenChainService = new TokenChainService(network, this.networkMonitor, tokenContract)
    const operatorContract = await coreChainService.getOperator()
    const operatorChainService = new OperatorChainService(network, this.networkMonitor, operatorContract)
    const operator = operatorChainService.operator

    const currentHlgBalance = (await tokenChainService.balanceOf(coreChainService.wallet.address)) as BigNumber
    this.log(`Current HLG balance: ${formatUnits(currentHlgBalance, 'ether')}`)

    if ((await operator.getBondedAmount(coreChainService.wallet.address)) > 0) {
      prompt = await inquirer.prompt([
        {
          name: 'continue',
          message: 'You are already bonded on this network. Would you like to unbond?',
          type: 'confirm',
          default: true,
        },
      ])
      if (!prompt.continue) {
        this.log('You are already bonded on this network. Please unbond first.')
        this.exit()
      }

      this.log(`Unbonding operator ${coreChainService.wallet.address} from network: ${networks[network].shortKey}`)
      const unbondReceipt: TransactionReceipt | null = await operatorChainService.unbondUtilityToken()
      if (unbondReceipt === null) {
        this.log(color.red(`Could not confirm the success of unbonding transaction.`))
        this.exit()
      }

      prompt = await inquirer.prompt([
        {
          name: 'continue',
          message: 'Would you like to rebond?',
          type: 'confirm',
          default: true,
        },
      ])
      if (!prompt.continue) {
        this.log('Thank you. Come again.')
        this.exit()
      }
    }

    if (!currentHlgBalance.gt(BigNumber.from('0'))) {
      this.log('No HLG balance found, please deposit HLG into your wallet before bonding.')
      this.exit()
    }

    this.log('Checking pods available...')
    const totalPods = await operator.getTotalPods()
    this.log(`Total Pods: ${totalPods}`)

    // Get the bond amounts for each pod
    const allPodBondAmounts: PodBondAmounts[] = []
    for (let i = 1; i <= totalPods; i++) {
      allPodBondAmounts.push(await operator.getPodBondAmounts(i))
    }

    const podChoices: string[] = allPodBondAmounts.map((podBondAmounts, index) => {
      return `${index + 1} - ${formatUnits(podBondAmounts.current, 'ether')} HLG`
    })

    if (!pod) {
      prompt = await inquirer.prompt([
        {
          name: 'pod',
          message: 'Enter the pod number to join',
          type: 'list',
          choices: podChoices,
        },
      ])
      pod = Number.parseInt(prompt.pod.split(' - ')[0], 10)
      this.log(`Joining pod: ${pod}`)
    }

    const podBondAmounts: PodBondAmounts = await operator.getPodBondAmounts(pod)
    this.log(
      `Pod ${pod} has a base bond amount of ${formatUnits(
        podBondAmounts.base,
        'ether',
      )} and currently requires ${formatUnits(podBondAmounts.current, 'ether')} to bond.`,
    )
    this.log(`Enter an amount greater or equal to: ${formatUnits(podBondAmounts.current, 'ether')} to bond.`)

    if (!amount) {
      prompt = await inquirer.prompt([
        {
          name: 'amount',
          message: `Enter the amount of tokens to deposit (Units in ether)`,
          type: 'number',
          validate: async (input: number) => {
            const inputBN = BigNumber.from(toLong18(input))
            if (typeof input === 'number' && input > 0 && inputBN.gte(podBondAmounts.current)) {
              return true
            }

            return 'Input is not a valid bond amount'
          },
        },
      ])
      amount = prompt.amount
    }

    this.log(
      `Bonding from ${coreChainService.wallet.address} to pod ${pod} on ${networks[network].shortKey} network for ${amount} tokens`,
    )

    CliUx.ux.action.start('Calculating gas amounts and prices')
    const estimatedGas: BigNumber = await operatorChainService.estimateGasForBondUtilityToken(
      coreChainService.wallet.address,
      toLong18(amount as number),
      pod,
    )
    CliUx.ux.action.stop()

    this.log(
      `Transaction is estimated to cost a total of ${formatUnits(estimatedGas, 'ether')} ${
        networks[network].tokenSymbol
      }`,
    )
    if (estimatedGas.gt(await coreChainService.getBalance())) {
      this.log(
        `You do not have enough ${networks[network].tokenSymbol} to cover the transaction cost. Please deposit more ${networks[network].tokenSymbol} into your wallet before bonding.`,
      )
      this.exit()
    }

    prompt = await inquirer.prompt([
      {
        name: 'continue',
        message: 'Next steps submit the transaction, would you like to proceed?',
        type: 'confirm',
        default: true,
      },
    ])
    if (!prompt.continue) {
      this.log('Dropping command, no blockchain transactions executed')
      this.exit()
    }

    const receipt: TransactionReceipt | null = await operatorChainService.bondUtilityToken(
      coreChainService.wallet.address,
      toLong18(amount as number),
      pod,
    )

    if (receipt === null) {
      this.log(color.red(`Could not confirm the success of transaction.`))
      this.exit()
    }

    this.log(
      color.green(
        `Welcome operator! Your wallet ${coreChainService.wallet.address} has bonded ${amount} eth to pod ${pod} on ${networks[network].shortKey} 🎉` +
          `\nAgain please make sure your operator remains operational! ` +
          `Failure will result in slashed funds!`,
      ),
    )

    prompt = await inquirer.prompt([
      {
        name: 'continue',
        message: "Last chance to start your operator if you don't have it running already. Would you like to proceed?",
        type: 'confirm',
        default: true,
      },
    ])
    if (!prompt.continue) {
      this.log('Successfully bonded. Exiting...')
      this.exit()
    }

    await Operator.run(['--mode', 'auto'])
  }
}
