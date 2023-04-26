import {Contract, ethers} from 'ethers'
import {SalesConfiguration} from '../types/drops'
import {bytecodes} from '../utils/bytecodes'
import {
  generateHolographDropERC721InitCode,
  generateHolographERC721InitCode,
  generateMetadataRendererInitCode,
} from '../utils/initcode'
import {allEventsEnabled, sha3, web3} from '../utils/utils'
import {networks} from '@holographxyz/networks'
import {strictECDSA, Signature} from '../utils/signature'
import {DeploymentConfig} from '../utils/contract-deployment'
import {getABIs} from '../utils/contracts'
import {TransactionReceipt, TransactionResponse} from '@ethersproject/abstract-provider'
import {decodeBridgeableContractDeployedEvent} from '../events/events'
import {getEnvironment} from '@holographxyz/environment'
require('dotenv').config()

const HOLOGRAPH_FACTORY_PROXY_ADDRESS = '0x90425798cc0e33932f11edc3EeDBD4f3f88DFF64'
const METADATA_RENDERER_ADDRESS = '0x03714aCb8E3325E43d967A2549541295a672d999' // EditionsMetadataRendererProxy

/**
 * This script is used to create a new Drop contract on the Holograph protocol.
 * The script will create a new HolographERC721 contract, and then create a new Drop contract that extends the HolographERC721 contract.
 * This script is meant to be an internal tool to be used for testing purposes and to provide an example of how to create a Drop contract using ethers.js.
 */
;(async () => {
  // Create a provider using the provider URL from the .env file
  const provider = new ethers.providers.JsonRpcProvider(process.env.SCRIPT_PROVIDER_URL)

  // Create a signer using the private key from the .env file
  const signer = new ethers.Wallet(process.env.PRIVATE_KEY!, provider)

  // NOTE: Since the Drop contract is an extension of the HolographERC721 enforcer, the contract type must be updated accordingly
  const contractType = 'HolographERC721'
  const contractTypeHash = '0x' + web3.utils.asciiToHex(contractType).slice(2).padStart(64, '0')

  // Set the static values for the test
  const collectionName = 'My Collection'
  const collectionSymbol = 'MYC'
  const description = 'My Description'
  const imageURI = 'ipfs://asdf'
  const animationURI = ''
  const numOfEditions = 1000
  const royaltyBps = 5000 // 50%
  const publicSalePrice = '1000000' // in USDC with 6 decimals
  const maxSalePurchasePerAddress = 100
  const publicSaleStart = 0 // January 1, 1970 beginning of unix time
  const publicSaleEnd = Math.floor(new Date('9999-12-31').getTime() / 1000) // December 31, 9999, which is the maximum representable date in JavaScript

  const saleConfig: SalesConfiguration = {
    publicSalePrice: ethers.BigNumber.from(publicSalePrice), // in USD
    maxSalePurchasePerAddress: maxSalePurchasePerAddress, // in number of editions an address can purchase
    publicSaleStart: publicSaleStart, // in unix time
    publicSaleEnd: publicSaleEnd, // in unix time
    presaleStart: 0, // no presale
    presaleEnd: 0, // no presale
    presaleMerkleRoot: '0x0000000000000000000000000000000000000000000000000000000000000000', // No presale
  }

  // The sales config must be serialized to an array of it's values to be passed as a tuple when abi encoded
  const salesConfig = Object.values(saleConfig)

  // NOTE: Disabled to save gas by using previously deployed metadata renderer contract
  // console.log('Deploying metadata renderer contract...')
  // Deploy a metadata renderer contract
  // TODO: this needs to be removed in the future and a reference to the deployed EditionsMetadataRendererProxy needs to be made here
  // const renderAbi = JSON.parse(fs.readFileSync(`./src/abi/develop/EditionsMetadataRenderer.json`).toString())
  // const rendererFactory = new ContractFactory(renderAbi, EditionsMetadataRenderer.bytecode, signer)
  // const metadataRenderer = await rendererFactory.deploy()
  // console.log(`Deployed metadata renderer contract at ${metadataRenderer.address}`)

  const metadataRendererInitCode = generateMetadataRendererInitCode(description, imageURI, animationURI)
  const holographDropERC721InitCode = generateHolographDropERC721InitCode(
    // eslint-disable-next-line unicorn/prefer-string-slice
    '0x' + web3.utils.asciiToHex('HolographDropERC721').substring(2).padStart(64, '0'),
    '0xAE27815bCf7ccA7191Cb55a6B86576aeDC462bBB', // holographRegistryProxy
    '0x0000000000000000000000000000000000000000', // erc721TransferHelper
    '0x0000000000000000000000000000000000000000', // marketFilterAddress (opensea)
    signer.address, // initialOwner
    signer.address, // fundsRecipient
    numOfEditions, // number of editions
    royaltyBps, // percentage of royalties in bps
    false, // enableOpenSeaRoyaltyRegistry
    salesConfig,
    METADATA_RENDERER_ADDRESS, // metadataRenderer (using previously deployed contract to save gas)
    metadataRendererInitCode, // metadataRendererInit
  )

  const initCode = generateHolographERC721InitCode(
    collectionName, // string memory contractName
    collectionSymbol, // string memory contractSymbol
    royaltyBps, // uint16 contractBps
    allEventsEnabled(), // uint256 eventConfig -  all 32 bytes of f
    false, // bool skipInit
    holographDropERC721InitCode,
  )

  // Deployment config
  console.log('Creating deployment config...')
  const chainType = '0x' + networks.avalancheTestnet.holographId.toString(16).padStart(8, '0') // fuji
  const salt = '0x' + web3.utils.randomHex(32).slice(2).padStart(64, '0') // random salt
  const byteCode = bytecodes.HolographDropERC721

  const configHash = sha3(
    '0x' +
      (contractTypeHash as string).slice(2) +
      (chainType as string).slice(2) +
      (salt as string).slice(2) +
      sha3(byteCode as string).slice(2) +
      sha3(initCode as string).slice(2) +
      (signer.address as string).slice(2),
  )
  const configHashBytes = web3.utils.hexToBytes(configHash)
  const sig = await signer.signMessage(configHashBytes!)
  const signature: Signature = strictECDSA({
    r: '0x' + sig.slice(2, 66),
    s: '0x' + sig.slice(66, 130),
    v: '0x' + sig.slice(130, 132),
  })

  const deploymentConfig: DeploymentConfig = {
    config: {
      contractType: contractTypeHash,
      chainType: chainType,
      salt: salt,
      byteCode: byteCode,
      initCode: initCode,
    },
    signature: {
      r: signature.r,
      s: signature.s,
      v: Number.parseInt(signature.v, 16),
    },
    signer: signer.address,
  }

  console.log(`Deployment config: ${(JSON.stringify(deploymentConfig), null, 2)}`)
  console.log(`Preparing to deploy HolographDropERC721 contract...`)

  // Get the ENVIRONMENT
  const ENVIRONMENT = getEnvironment()

  // Get the ABI
  const abis = await getABIs(ENVIRONMENT)

  // Set the contract address
  const factoryProxyAddress = HOLOGRAPH_FACTORY_PROXY_ADDRESS // HolographFactoryProxy

  // Create a contract instance
  const contract = new Contract(factoryProxyAddress, abis.HolographFactoryABI, signer)

  console.log('Calling deployHolographableContract...')
  try {
    const tx: TransactionResponse = await contract.deployHolographableContract(
      deploymentConfig.config,
      deploymentConfig.signature,
      signer.address,
    )
    console.log('Transaction:', tx)
    const receipt: TransactionReceipt = await tx.wait()
    console.log('Transaction receipt:', receipt)

    if (receipt === null) {
      throw new Error('Failed to confirm that the transaction was mined')
    } else {
      const logs: any[] | undefined = decodeBridgeableContractDeployedEvent(receipt, HOLOGRAPH_FACTORY_PROXY_ADDRESS)
      if (logs === undefined) {
        throw new Error('Failed to extract transfer event from transaction receipt')
      } else {
        const deploymentAddress = logs[0] as string
        console.log(`Contract has been deployed to address ${deploymentAddress} on ${'targetNetwork'} network`)

        console.log('Connecting new contract to HolographDropERC721 interface...')
        // Attach the Holographer interface to the newly deployed contract address
        const holographDrop = new Contract(deploymentAddress, abis.HolographDropERC721ABI, signer)
        console.log('HolographDropERC721 contract instance:', holographDrop)

        console.log('Setting price oracle...')
        const setPriceOracleTx: TransactionResponse = await holographDrop.setDropsPriceOracle(
          '0x812963cF94bE79d21614ef39cD456A9Abcc3f510',
        )
        console.log('Transaction:', setPriceOracleTx.hash)
        const setPriceOracleReceipt: TransactionReceipt = await setPriceOracleTx.wait()
        console.log('Transaction receipt:', setPriceOracleReceipt)
      }
    }
  } catch (error) {
    console.error('Error:', error)
  }
})()
