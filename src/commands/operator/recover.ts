import * as inquirer from 'inquirer'

import {CliUx, Command, Flags} from '@oclif/core'
import {ethers} from 'ethers'

import {ensureConfigFileIsValid} from '../../utils/config'
import networks from '../../utils/networks'

import {BlockJob, NetworkMonitor} from '../../utils/network-monitor'

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
  networkMonitor!: NetworkMonitor

  async fakeProcessor(job: BlockJob, transactions: ethers.providers.TransactionResponse[]): Promise<void> {
    this.networkMonitor.structuredLog(job.network, `This should not trigger: ${JSON.stringify(transactions,undefined,2)}`)
    Promise.resolve()
  }

  async run(): Promise<void> {
    this.log('Loading user configurations...')
    const {userWallet, configFile} = await ensureConfigFileIsValid(this.config.configDir, undefined, true)
    this.log('User configurations loaded.')

    this.networkMonitor = new NetworkMonitor({
      parent: this,
      configFile,
      debug: this.debug,
      processTransactions: this.fakeProcessor,
      userWallet
    })

    const {flags} = await this.parse(Recover)

    let tx: string = flags.tx || ''
    let network: string = flags.network || ''

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

    if (network === '' || !this.networkMonitor.networks.includes(network)) {
      const txNetworkPrompt: any = await inquirer.prompt([
        {
          name: 'network',
          message: 'select the network to extract transaction details from',
          type: 'list',
          choices: this.networkMonitor.networks,
        },
      ])
      network = txNetworkPrompt.network
    }

    CliUx.ux.action.start('Loading network RPC providers')
    await this.networkMonitor.initializeEthers()
    CliUx.ux.action.stop()

    CliUx.ux.action.start('Retrieving transaction details from ' + network + ' network')
    const transaction = await this.networkMonitor.providers[network].getTransaction(tx)
//    const receipt = await this.networkMonitor.providers[network].getTransactionReceipt(transaction.hash as string)
    CliUx.ux.action.stop()

    await this.processTransaction(network, transaction)
  }

  async processTransaction(network: string, transaction: ethers.providers.TransactionResponse): Promise<void> {
    this.networkMonitor.structuredLog(
      network,
      `Processing transaction ${transaction.hash} at block ${transaction.blockNumber}`,
    )
    const to: string | undefined = transaction.to?.toLowerCase()
    const from: string | undefined = transaction.from?.toLowerCase()
    switch (to) {
      case this.networkMonitor.bridgeAddress: {
        await this.handleBridgeOutEvent(transaction, network)

        break
      }

      default:
        if (from === this.networkMonitor.LAYERZERO_RECEIVERS[network]) {
          await this.handleAvailableOperatorJobEvent(transaction, network)
        } else {
          this.networkMonitor.structuredLog(
            network,
            `Function processTransaction stumbled on an unknown transaction ${transaction.hash}`,
          )
        }
    }
  }

  async handleBridgeOutEvent(transaction: ethers.providers.TransactionResponse, network: string): Promise<void> {
    const receipt = await this.networkMonitor.providers[network].getTransactionReceipt(transaction.hash)
    if (receipt === null) {
      throw new Error(`Could not get receipt for ${transaction.hash}`)
    }

    if (receipt.status === 1) {
      this.networkMonitor.structuredLog(network, `Checking if a bridge request was made at tx: ${transaction.hash}`)
      const operatorJobPayload = this.networkMonitor.decodePacketEvent(receipt)
      const operatorJobHash = operatorJobPayload === undefined ? undefined : ethers.utils.keccak256(operatorJobPayload)
      if (operatorJobHash === undefined) {
        this.networkMonitor.structuredLog(network, `Could not extract cross-chain packet for ${transaction.hash}`)
      } else {
        const bridgeTransaction: ethers.utils.TransactionDescription =
          this.networkMonitor.bridgeContract.interface.parseTransaction(transaction)
        const chainId: number = (await this.networkMonitor.interfacesContract.getChainId(2, ethers.BigNumber.from(bridgeTransaction.args.toChain), 1)).toNumber()
        let destinationNetwork: string | undefined
        const networkNames: string[] = Object.keys(networks)
        for (let i = 0, l = networkNames.length; i < l; i++) {
          const n = networks[networkNames[i]]
          if (n.chain as number === chainId) {
            destinationNetwork = networkNames[i]
            break
          }
        }

        if (destinationNetwork === undefined) {
          throw new Error('Failed to identify destination network from the bridge-out request')
        }

        this.networkMonitor.structuredLog(
          network,
          `Bridge-Out trasaction type: ${bridgeTransaction.name} -->> ${bridgeTransaction.args}`,
        )
        await this.executePayload(destinationNetwork, operatorJobPayload!)
      }
    }
  }

  async handleAvailableOperatorJobEvent(
    transaction: ethers.providers.TransactionResponse,
    network: string,
  ): Promise<void> {
    const receipt = await this.networkMonitor.providers[network].getTransactionReceipt(transaction.hash)
    if (receipt === null) {
      throw new Error(`Could not get receipt for ${transaction.hash}`)
    }

    if (receipt.status === 1) {
      this.networkMonitor.structuredLog(
        network,
        `Checking if Operator was sent a bridge job via the LayerZero Relayer at tx: ${transaction.hash}`,
      )
      const operatorJobPayload = this.networkMonitor.decodeAvailableJobEvent(receipt)
      const operatorJobHash = operatorJobPayload === undefined ? undefined : ethers.utils.keccak256(operatorJobPayload)
      if (operatorJobHash === undefined) {
        this.networkMonitor.structuredLog(network, `Could not extract relayer available job for ${transaction.hash}`)
      } else {
        this.networkMonitor.structuredLog(
          network,
          `HolographOperator received a new bridge job. The job payload hash is ${operatorJobHash}. The job payload is ${operatorJobPayload}`,
        )
        const bridgeTransaction = this.networkMonitor.bridgeContract.interface.parseTransaction({
          data: operatorJobPayload!,
          value: ethers.BigNumber.from('0'),
        })
        this.networkMonitor.structuredLog(
          network,
          `Bridge-In trasaction type: ${bridgeTransaction.name} -->> ${bridgeTransaction.args}`,
        )
        await this.executePayload(network, operatorJobPayload!)
      }
    }
  }

  async executePayload(network: string, payload: string): Promise<void> {
    // If the operator is in listen mode, payloads will not be executed
    // If the operator is in manual mode, the payload must be manually executed
    // If the operator is in auto mode, the payload will be executed automatically
    const operatorPrompt: any = await inquirer.prompt([
      {
        name: 'shouldContinue',
        message: `Transaction on ${network} is ready for execution, would you like to recover it?\n`,
        type: 'confirm',
        default: false,
      },
    ])
    const operate: boolean = operatorPrompt.shouldContinue

    if (operate) {
      const contract = this.networkMonitor.operatorContract.connect(this.networkMonitor.wallets[network])
      let gasLimit
      const tryGetGasLimit = async (): Promise<boolean> => {
        return new Promise<boolean>((resolve, _reject) => {
          const getGasLimit: NodeJS.Timeout = setInterval(async () => {
            try {
              gasLimit = await contract.estimateGas.executeJob(payload)
              clearInterval(getGasLimit)
              resolve(true)
            } catch (error: any) {
              switch (error.reason) {
                case 'execution reverted: HOLOGRAPH: already deployed': {
                  this.networkMonitor.structuredLog(network, 'HOLOGRAPH: already deployed')

                  break
                }

                case 'execution reverted: HOLOGRAPH: invalid job': {
                  this.networkMonitor.structuredLog(network, 'HOLOGRAPH: invalid job')

                  break
                }

                case 'execution reverted: HOLOGRAPH: not holographed': {
                  this.networkMonitor.structuredLog(network, 'HOLOGRAPH: not holographed')

                  break
                }

                default: {
                  this.networkMonitor.structuredLogError(network, error, contract.address)
                }
              }

              clearInterval(getGasLimit)
              resolve(false)
            }
          }, 1000) // every 1 second
        })
      }

      if (await tryGetGasLimit()) {
        const gasPrice = await contract.provider.getGasPrice()
        const jobRawTx = await contract.populateTransaction.executeJob(payload, {gasPrice, gasLimit})
        jobRawTx.nonce = this.networkMonitor.walletNonces[network]
        let jobTx!: ethers.providers.TransactionResponse
        const tryToSendTx = async (): Promise<boolean> => {
          return new Promise<boolean>((resolve, _reject) => {
            const getJobTx: NodeJS.Timeout = setInterval(async () => {
              jobTx = await this.networkMonitor.wallets[network].sendTransaction(jobRawTx)
              clearInterval(getJobTx)
              resolve(true)
            }, 1000) // every 1 second
          })
        }

        if (await tryToSendTx()) {
          this.debug(jobTx)
          this.networkMonitor.structuredLog(network, `Transaction hash is ${jobTx.hash}`)
          this.networkMonitor.walletNonces[network]++
          let jobReceipt: ethers.ContractReceipt
          const tryToGetTxReceipt = async (): Promise<void> => {
            return new Promise<void>((resolve, _reject) => {
              const getTxReceipt: NodeJS.Timeout = setInterval(async () => {
                jobReceipt = await this.networkMonitor.providers[network].getTransactionReceipt(jobTx.hash)
                if (jobReceipt !== null) {
                  this.debug(jobReceipt)
                  this.networkMonitor.structuredLog(network, `Transaction ${jobReceipt.transactionHash} mined and confirmed`)
                  clearInterval(getTxReceipt)
                  resolve()
                }
              }, 1000) // every 1 second
            })
          }

          await tryToGetTxReceipt()
        }
      }
    } else {
      this.networkMonitor.structuredLog(network, 'Dropped potential payload to execute')
    }

    // eslint-disable-next-line no-process-exit, unicorn/no-process-exit
    process.exit()
  }
}
