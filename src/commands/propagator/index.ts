import * as fs from 'fs-extra'
import * as inquirer from 'inquirer'

import {CliUx, Command, Flags} from '@oclif/core'
import {ethers} from 'ethers'

import {ensureConfigFileIsValid} from '../../utils/config'

import {decodeDeploymentConfigInput, capitalize, DeploymentConfig} from '../../utils/utils'

import {networkFlag, FilterType, OperatorMode, BlockJob, NetworkMonitor, warpFlag} from '../../utils/network-monitor'
import {startHealthcheckServer} from '../../utils/health-check-server'

type RecoveryData = {
  // eslint-disable-next-line camelcase
  chain_id: number
  // eslint-disable-next-line camelcase
  chain_ids: string
  tx: string
  // eslint-disable-next-line camelcase
  contract_address: string
}

export default class Propagator extends Command {
  static description = 'Listen for EVM events deploys collections to ther supported networks'
  static examples = ['$ holo propagator --networks="rinkeby mumbai fuji" --mode=auto']
  static flags = {
    mode: Flags.string({
      description: 'The mode in which to run the propagator',
      options: ['listen', 'manual', 'auto'],
      char: 'm',
    }),
    healthCheck: Flags.boolean({
      description: 'Launch server on http://localhost:6000 to make sure command is still running',
      default: false,
    }),
    sync: Flags.boolean({
      description: 'Start from last saved block position instead of latest block position',
      default: false,
    }),
    unsafePassword: Flags.string({
      description: 'Enter the plain text password for the wallet in the holo cli config',
    }),
    ...warpFlag,
    ...networkFlag,
    recover: Flags.string({
      description: 'Provide a JSON array of RecoveryData objects to manually ensure propagation',
      default: '[]',
    }),
    recoverFile: Flags.string({
      description: 'Filename reference to JSON array of RecoveryData objects to manually ensure propagation',
    }),
  }

  crossDeployments: string[] = []

  /**
   * Propagator class variables
   */
  operatorMode: OperatorMode = OperatorMode.listen

  networkMonitor!: NetworkMonitor

  async run(): Promise<void> {
    const {flags} = await this.parse(Propagator)

    const enableHealthCheckServer = flags.healthCheck
    const syncFlag = flags.sync
    const unsafePassword = flags.unsafePassword

    // Have the user input the mode if it's not provided
    let mode: string | undefined = flags.mode

    if (!mode) {
      const prompt: any = await inquirer.prompt([
        {
          name: 'mode',
          message: 'Enter the mode in which to run the operator',
          type: 'list',
          choices: ['listen', 'manual', 'auto'],
          default: 'listen',
        },
      ])
      mode = prompt.mode
    }

    this.operatorMode = OperatorMode[mode as keyof typeof OperatorMode]
    this.log(`Operator mode: ${this.operatorMode}`)

    this.log('Loading user configurations...')
    const {userWallet, configFile} = await ensureConfigFileIsValid(this.config.configDir, unsafePassword, true)
    this.log('User configurations loaded.')

    this.networkMonitor = new NetworkMonitor({
      parent: this,
      configFile,
      networks: flags.networks,
      debug: this.debug,
      processTransactions: this.processTransactions,
      userWallet,
      lastBlockFilename: 'propagator-blocks.json',
      warp: flags.warp,
    })

    this.networkMonitor.latestBlockHeight = await this.networkMonitor.loadLastBlocks(this.config.configDir)
    let canSync = false
    const lastBlockKeys: string[] = Object.keys(this.networkMonitor.latestBlockHeight)
    for (let i = 0, l: number = lastBlockKeys.length; i < l; i++) {
      if (this.networkMonitor.latestBlockHeight[lastBlockKeys[i]] > 0) {
        canSync = true
        break
      }
    }

    if (canSync && !syncFlag) {
      const syncPrompt: any = await inquirer.prompt([
        {
          name: 'shouldSync',
          message: 'Propagator has previous (missed) blocks that can be synced. Would you like to sync?',
          type: 'confirm',
          default: true,
        },
      ])
      if (syncPrompt.shouldSync === false) {
        this.networkMonitor.latestBlockHeight = {}
        this.networkMonitor.currentBlockHeight = {}
      }
    }

    CliUx.ux.action.start(`Starting propagator in mode: ${OperatorMode[this.operatorMode]}`)
    await this.networkMonitor.run(!(flags.warp > 0), undefined, this.filterBuilder)
    CliUx.ux.action.stop('🚀')

    let recoveryData: RecoveryData[] = JSON.parse(flags.recover as string) as RecoveryData[]
    const recoverDataFileString: string | undefined = flags.recoverFile
    if (recoverDataFileString !== undefined && recoverDataFileString !== '') {
      if (fs.existsSync(recoverDataFileString)) {
        recoveryData = (await fs.readJson(recoverDataFileString)) as RecoveryData[]
      } else {
        throw new Error('The recoverFile does not exist')
      }
    }

    // TODO: Add support for Goerli instead of Rinkeby
    if (recoveryData.length > 0) {
      this.log(`Manually running ${recoveryData.length} recovery jobs`)
      for (const data of recoveryData) {
        const network = data.chain_id === 4 ? 'rinkeby' : data.chain_id === 43_113 ? 'mumbai' : 'fuji'
        // eslint-disable-next-line no-await-in-loop
        let tx = await this.networkMonitor.providers[network].getTransaction(data.tx)
        if (tx === null) {
          // we need to try alternatives
          this.networkMonitor.structuredLog(network, `${data.tx} is on wrong network`)
          const checkNetworks: string[] =
            network === 'rinkeby'
              ? ['fuji', 'mumbai']
              : network === 'fuji'
              ? ['rinkeby', 'mumbai']
              : ['rinkeby', 'fuji']
          // eslint-disable-next-line no-await-in-loop
          tx = await this.networkMonitor.providers[checkNetworks[0]].getTransaction(data.tx)
          if (tx === null) {
            this.networkMonitor.structuredLog(checkNetworks[0], `${data.tx} is on wrong network`)
            // eslint-disable-next-line no-await-in-loop
            tx = await this.networkMonitor.providers[checkNetworks[1]].getTransaction(data.tx)
            if (tx === null) {
              this.networkMonitor.structuredLog(checkNetworks[1], `${data.tx} is on wrong network`)
            } else {
              // eslint-disable-next-line no-await-in-loop
              await this.handleContractDeployedEvents(tx, checkNetworks[1])
            }
          } else {
            // eslint-disable-next-line no-await-in-loop
            await this.handleContractDeployedEvents(tx, checkNetworks[0])
          }
        } else {
          // eslint-disable-next-line no-await-in-loop
          await this.handleContractDeployedEvents(tx, network)
        }
      }

      this.log('Done running recovery jobs')
    }

    // Start server
    if (enableHealthCheckServer) {
      startHealthcheckServer({networkMonitor: this.networkMonitor})
    }
  }

  async filterBuilder(): Promise<void> {
    this.networkMonitor.filters = [
      {
        type: FilterType.to,
        match: this.networkMonitor.factoryAddress,
        networkDependant: false,
      },
    ]
    Promise.resolve()
  }

  async processTransactions(job: BlockJob, transactions: ethers.providers.TransactionResponse[]): Promise<void> {
    /* eslint-disable no-await-in-loop */
    if (transactions.length > 0) {
      for (const transaction of transactions) {
        this.debug(`Processing transaction ${transaction.hash} on ${job.network} at block ${transaction.blockNumber}`)
        const to: string | undefined = transaction.to?.toLowerCase()
        if (to === this.networkMonitor.factoryAddress) {
          await this.handleContractDeployedEvents(transaction, job.network)
        } else {
          this.networkMonitor.structuredLog(
            job.network,
            `Function processTransactions stumbled on an unknown transaction ${transaction.hash}`,
          )
        }
      }
    }
  }

  async handleContractDeployedEvents(
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
        `Checking if a new Holograph contract was deployed at tx: ${transaction.hash}`,
      )
      const deploymentInfo = this.networkMonitor.decodeBridgeableContractDeployedEvent(receipt)
      if (deploymentInfo === undefined) {
        this.networkMonitor.structuredLog(network, `BridgeableContractDeployed event not found in ${transaction.hash}`)
      } else {
        const deploymentAddress = deploymentInfo[0] as string
        const config = decodeDeploymentConfigInput(transaction.data)
        this.networkMonitor.structuredLog(
          network,
          `HolographFactory deployed a new collection on ${capitalize(
            network,
          )} at address ${deploymentAddress}. Wallet that deployed the collection is ${
            transaction.from
          }. The config used for deployHolographableContract was ${JSON.stringify(
            config,
            null,
            2,
          )}. The transaction hash is: ${transaction.hash}`,
        )
        if (
          this.operatorMode !== OperatorMode.listen &&
          !this.crossDeployments.includes(deploymentAddress.toLowerCase())
        ) {
          await this.executePayload(network, config, deploymentAddress)
        }
      }
    }
  }

  async deployContract(network: string, deploymentConfig: DeploymentConfig, deploymentAddress: string): Promise<void> {
    const contractCode = await this.networkMonitor.providers[network].getCode(deploymentAddress, 'latest')
    const registry: ethers.Contract = this.networkMonitor.registryContract.connect(
      this.networkMonitor.providers[network],
    )
    if (
      (contractCode === '0x' || contractCode === '' || contractCode === undefined) &&
      !(await registry.callStatic.isHolographedContract(deploymentAddress, {blockTag: 'latest'}))
    ) {
      const deployReceipt: ethers.providers.TransactionReceipt | null = await this.networkMonitor.executeTransaction(
        network,
        undefined,
        this.networkMonitor.factoryContract,
        'deployHolographableContract',
        deploymentConfig.config,
        deploymentConfig.signature,
        deploymentConfig.signer,
      )
      if (deployReceipt === null) {
        this.networkMonitor.structuredLog(network, `Submitting tx for collection ${deploymentAddress} failed`)
      } else {
        this.networkMonitor.structuredLog(
          network,
          `Transaction minted with hash ${deployReceipt.transactionHash} for collection ${deploymentAddress}`,
        )
        const deploymentInfo: any[] | undefined = this.networkMonitor.decodeBridgeableContractDeployedEvent(
          deployReceipt as ethers.providers.TransactionReceipt,
        )
        if (deploymentInfo === undefined) {
          this.networkMonitor.structuredLog(
            network,
            `Failed extracting BridgeableContractDeployedEvent for collection ${deploymentAddress}`,
          )
        } else {
          const collectionAddress = deploymentInfo[0] as string
          this.networkMonitor.structuredLog(
            network,
            `Successfully deployed collection ${collectionAddress} = ${deploymentAddress}`,
          )
        }
      }
    } else {
      this.networkMonitor.structuredLog(network, `Collection ${deploymentAddress} already deployed`)
    }
  }

  async executePayload(network: string, config: DeploymentConfig, deploymentAddress: string): Promise<void> {
    // If the propagator is in listen mode, contract deployments will not be executed
    // If the propagator is in manual mode, the contract deployments must be manually executed
    // If the propagator is in auto mode, the contract deployments will be executed automatically
    let operate = this.operatorMode === OperatorMode.auto
    if (this.operatorMode === OperatorMode.manual) {
      const propagatorPrompt: any = await inquirer.prompt([
        {
          name: 'shouldContinue',
          message: `A contract appeared on ${network} for cross-chain deployment, would you like to deploy?\n`,
          type: 'confirm',
          default: false,
        },
      ])
      operate = propagatorPrompt.shouldContinue
    }

    if (operate) {
      this.crossDeployments.push(deploymentAddress.toLowerCase())
      for (const selectedNetwork of this.networkMonitor.networks) {
        if (selectedNetwork !== network) {
          this.networkMonitor.structuredLog(network, `Trying to deploy contract from ${network} to ${selectedNetwork}`)
          await this.deployContract(selectedNetwork, config, deploymentAddress)
        }
      }
    } else {
      this.networkMonitor.structuredLog(network, 'Dropped potential contract deployment to execute')
    }
  }
}
