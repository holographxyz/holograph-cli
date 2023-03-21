import {Contract, ContractFactory, ethers} from 'ethers'
import {SalesConfiguration} from '../types/drops'
import {bytecodes, EditionsMetadataRenderer} from '../utils/bytecodes'
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
require('dotenv').config()
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
  const numOfEditions = 100
  const royaltyBps = 5000 // 50%
  const publicSalePrice = '0.001' // in ether units
  const maxSalePurchasePerAddress = 1
  const publicSaleStart = 0 // January 1, 1970 beginning of unix time
  const publicSaleEnd = Math.floor(new Date('9999-12-31').getTime() / 1000) // December 31, 9999, which is the maximum representable date in JavaScript

  const saleConfig: SalesConfiguration = {
    publicSalePrice: ethers.utils.parseEther(publicSalePrice), // in ETH
    maxSalePurchasePerAddress: maxSalePurchasePerAddress, // in number of editions an address can purchase
    publicSaleStart: publicSaleStart, // in unix time
    publicSaleEnd: publicSaleEnd, // in unix time
    presaleStart: 0, // no presale
    presaleEnd: 0, // no presale
    presaleMerkleRoot: '0x0000000000000000000000000000000000000000000000000000000000000000', // No presale
  }

  // The sales config must be serialized to an array of it's values to be passed as a tuple when abi encoded
  const salesConfig = Object.values(saleConfig)

  console.log('Deploying metadata renderer contract...')
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
    '0x11b7B5f0Ba1A54b2068c2bDEB3CD1C7d99146f84', // metadataRenderer (using previously deployed contract to save gas)
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
  const chainType = '0x' + networks['avalancheTestnet'].holographId.toString(16).padStart(8, '0') // fuji
  const salt = '0x' + web3.utils.randomHex(32).slice(2).padStart(64, '0') // random salt
  const byteCode = bytecodes['HolographDropERC721']

  const configHash = sha3(
    '0x' +
      (contractType as string).slice(2) +
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

  console.log(`Deployment config: ${JSON.stringify(deploymentConfig)}`)

  console.log(`Preparing to deploy HolographDropERC721 contract...`)
  // Get the ENVIRONMENT
  const ENVIRONMENT = 'develop'

  // Get the ABI
  const abis = await getABIs(ENVIRONMENT)

  // Set the contract address
  const contractAddress = '0x90425798cc0e33932f11edc3EeDBD4f3f88DFF64' // HolographFactoryProxy

  // Create a contract instance
  const contract = new Contract(contractAddress, abis.HolographFactoryABI, signer)

  console.log('Calling deployHolographableContract...')
  // Call the deployHolographableContract function
  async function callDeployHolographableContract() {
    try {
      const tx = await contract.deployHolographableContract(
        deploymentConfig.config,
        deploymentConfig.signature,
        signer.address,
      )
      console.log('Transaction:', tx)
      const receipt = await tx.wait()
      console.log('Transaction receipt:', receipt)
    } catch (error) {
      console.error('Error:', error)
    }
  }
  await callDeployHolographableContract()
})()
