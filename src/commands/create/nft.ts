import {CliUx, Command, Flags} from '@oclif/core'
import * as inquirer from 'inquirer'
import * as fs from 'fs-extra'
import {ethers} from 'ethers'
import {TransactionReceipt} from '@ethersproject/abstract-provider'
import {ensureConfigFileIsValid} from '../../utils/config'
import {networkFlag, BlockJob, NetworkMonitor} from '../../utils/network-monitor'
import {getEnvironment} from '../../utils/environment'
import {validateContractAddress, validateTokenIdInput, checkContractAddressFlag, checkNetworkFlag} from '../../utils/validation'

export enum TokenUriType {
  unset, //   0
  ipfs, //    1
  https, //   2
  arweave, // 3
}

export default class NFT extends Command {
  static description = 'Mint a Holographable NFT'
  static examples = [
    '$ holograph create:nft --network="goerli" --collectionAddress="0x70f5b2f4f7e31353d75ad069053906a72ce75467" --tokenId="0" --tokenUriType="ipfs" --tokenUri="QmfQhPGMAbHL31qcqAEYpSP5gXwXWQa3HZjkNVzZ2mRsRs/metadata.json"',
  ]

  static flags = {
    collectionAddress: Flags.string({
      description: 'The address of the collection smart contract.',
      parse: validateContractAddress,
      multiple: false,
      required: false,
    }),
    tokenId: Flags.string({
      description: 'The token id to mint. By default the token id is 0, which mints the next available token id.',
      default: '0',
      parse: validateTokenIdInput,
      multiple: false,
      required: false,
    }),
    tokenUriType: Flags.string({
      description: 'The token URI type.',
      multiple: false,
      options: ['ipfs', 'https', 'arweave'],
      default: 'ipfs',
      required: false,
    }),
    tokenUri: Flags.string({
      description: 'The uri of the token, minus the prepend (ie "ipfs://").',
      multiple: false,
      required: true,
    }),
    ...networkFlag,
  }

  /**
   * NFT class variables
   */
  networkMonitor!: NetworkMonitor

  async fakeProcessor(job: BlockJob, transactions: ethers.providers.TransactionResponse[]): Promise<void> {
    this.networkMonitor.structuredLog(
      job.network,
      `This should not trigger: ${JSON.stringify(transactions, undefined, 2)}`,
    )
    Promise.resolve()
  }

  public async run(): Promise<void> {
    this.log('Loading user configurations...')
    const environment = getEnvironment()
    const {userWallet, configFile} = await ensureConfigFileIsValid(this.config.configDir, undefined, true)

    const {flags} = await this.parse(NFT)
    this.log('User configurations loaded.')

    const network: string = await checkNetworkFlag(configFile.networks, flags.network, 'Select the network on which to mint the nft.')
    const collectionAddress: string = await checkContractAddressFlag(flags.collectionAddress, 'Enter the address of the collection smart contract.')
    const tokenId: string = flags.tokenId as string
    const tokenUriType: TokenUriType = TokenUriType[flags.tokenUriType as string as keyof typeof TokenUriType]
    const tokenUri: string = flags.tokenUri as string

    this.networkMonitor = new NetworkMonitor({
      parent: this,
      configFile,
      networks: [network],
      debug: this.debug,
      processTransactions: this.fakeProcessor,
      userWallet,
    })

    CliUx.ux.action.start('Loading network RPC providers')
    await this.networkMonitor.initializeEthers()
    CliUx.ux.action.stop()

    CliUx.ux.action.start('Retrieving collection smart contract')
    const collectionABI = await fs.readJson(`./src/abi/${environment}/CxipERC721.json`)
    const collection = new ethers.ContractFactory(collectionABI, this.networkMonitor.wallets[network].address).attach(
      collectionAddress,
    )
    CliUx.ux.action.stop()

    const mintPrompt: any = await inquirer.prompt([
      {
        name: 'shouldContinue',
        message: `\nWould you like to mint the following NFT?\n\n${JSON.stringify(
          {network, collectionAddress, tokenId, tokenUriType: TokenUriType[tokenUriType], tokenUri},
          undefined,
          2,
        )}\n`,
        type: 'confirm',
        default: false,
      },
    ])
    const mint: boolean = mintPrompt.shouldContinue

    if (mint) {
      CliUx.ux.action.start('Minting NFT')
      const receipt: TransactionReceipt | null = await this.networkMonitor.executeTransaction({
        network,
        contract: collection,
        methodName: 'cxipMint',
        args: [tokenId, tokenUriType, tokenUri],
        waitForReceipt: true,
      })
      CliUx.ux.action.stop()

      if (receipt === null) {
        throw new Error('failed to confirm that the transaction was mined')
      } else {
        const logs: any[] | undefined = this.networkMonitor.decodeErc721TransferEvent(receipt)
        if (logs === undefined) {
          throw new Error('failed to extract transfer event from transaction receipt')
        } else {
          this.log(`NFT has been minted with token id #${logs[2].toString()}`)
        }
      }
    } else {
      this.log('NFT minting was canceled')
    }

    this.exit()
  }
}
