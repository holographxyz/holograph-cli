import * as fs from 'fs-extra'
import * as path from 'node:path'
import * as inquirer from 'inquirer'

import {CliUx, Command, Flags} from '@oclif/core'
import {ethers} from 'ethers'

import {CONFIG_FILE_NAME, ensureConfigFileIsValid} from '../../utils/config'
import {ConfigNetwork, ConfigNetworks} from '../../utils/config'

import color from '@oclif/color'

export default class Recover extends Command {
  static description = 'Attempt to re-run/recover a particular Operator Job'
  static examples = ['$ holo operator:recover --network="rinkeby" --tx="0x..."']
  static flags = {
    network: Flags.string({description: 'The network on which the transaction was executed'}),
    tx: Flags.string({description: 'The hash of transaction that we want to attempt to execute'}),
  }

  /**
   * Operator class variables
   */
  operatorAddress!: string

  abiCoder = ethers.utils.defaultAbiCoder
  holograph!: ethers.Contract
  operatorContract!: ethers.Contract
  HOLOGRAPH_ADDRESS = '0xD11a467dF6C80835A1223473aB9A48bF72eFCF4D'.toLowerCase()
  targetEvents: Record<string, string> = {
    AvailableJob: '0x6114b34f1f941c01691c47744b4fbc0dd9d542be34241ba84fc4c0bd9bef9b11',
    '0x6114b34f1f941c01691c47744b4fbc0dd9d542be34241ba84fc4c0bd9bef9b11': 'AvailableJob',
  }

  async run(): Promise<void> {
    this.log('Loading user configurations...')
    const configPath = path.join(this.config.configDir, CONFIG_FILE_NAME)
    const {userWallet, configFile} = await ensureConfigFileIsValid(configPath, undefined, true)
    this.log('User configurations loaded.')

    if (userWallet === undefined) {
      throw new Error('Wallet could not be unlocked')
    }

    const {flags} = await this.parse(Recover)

    const supportedNetworks: string[] = ['rinkeby', 'mumbai', 'fuji']
    let tx: string = flags.tx || ''
    let network: string = flags.network || ''

    if (network === '' || !supportedNetworks.includes(network)) {
      const txNetworkPrompt: any = await inquirer.prompt([
        {
          name: 'network',
          message: 'select the network to extract transaction details from',
          type: 'list',
          choices: supportedNetworks,
        },
      ])
      network = txNetworkPrompt.network
    }

    CliUx.ux.action.start('Loading transaction network RPC provider')
    const providerUrl: string = (configFile.networks[network as keyof ConfigNetworks] as ConfigNetwork).providerUrl
    const txNetworkProtocol = new URL(providerUrl).protocol
    let txNetworkProvider
    switch (txNetworkProtocol) {
      case 'https:':
        txNetworkProvider = new ethers.providers.JsonRpcProvider(providerUrl)
        break
      case 'wss:':
        txNetworkProvider = new ethers.providers.WebSocketProvider(providerUrl)
        break
      default:
        throw new Error('Unsupported RPC URL protocol -> ' + txNetworkProtocol)
    }

    const txNetworkWallet: ethers.Wallet = userWallet.connect(txNetworkProvider)
    CliUx.ux.action.stop()

    if (tx === '' || !/^0x[\da-f]{64}$/i.test(tx)) {
      const txPrompt: any = await inquirer.prompt([
        {
          name: 'tx',
          message: 'Enter the hash of transaction that deployed the contract',
          type: 'input',
          validate: async (input: string) => {
            return /^0x[\da-f]{64}$/i.test(input) ? true : 'Input is not a valid transaction hash'
          },
        },
      ])
      tx = txPrompt.tx
    }

    const holographABI = await fs.readJson('./src/abi/Holograph.json')
    this.holograph = new ethers.ContractFactory(holographABI, '0x', txNetworkWallet).attach(
      this.HOLOGRAPH_ADDRESS.toLowerCase(),
    )

    this.operatorAddress = (await this.holograph.getOperator()).toLowerCase()

    const holographOperatorABI = await fs.readJson('./src/abi/HolographOperator.json')
    this.operatorContract = new ethers.ContractFactory(holographOperatorABI, '0x', txNetworkWallet).attach(
      this.operatorAddress,
    )

    CliUx.ux.action.start('Retrieving transaction details from ' + network + ' network')
    const transaction = await txNetworkWallet.provider.getTransaction(tx)
    const receipt = await txNetworkWallet.provider.getTransactionReceipt(transaction.hash as string)
    CliUx.ux.action.stop()

    this.handleOperatorRequestEvents(transaction, receipt)
  }

  async handleOperatorRequestEvents(transaction: ethers.Transaction, receipt: ethers.ContractReceipt): Promise<void> {
    this.structuredLog(
      `Checking if Operator was sent a bridge job via the LayerZero Relayer at tx: ${transaction.hash}`,
    )
    let event = null
    if ('logs' in receipt && typeof receipt.logs !== 'undefined' && receipt.logs !== null) {
      for (let i = 0, l = receipt.logs.length; i < l; i++) {
        if (event === null) {
          const log = receipt.logs[i]
          if (
            log.address.toLowerCase() === this.operatorAddress &&
            log.topics.length > 0 &&
            log.topics[0] === this.targetEvents.AvailableJob
          ) {
            event = log.data
          } else {
            this.structuredLog(
              `LayerZero transaction is not relevant to AvailableJob event. ` +
                `Transaction was relayed to ${log.address} instead of ` +
                `The Operator at ${this.operatorAddress}`,
            )
          }
        }
      }

      if (event) {
        const payload = this.abiCoder.decode(['bytes'], event)[0]
        this.structuredLog(
          `HolographOperator received a new bridge job on ${transaction.chainId} with job payload: ${payload}\n`,
        )
        await this.executePayload(payload)
      }
    }
  }

  async executePayload(payload: string): Promise<void> {
    const operatorPrompt: any = await inquirer.prompt([
      {
        name: 'shouldContinue',
        message: `A transaction is ready for execution, would you like to operate?\n`,
        type: 'confirm',
        default: false,
      },
    ])
    const operate: boolean = operatorPrompt.shouldContinue

    if (operate) {
      CliUx.ux.action.start('Calculating gas amounts and prices')
      let gasLimit
      try {
        gasLimit = await this.operatorContract.estimateGas.executeJob(payload)
      } catch (error: any) {
        this.error(error.reason)
      }

      const gasPriceBase = await this.operatorContract.provider.getGasPrice()
      const gasPrice = gasPriceBase.add(gasPriceBase.div(ethers.BigNumber.from("4"))) // gasPrice = gasPriceBase * 1.25

      this.debug(`gas price is ${gasPrice}`)
      CliUx.ux.action.stop()
      this.log(
        'Transaction is estimated to cost a total of',
        ethers.utils.formatUnits(gasLimit.mul(gasPrice), 'ether'),
        'native gas tokens (in ether)',
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
        this.structuredLog('Dropping command, no blockchain transactions executed')
        this.structuredLog('No blockchain transactions executed')
        this.exit()
      }

      try {
        CliUx.ux.action.start('Sending transaction to mempool')
        const jobTx = await this.operatorContract.executeJob(payload, {
          gasPrice,
          gasLimit,
        })
        this.debug(jobTx)
        CliUx.ux.action.stop('Transaction hash is ' + jobTx.hash)

        CliUx.ux.action.start('Waiting for transaction to be mined and confirmed')
        const jobReceipt = await jobTx.wait()
        this.debug(jobReceipt)
        CliUx.ux.action.stop('Operator Job executed')
        this.structuredLog(`Transaction ${jobTx.hash} mined and confirmed`)
      } catch (error: any) {
        this.structuredLog(`Transaction failed to execute: ${error.reason}`)
        this.exit()
      }

      this.exit()
    } else {
      this.structuredLog('Dropped potential payload to execute')
    }

    // eslint-disable-next-line no-process-exit, unicorn/no-process-exit
    process.exit()
  }

  structuredLog(msg: string): void {
    const timestamp = new Date(Date.now()).toISOString()
    const timestampColor = color.keyword('green')

    this.log(`[${timestampColor(timestamp)}] ${msg}`)
  }
}
