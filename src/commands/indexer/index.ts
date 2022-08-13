import axios from 'axios'

import {CliUx, Command, Flags} from '@oclif/core'
import {ethers} from 'ethers'

import {ensureConfigFileIsValid} from '../../utils/config'
import networks from '../../utils/networks'

import {decodeDeploymentConfig, decodeDeploymentConfigInput, capitalize, sleep} from '../../utils/utils'
import {networkFlag, warpFlag, FilterType, OperatorMode, BlockJob, NetworkMonitor} from '../../utils/network-monitor'
import {startHealthcheckServer} from '../../utils/health-check-server'

import dotenv from 'dotenv'
dotenv.config()

export default class Indexer extends Command {
  static LAST_BLOCKS_FILE_NAME = 'indexer-blocks.json'
  static description = 'Listen for EVM events and update database network status'
  static examples = ['$ holo indexer --networks="rinkeby mumbai fuji" --mode=auto']
  static flags = {
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
    ...networkFlag,
    ...warpFlag,
  }

  /**
   * Indexer class variables
   */
  // API Params
  baseUrl!: string
  JWT!: string
  DELAY = 10_000

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
      this.debug(JSON.stringify(res.data))
    } catch (error: any) {
      this.error(error.message)
    }

    this.JWT = res!.data.accessToken

    if (typeof this.JWT === 'undefined') {
      this.error('Failed to authorize as an operator')
    }

    this.debug(`process.env.OPERATOR_API_KEY = ${process.env.OPERATOR_API_KEY}`)
    this.debug(`this.JWT = ${this.JWT}`)

    // Indexer always runs in listen mode
    this.log(`Indexer mode: ${this.operatorMode}`)

    this.log('Loading user configurations...')
    const {configFile} = await ensureConfigFileIsValid(this.config.configDir, undefined, false)
    this.log('User configurations loaded.')

    this.networkMonitor = new NetworkMonitor({
      parent: this,
      configFile,
      networks: flags.networks,
      debug: this.debug,
      processTransactions: this.processTransactions,
      lastBlockFilename: 'indexer-blocks.json',
      warp: flags.warp,
    })

    // Indexer always synchronizes missed blocks
    this.networkMonitor.latestBlockHeight = await this.networkMonitor.loadLastBlocks(this.config.configDir)

    CliUx.ux.action.start(`Starting indexer in mode: ${OperatorMode[this.operatorMode]}`)
    await this.networkMonitor.run(!(flags.warp > 0), undefined, this.filterBuilder)
    CliUx.ux.action.stop('🚀')

    // Start server
    if (enableHealthCheckServer) {
      startHealthcheckServer()
    }
  }

  async filterBuilder(): Promise<void> {
    this.networkMonitor.filters = [
      {
        type: FilterType.from,
        match: this.networkMonitor.LAYERZERO_RECEIVERS,
        networkDependant: true,
      },
      {
        type: FilterType.to,
        match: this.networkMonitor.factoryAddress,
        networkDependant: false,
      },
      {
        type: FilterType.to,
        match: this.networkMonitor.operatorAddress,
        networkDependant: false,
      },
    ]
    Promise.resolve()
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

        this.networkMonitor.structuredLog(job.network, `Processing transaction ${transaction.hash} at block ${receipt.blockNumber}`)
        if (transaction.to?.toLowerCase() === this.networkMonitor.factoryAddress) {
          this.handleContractDeployedEvents(transaction, receipt, job.network)
        } else if (transaction.to?.toLowerCase() === this.networkMonitor.operatorAddress) {
          this.handleOperatorBridgeEvents(transaction, receipt, job.network)
        } else {
          this.handleOperatorRequestEvents(transaction, receipt, job.network)
        }
      }
    }
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

        // First get the collection by the address (sleep for a bit to make sure the collection is indexed)
        this.networkMonitor.structuredLog(network, `Waiting ${this.DELAY} seconds before trying to index collection ${deploymentAddress}`)
        await sleep(this.DELAY)
        this.networkMonitor.structuredLog(
          network,
          `API: Requesting to get Collection with address ${deploymentAddress}`,
        )
        let res
        try {
          res = await axios.get(`${this.baseUrl}/v1/collections/contract/${deploymentAddress}`, {
            headers: {
              Authorization: `Bearer ${this.JWT}`,
              'Content-Type': 'application/json',
            },
          })
          this.networkMonitor.structuredLog(network, `GET collection ${deploymentAddress} response ${JSON.stringify(res.data)}`)
          this.networkMonitor.structuredLog(network, `Successfully found collection at ${deploymentAddress}`)
        } catch (error: any) {
          this.networkMonitor.structuredLog(network, `Failed to update the Holograph database for ${deploymentAddress}`)
          this.networkMonitor.structuredLogError(network, error, deploymentAddress)
          return
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
          `API: Requesting to update Collection ${deploymentAddress} with id ${res?.data.id}`,
        )
        try {
          const patchRes = await axios.patch(`${this.baseUrl}/v1/collections/${res?.data.id}`, data, params)
          this.networkMonitor.structuredLog(network, `PATCH response ${JSON.stringify(patchRes.data)}`)
          this.networkMonitor.structuredLog(
            network,
            `Successfully updated collection ${deploymentAddress} chainId to ${networks[network].chain}`,
          )
        } catch (error: any) {
          this.networkMonitor.structuredLog(network, `Failed to update the Holograph database ${deploymentAddress}`)
          this.networkMonitor.structuredLogError(network, error, deploymentAddress)
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

      // First get the collection by the address (sleep for a bit to make sure the collection is indexed)
      this.networkMonitor.structuredLog(network, `Waiting ${this.DELAY} seconds before trying to index ${deploymentAddress}`)
      await sleep(this.DELAY)
      this.networkMonitor.structuredLog(
        network,
        `API: Requesting to get Collection with address ${deploymentAddress}`,
      )
      let res
      try {
        res = await axios.get(`${this.baseUrl}/v1/collections/contract/${deploymentAddress}`, {
          headers: {
            Authorization: `Bearer ${this.JWT}`,
            'Content-Type': 'application/json',
          },
        })
        this.networkMonitor.structuredLog(network, `GET collection ${deploymentAddress} response ${JSON.stringify(res.data)}`)
        this.networkMonitor.structuredLog(network, `Successfully found collection at ${deploymentAddress}`)
      } catch (error: any) {
        this.networkMonitor.structuredLogError(network, error, deploymentAddress)
        return
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
        `API: Requesting to update Collection ${deploymentAddress} with id ${res?.data.id}`,
      )
      try {
        const patchRes = await axios.patch(`${this.baseUrl}/v1/collections/${res?.data.id}`, data, params)
        this.networkMonitor.structuredLog(network, `PATCH collection ${deploymentAddress} response ${JSON.stringify(patchRes.data)}`)
        this.networkMonitor.structuredLog(
          network,
          `Successfully updated collection ${deploymentAddress} and id ${res?.data.id}`,
        )
      } catch (error: any) {
        this.networkMonitor.structuredLog(network, `Failed to update the Holograph database ${deploymentAddress}`)
        this.networkMonitor.structuredLogError(network, error, deploymentAddress)
        return
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
      const deploymentInput = this.networkMonitor.abiCoder.decode(['bytes'], '0x' + transaction.data.slice(10))[0]
      const tokenId = Number.parseInt(event[3], 16)
      const contractAddress = '0x' + deploymentInput.slice(98, 138)

      // Index NFT
      this.networkMonitor.structuredLog(network, `Waiting ${this.DELAY} seconds before trying to index NFT`)
      await sleep(this.DELAY)
      this.networkMonitor.structuredLog(
        network,
        `API: Requesting to get NFT with tokenId ${tokenId} from ${contractAddress}`,
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
          `Successfully found NFT with tokenId ${tokenId} from ${contractAddress}`,
        )
      } catch (error: any) {
        this.networkMonitor.structuredLog(network, error.message)
        this.networkMonitor.structuredLogError(network, error, contractAddress)
        return
      }

      // Only update the database if this transaction happened in a later block than the last block we indexed
      // NOTE: This should only be necessary for NFTs because they can only exist on one network at a time so we don't
      //       want to update change update the database to the wrong network while the warp cron is running
      //       if a more recent bridge event happened on chain that moved the NFT to a different network
      if (
        res &&
        res.data &&
        res.data.transactions !== undefined &&
        res.data.transactions[0] !== undefined &&
        this.networkMonitor.latestBlockHeight > res.data.transaction[0]
      ) {
        this.networkMonitor.structuredLog(
          network,
          `Latest transaction in the database is more recent than this transaction. Skipping update for collection ${contractAddress} and tokeId ${tokenId}`,
        )
        return
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
        `API: Requesting to update NFT with collection ${contractAddress} and tokeId ${tokenId} and id ${res?.data.id}`,
      )
      try {
        const patchRes = await axios.patch(`${this.baseUrl}/v1/nfts/${res?.data.id}`, data, params)
        this.networkMonitor.structuredLog(network, `PATCH collection ${contractAddress} tokeId ${tokenId} and id ${res?.data.id} response ${JSON.stringify(patchRes.data)}`)
        this.networkMonitor.structuredLog(network, `Successfully updated NFT collection ${contractAddress} and tokeId ${tokenId}`)
      } catch (error: any) {
        this.networkMonitor.structuredLog(network, `Failed to update the database for collection ${contractAddress} and tokeId ${tokenId}`)
        this.networkMonitor.structuredLogError(network, error, `collection ${contractAddress} and tokeId ${tokenId}`)
      }
    }
  }
}
