import {CliUx, Command, Flags} from '@oclif/core'
import {BigNumber, providers} from 'ethers'
import * as inquirer from 'inquirer'

import {getNetworkByKey} from '@holographxyz/networks'
import color from '@oclif/color'
import {formatEther} from 'ethers/lib/utils'
import CoreChainService from '../../services/core-chain-service'
import TokenChainService from '../../services/token-chain-service'
import FaucetService, {FaucetInfo} from '../../services/faucet-service'
import {ConfigNetwork, ConfigNetworks, ensureConfigFileIsValid} from '../../utils/config'
import {checkOptionFlag} from '../../utils/validation'

export default class Faucet extends Command {
  static description = 'Request tokens from a faucet'
  static examples = ['$ <%= config.bin %> <%= command.id %> --network=<network>']
  static flags = {
    network: Flags.string({
      description: 'The network to bond to',
      char: 'n',
    }),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(Faucet)
    let {network} = flags
    let prompt: any

    prompt = await inquirer.prompt([
      {
        name: 'continue',
        message: 'Would you like to request $HLG tokens?',
        type: 'confirm',
        default: false,
      },
    ])
    if (!prompt.continue) {
      this.log('Exiting...')
      this.exit()
    }

    this.log('Loading user configurations...')
    const {userWallet, configFile, supportedNetworksOptions} = await ensureConfigFileIsValid(
      this.config.configDir,
      undefined,
      true,
    )

    network = await checkOptionFlag(supportedNetworksOptions, network, 'Select the network to request tokens on')

    const networkName = getNetworkByKey(network).shortKey
    this.log(`Joining network: ${networkName}`)

    CliUx.ux.action.start('Loading network RPC provider')
    const destinationProviderUrl: string = (configFile.networks[network as keyof ConfigNetworks] as ConfigNetwork)
      .providerUrl
    const networkProtocol: string = new URL(destinationProviderUrl).protocol
    let provider
    switch (networkProtocol) {
      case 'https:':
        provider = new providers.JsonRpcProvider(destinationProviderUrl)
        break
      case 'wss:':
        provider = new providers.WebSocketProvider(destinationProviderUrl)
        break
      default:
        throw new Error('Unsupported RPC URL protocol -> ' + networkProtocol)
    }

    CliUx.ux.action.stop()

    CliUx.ux.action.start('Checking RPC connection')
    const listening = await provider.send('net_listening', [])
    CliUx.ux.action.stop()
    if (!listening) {
      throw new Error('RPC connection failed')
    }

    this.log('RPC connection successful')

    const wallet = userWallet?.connect(provider)

    // Setup the contracts and chain services
    const coreChainService = new CoreChainService(provider, wallet, getNetworkByKey(network).chain)
    await coreChainService.initialize()
    const tokenContract = await coreChainService.getUtilityToken()
    const faucetContract = await coreChainService.getFaucet()
    const tokenChainService = new TokenChainService(provider, wallet, getNetworkByKey(network).chain, tokenContract)
    const faucetService = new FaucetService(provider, wallet, getNetworkByKey(network).chain, faucetContract)
    const currentHlgBalance = (await tokenChainService.balanceOf(wallet.address)) as BigNumber
    this.log(`Current $HLG balance: ${formatEther(currentHlgBalance)}`)

    const faucetInfo: FaucetInfo = await faucetService.getFaucetInfo(wallet.address)

    if (faucetInfo.isAllowedToWithdraw === false) {
      this.log(
        color.red(
          `You are not allowed to withdraw from the faucet on ${networkName}. Please wait 24 hours since your last withdrawal.\n` +
            `Current cooldown time is ${faucetInfo.cooldown} seconds`,
        ),
      )
      this.exit()
    }

    const faucetFee = await faucetService.getFaucetFee(wallet.address)
    if (faucetFee.hasEnoughBalance === false) {
      this.log(
        color.red(
          `You do not have enough ${networkName} gas tokens to pay for withdrawal of $HLG from the faucet.\n` +
            `Please deposit more ${networkName} gas tokens and try again.`,
        ),
      )
      this.exit()
    }

    this.log(`Requesting $HLG tokens from faucet...`)
    prompt = await inquirer.prompt([
      {
        name: 'continue',
        message:
          `You are about to withdraw ${faucetInfo.amount} $HLG from the faucet.\n` +
          `The gas cost will be ${faucetFee.fee}. Continue?`,
        type: 'confirm',
        default: false,
      },
    ])
    if (!prompt.continue) {
      this.log('Exiting...')
      this.exit()
    }

    try {
      CliUx.ux.action.start('Sending request for tokens transaction to mempool')
      const receipt = await faucetService.requestTokens()
      CliUx.ux.action.stop(`Transaction mined and confirmed. Transaction hash is ${receipt.transactionHash}`)
    } catch (error: any) {
      this.error(error.error.reason)
    }

    this.log(
      color.green(
        `Request for tokens on ${networkName} has been granted. You can return to request more tokens in 24 hours. Enjoy! 🤑`,
      ),
    )
  }
}
