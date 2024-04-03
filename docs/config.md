# `holograph config`

Initialize the Holograph CLI with a config file. If no flags are passed, the CLI will prompt you for the required information.

- [`holograph config`](#holograph-config)
- [`holograph config:networks`](#holograph-confignetworks)
- [`holograph config:user`](#holograph-configuser)
- [`holograph config:view`](#holograph-configview)

## `holograph config`

Initialize the Holograph CLI with a config file. If no flags are passed, the CLI will prompt you for the required information.

```
USAGE
  $ holograph config [--url <value> --network
    seiTestnetArctic|lineaTestnetSepolia|mantleTestnetSepolia|lineaTestnetGoerli|zoraTestnetSepolia|baseTestnetSepolia|a
    rbitrumTestnetSepolia|optimismTestnetSepolia|ethereumTestnetSepolia|baseTestnetGoerli|zoraTestnetGoerli|mantleTestne
    t|optimismTestnetGoerli|arbitrumTestnetGoerli|ethereumTestnetGoerli|polygonTestnet|avalancheTestnet|binanceSmartChai
    nTestnet] [--privateKey <value>] [--fromFile <value>] [--fromJson <value>]

FLAGS
  --fromFile=<value>    Path to the config file to load
  --fromJson=<value>    JSON object to use as the config
  --network=<option>    Network to set
                        <options: seiTestnetArctic|lineaTestnetSepolia|mantleTestnetSepolia|lineaTestnetGoerli|zoraTestn
                        etSepolia|baseTestnetSepolia|arbitrumTestnetSepolia|optimismTestnetSepolia|ethereumTestnetSepoli
                        a|baseTestnetGoerli|zoraTestnetGoerli|mantleTestnet|optimismTestnetGoerli|arbitrumTestnetGoerli|
                        ethereumTestnetGoerli|polygonTestnet|avalancheTestnet|binanceSmartChainTestnet>
  --privateKey=<value>  Default account to use when sending all transactions
  --url=<value>         Provider URL of network to set

DESCRIPTION
  Initialize the Holograph CLI with a config file. If no flags are passed, the CLI will prompt you for the required
  information.

EXAMPLES
  $ holograph config --privateKey abc...def

  $ holograph config --fromFile ./config.json

  $ holograph config --fromJson '{"version": "beta3", ...}
```

_See code: [src/commands/config/index.ts](https://github.com/holographxyz/holograph-cli/blob/v0.0.12/src/commands/config/index.ts)_

## `holograph config:networks`

View the current network config.

```
USAGE
  $ holograph config:networks [--output clean|json|yaml] [--env mainnet|testnet|develop|experimental]

FLAGS
  --env=<option>     [default: testnet] Holograph environment to use
                     <options: mainnet|testnet|develop|experimental>
  --output=<option>  Output format
                     <options: clean|json|yaml>

DESCRIPTION
  View the current network config.

EXAMPLES
  $ holograph config:networks --env mainnet|testnet|develop|experimental

  $ holograph config:networks --output json --env mainnet|testnet|develop|experimental

  $ holograph config:networks --output yaml --env mainnet|testnet|develop|experimental

  $ holograph config:networks --output clean --env mainnet|testnet|develop|experimental
```

_See code: [src/commands/config/networks.ts](https://github.com/holographxyz/holograph-cli/blob/v0.0.12/src/commands/config/networks.ts)_

## `holograph config:user`

View the current user information.

```
USAGE
  $ holograph config:user [--output clean|json|yaml] [--env mainnet|testnet|develop|experimental]

FLAGS
  --env=<option>     [default: testnet] Holograph environment to use
                     <options: mainnet|testnet|develop|experimental>
  --output=<option>  Output format
                     <options: clean|json|yaml>

DESCRIPTION
  View the current user information.

EXAMPLES
  $ holograph config:user --env mainnet|testnet|develop|experimental

  $ holograph config:user --output json --env mainnet|testnet|develop|experimental

  $ holograph config:user --output yaml --env mainnet|testnet|develop|experimental

  $ holograph config:user --output clean --env mainnet|testnet|develop|experimental
```

_See code: [src/commands/config/user.ts](https://github.com/holographxyz/holograph-cli/blob/v0.0.12/src/commands/config/user.ts)_

## `holograph config:view`

View the current config state of the Holograph CLI.

```
USAGE
  $ holograph config:view [--output clean|json|yaml] [--env mainnet|testnet|develop|experimental]

FLAGS
  --env=<option>     [default: testnet] Holograph environment to use
                     <options: mainnet|testnet|develop|experimental>
  --output=<option>  Output format
                     <options: clean|json|yaml>

DESCRIPTION
  View the current config state of the Holograph CLI.

EXAMPLES
  $ holograph config:view --env mainnet|testnet|develop|experimental

  $ holograph config:view --output json --env mainnet|testnet|develop|experimental

  $ holograph config:view --output yaml --env mainnet|testnet|develop|experimental

  $ holograph config:view --output clean --env mainnet|testnet|develop|experimental
```

_See code: [src/commands/config/view.ts](https://github.com/holographxyz/holograph-cli/blob/v0.0.12/src/commands/config/view.ts)_
