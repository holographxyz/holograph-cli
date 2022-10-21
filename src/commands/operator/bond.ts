import * as inquirer from 'inquirer'
import {CliUx, Command, Flags} from '@oclif/core'
import {ethers} from 'ethers'

import {ConfigNetwork, ConfigNetworks, ensureConfigFileIsValid} from '../../utils/config'
import networks, {supportedNetworks} from '../../utils/networks'
import {toShort18} from '../../utils/contracts'
import {formatEther} from 'ethers/lib/utils'
import {PodBondAmounts} from '../../types/holograph-operator'
import CoreChainService from '../../services/core-chain-service'
import OperatorChainService from '../../services/operator-chain-service'
import color from '@oclif/color'

/**
 * Start
 * Description: The primary command for operating jobs on the Holograph network.
 */
export default class Bond extends Command {
  static description = 'Start an operator up into a pod'
  static examples = ['$ holo operator:start --network <string> --pod <number> --amount <number>']
  static flags = {
    network: Flags.string({
      description: 'The network to connect to',
      options: supportedNetworks,
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
    let {network, pod, amount} = flags
    let prompt: any

    this.log(
      color.red(
        'WARNING: To bond you must first have an operator running with the same wallet on the chain you are bonding to. Failure to do so will result in a loss of funds.',
      ),
    )
    if (!network) {
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
        // eslint-disable-next-line no-process-exit, unicorn/no-process-exit
        this.exit()
      }
    }

    this.log('Loading user configurations...')
    const {userWallet, configFile} = await ensureConfigFileIsValid(this.config.configDir, undefined, true)

    let remainingNetworks = supportedNetworks
    this.debug(`remainingNetworks = ${remainingNetworks}`)

    if (!network) {
      const networkPrompt: any = await inquirer.prompt([
        {
          name: 'network',
          message: 'Enter network to bond to',
          type: 'list',
          choices: remainingNetworks,
        },
      ])
      network = networkPrompt.network

      remainingNetworks = remainingNetworks.filter((item: string) => {
        return item !== network
      })
    }

    this.log(`Joining network: ${network}`)

    CliUx.ux.action.start('Loading destination network RPC provider')
    const destinationProviderUrl: string = (configFile.networks[network as keyof ConfigNetworks] as ConfigNetwork)
      .providerUrl
    const networkProtocol: string = new URL(destinationProviderUrl).protocol
    let provider
    switch (networkProtocol) {
      case 'https:':
        provider = new ethers.providers.JsonRpcProvider(destinationProviderUrl)
        break
      case 'wss:':
        provider = new ethers.providers.WebSocketProvider(destinationProviderUrl)
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

    // Setup the contract and chain services
    const coreChainService = new CoreChainService(provider, wallet, networks[network as string].chain)
    await coreChainService.initialize()
    const contract = await coreChainService.getOperator()
    const operatorChainService = new OperatorChainService(provider, wallet, networks[network as string].chain, contract)
    const operator = operatorChainService.operator

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

    this.log('Checking pods available...')
    const totalPods = await operator.getTotalPods()
    this.log(`Total Pods: ${totalPods}`)

    if (!pod) {
      prompt = await inquirer.prompt([
        {
          name: 'pod',
          message: 'Enter the pod number to join',
          type: 'list',
          // eslint-disable-next-line unicorn/new-for-builtins
          choices: [...Array(totalPods.toNumber() + 1).keys()].slice(1),
        },
      ])
      pod = prompt.pod
      this.log(`Joining pod: ${pod}`)
    }

    const podBoundAmounts: PodBondAmounts = await operator.getPodBondAmounts(pod)
    this.log(
      `Pod ${pod} has a base bond amount of ${formatEther(podBoundAmounts.base)} and currently requires ${formatEther(
        podBoundAmounts.current,
      )} to bond.`,
    )
    this.log(`Enter an amount greater or equal to: ${formatEther(podBoundAmounts.current)} to bond.`)

    if (!amount) {
      prompt = await inquirer.prompt([
        {
          name: 'amount',
          message: `Enter the amount of tokens to deposit (Units in Ether)`,
          type: 'number',
          validate: async (input: number) => {
            if (
              typeof input === 'number' &&
              input > 0 &&
              input >= Number.parseFloat(formatEther(podBoundAmounts.current))
            ) {
              return true
            }

            return 'Input is not a valid bond amount'
          },
        },
      ])
      amount = prompt.amount
      this.log(`Depositing ${amount} tokens`)
    }

    this.log(`Bonding from ${wallet.address} to pod ${pod} on network ${network} for ${amount} tokens`)

    CliUx.ux.action.start('Calculating gas amounts and prices')
    let gasLimit
    try {
      gasLimit = await operator.estimateGas.bondUtilityToken(wallet.address, toShort18(amount as number), pod)
    } catch (error: any) {
      this.error(error.reason)
    }

    const gasPriceBase = await wallet!.provider.getGasPrice()
    const gasPrice = gasPriceBase.add(gasPriceBase.div(ethers.BigNumber.from('4'))) // gasPrice = gasPriceBase * 1.25

    CliUx.ux.action.stop()
    this.log(
      'Transaction is estimated to cost a total of',
      ethers.utils.formatUnits(gasLimit.mul(gasPrice), 'ether'),
      'native gas tokens (in Ether)',
    )

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
      const tx = await operator.bondUtilityToken(wallet.address, toShort18(amount as number), pod)
      this.debug(tx)
      CliUx.ux.action.stop('Transaction hash is ' + tx.hash)

      CliUx.ux.action.start('Waiting for transaction to be mined and confirmed')
      const receipt = await tx.wait()
      this.debug(receipt)
      console.log(receipt)
      CliUx.ux.action.stop(`Transaction mined and confirmed. Transaction hash is ${receipt.transactionHash}`)
    } catch (error: any) {
      this.error(error.error.reason)
    }

    this.exit()
  }
}
