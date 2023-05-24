import * as inquirer from 'inquirer'

import {CliUx, Command, Flags} from '@oclif/core'
import {Contract} from '@ethersproject/contracts'
import {TransactionReceipt} from '@ethersproject/abstract-provider'
import {getEnvironment} from '@holographxyz/environment'
import {networks} from '@holographxyz/networks'

import {ensureConfigFileIsValid} from '../../utils/config'
import {networkFlag, NetworkMonitor} from '../../utils/network-monitor'
import {
  validateContractAddress,
  validateNonEmptyString,
  validateTokenIdInput,
  checkContractAddressFlag,
  checkOptionFlag,
  checkStringFlag,
  checkUriTypeFlag,
  checkNumberFlag,
} from '../../utils/validation'
import {UriTypeIndex} from '../../utils/asset-deployment'
import {BigNumber, ethers} from 'ethers'
import {decodeErc721TransferEvent} from '../../events/events'
import {getABIs} from '../../utils/contracts'
import {safeStringify} from '../../utils/utils'

export default class NFT extends Command {
  static description = 'Mint a Holographable NFT.'
  static examples = [
    '$ <%= config.bin %> <%= command.id %> --network="goerli" --collectionAddress="0xf90c33d5ef88a9d84d4d61f62c913ba192091fe7" --tokenId="0" --uriType="ipfs" --uri="QmfQhPGMAbHL31qcqAEYpSP5gXwXWQa3HZjkNVzZ2mRsRs/metadata.json"',
  ]

  static flags = {
    collectionAddress: Flags.string({
      description: 'The address of the collection smart contract',
      parse: validateContractAddress,
      multiple: false,
      required: false,
    }),
    tokenId: Flags.string({
      description: 'The token id to mint. By default the token id is 0, which mints the next available token id',
      default: '0',
      parse: validateTokenIdInput,
      multiple: false,
      required: false,
    }),
    uriType: Flags.string({
      description: 'The token URI type',
      multiple: false,
      options: ['ipfs', 'https', 'arweave'],
      required: false,
    }),
    uri: Flags.string({
      description: 'The uri of the token, minus the prepend (ie "ipfs://")',
      multiple: false,
      required: false,
      parse: validateNonEmptyString,
    }),
    ...networkFlag,
  }

  /**
   * NFT class variables
   */
  networkMonitor!: NetworkMonitor

  public async run(): Promise<void> {
    this.log('Loading user configurations...')
    const environment = getEnvironment()
    const abis = await getABIs(environment)
    const {userWallet, configFile, supportedNetworksOptions} = await ensureConfigFileIsValid(
      this.config.configDir,
      undefined,
      true,
    )

    const {flags} = await this.parse(NFT)
    this.log('User configurations loaded.')

    const network: string = await checkOptionFlag(
      supportedNetworksOptions,
      flags.network,
      'Select the network on which to mint the nft',
    )
    const collectionAddress: string = await checkContractAddressFlag(
      flags.collectionAddress,
      'Enter the address of the collection smart contract',
    )

    this.networkMonitor = new NetworkMonitor({
      parent: this,
      configFile,
      networks: [network],
      debug: this.debug,
      userWallet,
      verbose: false,
    })

    CliUx.ux.action.start('Loading network RPC providers')
    await this.networkMonitor.run(true)
    CliUx.ux.action.stop()

    CliUx.ux.action.start('Checking that contract is already deployed and holographable on "' + network + '" network')
    const isDeployed: boolean = await this.networkMonitor.registryContract
      .connect(this.networkMonitor.providers[network])
      .isHolographedContract(collectionAddress)
    CliUx.ux.action.stop()
    if (!isDeployed) {
      throw new Error(
        'Collection is either not deployed or not hologaphable at ' +
          collectionAddress +
          ' on "' +
          network +
          '" network',
      )
    }

    // Select the contract type to deploy
    const collectionType = await checkOptionFlag(
      ['CxipERC721', 'HolographDropERC721'],
      undefined,
      "Select the type of collection you'd like to mint from",
    )

    // Load the ABI for the collection type to mint from
    let collectionABI: string
    switch (collectionType) {
      case 'CxipERC721':
        collectionABI = abis.CxipERC721ABI
        break
      case 'HolographDropERC721':
        collectionABI = abis.HolographDropERC721ABI
        break
      default:
        this.log('Invalid collection type')
        return
    }

    CliUx.ux.action.start('Retrieving collection smart contract')

    const collection: Contract = new Contract(collectionAddress, collectionABI, this.networkMonitor.providers[network])
    CliUx.ux.action.stop()

    let receipt: TransactionReceipt | null = null

    if (collectionType === 'CxipERC721') {
      const tokenId: string = flags.tokenId as string
      const uriType: UriTypeIndex =
        UriTypeIndex[
          await checkUriTypeFlag(flags.uriType, 'Select the uri of the token, minus the prepend (ie "ipfs://")')
        ]
      const uri: string = await checkStringFlag(
        flags.uri,
        'Enter the uri of the token, minus the prepend (ie "ipfs://")',
      )

      const mintPrompt: any = await inquirer.prompt([
        {
          name: 'shouldContinue',
          message: `\nWould you like to mint the following NFT?\n\n${JSON.stringify(
            {
              network: networks[network].shortKey,
              collectionAddress,
              tokenId,
              uriType: UriTypeIndex[uriType],
              uri,
            },
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
        receipt = await this.networkMonitor.executeTransaction({
          network,
          contract: collection,
          methodName: 'cxipMint',
          args: [tokenId, uriType, uri],
          waitForReceipt: true,
        })
        CliUx.ux.action.stop()
      } else {
        this.log('NFT minting was canceled')
        this.exit()
      }
    } else if (collectionType === 'HolographDropERC721') {
      const numToMint = await checkNumberFlag(undefined, 'How many NFTs would you like to mint/purchase?')
      // Connect wallet for signing txns
      const account = userWallet.connect(this.networkMonitor.providers[network])
      userWallet.connect(this.networkMonitor.providers[network])

      // Interact with drop contract
      const drop = new ethers.Contract(collectionAddress, collectionABI, account)
      const nativePrice = (await drop.getNativePrice()).mul(numToMint)

      // Confirm if user wants to mint
      const mintPrompt: any = await inquirer.prompt([
        {
          name: 'shouldContinue',
          message: `\nMinting ${numToMint} NFTs from the following collection: ${safeStringify(drop)} at ${
            drop.address
          } for ${ethers.utils.formatEther(nativePrice)} ${networks[network].tokenSymbol} on ${network}.\n`,
          type: 'confirm',
          default: false,
        },
      ])
      const mint: boolean = mintPrompt.shouldContinue

      if (mint) {
        receipt = await this.networkMonitor.executeTransaction({
          gasLimit: BigNumber.from('700000'),
          network,
          contract: collection,
          value: nativePrice, // must send the price of the drop times the number to purchase
          methodName: 'purchase',
          args: [numToMint],
          waitForReceipt: true,
        })

        CliUx.ux.action.stop()
      } else {
        this.log('NFT minting was canceled')
        this.exit()
      }
    } else {
      this.log('Invalid collection type')
      return
    }

    if (receipt === null) {
      throw new Error('Failed to confirm that the transaction was mined')
    } else {
      const logs: any[] | undefined = decodeErc721TransferEvent(receipt, collectionAddress)
      if (logs === undefined) {
        throw new Error('Failed to extract transfer event from transaction receipt')
      } else {
        this.log(`NFT has been minted with token id #${logs[2].toString()}`)
      }
    }

    this.exit()
  }
}
