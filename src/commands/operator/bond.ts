import * as inquirer from 'inquirer'

import {CliUx, Command, Flags} from '@oclif/core'
import color from '@oclif/color'
import {networks, supportedShortNetworks} from '@holographxyz/networks'
import {WebSocketProvider, JsonRpcProvider} from '@ethersproject/providers'
import {BigNumber} from '@ethersproject/bignumber'
import {formatUnits} from '@ethersproject/units'

import CoreChainService from '../../services/core-chain-service'
import OperatorChainService from '../../services/operator-chain-service'
import TokenChainService from '../../services/token-chain-service'
import {PodBondAmounts} from '../../types/holograph-operator'
import {ConfigNetwork, ConfigNetworks, ensureConfigFileIsValid} from '../../utils/config'
import {toLong18} from '../../utils/utils'
import {checkOptionFlag} from '../../utils/validation'
import Operator from '.'

/**
 * Bond
 * Description: Bond and operator into a pod.
 */
export default class Bond extends Command {
  static description = 'Bond an operator into a pod'
  static examples = ['$ <%= config.bin %> <%= command.id %> --network <string> --pod <number> --amount <number>']
  static flags = {
    network: Flags.string({
      description: 'The network to bond to',
      options: supportedShortNetworks,
      char: 'n',
    }),
    pod: Flags.integer({
      description: 'Pod number to join',
    }),
    amount: Flags.integer({
      description: 'Amount of tokens to deposit',
    }),
  }

  /**
   * Command Entry Point
   */
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

    CliUx.ux.action.start('Loading destination network RPC provider')
    const destinationProviderUrl: string = (configFile.networks[network as keyof ConfigNetworks] as ConfigNetwork)
      .providerUrl
    const networkProtocol: string = new URL(destinationProviderUrl).protocol
    let provider
    switch (networkProtocol) {
      case 'https:':
        provider = new JsonRpcProvider(destinationProviderUrl)
        break
      case 'wss:':
        provider = new WebSocketProvider(destinationProviderUrl)
        break
      default:
        throw new Error('Unsupported RPC URL protocol -> ' + networkProtocol)
    }

    CliUx.ux.action.stop()

    CliUx.ux.action.start('Checking RPC connection')
    const listening = await provider.send('net_listening', [])
    CliUx.ux.action.stop()
    if (!listening) {
      throw new Error('RPC connection failed')
    }

    this.log('RPC connection successful')

    const wallet = userWallet?.connect(provider)

    // Setup the contracts and chain services
    const coreChainService = new CoreChainService(provider, wallet, networks[network].chain)
    await coreChainService.initialize()
    const tokenContract = await coreChainService.getUtilityToken()
    const tokenChainService = new TokenChainService(provider, wallet, networks[network].chain, tokenContract)
    const operatorContract = await coreChainService.getOperator()
    const operatorChainService = new OperatorChainService(provider, wallet, networks[network].chain, operatorContract)
    const operator = operatorChainService.operator

    const currentHlgBalance = (await tokenChainService.balanceOf(wallet.address)) as BigNumber
    this.log(`Current HLG balance: ${formatUnits(currentHlgBalance, 'ether')}`)

    if ((await operator.getBondedAmount(wallet.address)) > 0) {
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

      CliUx.ux.action.start(`Unbonding operator ${wallet.address} from network: ${network}`)
      const tx = await operator.unbondUtilityToken(wallet.address, wallet.address)
      await tx.wait()
      CliUx.ux.action.stop()

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
      // eslint-disable-next-line no-await-in-loop
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
      pod = Number.parseInt(prompt.pod.charAt(0), 10)
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
          message: `Enter the amount of tokens to deposit (Units in Ether)`,
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

    this.log(`Bonding from ${wallet.address} to pod ${pod} on network ${network} for ${amount} tokens`)

    CliUx.ux.action.start('Calculating gas amounts and prices')
    let gasLimit
    try {
      gasLimit = await operator.estimateGas.bondUtilityToken(wallet.address, toLong18(amount as number), pod)
    } catch (error: any) {
      this.error(error.reason)
    }

    const gasPriceBase = await wallet!.provider.getGasPrice()
    const gasPrice = gasPriceBase.add(gasPriceBase.div(BigNumber.from('4'))) // gasPrice = gasPriceBase * 1.25
    const estimatedGas = gasLimit.mul(gasPrice)
    CliUx.ux.action.stop()

    this.log(
      `Transaction is estimated to cost a total of ${formatUnits(
        estimatedGas,
        'ether',
      )} native gas tokens (in Ether units)`,
    )
    if (estimatedGas.gt(currentHlgBalance)) {
      this.log(
        'You do not have enough HLG to cover the gas cost. Please deposit more HLG into your wallet before bonding.',
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

    try {
      CliUx.ux.action.start('Sending transaction to mempool')
      const tx = await operator.bondUtilityToken(wallet.address, toLong18(amount as number), pod)
      this.debug(tx)
      CliUx.ux.action.stop('Transaction hash is ' + tx.hash)

      CliUx.ux.action.start('Waiting for transaction to be mined and confirmed')
      const receipt = await tx.wait()
      this.debug(receipt)
      CliUx.ux.action.stop(`Transaction mined and confirmed. Transaction hash is ${receipt.transactionHash}`)
    } catch (error: any) {
      this.error(error.error.reason)
    }

    this.log(
      color.green(
        `Welcome operator! Your wallet ${wallet.address} has bonded ${amount} eth to pod ${pod} on ${network} 🎉` +
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
