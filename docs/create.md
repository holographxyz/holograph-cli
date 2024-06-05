# `holograph create`

Create Holographable contracts and NFTs.

- [`holograph create`](#holograph-create)
- [`holograph create:contract`](#holograph-createcontract)
- [`holograph create:nft`](#holograph-createnft)

## `holograph create`

Create Holographable contracts and NFTs.

```
USAGE
  $ holograph create [--env mainnet|testnet|develop|experimental]

FLAGS
  --env=<option>  [default: testnet] Holograph environment to use
                  <options: mainnet|testnet|develop|experimental>

DESCRIPTION
  Create Holographable contracts and NFTs.

EXAMPLES
  $ holograph create --env mainnet|testnet|develop|experimental

  $ holograph create:contract --env mainnet|testnet|develop|experimental

  $ holograph create:nft --env mainnet|testnet|develop|experimental
```

_See code: [src/commands/create/index.ts](https://github.com/holographxyz/holograph-cli/blob/v0.0.12/src/commands/create/index.ts)_

## `holograph create:contract`

Deploy a Holographable contract.

```
USAGE
  $ holograph create:contract [--tx <value>] [--txNetwork
    seiTestnetArctic|lineaTestnetSepolia|mantleTestnetSepolia|lineaTestnetGoerli|zoraTestnetSepolia|baseTestnetSepolia|a
    rbitrumTestnetSepolia|optimismTestnetSepolia|ethereumTestnetSepolia|baseTestnetGoerli|zoraTestnetGoerli|mantleTestne
    t|optimismTestnetGoerli|arbitrumTestnetGoerli|ethereumTestnetGoerli|polygonTestnet|avalancheTestnet|binanceSmartChai
    nTestnet] [--targetNetwork seiTestnetArctic|lineaTestnetSepolia|mantleTestnetSepolia|lineaTestnetGoerli|zoraTestnetS
    epolia|baseTestnetSepolia|arbitrumTestnetSepolia|optimismTestnetSepolia|ethereumTestnetSepolia|baseTestnetGoerli|zor
    aTestnetGoerli|mantleTestnet|optimismTestnetGoerli|arbitrumTestnetGoerli|ethereumTestnetGoerli|polygonTestnet|avalan
    cheTestnet|binanceSmartChainTestnet] [--deploymentType deployedTx|deploymentConfig|createConfig] [--deploymentConfig
    <value>] [--env mainnet|testnet|develop|experimental]

FLAGS
  --deploymentConfig=<value>
      The config file to use

  --deploymentType=<option>
      The type of deployment to use
      <options: deployedTx|deploymentConfig|createConfig>

  --env=<option>
      [default: testnet] Holograph environment to use
      <options: mainnet|testnet|develop|experimental>

  --targetNetwork=<option>
      The network on which the contract will be executed
      <options: seiTestnetArctic|lineaTestnetSepolia|mantleTestnetSepolia|lineaTestnetGoerli|zoraTestnetSepolia|baseTestne
      tSepolia|arbitrumTestnetSepolia|optimismTestnetSepolia|ethereumTestnetSepolia|baseTestnetGoerli|zoraTestnetGoerli|ma
      ntleTestnet|optimismTestnetGoerli|arbitrumTestnetGoerli|ethereumTestnetGoerli|polygonTestnet|avalancheTestnet|binanc
      eSmartChainTestnet>

  --tx=<value>
      The hash of transaction that deployed the original contract

  --txNetwork=<option>
      The network on which the transaction was executed
      <options: seiTestnetArctic|lineaTestnetSepolia|mantleTestnetSepolia|lineaTestnetGoerli|zoraTestnetSepolia|baseTestne
      tSepolia|arbitrumTestnetSepolia|optimismTestnetSepolia|ethereumTestnetSepolia|baseTestnetGoerli|zoraTestnetGoerli|ma
      ntleTestnet|optimismTestnetGoerli|arbitrumTestnetGoerli|ethereumTestnetGoerli|polygonTestnet|avalancheTestnet|binanc
      eSmartChainTestnet>

DESCRIPTION
  Deploy a Holographable contract.

EXAMPLES
  $ holograph create:contract --deploymentType="deployedTx" --tx="0xdb8b393dd18a71b386c8de75b87310c0c8ded0c57cf6b4c5bab52873d54d1e8a" --txNetwork="ethereumTestnetSepolia" --env mainnet|testnet|develop|experimental
```

_See code: [src/commands/create/contract.ts](https://github.com/holographxyz/holograph-cli/blob/v0.0.12/src/commands/create/contract.ts)_

## `holograph create:nft`

Mint a Holographable NFT.

```
USAGE
  $ holograph create:nft [--collectionAddress <value>] [--tokenId <value>] [--uriType ipfs|https|arweave] [--uri
    <value>] [--network seiTestnetArctic|lineaTestnetSepolia|mantleTestnetSepolia|lineaTestnetGoerli|zoraTestnetSepolia|
    baseTestnetSepolia|arbitrumTestnetSepolia|optimismTestnetSepolia|ethereumTestnetSepolia|baseTestnetGoerli|zoraTestne
    tGoerli|mantleTestnet|optimismTestnetGoerli|arbitrumTestnetGoerli|ethereumTestnetGoerli|polygonTestnet|avalancheTest
    net|binanceSmartChainTestnet] [--env mainnet|testnet|develop|experimental]

FLAGS
  --collectionAddress=<value>
      The address of the collection smart contract

  --env=<option>
      [default: testnet] Holograph environment to use
      <options: mainnet|testnet|develop|experimental>

  --network=<option>
      Name of network to use
      <options: seiTestnetArctic|lineaTestnetSepolia|mantleTestnetSepolia|lineaTestnetGoerli|zoraTestnetSepolia|baseTestne
      tSepolia|arbitrumTestnetSepolia|optimismTestnetSepolia|ethereumTestnetSepolia|baseTestnetGoerli|zoraTestnetGoerli|ma
      ntleTestnet|optimismTestnetGoerli|arbitrumTestnetGoerli|ethereumTestnetGoerli|polygonTestnet|avalancheTestnet|binanc
      eSmartChainTestnet>

  --tokenId=<value>
      [default: 0] The token id to mint. By default the token id is 0, which mints the next available token id

  --uri=<value>
      The uri of the token, minus the prepend (ie "ipfs://")

  --uriType=<option>
      The token URI type
      <options: ipfs|https|arweave>

DESCRIPTION
  Mint a Holographable NFT.

EXAMPLES
  $ holograph create:nft --network="ethereumTestnetSepolia" --collectionAddress="0xf90c33d5ef88a9d84d4d61f62c913ba192091fe7" --tokenId="0" --uriType="ipfs" --uri="QmfQhPGMAbHL31qcqAEYpSP5gXwXWQa3HZjkNVzZ2mRsRs/metadata.json" --env mainnet|testnet|develop|experimental
```

_See code: [src/commands/create/nft.ts](https://github.com/holographxyz/holograph-cli/blob/v0.0.12/src/commands/create/nft.ts)_
