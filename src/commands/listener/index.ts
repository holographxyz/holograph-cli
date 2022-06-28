import {Command, Flags} from '@oclif/core'

import {WebsocketProvider} from 'web3-providers-ws'

import {
  networks,
  // utf,
  providers,
  web3Local,
  holographAddress,
  rinkebyHolograph,
  receivers,
  targetEvents,
  decodeDeploymentConfig,
  decodeDeploymentConfigInput,
} from '../../utils/utils'

export default class Listener extends Command {
  static description = 'Listen for evm events'

  bridgeAddress: any
  factoryAddress: any
  operatorAddress: any
  latestBlock: {rinkeby: number; mumbai: number} = {
    rinkeby: 0,
    mumbai: 0,
  }
  blockJobs: any[] = []

  // TODO: Decide on flags
  // static flags = {
  //   from: Flags.string({ char: 'd', description: '', required: false }),
  // };

  // static args = [{ name: 'person', description: 'Person to say hello to', required: true }];

  async run(): Promise<void> {
    const {args, flags} = await this.parse(Listener)
    this.bridgeAddress = (await rinkebyHolograph.methods.getBridge().call()).toLowerCase()
    this.factoryAddress = (await rinkebyHolograph.methods.getFactory().call()).toLowerCase()
    this.operatorAddress = (await rinkebyHolograph.methods.getOperator().call()).toLowerCase()

    console.log('Starting listener...')
    console.log(`Holograph address: ${holographAddress}`)
    console.log(`Bridge address: ${this.bridgeAddress}`)
    console.log(`Factory address: ${this.factoryAddress}`)
    console.log(`Operator address: ${this.operatorAddress}`)

    this.rinkebySubscribe()
    this.mumbaiSubscribe()

    this.blockJobHandler()
    this.processTransactions('rinkeby', this.blockJobs, this.blockJobHandler)
    providers.rinkeby.on('error', this.handleRinkebyDroppedSocket)
    providers.rinkeby.on('close', this.handleRinkebyDroppedSocket)
    providers.rinkeby.on('end', this.handleRinkebyDroppedSocket)
    providers.mumbai.on('error', this.handleMumbaiDroppedSocket)
    providers.mumbai.on('close', this.handleMumbaiDroppedSocket)
    providers.mumbai.on('end', this.handleMumbaiDroppedSocket)
  }

  processBlock = async (job: any) => {
    const block = await web3Local[job.network].eth.getBlock(job.block, true)
    if (block !== null && 'transactions' in block) {
      if (block.transactions.length === 0) {
        console.log('Zero block transactions for block', job.block, 'on', job.network)
      }

      const interestingTransactions = []
      for (let i = 0, l = block.transactions.length; i < l; i++) {
        const transaction = block.transactions[i]
        // only check transactions that have a "to" address
        if ('to' in transaction && transaction.to !== null && transaction.to !== '') {
          // check if it's a factory call
          if (transaction.to.toLowerCase() === this.factoryAddress) {
            // we have a potential factory deployment transaction
            interestingTransactions.push(transaction)
          } else if (transaction.to.toLowerCase() === this.operatorAddress) {
            // we have a potential operator bridge transaction
            interestingTransactions.push(transaction)
          }
          // check if it's a layer zero call
          else if (transaction.to.toLowerCase() === receivers[job.network]) {
            // we have layer zero call, need to check it it's directed towards our operators
            interestingTransactions.push(transaction)
          }
        }
      }

      if (interestingTransactions.length > 0) {
        this.processTransactions(job.network, interestingTransactions, this.blockJobHandler)
      } else {
        this.blockJobHandler()
      }
    } else {
      console.log(job.network, 'dropped block!', job.block)
      this.blockJobs.unshift(job)
      this.blockJobHandler()
    }
  }

  blockJobHandler = (): void => {
    if (this.blockJobs.length > 0) {
      const blockJob = this.blockJobs.shift()
      this.processBlock(blockJob)
    } else {
      setTimeout(this.blockJobHandler, 1000)
    }
  }

  getReceipt = async (network: string, transactions: any, callback: any) => {
    if (transactions.length > 0) {
      const transaction = transactions.shift()
      const receipt = await web3Local[network].eth.getTransactionReceipt(transaction.hash)
      if (receipt === null) {
        throw new Error(`could not get receipt for ${transaction.hash}`)
      }

      if (transaction.to.toLowerCase() === this.factoryAddress) {
        const config = decodeDeploymentConfigInput(transaction.input)
        let event = null
        if ('logs' in receipt && typeof receipt.logs !== 'undefined' && receipt.logs !== null) {
          for (let i = 0, l = receipt.logs.length; i < l; i++) {
            const log = receipt.logs[i]
            if (log.topics.length > 0 && log.topics[0] === targetEvents.BridgeableContractDeployed) {
              event = log.topics
              break
            }
          }
        }

        if (event) {
          const deploymentAddress = '0x' + event[1].slice(26)
          console.log(`
            HolographFactory deployed a new collection on ${network} at address ${deploymentAddress}
            Wallet that deployed the collection is ${transaction.from}
            The config used for deployHolographableContract function was ${config.toString()}`)
        } else {
          console.log(`Failed with BridgeableContractDeployed event parsing ${transaction} ${receipt}`)
          throw new Error('Failed with BridgeableContractDeployed event parsing')
        }
      } else if (transaction.to.toLowerCase() === this.operatorAddress) {
        let event = null
        if ('logs' in receipt && typeof receipt.logs !== 'undefined' && receipt.logs !== null) {
          for (let i = 0, l = receipt.logs.length; i < l; i++) {
            const log = receipt.logs[i]
            if (log.topics.length > 0 && log.topics[0] === targetEvents.BridgeableContractDeployed) {
              event = log.topics
              break
            }
          }
        }

        if (event) {
          const deploymentInput = web3Local[network].eth.abi.decodeParameter(
            'bytes',
            '0x' + transaction.input.slice(10),
          )
          const config = decodeDeploymentConfig(
            web3Local[network].eth.abi.decodeParameter('bytes', '0x' + deploymentInput.slice(10)),
          )
          const deploymentAddress = '0x' + event[1].slice(26)
          console.log(
            `
              HolographOperator executed a job which bridged a collection
              HolographFactory deployed a new collection on ${network} at address ${deploymentAddress}
              Operator that deployed the collection is ${transaction.from}
              The config used for deployHolographableContract function was ${config.toString()}\n
              `,
          )
        } else {
          console.log('Failed to find BridgeableContractDeployed event from operator job')
        }
      } else {
        let event = null
        if ('logs' in receipt && typeof receipt.logs !== 'undefined' && receipt.logs !== null) {
          for (let i = 0, l = receipt.logs.length; i < l; i++) {
            const log = receipt.logs[i]
            if (
              log.address.toLowerCase() === this.operatorAddress &&
              log.topics.length > 0 &&
              log.topics[0] === targetEvents.AvailableJob
            ) {
              event = log.data
              break
            }
          }
        }

        if (event) {
          const payload = web3Local[network].eth.abi.decodeParameter('bytes', event)
          console.log(`HolographOperator received a new bridge job on ${network}\nThe job payload is ${payload}\n`)
        } else {
          console.log('LayerZero transaction is not relevant to AvailableJob event')
        }
      }
    } else {
      callback()
    }
  }

  processTransactions = (network: string, transactions: any, callback: any) => {
    this.getReceipt(network, transactions, callback)
  }

  rinkebySubscribe = () => {
    const rinkebySubscription = web3Local.rinkeby.eth
      .subscribe('newBlockHeaders')
      .on('connected', (subscriptionId: any) => {
        console.log('Rinkeby subscription to new block headers successful:', subscriptionId)
      })
      .on('data', (blockHeader: any) => {
        if (this.latestBlock.rinkeby !== 0 && blockHeader.number - this.latestBlock.rinkeby > 1) {
          console.log('dropped rinkeby websocket connection, gotta do some catching up')
          let latest = this.latestBlock.rinkeby
          while (blockHeader.number - latest > 1) {
            console.log('adding rinkeby block', latest)
            this.blockJobs.push({
              network: 'rinkeby',
              block: latest,
            })
            latest++
          }
        }
        this.latestBlock.rinkeby = blockHeader.number
        console.log('Rinkeby', blockHeader.number)
        this.blockJobs.push({
          network: 'rinkeby',
          block: blockHeader.number,
        })
      })
      .on('error', (error: any) => {
        console.error('Rinkeby subscription to new block headers error' /* , error */)
        try {
          rinkebySubscription.unsubscribe(console.log)
          rinkebySubscription.subscribe()
        } catch {
          this.rinkebySubscribe()
        }
      })
  }

  handleRinkebyDroppedSocket = (error: Error) => {
    let rinkebyResetProvider: any = null
    if (typeof rinkebyResetProvider !== 'undefined') {
      clearInterval(rinkebyResetProvider)
    }

    rinkebyResetProvider = setInterval(() => {
      try {
        web3Local.rinkeby.eth.clearSubscriptions()
      } catch (error) {
        console.error(`Rinkeby clearSubscriptions error: ${error}`)
      }

      console.error(`Rinkeby websocker error: ${error}`)
      const Web3 = require('web3')
      try {
        providers.rinkeby = new WebsocketProvider(networks.rinkeby.wss)
        providers.rinkeby.on('error', this.handleRinkebyDroppedSocket)
        providers.rinkeby.on('close', this.handleRinkebyDroppedSocket)
        providers.rinkeby.on('end', this.handleRinkebyDroppedSocket)
        web3Local.rinkeby = new Web3(providers.rinkeby)
        this.rinkebySubscribe()
        clearInterval(rinkebyResetProvider)
      } catch (error) {
        console.log(error)
      }
    }, 5000) // 5 seconds
  }

  mumbaiSubscribe = () => {
    const mumbaiSubscription = web3Local.mumbai.eth
      .subscribe('newBlockHeaders')
      .on('connected', (subscriptionId: any) => {
        console.log(`Mumbai subscription to new block headers successful: ${subscriptionId}`)
      })
      .on('data', (blockHeader: any) => {
        if (this.latestBlock.mumbai !== 0 && blockHeader.number - this.latestBlock.mumbai > 1) {
          console.log('Dropped mumbai websocket connection, gotta do some catching up')
          let latest = this.latestBlock.mumbai
          while (blockHeader.number - latest > 1) {
            console.log('adding mumbai block', latest)
            this.blockJobs.push({
              network: 'mumbai',
              block: latest,
            })
            latest++
          }
        }

        this.latestBlock.mumbai = blockHeader.number
        console.log('Mumbai', blockHeader.number)
        this.blockJobs.push({
          network: 'mumbai',
          block: blockHeader.number,
        })
      })
      .on('error', (error: Error) => {
        console.log(`Mumbai newBlockHeaders subscription error ${error}`)
        try {
          mumbaiSubscription.unsubscribe(console.log)
          mumbaiSubscription.subscribe()
        } catch {
          this.mumbaiSubscribe()
        }
      })
  }

  handleMumbaiDroppedSocket = (error: Error) => {
    let mumbaiResetProvider: any
    if (typeof mumbaiResetProvider !== 'undefined') {
      clearInterval(mumbaiResetProvider)
    }

    mumbaiResetProvider = setInterval(() => {
      try {
        web3Local.mumbai.eth.clearSubscriptions()
      } catch (error) {
        console.error(`Mumbai clearSubscriptions error: ${error}`)
      }

      console.log(`Mumbai wss error ${error}`)
      const Web3 = require('web3')
      try {
        providers.mumbai = new WebsocketProvider(networks.mumbai.wss)
        providers.mumbai.on('error', this.handleMumbaiDroppedSocket)
        providers.mumbai.on('close', this.handleMumbaiDroppedSocket)
        providers.mumbai.on('end', this.handleMumbaiDroppedSocket)
        web3Local.mumbai = new Web3(providers.mumbai)

        // Resubscribe to new blocks
        this.mumbaiSubscribe()
        clearInterval(mumbaiResetProvider)
      } catch (error) {
        console.log(error)
      }
    }, 5000) // 5 seconds
  }
}
