import * as inquirer from 'inquirer'
import * as fs from 'fs-extra'
import path from 'node:path'

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
} from '../../utils/validation'
import {UriTypeIndex} from '../../utils/asset-deployment'
import {ethers} from 'ethers'

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
    const tokenId: string = flags.tokenId as string
    const uriType: UriTypeIndex =
      UriTypeIndex[
        await checkUriTypeFlag(flags.uriType, 'Select the uri of the token, minus the prepend (ie "ipfs://")')
      ]
    const uri: string = await checkStringFlag(flags.uri, 'Enter the uri of the token, minus the prepend (ie "ipfs://")')

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
      ['CxipERC721', 'HolographERC721Drop'],
      undefined,
      "Select the type of collection you'd like to mint from",
    )

    let abiPath: string
    switch (collectionType) {
      case 'CxipERC721':
        abiPath = path.join(__dirname, `../../abi/${environment}/CxipERC721.json`)
        break
      case 'HolographERC721Drop':
        abiPath = path.join(__dirname, `../../abi/${environment}/HolographERC721Drop.json`)
        break
      default:
        throw new Error('Invalid collection type')
        break
    }

    CliUx.ux.action.start('Retrieving collection smart contract')
    const collectionABI = await fs.readJson(abiPath)
    const collection: Contract = new Contract(collectionAddress, collectionABI, this.networkMonitor.providers[network])
    CliUx.ux.action.stop()

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

      if (collectionType === 'CxipERC721') {
        const receipt: TransactionReceipt | null = await this.networkMonitor.executeTransaction({
          network,
          contract: collection,
          methodName: 'cxipMint',
          args: [tokenId, uriType, uri],
          waitForReceipt: true,
        })
        CliUx.ux.action.stop()

        if (receipt === null) {
          throw new Error('Failed to confirm that the transaction was mined')
        } else {
          const logs: any[] | undefined = this.networkMonitor.decodeErc721TransferEvent(receipt, collectionAddress)
          if (logs === undefined) {
            throw new Error('Failed to extract transfer event from transaction receipt')
          } else {
            this.log(`NFT has been minted with token id #${logs[2].toString()}`)
          }
        }
      } else if (collectionType === 'HolographERC721Drop') {
        // Connect wallet for signing txns
        const {userWallet} = await ensureConfigFileIsValid(this.config.configDir, undefined, true)
        const account = userWallet.connect(this.networkMonitor.providers[network])
        userWallet.connect(this.networkMonitor.providers[network])
        const drop = new ethers.Contract(collectionAddress, collectionABI, account)
        // const receipt = await drop.purchase(1, {
        //   value: ethers.utils.parseEther('0.01'),
        //   gasPrice: ethers.BigNumber.from(100_000_000_000), // 100 gwei
        //   gasLimit: ethers.BigNumber.from(7_000_000), // 7 million
        // })
        // console.log(receipt)

        const r = await drop.saleDetails()
        console.log(r)
        console.log(r.publicSalePrice)

        // TODO: We might use the network monitor to execute the transaction instead of ethers directly
        const receipt: TransactionReceipt | null = await this.networkMonitor.executeTransaction({
          network,
          contract: collection,
          value: r.publicSalePrice,
          methodName: 'purchase',
          args: [1],
          waitForReceipt: true,
          gasPrice: ethers.BigNumber.from(100_000_000_000), // 100 gwei
          gasLimit: ethers.BigNumber.from(1_000_000), // 1 million
        })
        CliUx.ux.action.stop()

        console.log(receipt)

        if (receipt === null) {
          throw new Error('Failed to confirm that the transaction was mined')
        } else {
          const logs: any[] | undefined = this.networkMonitor.decodeErc721TransferEvent(receipt, collectionAddress)
          if (logs === undefined) {
            throw new Error('Failed to extract transfer event from transaction receipt')
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
}
