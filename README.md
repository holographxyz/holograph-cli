<div align="center">
  <a href="https://holograph.xyz"><img alt="Holograph" src="https://user-images.githubusercontent.com/21043504/188220186-9c7f55e0-143a-41b4-a6b8-90e8bd54bfd9.png" width=600></a>
  <br />
  <h1>Holograph CLI</h1>
</div>
<p align="center">
</p>



[![oclif](https://img.shields.io/badge/cli-oclif-brightgreen.svg)](https://oclif.io)
[![Version](https://img.shields.io/npm/v/oclif-hello-world.svg)](https://npmjs.org/package/holograph-cli)
[![Downloads/week](https://img.shields.io/npm/dw/oclif-hello-world.svg)](https://npmjs.org/package/holograph-cli)
[![License](https://img.shields.io/npm/l/oclif-hello-world.svg)](https://github.com/oclif/hello-world/blob/main/package.json)



Overview
========

This is a CLI is primarily for operators of the holograph network. The CLI includes tools to move NFTs between networks and view their status.

<!-- toc -->
* [Usage](#usage)
* [Commands](#commands)
<!-- tocstop -->

# Usage

<!-- usage -->
```sh-session
$ npm install -g holograph-cli
$ holograph COMMAND
running command...
$ holograph (--version)
holograph-cli/0.0.1 darwin-arm64 node-v18.9.0
$ holograph --help [COMMAND]
USAGE
  $ holograph COMMAND
...
```
<!-- usagestop -->

# Commands

<!-- commands -->
* [`holograph bridge`](#holograph-bridge)
* [`holograph bridge:contract`](#holograph-bridgecontract)
* [`holograph bridge:nft`](#holograph-bridgenft)
* [`holograph config`](#holograph-config)
* [`holograph config:networks`](#holograph-confignetworks)
* [`holograph config:user`](#holograph-configuser)
* [`holograph config:view`](#holograph-configview)
* [`holograph help [COMMAND]`](#holograph-help-command)
* [`holograph operator`](#holograph-operator)
* [`holograph operator:recover`](#holograph-operatorrecover)
* [`holograph status`](#holograph-status)
* [`holograph status:contract`](#holograph-statuscontract)
* [`holograph status:nft`](#holograph-statusnft)

## `holograph bridge`

Make a bridge request

```
USAGE
  $ holograph bridge

DESCRIPTION
  Make a bridge request

EXAMPLES
  Learn how to bridge a Holographable contract

    $ holograph bridge:contract --help

  Learn how to bridge a Holographable NFT

    $ holograph bridge:nft --help
```

_See code: [dist/commands/bridge/index.ts](https://github.com/holographxyz/holograph-cli/blob/v0.0.1/dist/commands/bridge/index.ts)_

## `holograph bridge:contract`

Bridge a Holographable contract from source chain to destination chain

```
USAGE
  $ holograph bridge:contract [--sourceNetwork rinkeby|goerli|mumbai|fuji] [--destinationNetwork
    rinkeby|goerli|mumbai|fuji] [--tx <value>] [--txNetwork rinkeby|goerli|mumbai|fuji] [--deploymentType <value>]

FLAGS
  --deploymentType=<value>       The type of deployment to use: [deployedTx, deploymentConfig]
  --destinationNetwork=<option>  The name of destination network, where the bridge request is sent to
                                 <options: rinkeby|goerli|mumbai|fuji>
  --sourceNetwork=<option>       The name of source network, from which to make the bridge request
                                 <options: rinkeby|goerli|mumbai|fuji>
  --tx=<value>                   The hash of transaction that deployed the original collection
  --txNetwork=<option>           The network on which the transaction was executed
                                 <options: rinkeby|goerli|mumbai|fuji>

DESCRIPTION
  Bridge a Holographable contract from source chain to destination chain

EXAMPLES
  Bridge a contract using bridge source and destination networks from the config

    $ holograph bridge:contract --tx="0x42703541786f900187dbf909de281b4fda7ef9256f0006d3c11d886e6e678845"

  Bridge a contract and manually set the source and destination networks

    $ holograph bridge:contract --sourceNetwork fuji --destinationNetwork goerli \
      --address="0x1318d3420b0169522eB8F3EF0830aceE700A2eda" --tokenId=1
```

_See code: [dist/commands/bridge/contract.ts](https://github.com/holographxyz/holograph-cli/blob/v0.0.1/dist/commands/bridge/contract.ts)_

## `holograph bridge:nft`

Bridge a Holographable NFT from source chain to destination chain

```
USAGE
  $ holograph bridge:nft [--sourceNetwork rinkeby|goerli|mumbai|fuji] [--destinationNetwork
    rinkeby|goerli|mumbai|fuji] [--address <value>] [--tokenId <value>]

FLAGS
  --address=<value>              The address of the contract on the source chain
  --destinationNetwork=<option>  The name of destination network, where the bridge request is sent to
                                 <options: rinkeby|goerli|mumbai|fuji>
  --sourceNetwork=<option>       The name of source network, from which to make the bridge request
                                 <options: rinkeby|goerli|mumbai|fuji>
  --tokenId=<value>              The ID of the NFT on the source chain (number or 32-byte hex string)

DESCRIPTION
  Bridge a Holographable NFT from source chain to destination chain

EXAMPLES
  Bridge an NFT using bridge source and destination networks from the config

    $ holograph bridge:nft --address="0x1318d3420b0169522eB8F3EF0830aceE700A2eda" --tokenId=1

  Bridge an NFT and manually set the source and destination networks

    $ holograph bridge:nft --sourceNetwork fuji --destinationNetwork goerli \
      --address="0x1318d3420b0169522eB8F3EF0830aceE700A2eda" --tokenId=1
```

_See code: [dist/commands/bridge/nft.ts](https://github.com/holographxyz/holograph-cli/blob/v0.0.1/dist/commands/bridge/nft.ts)_

## `holograph config`

Initialize the Holograph CLI with a config file. If no flags are passed, the CLI will prompt you for the required information.

```
USAGE
  $ holograph config [--defaultFrom rinkeby|goerli|mumbai|fuji] [--defaultTo rinkeby|goerli|mumbai|fuji]
    [--url <value> --network rinkeby|goerli|mumbai|fuji] [--privateKey <value>] [--fromFile <value>] [--fromJson
    <value>]

FLAGS
  --defaultFrom=<option>  Default network to bridge FROM (source network)
                          <options: rinkeby|goerli|mumbai|fuji>
  --defaultTo=<option>    Default network to bridge TO (destination network)
                          <options: rinkeby|goerli|mumbai|fuji>
  --fromFile=<value>      Path to the config file to load
  --fromJson=<value>      JSON object to use as the config
  --network=<option>      Network to set
                          <options: rinkeby|goerli|mumbai|fuji>
  --privateKey=<value>    Default account to use when sending all transactions
  --url=<value>           Provider URL of network to set

DESCRIPTION
  Initialize the Holograph CLI with a config file. If no flags are passed, the CLI will prompt you for the required
  information.

EXAMPLES
  $ holograph config --defaultFrom goerli

  $ holograph config --defaultFrom goerli --defaultTo mumbai

  $ holograph config --privateKey abc...def

  $ holograph config --fromFile ./config.json

  $ holograph config --fromJson '{"version": "beta1", ...}
```

_See code: [dist/commands/config/index.ts](https://github.com/holographxyz/holograph-cli/blob/v0.0.1/dist/commands/config/index.ts)_

## `holograph config:networks`

View the current network config

```
USAGE
  $ holograph config:networks [--output clean|json|yaml]

FLAGS
  --output=<option>  Output format
                     <options: clean|json|yaml>

DESCRIPTION
  View the current network config

EXAMPLES
  $ holograph config:networks

  $ holograph config:networks --output json

  $ holograph config:networks --output yaml

  $ holograph config:networks --output clean
```

_See code: [dist/commands/config/networks.ts](https://github.com/holographxyz/holograph-cli/blob/v0.0.1/dist/commands/config/networks.ts)_

## `holograph config:user`

View the current user information

```
USAGE
  $ holograph config:user [--output clean|json|yaml]

FLAGS
  --output=<option>  Output format
                     <options: clean|json|yaml>

DESCRIPTION
  View the current user information

EXAMPLES
  $ holograph config:user

  $ holograph config:user --output json

  $ holograph config:user --output yaml

  $ holograph config:user --output clean
```

_See code: [dist/commands/config/user.ts](https://github.com/holographxyz/holograph-cli/blob/v0.0.1/dist/commands/config/user.ts)_

## `holograph config:view`

View the current configuration state of the Holograph command line

```
USAGE
  $ holograph config:view [--output clean|json|yaml]

FLAGS
  --output=<option>  Output format
                     <options: clean|json|yaml>

DESCRIPTION
  View the current configuration state of the Holograph command line

EXAMPLES
  $ holograph config:view

  $ holograph config:view --output json

  $ holograph config:view --output yaml

  $ holograph config:view --output clean
```

_See code: [dist/commands/config/view.ts](https://github.com/holographxyz/holograph-cli/blob/v0.0.1/dist/commands/config/view.ts)_

## `holograph help [COMMAND]`

Display help for holograph.

```
USAGE
  $ holograph help [COMMAND] [-n]

ARGUMENTS
  COMMAND  Command to show help for.

FLAGS
  -n, --nested-commands  Include all nested commands in the output.

DESCRIPTION
  Display help for holograph.
```

_See code: [@oclif/plugin-help](https://github.com/oclif/plugin-help/blob/v5.1.12/src/commands/help.ts)_

## `holograph operator`

Listen for EVM events for jobs and process them

```
USAGE
  $ holograph operator [-m listen|manual|auto] [--healthCheck] [--sync] [--unsafePassword <value>] [--networks
    rinkeby|goerli|mumbai|fuji]

FLAGS
  -m, --mode=<option>       The mode in which to run the operator
                            <options: listen|manual|auto>
  --healthCheck             Launch server on http://localhost:6000 to make sure command is still running
  --networks=<option>...    Space separated list of networks to operate on
                            <options: rinkeby|goerli|mumbai|fuji>
  --sync                    Start from last saved block position instead of latest block position
  --unsafePassword=<value>  Enter the plain text password for the wallet in the holograph cli config

DESCRIPTION
  Listen for EVM events for jobs and process them

EXAMPLES
  $ holograph operator --networks="goerli mumbai fuji" --mode=auto
```

_See code: [dist/commands/operator/index.ts](https://github.com/holographxyz/holograph-cli/blob/v0.0.1/dist/commands/operator/index.ts)_

## `holograph operator:recover`

Attempt to re-run/recover a particular Operator Job

```
USAGE
  $ holograph operator:recover [--network rinkeby|goerli|mumbai|fuji] [--tx <value>]

FLAGS
  --network=<option>  The network on which the transaction was executed
                      <options: rinkeby|goerli|mumbai|fuji>
  --tx=<value>        The hash of transaction that we want to attempt to execute

DESCRIPTION
  Attempt to re-run/recover a particular Operator Job

EXAMPLES
  $ holograph operator:recover--network="goerli" --tx="0x..."
```

_See code: [dist/commands/operator/recover.ts](https://github.com/holographxyz/holograph-cli/blob/v0.0.1/dist/commands/operator/recover.ts)_

## `holograph plugins`

List installed plugins.

```
USAGE
  $ holograph plugins [--core]

FLAGS
  --core  Show core plugins.

DESCRIPTION
  List installed plugins.

EXAMPLES
  $ holograph plugins
```

_See code: [dist/commands/status/index.ts](https://github.com/holographxyz/holograph-cli/blob/v0.0.1/dist/commands/status/index.ts)_

## `holograph status:contract`

Check the status of a contract across all networks defined in the config

```
USAGE
  $ holograph status:contract [--address <value>] [--output csv|json|yaml|]

FLAGS
  --address=<value>  The address of contract to check status of
  --output=<option>  [default: yaml] Define table output type
                     <options: csv|json|yaml|>

DESCRIPTION
  Check the status of a contract across all networks defined in the config

EXAMPLES
  $ holograph status:contract --address="0x5059bf8E4De43ccc0C27ebEc9940e2310E071A78"
```

_See code: [dist/commands/status/contract.ts](https://github.com/holographxyz/holograph-cli/blob/v0.0.1/dist/commands/status/contract.ts)_

## `holograph status:nft`

Check the status of an nft across all networks defined in the config

```
USAGE
  $ holograph status:nft [--address <value>] [--id <value>] [--output csv|json|yaml|]

FLAGS
  --address=<value>  The address of contract to check status of
  --id=<value>       Token ID to check
  --output=<option>  [default: yaml] Define table output type
                     <options: csv|json|yaml|>

DESCRIPTION
  Check the status of an nft across all networks defined in the config

EXAMPLES
  $ holograph status:nft --address="0x5059bf8E4De43ccc0C27ebEc9940e2310E071A78" --id=1
```

_See code: [dist/commands/status/nft.ts](https://github.com/holographxyz/holograph-cli/blob/v0.0.1/dist/commands/status/nft.ts)_
<!-- commandsstop -->

## Developing

If you want to build the package directly, or if you want to help [contribute](#contributing) you can do the following:

### Install Dependencies

The required versions of `node` and `yarn` are in the `.tool-version` file.

1. This project uses [asdf](https://asdf-vm.com/) for language/binary versions management. Install following plugins
  - Install [asdf Node plugin](https://github.com/asdf-vm/asdf-nodejs): `asdf plugin add nodejs https://github.com/asdf-vm/asdf-nodejs.git`
  - Install [asdf yarn plugin](https://github.com/twuni/asdf-yarn): `asdf plugin-add yarn`
2. Run `asdf install` to get the required `node` and `yarn` version in the .tool-versions file.
3. Install dependencies with `yarn install`.

### Working with the code

Once everything is installed, you can run `./bin/dev COMMAND` and the respective command in the `/src/commands` file will be run. For example the command `./bin/dev status:nft` will run the file `./src/commands/status/nft.ts` 

```
src
├── abi
│  ├── develop: ABI for development purposes
│  ├── experimental: ABI for breaking changes
│  └── testnet: ABI for public testnets
├── commands
│  ├── bridge: Bridge commands
│  ├── config: Config commands
│  ├── operator: Operator commands
│  └── status: Status command
└── utils: General utility functions
```

### Branches

| Branch                                                                     | Status                                                                            |
|----------------------------------------------------------------------------|-----------------------------------------------------------------------------------|
| [mainnet](https://github.com/holographxyz/holograph-cli/tree/mainnet)      | Accepts PRs from `testnet` or `release/x.x.x` when we intend to deploy to mainnet. |
| [testnet](https://github.com/holographxyz/holograph-cli/tree/testnet)      | Accepts PRs from `develop` that are ready to be deployed to testnet.              |
| [develop](https://github.com/holographxyz/holograph-cli/tree/develop)      | Accepts PRs from `feature/xyz` branches that are experimental or in testing stage. |
| [experimental](https://github.com/holographxyz/holograph-cli/tree/experimental) | Accepts PRs from `feature/xyz`                                                    |

We generally follow [this Git branching model](https://nvie.com/posts/a-successful-git-branching-model/).
Please read the linked post if you're planning to make frequent PRs into this repository.

### The `mainnet` branch

The `mainnet` branch contains the code for our latest "stable" mainnet releases.
Updates from `mainnet` always come from the `testnet` branch.
We only ever update the `mainnet` branch when we intend to deploy code that has been tested on testnets to all mainnet networks supported by the Holograph protocol.
Our update process takes the form of a PR merging the `testnet` branch into the `mainnet` branch.

### The `testnet` branch

The `testnet` branch contains the code that is the latest stable testnet release for all supported testnet networks. This branch is deployed and circulated for beta users of the protocol. Updates are merged in from the `develop` branch once they're ready for broad usage.

### The `develop` branch

Our primary development branch is [`develop`](https://github.com/holographxyz/holograph-cli/tree/develop).
`develop` contains the most up-to-date software that is being tested via experimental network deployments.


### The `experimetnal` branch

This branch is used for deep internal features [`experimental`](https://github.com/holographxyz/holograph-cli/tree/experimental).
`experimetnal` contains experimental features.




## Contributing

### Bugs
If you found a bug please create an issue and provide the required information. Please label your issue with the tag "Bug". We will triage the issues and incorporate fixes.

### Suggestions / Desires
We love that you have ideas! So do we! You can make a ticket in the issues tab and label it as 'enhancement'. You can also join our discord and talk to us directly. 

### Pull Requests

If you do write code and want it integrated in, we ask that you make all PRS into the develop branch. Please review the branch structure section to understand how features make move up the stack. 


## Official Links

- [Website](https://holograph.xyz)
- [App](https://app.holograph.xyz)
- [Docs](https://docs.holograph.xyz)
- [Discord](https://discord.com/invite/holograph)
- [Twitter](https://twitter.com/holographxyz)
- [Mirror](https://mirror.xyz/holographxyz.eth)
