import * as fs from 'fs-extra'
import * as inquirer from 'inquirer'

import {CliUx, Command, Flags} from '@oclif/core'
import {ethers} from 'ethers'

import {ensureConfigFileIsValid} from '../../utils/config'
import {ConfigFile, ConfigNetwork, ConfigNetworks} from '../../utils/config'
import {addressValidator} from '../../utils/validation'
import {Environment, getEnvironment} from '@holographxyz/environment'
import {HOLOGRAPH_ADDRESSES} from '../../utils/contracts'
import {networks} from '@holographxyz/networks'

export default class Contract extends Command {
  static LAST_BLOCKS_FILE_NAME = 'blocks.json'
  static description = 'Check the status of a contract across all networks defined in the config'
  static examples = ['$ <%= config.bin %> <%= command.id %> --address="0x5059bf8E4De43ccc0C27ebEc9940e2310E071A78"']

  static flags = {
    address: Flags.string({
      description: 'The address of contract to check status of',
    }),
    output: Flags.string({
      options: ['csv', 'json', 'yaml', ''],
      description: 'Define table output type',
      default: 'yaml',
    }),
  }

  registryAddress!: string
  supportedNetworks: string[] = []
  contractAddress!: string

  providers: {[key: string]: ethers.providers.JsonRpcProvider | ethers.providers.WebSocketProvider} = {}
  holograph!: ethers.Contract
  registryContract!: ethers.Contract
  ownableContract!: ethers.Contract

  async initializeEthers(configFile: ConfigFile, environment: Environment): Promise<void> {
    for (let i = 0, l = this.supportedNetworks.length; i < l; i++) {
      const network = this.supportedNetworks[i]
      const rpcEndpoint = (configFile.networks[network as keyof ConfigNetworks] as ConfigNetwork).providerUrl
      const protocol = new URL(rpcEndpoint).protocol
      switch (protocol) {
        case 'https:':
          this.providers[network] = new ethers.providers.JsonRpcProvider(rpcEndpoint)

          break
        case 'wss:':
          this.providers[network] = new ethers.providers.WebSocketProvider(rpcEndpoint)
          break
        default:
          throw new Error('Unsupported RPC provider protocol -> ' + protocol)
      }
    }

    const holographABI = await fs.readJson(`./src/abi/${environment}/Holograph.json`)
    this.holograph = new ethers.Contract(
      HOLOGRAPH_ADDRESSES[environment],
      holographABI,
      this.providers[this.supportedNetworks[0]],
    )

    const holographRegistryABI = await fs.readJson(`./src/abi/${environment}/HolographRegistry.json`)
    this.registryAddress = await this.holograph.getRegistry()
    this.registryContract = new ethers.Contract(
      this.registryAddress,
      holographRegistryABI,
      this.providers[this.supportedNetworks[0]],
    )
    const ownerABI = await fs.readJson(`./src/abi/${environment}/Owner.json`)
    this.ownableContract = new ethers.Contract(
      this.contractAddress,
      ownerABI,
      this.providers[this.supportedNetworks[0]],
    )
  }

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

  /**
   * Command Entry Point
   */
  async run(): Promise<void> {
    this.log('Loading user configurations...')
    const environment = getEnvironment()
    const {configFile} = await ensureConfigFileIsValid(this.config.configDir, undefined, false)
    this.log('User configurations loaded.')

    const {flags} = await this.parse(Contract)
    this.contractAddress = flags.address || ''
    await this.validateContractAddress()

    this.supportedNetworks = Object.keys(configFile.networks)

    await this.initializeEthers(configFile, environment)

    // data we want
    // network -- deployed -- valid -- address -- explorer link
    const data: {network: string; deployed: boolean; valid: boolean; owner: string; link: string}[] = []
    for (const network of this.supportedNetworks) {
      const d: {network: string; deployed: boolean; valid: boolean; owner: string; link: string} = {
        network,
        deployed: false,
        valid: false,
        owner: '0x',
        link: '',
      }
      const provider = this.providers[network]
      const registry = this.registryContract.connect(provider)
      const ownable = this.ownableContract.connect(provider)
      // eslint-disable-next-line no-await-in-loop
      const code = await provider.getCode(this.contractAddress, 'latest')
      if (code === '0x') {
        // do nothing
      } else {
        d.deployed = true
        // eslint-disable-next-line no-await-in-loop
        d.valid = await registry.isHolographedContract(this.contractAddress)
        d.link = (networks[network].explorer || '') + '/address/' + this.contractAddress
        // eslint-disable-next-line no-await-in-loop
        d.owner = await ownable.getOwner()
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
