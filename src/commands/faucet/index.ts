import * as inquirer from 'inquirer'

import {CliUx, Command} from '@oclif/core'
import color from '@oclif/color'
import {BigNumber} from '@ethersproject/bignumber'
import {formatUnits} from '@ethersproject/units'
import {TransactionReceipt} from '@ethersproject/providers'
import {networks} from '@holographxyz/networks'

import CoreChainService from '../../services/core-chain-service'
import TokenChainService from '../../services/token-chain-service'
import FaucetService, {FaucetInfo} from '../../services/faucet-service'
import {NetworkMonitor, networkFlag} from '../../utils/network-monitor'

import {ensureConfigFileIsValid} from '../../utils/config'
import {checkOptionFlag} from '../../utils/validation'

export default class Faucet extends Command {
  static description = 'Request Testnet HLG from a faucet.'
  static examples = ['$ <%= config.bin %> <%= command.id %> --network="goerli"']
  static flags = {
    ...networkFlag,
  }

  networkMonitor!: NetworkMonitor

  async run(): Promise<void> {
    const {flags} = await this.parse(Faucet)
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

    const network: string = await checkOptionFlag(
      supportedNetworksOptions,
      flags.network,
      'Select the network to request tokens on',
    )

    this.log(`Joining network: ${networks[network].shortKey}`)

    this.networkMonitor = new NetworkMonitor({
      parent: this,
      configFile,
      networks: [network],
      debug: this.debug,
      userWallet,
      verbose: false,
    })

    CliUx.ux.action.start('Loading network RPC provider')
    await this.networkMonitor.run(true)
    CliUx.ux.action.stop()

    // Setup the contracts and chain services
    const coreChainService = new CoreChainService(network, this.networkMonitor)
    await coreChainService.initialize()
    const tokenContract = await coreChainService.getUtilityToken()
    const faucetContract = await coreChainService.getFaucet()
    const tokenChainService = new TokenChainService(network, this.networkMonitor, tokenContract)
    const faucetService = new FaucetService(network, this.networkMonitor, faucetContract)
    const currentHlgBalance = BigNumber.from(await tokenChainService.balanceOf(coreChainService.wallet.address))
    this.log(`Current $HLG balance: ${formatUnits(currentHlgBalance, 'ether')}`)

    const faucetInfo: FaucetInfo = await faucetService.getFaucetInfo(coreChainService.wallet.address)

    if (faucetInfo.isAllowedToWithdraw === false) {
      this.log(
        color.red(
          `You are not allowed to withdraw from the faucet on ${networks[network].shortKey}. Please wait 24 hours since your last withdrawal.\n` +
            `Current cooldown time is ${faucetInfo.cooldown} seconds`,
        ),
      )
      this.exit()
    }

    const faucetFee = await faucetService.getFaucetFee(coreChainService.wallet.address)
    if (faucetFee.hasEnoughBalance === false) {
      this.log(
        color.red(
          `You do not have enough ${networks[network].tokenSymbol} to pay for withdrawal of $HLG from the faucet.\n` +
            `Please deposit more ${networks[network].tokenSymbol} and try again.`,
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
          `The gas cost will be approximately ${faucetFee.fee} ${networks[network].tokenSymbol}. Continue?`,
        type: 'confirm',
        default: false,
      },
    ])
    if (!prompt.continue) {
      this.log('Exiting...')
      this.exit()
    }

    this.log('Sending request for tokens')
    const receipt: TransactionReceipt | null = await faucetService.requestTokens()

    if (receipt === null) {
      this.log(color.red(`Could not confirm the success of transaction.`))
    } else {
      this.log(
        color.green(
          `Request for tokens on ${networks[network].shortKey} has been granted. You can return to request more tokens in 24 hours. Enjoy! 🤑`,
        ),
      )
    }

    this.exit()
  }
}
