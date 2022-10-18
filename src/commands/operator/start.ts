// import * as inquirer from 'inquirer'
// import * as fs from 'fs-extra'
// import {CliUx, Command, Flags} from '@oclif/core'
// import {ethers} from 'ethers'

// import {ConfigNetwork, ConfigNetworks, ensureConfigFileIsValid} from '../../utils/config'

// import {networksFlag, FilterType, OperatorMode, BlockJob, NetworkMonitor} from '../../utils/network-monitor'
// import {supportedNetworks} from '../../utils/networks'
// import {getEnvironment} from '../../utils/environment'
// import {HOLOGRAPH_ADDRESSES, HOLOGRAPH_OPERATOR_ADDRESSES} from '../../utils/contracts'

// /**
//  * Start
//  * Description: The primary command for operating jobs on the Holograph network.
//  */
// export default class Start extends Command {
//   static description = 'Start an operator up into a pod'
//   static examples = ['$ holo operator:start --network <string> --pod <number> --amount <number> --unsafePassword']
//   static flags = {
//     network: Flags.string({
//       description: 'The network to connect to',
//       options: supportedNetworks,
//       char: 'n',
//     }),
//     pod: Flags.integer({
//       description: 'Pod number to join',
//     }),
//     amount: Flags.integer({
//       description: 'Amount of tokens to deposit',
//     }),
//     unsafePassword: Flags.string({
//       description: 'Enter the plain text password for the wallet in the holograph cli config',
//     }),
//     ...networksFlag,
//   }

//   /**
//    * Command Entry Point
//    */
//   async run(): Promise<void> {
//     const {flags} = await this.parse(Start)

//     // Check the flags
//     let network = flags.network
//     let pod = flags.pod
//     let amount = flags.amount
//     const unsafePassword = flags.unsafePassword

//     this.log('Loading user configurations...')
//     const environment = getEnvironment()
//     const {userWallet, configFile} = await ensureConfigFileIsValid(this.config.configDir, undefined, true)

//     let remainingNetworks = supportedNetworks
//     this.debug(`remainingNetworks = ${remainingNetworks}`)

//     let destinationNetwork = flags.network
//     if (!network) {
//       const destinationNetworkPrompt: any = await inquirer.prompt([
//         {
//           name: 'destinationNetwork',
//           message: 'Enter network to bond to',
//           type: 'list',
//           choices: remainingNetworks,
//         },
//       ])
//       destinationNetwork = destinationNetworkPrompt.destinationNetwork

//       remainingNetworks = remainingNetworks.filter((item: string) => {
//         return item !== destinationNetwork
//       })
//     }

//     this.log(`Joining network: ${destinationNetwork}`)

//     CliUx.ux.action.start('Loading destination network RPC provider')
//     const destinationProviderUrl: string = (
//       configFile.networks[destinationNetwork as keyof ConfigNetworks] as ConfigNetwork
//     ).providerUrl
//     const destinationNetworkProtocol: string = new URL(destinationProviderUrl).protocol
//     let destinationNetworkProvider
//     switch (destinationNetworkProtocol) {
//       case 'https:':
//         destinationNetworkProvider = new ethers.providers.JsonRpcProvider(destinationProviderUrl)
//         break
//       case 'wss:':
//         destinationNetworkProvider = new ethers.providers.WebSocketProvider(destinationProviderUrl)
//         break
//       default:
//         throw new Error('Unsupported RPC URL protocol -> ' + destinationNetworkProtocol)
//     }

//     const destinationWallet = userWallet?.connect(destinationNetworkProvider)
//     CliUx.ux.action.stop()

//     const holographOperatorABI = await fs.readJson(`./src/abi/${environment}/HolographOperator.json`)
//     const holographOperator = new ethers.Contract(
//       HOLOGRAPH_OPERATOR_ADDRESSES[environment],
//       holographOperatorABI,
//       destinationWallet,
//     )

//     // console.log(holographOperator)

//     const totalPods = await holographOperator.getTotalPods()
//     this.log(`Total Pods: ${totalPods}`)

//     //   if (!pod) {
//     //     const prompt: any = await inquirer.prompt([
//     //       {
//     //         name: 'pod',
//     //         message: 'Enter the pod number to join',
//     //         type: 'list',
//     //         choices: [1, 2, 3, 4],
//     //         default: undefined,
//     //       },
//     //     ])
//     //     pod = prompt.pod
//     //   }

//     //   this.log(`Joining pod: ${pod}`)

//     //   if (!amount) {
//     //     const prompt: any = await inquirer.prompt([
//     //       {
//     //         name: 'amount',
//     //         message: 'Enter the amount of tokens to deposit (Units in Ether)',
//     //         type: 'list',
//     //         default: undefined,
//     //       },
//     //     ])
//     //     amount = prompt.amount
//     //   }

//     //   this.log(`Depositing ${amount} tokens`)
//   }
// }
