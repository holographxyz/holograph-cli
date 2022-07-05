import {ethers} from 'ethers'
import * as inquirer from 'inquirer'
import {CliUx, Flags} from '@oclif/core'
import {decodeDeploymentConfigInput} from './utils'

export const deploymentFlags = {
  tx: Flags.string({description: 'The hash of transaction that deployed the original collection'}),
  txNetwork: Flags.string({description: 'The network on which the transaction was executed'}),
  deploymentType: Flags.string({description: 'The type of deployment to use: [deployedTx, deploymentConfig]'}),
}

export const deploymentTypes = ['deployedTx', 'deploymentConfig']

export const deploymentProcesses = [
  {
    name: 'Extract deployment config from existing transaction',
    value: 'deployedTx',
    short: 'existing deployment',
  },
  {
    name: 'Load custom deployment configuration',
    value: 'deploymentConfig',
    short: 'custom deployment',
  },
]

export const prepareDeploymentConfig = async function (
  configFile: any,
  userWallet: any,
  flags: any,
  allowedNetworks: string[],
): Promise<any> {
  let deploymentType = flags.deploymentType
  let tx = flags.tx
  let txNetwork = flags.tx
  if (deploymentType === undefined) {
    const prompt: any = await inquirer.prompt([
      {
        name: 'deploymentType',
        message: 'Select the contract deployment process to use',
        type: 'list',
        choices: deploymentProcesses,
        default: deploymentTypes[0],
      },
    ])
    deploymentType = prompt.deploymentType
  }

  let deploymentConfig

  switch (deploymentType) {
    case 'deployedTx': {
      if (txNetwork === undefined || !allowedNetworks.includes(txNetwork)) {
        const txNetworkPrompt: any = await inquirer.prompt([
          {
            name: 'txNetwork',
            message: 'select the network to extract transaction details from',
            type: 'list',
            choices: allowedNetworks,
          },
        ])
        txNetwork = txNetworkPrompt.txNetwork
      }

      CliUx.ux.action.start('Loading transaction network RPC provider')
      const txNetworkProtocol = new URL(configFile.networks[txNetwork].providerUrl).protocol
      let txNetworkProvider
      switch (txNetworkProtocol) {
        case 'https:':
          txNetworkProvider = new ethers.providers.JsonRpcProvider(configFile.networks[txNetwork].providerUrl)
          break
        case 'wss:':
          txNetworkProvider = new ethers.providers.WebSocketProvider(configFile.networks[txNetwork].providerUrl)
          break
        default:
          throw new Error('Unsupported RPC URL protocol -> ' + txNetworkProtocol)
      }

      let txNetworkWallet = userWallet.connect(txNetworkProvider)
      CliUx.ux.action.stop()
      if (tx === undefined || !/^0x[\da-f]{64}$/i.test(tx)) {
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

      CliUx.ux.action.start('Retrieving transaction details from ' + txNetwork + ' network')
      const transaction = await txNetworkWallet.provider.getTransaction(tx)

      deploymentConfig = decodeDeploymentConfigInput(transaction.data)
      CliUx.ux.action.stop()

      txNetworkWallet = null
      break
    }

    case 'deploymentConfig': {
      throw new Error('Unsupported deployment type: ' + deploymentType + '... Still working on this one :(')
      break
    }

    default: {
      throw new Error('Unsupported deployment type: ' + deploymentType)
    }
  }

  return deploymentConfig
}
