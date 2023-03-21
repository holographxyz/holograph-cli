import * as inquirer from 'inquirer'
import * as fs from 'fs-extra'

import {CliUx, Command} from '@oclif/core'
import {BytesLike} from '@ethersproject/bytes'
import {TransactionReceipt} from '@ethersproject/abstract-provider'
import {networks} from '@holographxyz/networks'

import {BytecodeType, bytecodes, EditionsMetadataRenderer} from '../../utils/bytecodes'
import {ensureConfigFileIsValid} from '../../utils/config'
import {web3, zeroAddress, remove0x, sha3} from '../../utils/utils'
import {NetworkMonitor} from '../../utils/network-monitor'
import {
  ContractDeployment,
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
  checkUriTypeFlag,
} from '../../utils/validation'
import {ContractFactory, ethers} from 'ethers'
import {UriTypeIndex} from '../../utils/asset-deployment'
import {
  generateHolographDropERC721InitCode,
  generateInitCode,
  generateMetadataRendererInitCode,
  generateOuterInitCode,
} from '../../utils/initcode'

import {SalesConfiguration} from '../../types/drops'

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
    const deploymentConfig: DeploymentConfig = {
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
    let contractDeploymentFile: string | undefined

    let contractDeployment: ContractDeployment = {
      version: '',
      deploymentConfig,
      transactions: [],
      metadata: {} as any,
    } as ContractDeployment

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
    const contractTypes: string[] = ['HolographERC20', 'HolographERC721', 'HolographDropERC721']
    let contractType = ''
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

    let collectionName = ''
    let collectionSymbol = ''
    let royaltyBps = 0

    // Drops
    let numOfEditions = 0
    let description = ''
    let imageURI = ''
    let animationURI = ''

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
        contractDeploymentFile = await checkStringFlag(flags.deploymentConfig, 'Enter the config file to use')
        if (await fs.pathExists(contractDeploymentFile as string)) {
          contractDeployment = (await fs.readJson(contractDeploymentFile as string)) as ContractDeployment
        } else {
          throw new Error('The file "' + (contractDeploymentFile as string) + '" does not exist.')
        }

        break

      case DeploymentType.createConfig:
        chainType = await checkOptionFlag(
          supportedNetworksOptions,
          undefined,
          'Select the primary network of the contract (does not prepend chainId to tokenIds)',
        )

        chainId = '0x' + networks[chainType].holographId.toString(16).padStart(8, '0')
        contractDeployment.deploymentConfig.config.chainType = chainId
        salt =
          '0x' +
          remove0x(await checkTokenIdFlag(undefined, 'Enter a bytes32 hash or number to use for salt hash')).padStart(
            64,
            '0',
          )

        contractDeployment.deploymentConfig.config.salt = salt
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
          case BytecodeType.HolographDropERC721:
            contractType = 'HolographDropERC721'
            break
          default:
            contractType = 'HolographERC721'
            break
        }

        contractTypeHash = '0x' + web3.utils.asciiToHex(contractType).slice(2).padStart(64, '0')
        contractDeployment.deploymentConfig.config.contractType = contractTypeHash
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

          case 'HolographDropERC721': {
            // NOTE: Since the Drop contract is an extension of the HolographERC721 enforcer, the contract type must be updated accordingly
            contractType = 'HolographERC721'
            contractTypeHash = '0x' + web3.utils.asciiToHex(contractType).slice(2).padStart(64, '0')
            contractDeployment.deploymentConfig.config.contractType = contractTypeHash

            // Setup the Drop contract properties
            collectionName = await checkStringFlag(undefined, 'Enter the name of the Drop')
            collectionSymbol = await checkStringFlag(undefined, 'Enter the collection symbol to use')
            description = await checkStringFlag(undefined, 'Enter the description of the drop')
            const uriType: UriTypeIndex =
              UriTypeIndex[
                await checkUriTypeFlag(
                  flags.uriType,
                  'Select the type of uri to use for the image / animation of the drop',
                )
              ]

            const animationPrompt: any = await inquirer.prompt([
              {
                name: 'isAnimation',
                message: 'Is this an animation?',
                type: 'confirm',
                default: false,
              },
            ])
            if (animationPrompt.isAnimation) {
              const animationContentId: string = await checkStringFlag(
                flags.uri,
                'Enter the animation uri of the drop, minus the prepend (ie "ipfs://")',
              )
              animationURI = `${UriTypeIndex[uriType]}://${animationContentId}`
            }

            const contentId: string = await checkStringFlag(
              flags.uri,
              'Enter the image uri of the drop, minus the prepend (ie "ipfs://")',
            )
            imageURI = `${UriTypeIndex[uriType]}://${contentId}`

            numOfEditions = await checkNumberFlag(
              undefined,
              'Enter the number of editions in this drop. Set to 0 for unlimited editions.',
            )

            royaltyBps = await checkNumberFlag(
              undefined,
              'Enter the percentage of royalty to collect in basis points. (1 = 0.01%, 10000 = 100%)',
            )

            if (royaltyBps > 10_000 || royaltyBps < 0) {
              throw new Error('Invalid royalty basis points was provided: ' + royaltyBps.toString())
            }

            // Setup the sales config
            let salesConfig: any = []
            const salesConfigPrompt: any = await inquirer.prompt([
              {
                name: 'shouldContinue',
                message: 'Would you like to create a sales config for the drop?',
                type: 'confirm',
                default: false,
              },
            ])
            if (salesConfigPrompt.shouldContinue) {
              // Enter the sales config variables
              const publicSalePrice: string = await checkStringFlag(
                undefined,
                'Enter the price of the drop in ether units',
              )
              const maxSalePurchasePerAddress: number = await checkNumberFlag(
                undefined,
                'Enter the maximum number of editions a user can purchase',
              )
              const publicSaleStart: number = Math.floor(
                new Date(
                  await checkStringFlag(undefined, 'Enter the start time of the sale in the format of YYYY-MM-DD'),
                ).getTime() / 1000,
              )

              const publicSaleEnd: number = Math.floor(
                new Date(
                  await checkStringFlag(undefined, 'Enter the ending time of the sale in the format of YYYY-MM-DD'),
                ).getTime() / 1000,
              )

              const saleConfig: SalesConfiguration = {
                publicSalePrice: ethers.utils.parseEther(publicSalePrice), // in ETH
                maxSalePurchasePerAddress: maxSalePurchasePerAddress, // in number of editions an address can purchase
                publicSaleStart: publicSaleStart, // in unix time
                publicSaleEnd: publicSaleEnd, // in unix time
                presaleStart: 0, // no presale
                presaleEnd: 0, // no presale
                presaleMerkleRoot: '0x0000000000000000000000000000000000000000000000000000000000000000', // No presale
              }

              salesConfig = Object.values(saleConfig)
            }

            // Connect wallet to the provider
            const provider = this.networkMonitor.providers[chainType]
            const account = userWallet.connect(provider)

            // Deploy a metadata renderer contract
            // TODO: this needs to be removed in the future and a reference to the deployed EditionsMetadataRendererProxy needs to be made here
            const renderAbi = JSON.parse(fs.readFileSync(`./src/abi/develop/EditionsMetadataRenderer.json`).toString())
            const rendererFactory = new ContractFactory(renderAbi, EditionsMetadataRenderer.bytecode, account)
            const metadataRenderer = await rendererFactory.deploy()
            this.log(`Deployed metadata renderer contract at ${metadataRenderer.address}`)

            const metadataRendererInitCode = generateMetadataRendererInitCode(description, imageURI, animationURI)
            const holographDropERC721InitCode = generateHolographDropERC721InitCode(
              // eslint-disable-next-line unicorn/prefer-string-slice
              '0x' + web3.utils.asciiToHex('HolographDropERC721').substring(2).padStart(64, '0'),
              this.networkMonitor.registryAddress,
              '0x0000000000000000000000000000000000000000', // erc721TransferHelper
              '0x0000000000000000000000000000000000000000', // marketFilterAddress (opensea)
              userWallet.address, // initialOwner
              userWallet.address, // fundsRecipient
              numOfEditions, // number of editions
              royaltyBps, // percentage of royalties in bps
              false, // enableOpenSeaRoyaltyRegistry
              salesConfig,
              metadataRenderer.address, // metadataRenderer
              metadataRendererInitCode, // metadataRendererInit
            )

            initCode = generateOuterInitCode(
              collectionName, // string memory contractName
              collectionSymbol, // string memory contractSymbol
              royaltyBps, // uint16 contractBps
              allEventsEnabled(), // uint256 eventConfig -  all 32 bytes of f
              false, // bool skipInit
              holographDropERC721InitCode,
            )

            break
          }
        }

        contractDeployment.deploymentConfig.config.byteCode = byteCode
        deploymentConfig.config.initCode = initCode

        configHash = sha3(
          '0x' +
            (contractDeployment.deploymentConfig.config.contractType as string).slice(2) +
            (contractDeployment.deploymentConfig.config.chainType as string).slice(2) +
            (contractDeployment.deploymentConfig.config.salt as string).slice(2) +
            sha3(contractDeployment.deploymentConfig.config.byteCode as string).slice(2) +
            sha3(contractDeployment.deploymentConfig.config.initCode as string).slice(2) +
            (contractDeployment.deploymentConfig.signer as string).slice(2),
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
      contractDeployment.deploymentConfig.signature.r = signature.r
      contractDeployment.deploymentConfig.signature.s = signature.s
      contractDeployment.deploymentConfig.signature.v = Number.parseInt(signature.v, 16)
    }

    if (deploymentType === DeploymentType.deployedTx) {
      CliUx.ux.action.start('Retrieving transaction details from "' + (txNetwork as string) + '" network')
      const deploymentTransaction = await this.networkMonitor.providers[txNetwork as string].getTransaction(
        tx as string,
      )
      contractDeployment.deploymentConfig = decodeDeploymentConfigInput(deploymentTransaction.data)
      CliUx.ux.action.stop()
    }

    configHash = sha3(
      '0x' +
        (contractDeployment.deploymentConfig.config.contractType as string).slice(2) +
        (contractDeployment.deploymentConfig.config.chainType as string).slice(2) +
        (contractDeployment.deploymentConfig.config.salt as string).slice(2) +
        sha3(contractDeployment.deploymentConfig.config.byteCode as string).slice(2) +
        sha3(contractDeployment.deploymentConfig.config.initCode as string).slice(2) +
        (contractDeployment.deploymentConfig.signer as string).slice(2),
    )

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
    const provider = this.networkMonitor.providers[targetNetwork]
    const account = userWallet.connect(provider)
    const receipt: TransactionReceipt | null = await this.networkMonitor.executeTransaction({
      network: targetNetwork,
      // NOTE: gas can be overriden by here
      gasPrice: ethers.BigNumber.from(100_000_000_000), // 100 gwei
      gasLimit: ethers.BigNumber.from(7_000_000), // 7 million
      contract: this.networkMonitor.factoryContract.connect(provider),
      methodName: 'deployHolographableContract',
      args: [
        contractDeployment.deploymentConfig.config,
        contractDeployment.deploymentConfig.signature,
        account.address,
      ],
      waitForReceipt: true,
    })
    CliUx.ux.action.stop()

    if (receipt === null) {
      throw new Error('Failed to confirm that the transaction was mined')
    } else {
      const logs: any[] | undefined = this.networkMonitor.decodeBridgeableContractDeployedEvent(
        receipt,
        this.networkMonitor.factoryAddress,
      )
      if (logs === undefined) {
        throw new Error('Failed to extract transfer event from transaction receipt')
      } else {
        const deploymentAddress = logs[0] as string
        this.log(`Contract has been deployed to address ${deploymentAddress} on ${targetNetwork} network`)

        // If not reading from previous deployment config, then prepare the deployment config metadata for saving
        if (deploymentType !== DeploymentType.deploymentConfig) {
          // Prepare the deployment config metadata for saving
          contractDeployment = {
            version: 'beta3',
            deploymentConfig: deploymentConfig,
            metadata: {
              collectionName: collectionName,
              collectionSymbol: collectionSymbol,
              royaltyBps: royaltyBps,
              contractType: contractType,

              description: description,
              imageURI: imageURI,
              numOfEditions: numOfEditions,
            },
            transactions: [],
          }
        }

        const configFilePrompt: any = await inquirer.prompt([
          {
            name: 'shouldSave',
            message: 'Would you like to export/save the deployment config file?',
            type: 'confirm',
            default: true,
          },
        ])

        if (configFilePrompt.shouldSave) {
          contractDeployment.transactions.push({
            address: deploymentAddress,
            txHash: receipt.transactionHash,
            blockNumber: receipt.blockNumber,
            network: targetNetwork,
          })

          if (deploymentType !== DeploymentType.deploymentConfig && contractDeploymentFile === undefined) {
            contractDeploymentFile = await checkStringFlag(
              undefined,
              'Enter the path and file where to save (ie ./contractDeployment.json)',
            )
          }

          // NOTE: this will overwrite the file if it already exists (exlaimation mart is okay due to check above)
          await fs.ensureFile(contractDeploymentFile!)
          await fs.writeFile(contractDeploymentFile!, JSON.stringify(contractDeployment, undefined, 2), 'utf8')
          this.log('File successfully saved to "' + contractDeploymentFile + '"')
        }
      }

      this.exit()
    }
  }
}
