`holograph bridge`
==================

Make a bridge request.

* [`holograph bridge`](#holograph-bridge)
* [`holograph bridge:contract`](#holograph-bridgecontract)
* [`holograph bridge:nft`](#holograph-bridgenft)

## `holograph bridge`

Make a bridge request.

```
USAGE
  $ holograph bridge [--env mainnet|testnet|develop|experimental]

FLAGS
  --env=<option>  [default: testnet] Holograph environment to use
                  <options: mainnet|testnet|develop|experimental>

DESCRIPTION
  Make a bridge request.

EXAMPLES
  Learn how to bridge a Holographable contract

    $ holograph bridge:contract --help --env mainnet|testnet|develop|experimental

  Learn how to bridge a Holographable NFT

    $ holograph bridge:nft --help --env mainnet|testnet|develop|experimental
```

_See code: [src/commands/bridge/index.ts](https://github.com/holographxyz/holograph-cli/blob/v0.0.12/src/commands/bridge/index.ts)_

## `holograph bridge:contract`

Bridge a Holographable contract from source chain to destination chain. You need to have a deployment config JSON file. Use the "contract:create" command to create or extract one.

```
USAGE
  $ holograph bridge:contract [--sourceNetwork
    seiTestnetArctic|lineaTestnetSepolia|mantleTestnetSepolia|lineaTestnetGoerli|zoraTestnetSepolia|baseTestnetSepolia|a
    rbitrumTestnetSepolia|optimismTestnetSepolia|ethereumTestnetSepolia|mantleTestnet|polygonTestnet|avalancheTestnet|bi
    nanceSmartChainTestnet] [--destinationNetwork seiTestnetArctic|lineaTestnetSepolia|mantleTestnetSepolia|lineaTestnet
    Goerli|zoraTestnetSepolia|baseTestnetSepolia|arbitrumTestnetSepolia|optimismTestnetSepolia|ethereumTestnetSepolia|ma
    ntleTestnet|polygonTestnet|avalancheTestnet|binanceSmartChainTestnet] [--deploymentConfig <value>] [--env
    mainnet|testnet|develop|experimental]

FLAGS
  --deploymentConfig=<value>     The config file to use
  --destinationNetwork=<option>  The network on which the contract will be deployed
                                 <options:
                                 seiTestnetArctic|lineaTestnetSepolia|mantleTestnetSepolia|lineaTestnetGoerli|zoraTestne
                                 tSepolia|baseTestnetSepolia|arbitrumTestnetSepolia|optimismTestnetSepolia|ethereumTestn
                                 etSepolia|mantleTestnet|polygonTestnet|avalancheTestnet|binanceSmartChainTestnet>
  --env=<option>                 [default: testnet] Holograph environment to use
                                 <options: mainnet|testnet|develop|experimental>
  --sourceNetwork=<option>       The network from which contract deploy request will be sent
                                 <options:
                                 seiTestnetArctic|lineaTestnetSepolia|mantleTestnetSepolia|lineaTestnetGoerli|zoraTestne
                                 tSepolia|baseTestnetSepolia|arbitrumTestnetSepolia|optimismTestnetSepolia|ethereumTestn
                                 etSepolia|mantleTestnet|polygonTestnet|avalancheTestnet|binanceSmartChainTestnet>

DESCRIPTION
  Bridge a Holographable contract from source chain to destination chain. You need to have a deployment config JSON
  file. Use the "contract:create" command to create or extract one.

EXAMPLES
  $ holograph bridge:contract --sourceNetwork="ethereumTestnetSepolia" --destinationNetwork="avalancheTestnet" --deploymentConfig="./MyContract.json" --env mainnet|testnet|develop|experimental
```

_See code: [src/commands/bridge/contract.ts](https://github.com/holographxyz/holograph-cli/blob/v0.0.12/src/commands/bridge/contract.ts)_

## `holograph bridge:nft`

Bridge a Holographable NFT from one network to another.

```
USAGE
  $ holograph bridge:nft [--collectionAddress <value>] [--tokenId <value>] [--sourceNetwork
    seiTestnetArctic|lineaTestnetSepolia|mantleTestnetSepolia|lineaTestnetGoerli|zoraTestnetSepolia|baseTestnetSepolia|a
    rbitrumTestnetSepolia|optimismTestnetSepolia|ethereumTestnetSepolia|mantleTestnet|polygonTestnet|avalancheTestnet|bi
    nanceSmartChainTestnet] [--destinationNetwork seiTestnetArctic|lineaTestnetSepolia|mantleTestnetSepolia|lineaTestnet
    Goerli|zoraTestnetSepolia|baseTestnetSepolia|arbitrumTestnetSepolia|optimismTestnetSepolia|ethereumTestnetSepolia|ma
    ntleTestnet|polygonTestnet|avalancheTestnet|binanceSmartChainTestnet] [--env mainnet|testnet|develop|experimental]

FLAGS
  --collectionAddress=<value>    The address of the collection smart contract
  --destinationNetwork=<option>  The destination network which to bridge to
                                 <options:
                                 seiTestnetArctic|lineaTestnetSepolia|mantleTestnetSepolia|lineaTestnetGoerli|zoraTestne
                                 tSepolia|baseTestnetSepolia|arbitrumTestnetSepolia|optimismTestnetSepolia|ethereumTestn
                                 etSepolia|mantleTestnet|polygonTestnet|avalancheTestnet|binanceSmartChainTestnet>
  --env=<option>                 [default: testnet] Holograph environment to use
                                 <options: mainnet|testnet|develop|experimental>
  --sourceNetwork=<option>       The source network from which to bridge
                                 <options:
                                 seiTestnetArctic|lineaTestnetSepolia|mantleTestnetSepolia|lineaTestnetGoerli|zoraTestne
                                 tSepolia|baseTestnetSepolia|arbitrumTestnetSepolia|optimismTestnetSepolia|ethereumTestn
                                 etSepolia|mantleTestnet|polygonTestnet|avalancheTestnet|binanceSmartChainTestnet>
  --tokenId=<value>              The token ID of the NFT to bridge

DESCRIPTION
  Bridge a Holographable NFT from one network to another.

EXAMPLES
  $ holograph bridge:nft --sourceNetwork="ethereumTestnetSepolia" --destinationNetwork="avalancheTestnet" --collectionAddress="0x1318d3420b0169522eB8F3EF0830aceE700A2eda" --tokenId="0x01" --env mainnet|testnet|develop|experimental
```

_See code: [src/commands/bridge/nft.ts](https://github.com/holographxyz/holograph-cli/blob/v0.0.12/src/commands/bridge/nft.ts)_
