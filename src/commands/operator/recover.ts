import * as inquirer from 'inquirer'

import {CliUx, Flags} from '@oclif/core'
import {BigNumber} from 'ethers'
import {TransactionResponse, TransactionReceipt} from '@ethersproject/abstract-provider'
import {TransactionDescription} from '@ethersproject/abi'
import {networks, supportedNetworks, supportedShortNetworks} from '@holographxyz/networks'

import {ensureConfigFileIsValid} from '../../utils/config'
import {NetworkMonitor} from '../../utils/network-monitor'
import {sha3} from '../../utils/utils'
import {checkOptionFlag, checkTransactionHashFlag} from '../../utils/validation'
import {OperatorJobAwareCommand} from '../../utils/operator-job'
import {HealthCheck} from '../../base-commands/healthcheck'

export default class Recover extends OperatorJobAwareCommand {
  static description = 'Attempt to re-run/recover a particular Operator Job'
  static examples = ['$ <%= config.bin %> <%= command.id %> --network="ethereumTestnetGoerli" --tx="0x..."']
  static flags = {
    network: Flags.string({
      description: 'The network on which the transaction was executed',
      options: supportedShortNetworks,
    }),
    tx: Flags.string({
      description: 'The hash of transaction that we want to attempt to execute',
    }),
    ...HealthCheck.flags,
  }

  /**
   * Command Entry Point
   */
  async run(): Promise<void> {
    await super.run()
    this.log('Loading user configurations...')
    const {userWallet, configFile, supportedNetworksOptions} = await ensureConfigFileIsValid(
      this.config.configDir,
      undefined,
      true,
    )
    this.log('User configurations loaded.')

    const {flags} = await this.parse(Recover)

    const network: string = await checkOptionFlag(
      supportedNetworksOptions,
      flags.network,
      'Select the network to extract transaction details from',
    )

    const tx: string = await checkTransactionHashFlag(
      flags.tx,
      'Enter the hash of transaction from which to extract recovery data from',
    )

    this.networkMonitor = new NetworkMonitor({
      parent: this,
      configFile,
      debug: this.debug,
      userWallet,
      verbose: false,
    })

    CliUx.ux.action.start('Loading network RPC providers')
    await this.networkMonitor.run(true)
    CliUx.ux.action.stop()

    CliUx.ux.action.start('Retrieving transaction details from ' + network + ' network')
    const transaction = await this.networkMonitor.getTransaction({
      transactionHash: tx,
      network,
      canFail: true,
      attempts: 30,
      interval: 500,
    })
    CliUx.ux.action.stop()

    if (transaction === null) {
      this.networkMonitor.structuredLog(network, 'Could not retrieve the transaction')
      // eslint-disable-next-line no-process-exit, unicorn/no-process-exit
      process.exit()
    } else {
      await this.processTransaction(network, transaction)
    }
  }

  /**
   * Process a transaction and attempt to either handle the bridge out or bridge in depending on the event emitted
   */
  async processTransaction(network: string, transaction: TransactionResponse): Promise<void> {
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

  /**
   * Handles the event emitted by the bridge contract when a token is bridged out
   */
  async handleBridgeOutEvent(transaction: TransactionResponse, network: string): Promise<void> {
    const receipt: TransactionReceipt | null = await this.networkMonitor.getTransactionReceipt({
      network,
      transactionHash: transaction.hash,
      attempts: 30,
      canFail: true,
    })
    if (receipt === null) {
      throw new Error(`Could not get receipt for ${transaction.hash}`)
    }

    if (receipt.status === 1) {
      this.networkMonitor.structuredLog(network, `Checking if a bridge request was made at tx: ${transaction.hash}`)
      const operatorJobPayload =
        this.networkMonitor.decodePacketEvent(receipt) ?? this.networkMonitor.decodeLzPacketEvent(receipt)
      const operatorJobHash = operatorJobPayload === undefined ? undefined : sha3(operatorJobPayload)
      if (operatorJobHash === undefined) {
        this.networkMonitor.structuredLog(network, `Could not extract cross-chain packet for ${transaction.hash}`)
      } else {
        const bridgeTransaction: TransactionDescription =
          this.networkMonitor.bridgeContract.interface.parseTransaction(transaction)
        const chainId: number = (
          await this.networkMonitor.interfacesContract.getChainId(2, BigNumber.from(bridgeTransaction.args.toChain), 1)
        ).toNumber()
        let destinationNetwork: string | undefined
        const networkNames: string[] = supportedNetworks
        for (let i = 0, l = networkNames.length; i < l; i++) {
          const n = networks[networkNames[i]]
          if ((n.chain as number) === chainId) {
            destinationNetwork = networkNames[i]
            break
          }
        }

        if (destinationNetwork === undefined) {
          throw new Error('Failed to identify destination network from the bridge-out request')
        }

        this.networkMonitor.structuredLog(
          network,
          `Bridge-Out transaction type: ${bridgeTransaction.name} -->> ${bridgeTransaction.args}`,
        )
        await this.executePayload(destinationNetwork, operatorJobPayload!)
      }
    }
  }

  /**
   * Handles the event emitted by the operator contract when a job is available and can be executed
   */
  async handleAvailableOperatorJobEvent(transaction: TransactionResponse, network: string): Promise<void> {
    const receipt: TransactionReceipt | null = await this.networkMonitor.getTransactionReceipt({
      network,
      transactionHash: transaction.hash,
      attempts: 30,
      canFail: true,
    })
    if (receipt === null) {
      throw new Error(`Could not get receipt for ${transaction.hash}`)
    }

    if (receipt.status === 1) {
      this.networkMonitor.structuredLog(
        network,
        `Checking if Operator was sent a bridge job via the LayerZero Relayer at tx: ${transaction.hash}`,
      )
      const operatorJobEvent: string[] | undefined = this.networkMonitor.decodeAvailableOperatorJobEvent(
        receipt,
        this.networkMonitor.operatorAddress,
      )
      const operatorJobPayload: string | undefined = operatorJobEvent === undefined ? undefined : operatorJobEvent![1]
      const operatorJobHash: string | undefined = operatorJobPayload === undefined ? undefined : operatorJobEvent![0]
      if (operatorJobHash === undefined) {
        this.networkMonitor.structuredLog(network, `Could not extract relayer available job for ${transaction.hash}`)
      } else {
        this.networkMonitor.structuredLog(
          network,
          `HolographOperator received a new bridge job. The job payload hash is ${operatorJobHash}. The job payload is ${operatorJobPayload}`,
        )
        const bridgeTransaction = this.networkMonitor.bridgeContract.interface.parseTransaction({
          data: operatorJobPayload!,
        })
        this.networkMonitor.structuredLog(
          network,
          `Bridge-In transaction type: ${bridgeTransaction.name} -->> ${bridgeTransaction.args}`,
        )
        await this.executePayload(network, operatorJobPayload!)
      }
    }
  }

  /**
   * Execute the payload on the destination network
   */
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
      await this.networkMonitor.executeTransaction({
        network,
        contract: this.networkMonitor.operatorContract,
        methodName: 'executeJob',
        args: [payload],
      })
    }

    // eslint-disable-next-line no-process-exit, unicorn/no-process-exit
    process.exit()
  }
}
