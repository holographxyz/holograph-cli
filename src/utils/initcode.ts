import {ethers} from 'ethers'

export function generateInitCode(vars: string[], vals: any[]): string {
  return ethers.utils.defaultAbiCoder.encode(vars, vals)
}

export function generateMetadataRendererInitCode(description: string, imageURI: string, animationURI: string): any {
  return generateInitCode(['string', 'string', 'string'], [description, imageURI, animationURI])
}

/* eslint-disable-next-line max-params */
export function generateHolographDropERC721InitCode(
  contractType: string, // HolographDropERC721
  registryAddress: string,
  erc721TransferHelper: string,
  initialOwner: string,
  fundsRecipient: string,
  numOfEditions: number,
  royaltyBps: number,
  salesConfig: any,
  metadataRendererAddress: string,
  metadataRendererInit: any,
): any {
  return generateInitCode(
    ['bytes32', 'address', 'bytes'],
    [
      contractType,
      registryAddress,
      generateInitCode(
        [
          'tuple(address,address,address,uint64,uint16,tuple(uint104,uint32,uint64,uint64,uint64,uint64,bytes32),address,bytes)',
        ],
        [
          [
            erc721TransferHelper,
            initialOwner,
            fundsRecipient,
            numOfEditions,
            royaltyBps,
            salesConfig,
            metadataRendererAddress,
            metadataRendererInit,
          ],
        ],
      ),
    ],
  )
}

export function generateHolographERC721InitCode(
  collectionName: string,
  collectionSymbol: string,
  royaltyBps: number,
  eventConfig: any,
  skipInit: boolean,
  holographDropERC721InitCode: any,
): any {
  return generateInitCode(
    ['string', 'string', 'uint16', 'uint256', 'bool', 'bytes'],
    [collectionName, collectionSymbol, royaltyBps, eventConfig, skipInit, holographDropERC721InitCode],
  )
}

// NOTE: Please keep this as a reference for how to generate the init code for the HolographDropERC721 contract in-line
// generateInitCode(
//   ['string', 'string', 'uint16', 'uint256', 'bool', 'bytes'],
//   [
//     collectionName, // string memory contractName
//     collectionSymbol, // string memory contractSymbol
//     royaltyBps, // uint16 contractBps
//     dropEventsEnabled(), // uint256 eventConfig - dropEventsEnabled
//     false, // bool skipInit
//     generateInitCode(
//       ['bytes32', 'address', 'bytes'],
//       [
//         // eslint-disable-next-line unicorn/prefer-string-slice
//         '0x' + web3.utils.asciiToHex('HolographDropERC721').substring(2).padStart(64, '0'),
//         this.networkMonitor.registryAddress,
//         generateInitCode(
//           [
//             'tuple(address,address,address,uint64,uint16,tuple(uint104,uint32,uint64,uint64,uint64,uint64,bytes32),address,bytes)',
//           ],
//           [
//             [
//               '0x0000000000000000000000000000000000000000', // erc721TransferHelper
//               userWallet.address, // initialOwner
//               userWallet.address, // fundsRecipient
//               numOfEditions, // number of editions
//               royaltyBps, // percentage of royalties in bps
//               salesConfig,
//               metadataRenderer.address, // metadataRenderer
//               generateInitCode(['string', 'string', 'string'], [description, imageURI, animationURI]), // metadataRendererInit
//             ],
//           ],
//         ),
//       ],
//     ),
//   ],
// )
