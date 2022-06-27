import {Command, Flags} from '@oclif/core'

const WebsocketProvider = require('../../utils/WebSocketProvider')

import {
  networks,
  // utf,
  provider,
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

  // TODO: Decide on flags
  // static flags = {
  //   from: Flags.string({ char: 'd', description: '', required: false }),
  // };

  // static args = [{ name: 'person', description: 'Person to say hello to', required: true }];

  async run(): Promise<void> {
    const {args, flags} = await this.parse(Listener)
    const bridgeAddress = (await rinkebyHolograph.methods.getBridge().call()).toLowerCase()
    const factoryAddress = (await rinkebyHolograph.methods.getFactory().call()).toLowerCase()
    const operatorAddress = (await rinkebyHolograph.methods.getOperator().call()).toLowerCase()

    console.log('Starting listener...')
    console.log(`Holograph address: ${holographAddress}`)
    console.log(`Bridge address: ${bridgeAddress}`)
    console.log(`Factory address: ${factoryAddress}`)
    console.log(`Operator address: ${operatorAddress}`)

    function processTransactions(network: string, transactions: any, callback: any) {
      const getReceipt = () => {
        if (transactions.length > 0) {
          const transaction = transactions.shift()
          web3Local[network].eth.getTransactionReceipt(transaction.hash).then((receipt: any) => {
            if (receipt === null) {
              throw new Error(`could not get receipt for ${transaction.hash}`)
            }

            if (transaction.to.toLowerCase() === factoryAddress) {
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

              if (event !== null) {
                const deploymentAddress = '0x' + event[1].slice(26)
                console.log(
                  // @ts-expect-error
                  `HolographFactory deployed a new collection on ${network.capitalize()} at address ${deploymentAddress}\n
                  Wallet that deployed the collection is ${transaction.from}\n
                  The config used for deployHolographableContract function was ${config}\n`,
                )
              } else {
                console.log(`Failed with BridgeableContractDeployed event parsing ${transaction} ${receipt}`)
                throw new Error('Failed with BridgeableContractDeployed event parsing')
              }
            } else if (transaction.to.toLowerCase() === operatorAddress) {
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

              if (event !== null) {
                const deploymentInput = web3Local[network].eth.abi.decodeParameter(
                  'bytes',
                  '0x' + transaction.input.slice(10),
                )
                const config = decodeDeploymentConfig(
                  web3Local[network].eth.abi.decodeParameter('bytes', '0x' + deploymentInput.slice(10)),
                )
                const deploymentAddress = '0x' + event[1].slice(26)
                console.log(
                  // @ts-expect-error
                  `HolographOperator executed a job which bridged a collection\nHolographFactory deployed a new collection on ${network.capitalize()} at address ${deploymentAddress}\n
                  Operator that deployed the collection is ${transaction.from}\n
                  The config used for deployHolographableContract function was ${config}\n`,
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
                    log.address.toLowerCase() === operatorAddress &&
                    log.topics.length > 0 &&
                    log.topics[0] === targetEvents.AvailableJob
                  ) {
                    event = log.data
                    break
                  }
                }
              }

              if (event !== null) {
                const payload = web3Local[network].eth.abi.decodeParameter('bytes', event)
                console.log(
                  // @ts-expect-error
                  `HolographOperator received a new bridge job on ${network.capitalize()}\n
                  The job payload is ${payload}\n`,
                )
              } else {
                console.log('LayerZero transaction is not relevant to AvailableJob event')
              }
            }

            getReceipt()
          })
        } else {
          callback()
        }
      }

      getReceipt()
    }

    const latestBlock = {
      rinkeby: 0,
      mumbai: 0,
    }

    const blockJobs: any[] = []

    function processBlock(job: any) {
      web3Local[job.network].eth.getBlock(job.block, true).then(function (block: any) {
        if (block !== null && 'transactions' in block) {
          if (block.transactions.length === 0) {
            console.log('zero block transaction for block', job.block, 'on', job.network)
          }

          const interestingTransactions = []
          for (let i = 0, l = block.transactions.length; i < l; i++) {
            const transaction = block.transactions[i]
            // only check transactions that have a "to" address
            if ('to' in transaction && transaction.to !== null && transaction.to !== '') {
              // check if it's a factory call
              if (transaction.to.toLowerCase() === factoryAddress) {
                // we have a potential factory deployment transaction
                interestingTransactions.push(transaction)
              } else if (transaction.to.toLowerCase() === operatorAddress) {
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
            processTransactions(job.network, interestingTransactions, blockJobHandler)
          } else {
            blockJobHandler()
          }
        } else {
          console.log(job.network, 'dropped block!', job.block)
          blockJobs.unshift(job)
          blockJobHandler()
        }
      })
    }

    function blockJobHandler() {
      if (blockJobs.length > 0) {
        const blockJob = blockJobs.shift()
        processBlock(blockJob)
      } else {
        setTimeout(blockJobHandler, 1000)
      }
    }

    // Start block job handler
    blockJobHandler()

    let rinkebySubscriptionId = null
    function rinkebySubscribe() {
      const rinkebySubscription = web3Local.rinkeby.eth
      .subscribe('newBlockHeaders')
      .on('connected', function (subscriptionId: any) {
        rinkebySubscriptionId = subscriptionId
        console.log('Rinkeby subscription to new block headers successful:', subscriptionId)
      })
      .on('data', function (blockHeader: any) {
        if (latestBlock.rinkeby !== 0 && blockHeader.number - latestBlock.rinkeby > 1) {
          console.log('dropped rinkeby websocket connection, gotta do some catching up')
          let latest = latestBlock.rinkeby
          while (blockHeader.number - latest > 1) {
            console.log('adding rinkeby block', latest)
            blockJobs.push({
              network: 'rinkeby',
              block: latest,
            })
            latest++
          }
        }

        latestBlock.rinkeby = blockHeader.number
        console.log('Rinkeby', blockHeader.number)
        blockJobs.push({
          network: 'rinkeby',
          block: blockHeader.number,
        })
      })
      .on('error', function (error: any) {
        console.error('Rinkeby subscription to new block headers error' /* , error */)
        try {
          rinkebySubscription.unsubscribe(console.log)
          rinkebySubscription.subscribe()
        } catch {
          rinkebySubscribe()
        }
      })
    }

    rinkebySubscribe()
    let rinkebyResetProvider: any
    function handleRinkebyDroppedSocket(error: Error) {
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
          provider.rinkeby = new WebsocketProvider(networks.eth_rinkeby.webSocket)
          provider.rinkeby.on('error', handleRinkebyDroppedSocket)
          provider.rinkeby.on('close', handleRinkebyDroppedSocket)
          provider.rinkeby.on('end', handleRinkebyDroppedSocket)
          web3Local.rinkeby = new Web3(provider.rinkeby)
          rinkebySubscribe()
          clearInterval(rinkebyResetProvider)
        } catch (error_) {
          console.log(error_)
        }
      }, 5000) // 3 seconds
    }

    provider.rinkeby.on('error', handleRinkebyDroppedSocket)
    provider.rinkeby.on('close', handleRinkebyDroppedSocket)
    provider.rinkeby.on('end', handleRinkebyDroppedSocket)

    let mumbaiSubscriptionId = null
    const mumbaiSubscribe = () => {
      const mumbaiSubscription = web3Local.mumbai.eth
      .subscribe('newBlockHeaders')
      .on('connected', function (subscriptionId: any) {
        mumbaiSubscriptionId = subscriptionId
        console.log(`Mumbai subscription to new block headers successful: ${subscriptionId}`)
      })
      .on('data', function (blockHeader: any) {
        if (latestBlock.mumbai !== 0 && blockHeader.number - latestBlock.mumbai > 1) {
          console.log('Dropped mumbai websocket connection, gotta do some catching up')
          let latest = latestBlock.mumbai
          while (blockHeader.number - latest > 1) {
            console.log('adding mumbai block', latest)
            blockJobs.push({
              network: 'mumbai',
              block: latest,
            })
            latest++
          }
        }

        latestBlock.mumbai = blockHeader.number
        console.log('Mumbai', blockHeader.number)
        blockJobs.push({
          network: 'mumbai',
          block: blockHeader.number,
        })
      })
      .on('error', function (error: Error) {
        console.log(`Mumbai newBlockHeaders subscription error ${error}`)
        try {
          mumbaiSubscription.unsubscribe(console.log)
          mumbaiSubscription.subscribe()
        } catch {
          mumbaiSubscribe()
        }
      })
    }

    mumbaiSubscribe()

    let mumbaiResetProvider: any
    function handleMumbaiDroppedSocket(error: Error) {
      if (typeof mumbaiResetProvider !== 'undefined') {
        clearInterval(mumbaiResetProvider)
      }

      mumbaiResetProvider = setInterval(() => {
        try {
          web3Local.mumbai.eth.clearSubscriptions()
        } catch (error) {
          console.error(`Mumbai clearSubscriptions error: ${error}`)
        }

        console.log(`Mumbai webSocket error ${error}`)
        const Web3 = require('web3')
        const WebsocketProvider = require('./WebSocketProvider')
        try {
          provider.mumbai = new WebsocketProvider(networks.mumbai.webSocket)
          provider.mumbai.on('error', handleMumbaiDroppedSocket)
          provider.mumbai.on('close', handleMumbaiDroppedSocket)
          provider.mumbai.on('end', handleMumbaiDroppedSocket)
          web3Local.mumbai = new Web3(provider.mumbai)

          // Resubscribe to new blocks
          mumbaiSubscribe()
          clearInterval(mumbaiResetProvider)
        } catch (error) {
          console.log(error)
        }
      }, 5000) // 3 seconds
    }

    provider.mumbai.on('error', handleMumbaiDroppedSocket)
    provider.mumbai.on('close', handleMumbaiDroppedSocket)
    provider.mumbai.on('end', handleMumbaiDroppedSocket)
  }
}
