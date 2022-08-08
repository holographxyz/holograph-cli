import * as path from 'node:path'
import axios from 'axios'

import {CliUx, Command, Flags} from '@oclif/core'
import {ethers} from 'ethers'

import {CONFIG_FILE_NAME, ensureConfigFileIsValid} from '../../utils/config'
import networks from '../../utils/networks'

import {decodeDeploymentConfig, decodeDeploymentConfigInput, capitalize} from '../../utils/utils'
import {warpFlag, OperatorMode, BlockJob, NetworkMonitor} from '../../utils/network-monitor'
import {startHealthcheckServer} from '../../utils/health-check-server'

import color from '@oclif/color'
import dotenv from 'dotenv'
dotenv.config()

export default class Indexer extends Command {
  static LAST_BLOCKS_FILE_NAME = 'indexer-blocks.json'
  static description = 'Listen for EVM events and update database network status'
  static examples = ['$ holo indexer --networks="rinkeby mumbai fuji" --mode=auto']
  static flags = {
    networks: Flags.string({description: 'Comma separated list of networks to operate to', multiple: true}),
    mode: Flags.string({
      description: 'The mode in which to run the indexer',
      options: ['listen', 'manual', 'auto'],
      char: 'm',
    }),
    host: Flags.string({description: 'The host to listen on', char: 'h', default: 'http://localhost:9001'}),
    healthCheck: Flags.boolean({
      description: 'Launch server on http://localhost:6000 to make sure command is still running',
      default: false,
    }),
    ...warpFlag,
  }

  /**
   * Indexer class variables
   */
  // API Params
  baseUrl!: string
  JWT!: string

  operatorMode: OperatorMode = OperatorMode.listen

  networkMonitor!: NetworkMonitor

  async run(): Promise<void> {
    this.log(`Operator command has begun!!!`)
    const {flags} = await this.parse(Indexer)
    this.baseUrl = flags.host
    const enableHealthCheckServer = flags.healthCheck

    this.log(`API: Authenticating with ${this.baseUrl}`)
    let res
    try {
      res = await axios.post(`${this.baseUrl}/v1/auth/operator`, {
        hash: process.env.OPERATOR_API_KEY,
      })
      this.debug(res)
    } catch (error: any) {
      this.error(error.message)
    }

    this.JWT = res!.data.accessToken
    this.log(res.data)

    if (typeof this.JWT === 'undefined') {
      this.error('Failed to authorize as an operator')
    }

    this.log(`process.env.OPERATOR_API_KEY = ${process.env.OPERATOR_API_KEY}`)
    this.log(`this.JWT = ${this.JWT}`)

    // Indexer always runs in listen mode
    this.log(`Indexer mode: ${this.operatorMode}`)

    this.log('Loading user configurations...')
    const configPath = path.join(this.config.configDir, CONFIG_FILE_NAME)
    const {configFile} = await ensureConfigFileIsValid(configPath, undefined, false)
    this.log('User configurations loaded.')

    // Load defaults for the networks from the config file
    if (flags.networks === undefined || '') {
      flags.networks = Object.keys(configFile.networks)
    }

    const blockJobs: {[key: string]: BlockJob[]} = {}

    for (let i = 0, l = flags.networks.length; i < l; i++) {
      const network = flags.networks[i]
      if (Object.keys(configFile.networks).includes(network)) {
        blockJobs[network] = []
      } else {
        // If network is not supported remove it from the array
        flags.networks.splice(i, 1)
        l--
        i--
      }
    }

    this.networkMonitor = new NetworkMonitor({
      parent: this,
      configFile,
      networks: flags.networks,
      debug: this.debug,
      processBlock: this.processBlock,
      lastBlockFilename: 'indexer-blocks.json',
      warp: flags.warp,
    })

    // Indexer always synchronizes missed blocks
    this.networkMonitor.latestBlockHeight = await this.networkMonitor.loadLastBlocks(this.config.configDir)

    CliUx.ux.action.start(`Starting indexer in mode: ${OperatorMode[this.operatorMode]}`)
    await this.networkMonitor.run(!(flags.warp > 0), blockJobs)
    CliUx.ux.action.stop('🚀')

    // Start server
    if (enableHealthCheckServer) {
      startHealthcheckServer()
    }
  }

  async processBlock(job: BlockJob): Promise<void> {
    this.networkMonitor.structuredLog(job.network, `Processing Block ${job.block}`)
    const block = await this.networkMonitor.providers[job.network].getBlockWithTransactions(job.block)
    if (block !== null && 'transactions' in block) {
      if (block.transactions.length === 0) {
        this.networkMonitor.structuredLog(job.network, `Zero block transactions for block ${job.block}`)
      }

      const interestingTransactions = []
      for (let i = 0, l = block.transactions.length; i < l; i++) {
        const transaction = block.transactions[i]
        if (transaction.from.toLowerCase() === this.networkMonitor.LAYERZERO_RECEIVERS[job.network]) {
          // We have LayerZero call, need to check it it's directed towards Holograph operators
          interestingTransactions.push(transaction)
        } else if ('to' in transaction && transaction.to !== null && transaction.to !== '') {
          const to: string = transaction.to!.toLowerCase()
          // Check if it's a factory call
          if (to === this.networkMonitor.factoryAddress || to === this.networkMonitor.operatorAddress) {
            // We have a potential factory deployment or operator bridge transaction
            interestingTransactions.push(transaction)
          }
        }
      }

      if (interestingTransactions.length > 0) {
        this.networkMonitor.structuredLog(
          job.network,
          `Found ${interestingTransactions.length} interesting transactions on block ${job.block}`,
        )
        this.processTransactions(job, interestingTransactions)
      } else {
        this.networkMonitor.blockJobHandler(job.network, job)
      }
    } else {
      this.networkMonitor.structuredLog(job.network, `${job.network} ${color.red('Dropped block!')} ${job.block}`)
      this.networkMonitor.blockJobs[job.network].unshift(job)
      this.networkMonitor.blockJobHandler(job.network)
    }
  }

  async processTransactions(job: BlockJob, transactions: ethers.Transaction[]): Promise<void> {
    /* eslint-disable no-await-in-loop */
    if (transactions.length > 0) {
      for (const transaction of transactions) {
        const receipt = await this.networkMonitor.providers[job.network].getTransactionReceipt(
          transaction.hash as string,
        )
        if (receipt === null) {
          throw new Error(`Could not get receipt for ${transaction.hash}`)
        }

        this.debug(`Processing transaction ${transaction.hash} on ${job.network} at block ${receipt.blockNumber}`)
        if (transaction.to?.toLowerCase() === this.networkMonitor.factoryAddress) {
          this.handleContractDeployedEvents(transaction, receipt, job.network)
        } else if (transaction.to?.toLowerCase() === this.networkMonitor.operatorAddress) {
          this.handleOperatorBridgeEvents(transaction, receipt, job.network)
        } else {
          this.handleOperatorRequestEvents(transaction, receipt, job.network)
        }
      }
    }

    this.networkMonitor.blockJobHandler(job.network, job)
  }

  async handleContractDeployedEvents(
    transaction: ethers.Transaction,
    receipt: ethers.ContractReceipt,
    network: string,
  ): Promise<void> {
    this.networkMonitor.structuredLog(
      network,
      `Checking if a new Holograph contract was deployed at tx: ${transaction.hash}`,
    )
    const config = decodeDeploymentConfigInput(transaction.data)
    let event = null
    if ('logs' in receipt && typeof receipt.logs !== 'undefined' && receipt.logs !== null) {
      for (let i = 0, l = receipt.logs.length; i < l; i++) {
        if (event === null) {
          const log = receipt.logs[i]
          if (log.topics.length > 0 && log.topics[0] === this.networkMonitor.targetEvents.BridgeableContractDeployed) {
            event = log.topics
            break
          } else {
            this.networkMonitor.structuredLog(
              network,
              `BridgeableContractDeployed event not found in ${transaction.hash}`,
            )
          }
        }
      }

      if (event) {
        const deploymentAddress = '0x' + event[1].slice(26)
        this.networkMonitor.structuredLog(
          network,
          `\nHolographFactory deployed a new collection on ${capitalize(network)} at address ${deploymentAddress}\n` +
            `Wallet that deployed the collection is ${transaction.from}\n` +
            `The config used for deployHolographableContract was ${JSON.stringify(config, null, 2)}\n` +
            `The transaction hash is: ${transaction.hash}\n`,
        )

        // First get the collection by the address
        this.networkMonitor.structuredLog(
          network,
          `API: Requesting to get Collection with address ${deploymentAddress} with Operator token ${this.JWT}`,
        )
        let res
        try {
          this.log(`About to make a request for a collection with "Bearer ${this.JWT}"`)
          res = await axios.get(`${this.baseUrl}/v1/collections/contract/${deploymentAddress}`, {
            headers: {
              Authorization: `Bearer ${this.JWT}`,
              'Content-Type': 'application/json',
            },
          })
          this.debug(JSON.stringify(res.data))
          this.networkMonitor.structuredLog(network, `Successfully found collection at ${deploymentAddress}`)
        } catch (error: any) {
          this.networkMonitor.structuredLog(network, `Failed to update the Holograph database ${error.message}`)
          this.debug(error)
        }

        // Compose request to API server to update the collection
        const data = JSON.stringify({
          chainId: networks[network].chain,
          status: 'DEPLOYED',
          salt: '0x',
          tx: transaction.hash,
        })

        const params = {
          headers: {
            Authorization: `Bearer ${this.JWT}`,
            'Content-Type': 'application/json',
          },
          data: data,
        }

        this.networkMonitor.structuredLog(
          network,
          `API: Requesting to update Collection with id ${res?.data.id} with Operator token ${this.JWT}`,
        )
        try {
          const patchRes = await axios.patch(`${this.baseUrl}/v1/collections/${res?.data.id}`, data, params)
          this.debug(patchRes.data)
          this.networkMonitor.structuredLog(
            network,
            `Successfully updated collection chainId to ${networks[network].chain}`,
          )
        } catch (error: any) {
          this.networkMonitor.structuredLog(network, `Failed to update the Holograph database ${error.message}`)
          this.debug(error)
        }
      }
    }
  }

  async handleOperatorRequestEvents(
    transaction: ethers.Transaction,
    receipt: ethers.ContractReceipt,
    network: string,
  ): Promise<void> {
    this.networkMonitor.structuredLog(
      network,
      `Checking if Operator was sent a bridge job via the LayerZero Relayer at tx: ${transaction.hash}`,
    )
    let event = null
    if ('logs' in receipt && typeof receipt.logs !== 'undefined' && receipt.logs !== null) {
      for (let i = 0, l = receipt.logs.length; i < l; i++) {
        if (event === null) {
          const log = receipt.logs[i]
          if (
            log.address.toLowerCase() === this.networkMonitor.operatorAddress &&
            log.topics.length > 0 &&
            log.topics[0] === this.networkMonitor.targetEvents.AvailableJob
          ) {
            event = log.data
          } else {
            this.networkMonitor.structuredLog(
              network,
              `LayerZero transaction is not relevant to AvailableJob event. ` +
                `Transaction was relayed to ${log.address} instead of ` +
                `The Operator at ${this.networkMonitor.operatorAddress}`,
            )
          }
        }
      }

      if (event) {
        const payload = this.networkMonitor.abiCoder.decode(['bytes'], event)[0]
        this.networkMonitor.structuredLog(
          network,
          `HolographOperator received a new bridge job on ${capitalize(network)}\nThe job payload is ${payload}\n`,
        )
      }
    }
  }

  async handleOperatorBridgeEvents(
    transaction: ethers.Transaction,
    receipt: ethers.ContractReceipt,
    network: string,
  ): Promise<void> {
    this.networkMonitor.structuredLog(
      network,
      `Checking if an indexer executed a job to bridge a contract / collection at tx: ${transaction.hash}`,
    )
    let event = null
    if ('logs' in receipt && typeof receipt.logs !== 'undefined' && receipt.logs !== null) {
      for (let i = 0, l = receipt.logs.length; i < l; i++) {
        if (event === null) {
          const log = receipt.logs[i]
          if (log.topics.length > 0 && log.topics[0] === this.networkMonitor.targetEvents.BridgeableContractDeployed) {
            event = log.topics
          }
        }
      }
    } else {
      this.networkMonitor.structuredLog(network, 'Failed to find BridgeableContractDeployed event from indexer job')
    }

    if (event) {
      const deploymentInput = this.networkMonitor.abiCoder.decode(['bytes'], '0x' + transaction.data.slice(10))[0]
      const config = decodeDeploymentConfig(
        this.networkMonitor.abiCoder.decode(['bytes'], '0x' + deploymentInput.slice(10))[0],
      )
      const deploymentAddress = '0x' + event[1].slice(26)
      this.networkMonitor.structuredLog(
        network,
        '\nHolographOperator executed a job which bridged a collection\n' +
          `HolographFactory deployed a new collection on ${capitalize(network)} at address ${deploymentAddress}\n` +
          `Operator that deployed the collection is ${transaction.from}` +
          `The config used for deployHolographableContract function was ${JSON.stringify(config, null, 2)}\n`,
      )

      // First get the collection by the address
      this.networkMonitor.structuredLog(
        network,
        `API: Requesting to get Collection with address ${deploymentAddress} with Operator token ${this.JWT}`,
      )
      let res
      try {
        this.log(`About to make a request for a collection with "Bearer ${this.JWT}"`)
        res = await axios.get(`${this.baseUrl}/v1/collections/contract/${deploymentAddress}`, {
          headers: {
            Authorization: `Bearer ${this.JWT}`,
            'Content-Type': 'application/json',
          },
        })
        this.debug(JSON.stringify(res.data))
        this.networkMonitor.structuredLog(network, `Successfully found collection at ${deploymentAddress}`)
      } catch (error: any) {
        this.networkMonitor.structuredLog(network, `Failed to update the Holograph database ${error.message}`)
        this.debug(error)
      }

      // Compose request to API server to update the collection
      const data = JSON.stringify({
        chainId: networks[network].chain,
        status: 'DEPLOYED',
        salt: '0x',
        tx: transaction.hash,
      })

      const params = {
        headers: {
          Authorization: `Bearer ${this.JWT}`,
          'Content-Type': 'application/json',
        },
        data: data,
      }

      this.networkMonitor.structuredLog(
        network,
        `API: Requesting to update Collection with id ${res?.data.id} with Operator token ${this.JWT}`,
      )
      try {
        const patchRes = await axios.patch(`${this.baseUrl}/v1/collections/${res?.data.id}`, data, params)
        this.debug(patchRes.data)
        this.networkMonitor.structuredLog(
          network,
          `Successfully updated collection chainId to ${networks[network].chain}`,
        )
      } catch (error: any) {
        this.networkMonitor.structuredLog(network, `Failed to update the Holograph database ${error.message}`)
        this.debug(error)
      }
    }

    // Check if the indexer executed a job to bridge an NFT
    event = null
    this.networkMonitor.structuredLog(
      network,
      `Checking if an indexer executed a job to bridge an NFT at tx: ${transaction.hash}`,
    )
    if ('logs' in receipt && typeof receipt.logs !== 'undefined' && receipt.logs !== null) {
      for (let i = 0, l = receipt.logs.length; i < l; i++) {
        if (event === null) {
          const log = receipt.logs[i]
          if (log.topics.length > 0 && log.topics[0] === this.networkMonitor.targetEvents.Transfer) {
            event = log.topics
          }
        }
      }
    } else {
      this.networkMonitor.structuredLog(network, 'Failed to find Transfer event from indexer job')
    }

    // Compose request to API server to update the NFT
    if (event) {
      this.debug(event)
      const deploymentInput = this.networkMonitor.abiCoder.decode(['bytes'], '0x' + transaction.data.slice(10))[0]
      const tokenId = Number.parseInt(event[3], 16)
      const contractAddress = '0x' + deploymentInput.slice(98, 138)

      this.networkMonitor.structuredLog(
        network,
        `API: Requesting to get NFT with tokenId ${tokenId} from ${contractAddress} with Operator token ${this.JWT}`,
      )
      let res
      try {
        res = await axios.get(`${this.baseUrl}/v1/nfts/${contractAddress}/${tokenId}`, {
          headers: {
            Authorization: `Bearer ${this.JWT}`,
            'Content-Type': 'application/json',
          },
        })
        this.networkMonitor.structuredLog(
          network,
          `Successfully found NFT with tokenId ${tokenId} from ${contractAddress} with Operator token ${this.JWT}`,
        )
      } catch (error: any) {
        this.networkMonitor.structuredLog(network, error.message)
        this.debug(error)
      }

      // Compose request to API server to update the nft
      const data = JSON.stringify({
        chainId: networks[network].chain,
        status: 'MINTED',
        tx: transaction.hash,
      })

      const params = {
        headers: {
          Authorization: `Bearer ${this.JWT}`,
          'Content-Type': 'application/json',
        },
        data: data,
      }

      this.networkMonitor.structuredLog(
        network,
        `API: Requesting to update NFT with id ${res?.data.id} with Operator token ${this.JWT}`,
      )
      try {
        const patchRes = await axios.patch(`${this.baseUrl}/v1/nfts/${res?.data.id}`, data, params)
        this.networkMonitor.structuredLog(network, JSON.stringify(patchRes.data))
        this.networkMonitor.structuredLog(network, `Successfully updated NFT chainId to ${networks[network].chain}`)
      } catch (error: any) {
        this.networkMonitor.structuredLog(network, `Failed to update the database ${error.message}`)
        this.debug(error)
      }
    }
  }
}
