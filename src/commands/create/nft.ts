/*

User Story

AA user

IWT Mint an NFT

STI can test collection and NFT

Description

We want to allow a user to deploy an NFT through the CLI.

AC

holo deploy:nft --collectionAddress ${COLLECRTION_ADDRESS} --file ${FILE} --network ${NETWORK} --unsafePasssword

The file is { name: "", description: "", … }

Check if file object has the right schema

if file is missing provide a warning

If unsafePassword is missing prompt the user

*/
import {CliUx, Command, Flags} from '@oclif/core'
import * as inquirer from 'inquirer'
import * as fs from 'fs-extra'
import {ethers, BigNumber} from 'ethers'
import {TransactionReceipt} from '@ethersproject/abstract-provider'
import {ensureConfigFileIsValid} from '../../utils/config'
import {networkFlag, BlockJob, NetworkMonitor} from '../../utils/network-monitor'
import {getEnvironment} from '../../utils/environment'

export enum TokenUriType {
  unset, //  0
  ipfs, //   1
  https, //  2
  arweave, // 3
}

const validateContractAddress = async (input: string): Promise<string> => {
  const output: string = input.trim().toLowerCase()
  if (/^0x[\da-f]{40}$/.test(output)) {
    // we have a valid hex
    return output
  }

  throw new Error('Invalid contact address provided ' + output)
}

const cleanTokenInput = async (input: string): Promise<string> => {
  const output: string = input.trim()
  if (/^\d+$/.test(output)) {
    // we have a pure number
    return BigNumber.from(output).toHexString()
  }

  if (/^(?:0x|)[\da-f]{1,64}$/.test(output)) {
    // we have a valid hex
    return output
  }

  throw new Error('Invalid tokenId provided ' + output)
}

export default class NFT extends Command {
  static description = 'Mint a Holographable NFT'

  static examples = [
    '$ holo create:nft --network="goerli" --collectionAddress="0x70f5b2f4f7e31353d75ad069053906a72ce75467" --tokenId="0" --tokenUriType="ipfs" --tokenUri="QmfQhPGMAbHL31qcqAEYpSP5gXwXWQa3HZjkNVzZ2mRsRs/metadata.json"',
  ]

  static flags = {
    collectionAddress: Flags.string({
      description: 'The address of the collection smart contract.',
      parse: validateContractAddress,
      multiple: false,
      required: true,
    }),
    tokenId: Flags.string({
      description: 'The token id to mint. By default the token id is 0, which mints the next available token id.',
      default: '0',
      parse: cleanTokenInput,
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

    let network: string = flags.network as string
    const collectionAddress: string = flags.collectionAddress as string
    const tokenId: string = flags.tokenId as string
    const tokenUriType: TokenUriType = TokenUriType[flags.tokenUriType as string as keyof typeof TokenUriType]
    const tokenUri: string = flags.tokenUri as string

    if (!Object.keys(configFile.networks).includes(network)) {
      const networkPrompt: any = await inquirer.prompt([
        {
          name: 'network',
          message: 'select the network on which to mint the nft',
          type: 'list',
          choices: Object.keys(configFile.networks),
        },
      ])
      network = networkPrompt.network
    }

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
    }

    this.exit()
  }
}
