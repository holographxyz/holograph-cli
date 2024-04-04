`holograph faucet`
==================

Request Testnet HLG from a faucet.

* [`holograph faucet`](#holograph-faucet)

## `holograph faucet`

Request Testnet HLG from a faucet.

```
USAGE
  $ holograph faucet [--network
    seiTestnetArctic|lineaTestnetSepolia|mantleTestnetSepolia|lineaTestnetGoerli|zoraTestnetSepolia|baseTestnetSepolia|a
    rbitrumTestnetSepolia|optimismTestnetSepolia|ethereumTestnetSepolia|mantleTestnet|polygonTestnet|avalancheTestnet|bi
    nanceSmartChainTestnet] [--env mainnet|testnet|develop|experimental]

FLAGS
  --env=<option>      [default: testnet] Holograph environment to use
                      <options: mainnet|testnet|develop|experimental>
  --network=<option>  Name of network to use
                      <options: seiTestnetArctic|lineaTestnetSepolia|mantleTestnetSepolia|lineaTestnetGoerli|zoraTestnet
                      Sepolia|baseTestnetSepolia|arbitrumTestnetSepolia|optimismTestnetSepolia|ethereumTestnetSepolia|ma
                      ntleTestnet|polygonTestnet|avalancheTestnet|binanceSmartChainTestnet>

DESCRIPTION
  Request Testnet HLG from a faucet.

EXAMPLES
  $ holograph faucet --network="ethereumTestnetSepolia" --env mainnet|testnet|develop|experimental
```

_See code: [src/commands/faucet/index.ts](https://github.com/holographxyz/holograph-cli/blob/v0.0.12/src/commands/faucet/index.ts)_
