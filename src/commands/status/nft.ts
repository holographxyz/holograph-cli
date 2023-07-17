import * as inquirer from 'inquirer'

import {CliUx, Command, Flags} from '@oclif/core'
import {ethers} from 'ethers'

import {ensureConfigFileIsValid} from '../../utils/config'
import {addressValidator, tokenValidator} from '../../utils/validation'
import {networks} from '@holographxyz/networks'
import {NetworkMonitor} from '../../utils/network-monitor'

export default class Nft extends Command {
  static LAST_BLOCKS_FILE_NAME = 'blocks.json'
  static description = 'Check the status of an NFT across all networks defined in the config.'
  static examples = [
    '$ <%= config.bin %> <%= command.id %> --address="0x5059bf8E4De43ccc0C27ebEc9940e2310E071A78" --id=1',
  ]

  static flags = {
    address: Flags.string({
      description: 'The address of contract to check status of',
    }),
    id: Flags.string({
      description: 'Token ID to check',
    }),
    output: Flags.string({
      options: ['csv', 'json', 'yaml', ''],
      description: 'Define table output type',
      default: 'yaml',
    }),
  }

  tokenId!: string
  contractAddress!: string

  networkMonitor!: NetworkMonitor
  registryAddress!: string
  supportedNetworks: string[] = []
  holograph!: ethers.Contract
  registryContract!: ethers.Contract
  erc721Contract!: ethers.Contract

  async validateContractAddress(): Promise<void> {
    if (this.contractAddress === '') {
      const prompt: any = await inquirer.prompt([
        {
          name: 'contractAddress',
          message: 'Enter the contract address to check status of',
          type: 'string',
          validate: async (input: string) => {
            return addressValidator.test(input) ? true : 'Input is not a valid contract address'
          },
        },
      ])
      this.contractAddress = prompt.contractAddress
    }

    if (!addressValidator.test(this.contractAddress)) {
      throw new Error(`Invalid contract address: ${this.contractAddress}`)
    }
  }

  async validateTokenId(): Promise<void> {
    if (this.tokenId === '') {
      const prompt: any = await inquirer.prompt([
        {
          name: 'tokenId',
          message: 'Provide a token ID to get status for',
          type: 'string',
          validate: async (input: string) => {
            return tokenValidator.test(input) ? true : 'Input is neither a valid number or 32-byte hex string'
          },
        },
      ])
      this.tokenId = prompt.tokenId
    }

    if (!tokenValidator.test(this.tokenId)) {
      this.error('Invalid token ID')
    }
  }

  /**
   * Command Entry Point
   */
  async run(): Promise<void> {
    this.log('Loading user configurations...')
    const {configFile} = await ensureConfigFileIsValid(this.config.configDir, undefined, false)
    this.log('User configurations loaded.')

    const {flags} = await this.parse(Nft)
    this.contractAddress = flags.address || ''
    this.tokenId = flags.id || ''
    await this.validateContractAddress()
    await this.validateTokenId()

    this.supportedNetworks = Object.keys(configFile.networks)

    this.networkMonitor = new NetworkMonitor({
      parent: this,
      configFile,
      debug: this.debug,
      userWallet: undefined,
      verbose: false,
    })

    CliUx.ux.action.start('Loading network RPC providers')
    await this.networkMonitor.run(true)
    CliUx.ux.action.stop()

    // data we want
    // network -- deployed -- valid -- address -- explorer link
    const data: {network: string; deployed: boolean; valid: boolean; exists: boolean; owner: string; link: string}[] =
      []
    for (const network of this.supportedNetworks) {
      const d: {network: string; deployed: boolean; valid: boolean; exists: boolean; owner: string; link: string} = {
        network,
        deployed: false,
        valid: false,
        exists: false,
        owner: '0x',
        link: '',
      }
      const provider = this.networkMonitor.providers[network]
      const registry = this.networkMonitor.registryContract.connect(provider)
      const erc721 = this.networkMonitor.cxipERC721Contract.connect(provider)
      const code = await provider.getCode(this.contractAddress, 'latest')
      const token = ethers.BigNumber.from(this.tokenId)
      if (code === '0x') {
        // do nothing
      } else {
        d.deployed = true

        d.valid = await registry.isHolographedContract(this.contractAddress)
        if (d.valid) {
          d.exists = await erc721.exists(token.toHexString())
          if (d.exists) {
            d.owner = await erc721.ownerOf(token.toHexString())
            d.link = (networks[network].explorer || '') + '/token/' + this.contractAddress + '?a=' + token.toString()
          }
        }
      }

      data.push(d)
    }

    CliUx.ux.table(
      data,
      {
        network: {
          header: 'Network',
        },
        deployed: {
          header: 'Deployed',
        },
        valid: {
          header: 'Valid',
        },
        exists: {
          header: 'Exists',
        },
        owner: {
          header: 'Owner',
        },
        link: {
          header: 'Explorer Link',
        },
      },
      {
        printLine: this.log.bind(this),
        'no-truncate': true,
        'no-header': false,
        output: flags.output,
      },
    )
    this.exit()
  }
}
