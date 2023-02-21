import * as inquirer from 'inquirer'
import * as fs from 'fs-extra'

import {CliUx, Command} from '@oclif/core'
import {BytesLike} from '@ethersproject/bytes'
import {TransactionReceipt} from '@ethersproject/abstract-provider'
import {networks} from '@holographxyz/networks'

import {BytecodeType, bytecodes} from '../../utils/bytecodes'
import {ensureConfigFileIsValid} from '../../utils/config'
import {web3, zeroAddress, generateInitCode, remove0x, sha3} from '../../utils/utils'
import {NetworkMonitor} from '../../utils/network-monitor'
import {
  deploymentFlags,
  DeploymentType,
  DeploymentConfig,
  decodeDeploymentConfigInput,
} from '../../utils/contract-deployment'
import {Signature, strictECDSA} from '../../utils/signature'
import {
  HolographERC20Event,
  HolographERC721Event,
  allEventsEnabled,
  configureEvents,
} from '../../utils/holograph-contract-events'
import {
  validateBytes,
  checkBytecodeTypeFlag,
  checkDeploymentTypeFlag,
  checkNumberFlag,
  checkOptionFlag,
  checkStringFlag,
  checkTokenIdFlag,
  checkTransactionHashFlag,
} from '../../utils/validation'
import {ContractFactory} from 'ethers'

async function getCodeFromFile(prompt: string): Promise<string> {
  const codeFile: string = await checkStringFlag(undefined, prompt)
  if (await fs.pathExists(codeFile as string)) {
    return validateBytes(await fs.readFile(codeFile, 'utf8'))
  }

  throw new Error('The file "' + codeFile + '" does not exist.')
}

export default class Contract extends Command {
  static hidden = false
  static description = 'Deploy a Holographable contract.'
  static examples = [
    '$ <%= config.bin %> <%= command.id %> --deploymentType="deployedTx" --tx="0xdb8b393dd18a71b386c8de75b87310c0c8ded0c57cf6b4c5bab52873d54d1e8a" --txNetwork="goerli"',
  ]

  static flags = {
    ...deploymentFlags,
  }

  /**
   * Contract class variables
   */
  networkMonitor!: NetworkMonitor

  // eslint-disable-next-line complexity
  public async run(): Promise<void> {
    this.log('Loading user configurations...')
    const {userWallet, configFile, supportedNetworksOptions} = await ensureConfigFileIsValid(
      this.config.configDir,
      undefined,
      true,
    )

    const {flags} = await this.parse(Contract)
    this.log('User configurations loaded.')

    let configHash: BytesLike

    let tx!: string
    let txNetwork: string | undefined
    let deploymentConfig: DeploymentConfig = {
      config: {
        contractType: '',
        chainType: '',
        salt: '',
        byteCode: '',
        initCode: '',
      },
      signature: {
        r: '',
        s: '',
        v: 0,
      },
      signer: userWallet.address,
    } as DeploymentConfig
    let deploymentConfigFile: string | undefined

    this.networkMonitor = new NetworkMonitor({
      parent: this,
      configFile,
      debug: this.debug,
      userWallet,
      verbose: false,
    })

    CliUx.ux.action.start('Loading network RPC providers')
    await this.networkMonitor.run(true)
    CliUx.ux.action.stop()

    let chainType: string
    let chainId: string
    let salt: string
    let bytecodeType: BytecodeType
    const contractTypes: string[] = ['HolographERC20', 'HolographERC721', 'HolographERC721Drop']
    let contractType: string
    let contractTypeHash: string
    let byteCode: string
    let eventConfig: string = allEventsEnabled()
    let sourceInitCode: string = generateInitCode(['bytes'], ['0x00'])
    let initCode: string = generateInitCode(['bytes'], [sourceInitCode])

    let tokenName: string
    let tokenSymbol: string
    let domainSeperator: string
    const domainVersion = '1'
    let decimals: number

    let collectionName: string
    let collectionSymbol: string
    let royaltyBps: number

    // Drops
    let numOfEditions: number

    let configHashBytes: number[]
    let sig: string
    let signature: Signature
    let needToSign = false

    const deploymentType: DeploymentType = await checkDeploymentTypeFlag(
      flags.deploymentType,
      'Select the type of deployment to use',
    )

    switch (deploymentType) {
      case DeploymentType.deployedTx:
        txNetwork = await checkOptionFlag(
          supportedNetworksOptions,
          flags.txNetwork,
          'Select the network on which the transaction was executed',
        )
        tx = await checkTransactionHashFlag(
          flags.tx,
          'Enter the hash of transaction that deployed the original contract',
        )
        break

      case DeploymentType.deploymentConfig:
        deploymentConfigFile = await checkStringFlag(flags.deploymentConfig, 'Enter the config file to use')
        if (await fs.pathExists(deploymentConfigFile as string)) {
          deploymentConfig = (await fs.readJson(deploymentConfigFile as string)) as DeploymentConfig
        } else {
          throw new Error('The file "' + (deploymentConfigFile as string) + '" does not exist.')
        }

        break

      case DeploymentType.createConfig:
        chainType = await checkOptionFlag(
          supportedNetworksOptions,
          undefined,
          'Select the primary network of the contract (does not prepend chainId to tokenIds)',
        )
        chainId = '0x' + networks[chainType].holographId.toString(16).padStart(8, '0')
        deploymentConfig.config.chainType = chainId
        salt =
          '0x' +
          remove0x(await checkTokenIdFlag(undefined, 'Enter a bytes32 hash or number to use for salt hash')).padStart(
            64,
            '0',
          )

        deploymentConfig.config.salt = salt
        bytecodeType = await checkBytecodeTypeFlag(undefined, 'Select the bytecode type to deploy')

        // Select the contract type to deploy
        switch (bytecodeType) {
          case BytecodeType.Custom:
            contractType = await checkOptionFlag(contractTypes, undefined, 'Select the contract type to create')
            break
          case BytecodeType.SampleERC20:
            contractType = 'HolographERC20'
            break
          case BytecodeType.SampleERC721:
            contractType = 'HolographERC721'
            break
          case BytecodeType.HolographERC721Drop:
            contractType = 'HolographERC721Drop'
            break
          default:
            contractType = 'HolographERC721Drop'
        }

        contractTypeHash = '0x' + web3.utils.asciiToHex(contractType).slice(2).padStart(64, '0')
        deploymentConfig.config.contractType = contractTypeHash
        byteCode =
          bytecodeType === BytecodeType.Custom
            ? await getCodeFromFile(
                'Provide the filename containing the hex encoded string of the bytecode you want to use',
              )
            : bytecodes[bytecodeType]

        switch (contractType) {
          case 'HolographERC20':
            tokenName = await checkStringFlag(undefined, 'Enter the token name to use')
            tokenSymbol = await checkStringFlag(undefined, 'Enter the token symbol to use')
            domainSeperator = tokenName
            decimals = await checkNumberFlag(
              undefined,
              'Enter the number of decimals [0-18] to use. The recommended number is 18.',
            )
            if (decimals > 18 || decimals < 0) {
              throw new Error('Invalid decimals was provided: ' + decimals.toString())
            }

            switch (bytecodeType) {
              case BytecodeType.SampleERC20:
                eventConfig = configureEvents([1, 2]) // [HolographERC20Event.bridgeIn, HolographERC20Event.bridgeOut]
                sourceInitCode = generateInitCode(['address'], [userWallet.address])
                break
              case BytecodeType.Custom:
                eventConfig = configureEvents(
                  (
                    await inquirer.prompt([
                      {
                        type: 'checkbox',
                        message: 'Select the events to enable',
                        name: 'erc20events',
                        choices: HolographERC20Event,
                      },
                    ])
                  ).erc20events,
                )
                sourceInitCode = await getCodeFromFile(
                  'Provide the filename containing the hex encoded string of the initCode you want to use',
                )
                break
            }

            initCode = generateInitCode(
              ['string', 'string', 'uint8', 'uint256', 'string', 'string', 'bool', 'bytes'],
              [
                tokenName, // string memory tokenName
                tokenSymbol, // string memory tokenSymbol
                decimals, // uint8 decimals
                eventConfig, // uint256 eventConfig
                domainSeperator,
                domainVersion,
                false, // bool skipInit
                sourceInitCode,
              ],
            )
            break

          case 'HolographERC721':
            collectionName = await checkStringFlag(undefined, 'Enter the name of the collection')
            collectionSymbol = await checkStringFlag(undefined, 'Enter the collection symbol to use')
            royaltyBps = await checkNumberFlag(
              undefined,
              'Enter the percentage of royalty to collect in basis points. (1 = 0.01%, 10000 = 100%)',
            )
            if (royaltyBps > 10_000 || royaltyBps < 0) {
              throw new Error('Invalid royalty basis points was provided: ' + royaltyBps.toString())
            }

            switch (bytecodeType) {
              case BytecodeType.CxipERC721:
                eventConfig = configureEvents([1, 2, 7]) // [HolographERC721Event.bridgeIn, HolographERC721Event.bridgeOut, HolographERC721Event.afterBurn]
                sourceInitCode = generateInitCode(
                  ['bytes32', 'address', 'bytes'],
                  [
                    '0x' + web3.utils.asciiToHex('CxipERC721').slice(2).padStart(64, '0'),
                    await this.networkMonitor.registryContract.address,
                    generateInitCode(['address'], [userWallet.address]),
                  ],
                )
                break

              case BytecodeType.SampleERC721:
                eventConfig = configureEvents([1, 2, 7]) // [HolographERC721Event.bridgeIn, HolographERC721Event.bridgeOut, HolographERC721Event.afterBurn]
                sourceInitCode = generateInitCode(['address'], [userWallet.address])
                break

              case BytecodeType.Custom:
                eventConfig = configureEvents(
                  (
                    await inquirer.prompt([
                      {
                        type: 'checkbox',
                        message: 'Select the events to enable',
                        name: 'erc721events',
                        choices: HolographERC721Event,
                      },
                    ])
                  ).erc721events,
                )
                sourceInitCode = await getCodeFromFile(
                  'Provide the filename containing the hex encoded string of the initCode you want to use',
                )
                break
            }

            initCode = generateInitCode(
              ['string', 'string', 'uint16', 'uint256', 'bool', 'bytes'],
              [
                collectionName, // string memory contractName
                collectionSymbol, // string memory contractSymbol
                royaltyBps, // uint16 contractBps
                eventConfig, // uint256 eventConfig
                false, // bool skipInit
                sourceInitCode,
              ],
            )

            break

          case 'HolographERC721Drop':
            // TODO: Make this logic more modular
            // collectionName = await checkStringFlag(undefined, 'Enter the name of the Drop')
            // collectionSymbol = await checkStringFlag(undefined, 'Enter the collection symbol to use')
            // const numOfEditions = await checkNumberFlag(undefined, 'Enter the number of editions in this drop')

            // royaltyBps = await checkNumberFlag(
            //   undefined,
            //   'Enter the percentage of royalty to collect in basis points. (1 = 0.01%, 10000 = 100%)',
            // )
            // if (royaltyBps > 10_000 || royaltyBps < 0) {
            //   throw new Error('Invalid royalty basis points was provided: ' + royaltyBps.toString())
            // }

            // TODO: Connect wallet to the provider
            const account = userWallet.connect(this.networkMonitor.providers['ethereumTestnetGoerli'])

            // TODO: Deploy a metadata renderer contract
            const rendererByteCode = '' // TODO: Get the bytecode from the metadata renderer contract
            const renderAbi = JSON.parse(fs.readFileSync(`./src/abi/develop/EditionMetadataRenderer.json`).toString())
            const rendererFactory = new ContractFactory(renderAbi, rendererByteCode, account)

            // If your contract requires constructor args, you can specify them here
            const metadataRenderer = await rendererFactory.deploy()
            console.log(metadataRenderer)

            initCode = generateInitCode(
              [
                'tuple(address,address,address,string,string,address,address,uint64,uint16,bytes[],address,bytes)',
                'bool',
              ],
              [
                [
                  '0x0000000000000000000000000000000000000000', // TODO: holographFeeManager - this.networkMonitor.holographFeeManager.address
                  '0x0000000000000000000000000000000000000000', // holographERC721TransferHelper
                  '0x000000000000AAeB6D7670E522A718067333cd4E', // marketFilterAddress
                  'Holograph ERC721 Drop Collection', // contractName
                  'hDROP', // contractSymbol
                  userWallet.address, // initialOwner
                  userWallet.address, // fundsRecipient
                  10, // number of editions
                  500, // royalty percentage in bps
                  [], // setupCalls (TODO: used to set sales config)
                  metadataRenderer.address, // metadataRenderer
                  generateInitCode(['string', 'string', 'string'], ['decscription', 'imageURI', 'animationURI']), // metadataRendererInit
                ],
                false, // skipInit
              ],
            ) // initCode

            break
        }

        deploymentConfig.config.byteCode = byteCode
        deploymentConfig.config.initCode = initCode

        configHash = sha3(
          '0x' +
            (deploymentConfig.config.contractType as string).slice(2) +
            (deploymentConfig.config.chainType as string).slice(2) +
            (deploymentConfig.config.salt as string).slice(2) +
            sha3(deploymentConfig.config.byteCode as string).slice(2) +
            sha3(deploymentConfig.config.initCode as string).slice(2) +
            (deploymentConfig.signer as string).slice(2),
        )
        configHashBytes = web3.utils.hexToBytes(configHash)
        needToSign = true

        break
    }

    const targetNetwork: string = await checkOptionFlag(
      supportedNetworksOptions,
      flags.targetNetwork,
      'Select the network on which the contract will be executed',
      txNetwork,
    )

    if (needToSign) {
      sig = await this.networkMonitor.wallets[targetNetwork].signMessage(configHashBytes!)
      signature = strictECDSA({
        r: '0x' + sig.slice(2, 66),
        s: '0x' + sig.slice(66, 130),
        v: '0x' + sig.slice(130, 132),
      } as Signature)
      deploymentConfig.signature.r = signature.r
      deploymentConfig.signature.s = signature.s
      deploymentConfig.signature.v = Number.parseInt(signature.v, 16)
    }

    if (deploymentType === DeploymentType.deployedTx) {
      CliUx.ux.action.start('Retrieving transaction details from "' + (txNetwork as string) + '" network')
      const deploymentTransaction = await this.networkMonitor.providers[txNetwork as string].getTransaction(
        tx as string,
      )
      deploymentConfig = decodeDeploymentConfigInput(deploymentTransaction.data)
      CliUx.ux.action.stop()
    }

    configHash = sha3(
      '0x' +
        (deploymentConfig.config.contractType as string).slice(2) +
        (deploymentConfig.config.chainType as string).slice(2) +
        (deploymentConfig.config.salt as string).slice(2) +
        sha3(deploymentConfig.config.byteCode as string).slice(2) +
        sha3(deploymentConfig.config.initCode as string).slice(2) +
        (deploymentConfig.signer as string).slice(2),
    )

    if (deploymentType !== DeploymentType.deploymentConfig) {
      const configFilePrompt: any = await inquirer.prompt([
        {
          name: 'shouldSave',
          message: 'Would you like to export/save the deployment config file?',
          type: 'confirm',
          default: true,
        },
      ])
      if (configFilePrompt.shouldSave) {
        deploymentConfigFile = await checkStringFlag(
          undefined,
          'Enter the path and file where to save (ie ./deploymentConfig.json)',
        )
        await fs.ensureFile(deploymentConfigFile)
        await fs.writeFile(deploymentConfigFile, JSON.stringify(deploymentConfig, undefined, 2), 'utf8')
        this.log('File successfully saved to "' + deploymentConfigFile + '"')
      }
    }

    CliUx.ux.action.start('Checking that contract is not already deployed on "' + targetNetwork + '" network')
    const contractAddress: string = await this.networkMonitor.registryContract
      .connect(this.networkMonitor.providers[targetNetwork])
      .getContractTypeAddress(configHash)
    CliUx.ux.action.stop()
    if (contractAddress !== zeroAddress) {
      throw new Error('Contract already deployed at ' + contractAddress + ' on "' + targetNetwork + '" network')
    }

    const blockchainPrompt: any = await inquirer.prompt([
      {
        name: 'shouldContinue',
        message: 'Next steps submit the transaction, would you like to proceed?',
        type: 'confirm',
        default: true,
      },
    ])
    if (!blockchainPrompt.shouldContinue) {
      throw new Error('Dropping command, no blockchain transactions executed')
    }

    CliUx.ux.action.start('Deploying contract')
    const receipt: TransactionReceipt | null = await this.networkMonitor.executeTransaction({
      network: targetNetwork,
      contract: this.networkMonitor.factoryContract.connect(this.networkMonitor.providers[targetNetwork]),
      methodName: 'deployHolographableContract',
      args: [deploymentConfig.config, deploymentConfig.signature, deploymentConfig.signer],
      waitForReceipt: true,
    })
    CliUx.ux.action.stop()

    if (receipt === null) {
      throw new Error('failed to confirm that the transaction was mined')
    } else {
      const logs: any[] | undefined = this.networkMonitor.decodeBridgeableContractDeployedEvent(
        receipt,
        this.networkMonitor.factoryAddress,
      )
      if (logs === undefined) {
        throw new Error('failed to extract transfer event from transaction receipt')
      } else {
        const deploymentAddress = logs[0] as string
        this.log(`Contract has been deployed to address ${deploymentAddress} on ${targetNetwork} network`)
        this.exit()
      }
    }
  }
}
