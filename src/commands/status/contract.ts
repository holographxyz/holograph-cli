import * as inquirer from 'inquirer'

import {CliUx, Command, Flags} from '@oclif/core'
import {ethers} from 'ethers'

import {ensureConfigFileIsValid} from '../../utils/config'
import {addressValidator} from '../../utils/validation'
import {networks} from '@holographxyz/networks'
import {NetworkMonitor} from '../../utils/network-monitor'

export default class Contract extends Command {
  static LAST_BLOCKS_FILE_NAME = 'blocks.json'
  static description = 'Check the status of a contract across all networks defined in the config.'
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

  networkMonitor!: NetworkMonitor
  registryAddress!: string
  supportedNetworks: string[] = []
  contractAddress!: string
  holograph!: ethers.Contract
  registryContract!: ethers.Contract
  ownableContract!: ethers.Contract

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

    const abis = await getABIs(environment)
    this.ownableContract = new ethers.Contract(
      this.contractAddress,
      abis.OwnerABI,
      this.networkMonitor.providers[this.supportedNetworks[0]],
    )

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
      const provider = this.networkMonitor.providers[network]
      const registry = this.networkMonitor.registryContract.connect(provider)
      const ownable = this.ownableContract.connect(provider)
      const code = await provider.getCode(this.contractAddress, 'latest')
      if (code === '0x') {
        // do nothing
      } else {
        d.deployed = true
        d.valid = await registry.isHolographedContract(this.contractAddress)
        d.link = (networks[network].explorer || '') + '/address/' + this.contractAddress
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
