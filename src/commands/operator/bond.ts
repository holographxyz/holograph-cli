import * as inquirer from 'inquirer'
import * as fs from 'fs-extra'
import {CliUx, Command, Flags} from '@oclif/core'
import {BigNumber, BigNumberish, ethers} from 'ethers'

import {ConfigNetwork, ConfigNetworks, ensureConfigFileIsValid} from '../../utils/config'

import {networksFlag} from '../../utils/network-monitor'
import networks, {supportedNetworks} from '../../utils/networks'
import {getEnvironment} from '../../utils/environment'
import {toShort18} from '../../utils/contracts'
import {formatEther} from 'ethers/lib/utils'
import {PodBondAmounts} from '../../types/HolographOperator'
import CoreChainService from '../../services/CoreChainService'
import OperatorChainService from '../../services/OperatorChainService'

/**
 * Start
 * Description: The primary command for operating jobs on the Holograph network.
 */
export default class Bond extends Command {
  static description = 'Start an operator up into a pod'
  static examples = ['$ holo operator:start --network <string> --pod <number> --amount <number> --unsafePassword']
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
    unsafePassword: Flags.string({
      description: 'Enter the plain text password for the wallet in the holograph cli config',
    }),
    ...networksFlag,
  }

  /**
   * Command Entry Point
   */
  async run(): Promise<void> {
    const {flags} = await this.parse(Bond)

    // Check the flags
    let network = flags.network
    let pod = flags.pod
    let amount = flags.amount
    const unsafePassword = flags.unsafePassword

    this.log('Loading user configurations...')
    const environment = getEnvironment()
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

    const wallet = userWallet?.connect(provider)
    CliUx.ux.action.stop()

    // Setup the contract and chain services
    const coreChainService = new CoreChainService(provider, wallet, networks[network as string].chain)
    await coreChainService.initialize()
    const contract = await coreChainService.getOperator()
    const operatorChainService = new OperatorChainService(provider, wallet, networks[network as string].chain, contract)
    const operator = operatorChainService.operator

    const totalPods = await operator.getTotalPods()
    this.log(`Total Pods: ${totalPods}`)

    if (!pod) {
      const prompt: any = await inquirer.prompt([
        {
          name: 'pod',
          message: 'Enter the pod number to join',
          type: 'list',
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
      const prompt: any = await inquirer.prompt([
        {
          name: 'amount',
          message: `Enter the amount of tokens to deposit (Units in Ether)`,
          type: 'number',
          validate: async (input: number) => {
            if (typeof input === 'number' && input > 0 && input >= parseFloat(formatEther(podBoundAmounts.current))) {
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

    const blockchainPrompt: any = await inquirer.prompt([
      {
        name: 'shouldContinue',
        message: 'Next steps submit the transaction, would you like to proceed?',
        type: 'confirm',
        default: true,
      },
    ])
    if (!blockchainPrompt.shouldContinue) {
      this.error('Dropping command, no blockchain transactions executed')
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
