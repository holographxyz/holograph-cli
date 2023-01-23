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

# Overview

The Holograph CLI enables you to interact with Holograph Protocol, in addition to participating as an operator in the Operator Network.

<!-- toc -->

- [Overview](#overview)
- [Usage](#usage)
- [Commands](#commands)
<!-- tocstop -->

# Usage

<!-- usage -->

```sh-session
$ npm install -g @holographxyz/cli
$ holograph COMMAND
running command...
$ holograph (--version)
@holographxyz/cli/0.0.12 darwin-arm64 node-v18.9.0
$ holograph --help [COMMAND]
USAGE
  $ holograph COMMAND
...
```

<!-- usagestop -->

# Commands

<!-- commands -->

- [Overview](#overview)
- [Usage](#usage)
- [Commands](#commands)
  - [`holograph bridge`](#holograph-bridge)
  - [`holograph bridge:contract`](#holograph-bridgecontract)
  - [`holograph bridge:nft`](#holograph-bridgenft)
  - [`holograph config`](#holograph-config)
  - [`holograph config:networks`](#holograph-confignetworks)
  - [`holograph config:user`](#holograph-configuser)
  - [`holograph config:view`](#holograph-configview)
  - [`holograph create`](#holograph-create)
  - [`holograph create:contract`](#holograph-createcontract)
  - [`holograph create:nft`](#holograph-createnft)
  - [`holograph faucet`](#holograph-faucet)
  - [`holograph help [COMMAND]`](#holograph-help-command)
  - [`holograph operator`](#holograph-operator)
  - [`holograph operator:bond`](#holograph-operatorbond)
  - [`holograph operator:recover`](#holograph-operatorrecover)
  - [`holograph operator:unbond`](#holograph-operatorunbond)
  - [`holograph status`](#holograph-status)
  - [`holograph status:contract`](#holograph-statuscontract)
  - [`holograph status:nft`](#holograph-statusnft)
  - [Developing](#developing)
    - [Install Dependencies](#install-dependencies)
    - [Working with the code](#working-with-the-code)
    - [Branches](#branches)
    - [The `mainnet` branch](#the-mainnet-branch)
    - [The `testnet` branch](#the-testnet-branch)
    - [The `develop` branch](#the-develop-branch)
    - [The `experimetnal` branch](#the-experimetnal-branch)
  - [Contributing](#contributing)
    - [Bugs](#bugs)
    - [Suggestions / Desires](#suggestions--desires)
    - [Pull Requests](#pull-requests)
  - [Official Links](#official-links)

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

_See code: [dist/commands/bridge/index.ts](https://github.com/holographxyz/holograph-cli/blob/v0.0.12/dist/commands/bridge/index.ts)_

## `holograph bridge:contract`

Bridge a Holographable contract from source chain to destination chain. You need to have a deployment config JSON file. Use the "contract:create" command to create or extract one.

```
USAGE
  $ holograph bridge:contract [--sourceNetwork goerli|mumbai|fuji] [--destinationNetwork
    goerli|mumbai|fuji] [--deploymentConfig <value>] [--env mainnet|testnet|develop|experimental]

FLAGS
  --deploymentConfig=<value>     The config file to use
  --destinationNetwork=<option>  The network on which the contract will be deployed
                                 <options: goerli|mumbai|fuji>
  --env=<option>                 [default: testnet] Holograph environment to use
                                 <options: mainnet|testnet|develop|experimental>
  --sourceNetwork=<option>       The network from which contract deploy request will be sent
                                 <options: goerli|mumbai|fuji>

DESCRIPTION
  Bridge a Holographable contract from source chain to destination chain. You need to have a deployment config JSON
  file. Use the "contract:create" command to create or extract one.

EXAMPLES
  $ holograph bridge:contract --sourceNetwork="goerli" --destinationNetwork="fuji" --deploymentConfig="./MyContract.json" --env mainnet|testnet|develop|experimental
```

_See code: [dist/commands/bridge/contract.ts](https://github.com/holographxyz/holograph-cli/blob/v0.0.12/dist/commands/bridge/contract.ts)_

## `holograph bridge:nft`

Bridge a Holographable NFT from one network to another.

```
USAGE
  $ holograph bridge:nft [--collectionAddress <value>] [--tokenId <value>] [--sourceNetwork
    goerli|mumbai|fuji] [--destinationNetwork goerli|mumbai|fuji] [--env
    mainnet|testnet|develop|experimental]

FLAGS
  --collectionAddress=<value>    The address of the collection smart contract
  --destinationNetwork=<option>  The destination network which to beam to
                                 <options: goerli|mumbai|fuji>
  --env=<option>                 [default: testnet] Holograph environment to use
                                 <options: mainnet|testnet|develop|experimental>
  --sourceNetwork=<option>       The source network from which to beam
                                 <options: goerli|mumbai|fuji>
  --tokenId=<value>              The token ID of the NFT to beam

DESCRIPTION
  Bridge a Holographable NFT from one network to another.

EXAMPLES
  $ holograph bridge:nft --sourceNetwork="goerli" --destinationNetwork="fuji" --collectionAddress="0x1318d3420b0169522eB8F3EF0830aceE700A2eda" --tokenId="0x01" --env mainnet|testnet|develop|experimental
```

_See code: [dist/commands/bridge/nft.ts](https://github.com/holographxyz/holograph-cli/blob/v0.0.12/dist/commands/bridge/nft.ts)_

## `holograph config`

Initialize the Holograph CLI with a config file. If no flags are passed, the CLI will prompt you for the required information.

```
USAGE
  $ holograph config [--url <value> --network goerli|mumbai|fuji] [--privateKey <value>] [--fromFile
    <value>] [--fromJson <value>]

FLAGS
  --fromFile=<value>    Path to the config file to load
  --fromJson=<value>    JSON object to use as the config
  --network=<option>    Network to set
                        <options: goerli|mumbai|fuji>
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

_See code: [dist/commands/config/index.ts](https://github.com/holographxyz/holograph-cli/blob/v0.0.12/dist/commands/config/index.ts)_

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

_See code: [dist/commands/config/networks.ts](https://github.com/holographxyz/holograph-cli/blob/v0.0.12/dist/commands/config/networks.ts)_

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

_See code: [dist/commands/config/user.ts](https://github.com/holographxyz/holograph-cli/blob/v0.0.12/dist/commands/config/user.ts)_

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

_See code: [dist/commands/config/view.ts](https://github.com/holographxyz/holograph-cli/blob/v0.0.12/dist/commands/config/view.ts)_

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

_See code: [dist/commands/create/index.ts](https://github.com/holographxyz/holograph-cli/blob/v0.0.12/dist/commands/create/index.ts)_

## `holograph create:contract`

Deploy a Holographable contract.

```
USAGE
  $ holograph create:contract [--tx <value>] [--txNetwork goerli|mumbai|fuji] [--targetNetwork
    goerli|mumbai|fuji] [--deploymentType deployedTx|deploymentConfig|createConfig] [--deploymentConfig <value>]
    [--env mainnet|testnet|develop|experimental]

FLAGS
  --deploymentConfig=<value>  The config file to use
  --deploymentType=<option>   The type of deployment to use
                              <options: deployedTx|deploymentConfig|createConfig>
  --env=<option>              [default: testnet] Holograph environment to use
                              <options: mainnet|testnet|develop|experimental>
  --targetNetwork=<option>    The network on which the contract will be executed
                              <options: goerli|mumbai|fuji>
  --tx=<value>                The hash of transaction that deployed the original contract
  --txNetwork=<option>        The network on which the transaction was executed
                              <options: goerli|mumbai|fuji>

DESCRIPTION
  Deploy a Holographable contract.

EXAMPLES
  $ holograph create:contract --deploymentType="deployedTx" --tx="0xdb8b393dd18a71b386c8de75b87310c0c8ded0c57cf6b4c5bab52873d54d1e8a" --txNetwork="goerli" --env mainnet|testnet|develop|experimental
```

_See code: [dist/commands/create/contract.ts](https://github.com/holographxyz/holograph-cli/blob/v0.0.12/dist/commands/create/contract.ts)_

## `holograph create:nft`

Mint a Holographable NFT.

```
USAGE
  $ holograph create:nft [--collectionAddress <value>] [--tokenId <value>] [--tokenUriType ipfs|https|arweave]
    [--tokenUri <value>] [--network goerli|mumbai|fuji] [--env mainnet|testnet|develop|experimental]

FLAGS
  --collectionAddress=<value>  The address of the collection smart contract
  --env=<option>               [default: testnet] Holograph environment to use
                               <options: mainnet|testnet|develop|experimental>
  --network=<option>           Name of network to use
                               <options: goerli|mumbai|fuji>
  --tokenId=<value>            [default: 0] The token id to mint. By default the token id is 0, which mints the next
                               available token id
  --tokenUri=<value>           The uri of the token, minus the prepend (ie "ipfs://")
  --tokenUriType=<option>      The token URI type
                               <options: ipfs|https|arweave>

DESCRIPTION
  Mint a Holographable NFT.

EXAMPLES
  $ holograph create:nft --network="goerli" --collectionAddress="0xf90c33d5ef88a9d84d4d61f62c913ba192091fe7" --tokenId="0" --tokenUriType="ipfs" --tokenUri="QmfQhPGMAbHL31qcqAEYpSP5gXwXWQa3HZjkNVzZ2mRsRs/metadata.json" --env mainnet|testnet|develop|experimental
```

_See code: [dist/commands/create/nft.ts](https://github.com/holographxyz/holograph-cli/blob/v0.0.12/dist/commands/create/nft.ts)_

## `holograph faucet`

Request Testnet HLG from a faucet.

```
USAGE
  $ holograph faucet [--network goerli|mumbai|fuji] [--env mainnet|testnet|develop|experimental]

FLAGS
  --env=<option>      [default: testnet] Holograph environment to use
                      <options: mainnet|testnet|develop|experimental>
  --network=<option>  Name of network to use
                      <options: goerli|mumbai|fuji>

DESCRIPTION
  Request Testnet HLG from a faucet.

EXAMPLES
  $ holograph faucet --network="goerli" --env mainnet|testnet|develop|experimental
```

_See code: [dist/commands/faucet/index.ts](https://github.com/holographxyz/holograph-cli/blob/v0.0.12/dist/commands/faucet/index.ts)_

## `holograph help [COMMAND]`

Display help for holograph.

```
USAGE
  $ holograph help [COMMAND] [-n] [--env mainnet|testnet|develop|experimental]

ARGUMENTS
  COMMAND  Command to show help for.

FLAGS
  -n, --nested-commands  Include all nested commands in the output.
  --env=<option>         [default: testnet] Holograph environment to use
                         <options: mainnet|testnet|develop|experimental>

DESCRIPTION
  Display help for holograph.
```

_See code: [@oclif/plugin-help](https://github.com/oclif/plugin-help/blob/v5.1.18/src/commands/help.ts)_

## `holograph operator`

Listen for jobs and execute jobs.

```
USAGE
  $ holograph operator [-m listen|manual|auto] [--sync] [--unsafePassword <value>] [--networks
    goerli|mumbai|fuji] [--healthCheckPort <value> --healthCheck] [--env mainnet|testnet|develop|experimental]

FLAGS
  -m, --mode=<option>        The mode in which to run the operator
                             <options: listen|manual|auto>
  --env=<option>             [default: testnet] Holograph environment to use
                             <options: mainnet|testnet|develop|experimental>
  --healthCheck              Launch server on http://localhost:6000 to make sure command is still running
  --healthCheckPort=<value>  This flag allows you to choose what port the health check sever is running on.
  --networks=<option>...     Space separated list of networks to use
                             <options: goerli|mumbai|fuji>
  --sync                     Start from last saved block position instead of latest block position
  --unsafePassword=<value>   Enter the plain text password for the wallet in the holograph cli config

DESCRIPTION
  Listen for jobs and execute jobs.

EXAMPLES
  $ holograph operator --networks goerli fuji mumbai --mode=auto --sync --env mainnet|testnet|develop|experimental
```

_See code: [dist/commands/operator/index.ts](https://github.com/holographxyz/holograph-cli/blob/v0.0.12/dist/commands/operator/index.ts)_

## `holograph operator:bond`

Bond in to a pod.

```
USAGE
  $ holograph operator:bond [--network goerli|mumbai|fuji] [--pod <value>] [--amount <value>] [--env
    mainnet|testnet|develop|experimental]

FLAGS
  --amount=<value>    Amount of tokens to deposit
  --env=<option>      [default: testnet] Holograph environment to use
                      <options: mainnet|testnet|develop|experimental>
  --network=<option>  Name of network to use
                      <options: goerli|mumbai|fuji>
  --pod=<value>       Pod number to join

DESCRIPTION
  Bond in to a pod.

EXAMPLES
  $ holograph operator:bond --network <string> --pod <number> --amount <number> --env mainnet|testnet|develop|experimental
```

_See code: [dist/commands/operator/bond.ts](https://github.com/holographxyz/holograph-cli/blob/v0.0.12/dist/commands/operator/bond.ts)_

## `holograph operator:recover`

Attempt to re-run/recover a specific job.

```
USAGE
  $ holograph operator:recover [--host http://localhost:4000] [--network goerli|mumbai|fuji] [--tx <value>] [--healthCheckPort <value>
    --healthCheck] [--env mainnet|testnet|develop|experimental]

FLAGS
  --env=<option>             [default: testnet] Holograph environment to use
                             <options: mainnet|testnet|develop|experimental>
  --healthCheck              Launch server on http://localhost:6000 to make sure command is still running
  --healthCheckPort=<value>  This flag allows you to choose what port the health check sever is running on.
  --network=<option>         The network on which the transaction was executed
                             <options: goerli|mumbai|fuji>
  --tx=<value>               The hash of transaction that we want to attempt to execute
  --host                     The host to send data to

DESCRIPTION
  Attempt to re-run/recover a specific job.

EXAMPLES
  $ holograph operator:recover --network="ethereumTestnetGoerli" --tx="0x..." --env mainnet|testnet|develop|experimental
```

_See code: [dist/commands/operator/recover.ts](https://github.com/holographxyz/holograph-cli/blob/v0.0.12/dist/commands/operator/recover.ts)_

## `holograph operator:unbond`

Un-bond an operator from a pod

```
USAGE
  $ holograph operator:unbond [--env mainnet|testnet|develop|experimental]

FLAGS
  --env=<option>  [default: testnet] Holograph environment to use
                  <options: mainnet|testnet|develop|experimental>

DESCRIPTION
  Un-bond an operator from a pod

EXAMPLES
  $ holograph operator:unbond --env mainnet|testnet|develop|experimental
```

_See code: [dist/commands/operator/unbond.ts](https://github.com/holographxyz/holograph-cli/blob/v0.0.12/dist/commands/operator/unbond.ts)_

## `holograph status`

Get the status of a contract or NFT.

```
USAGE
  $ holograph status [--env mainnet|testnet|develop|experimental]

FLAGS
  --env=<option>  [default: testnet] Holograph environment to use
                  <options: mainnet|testnet|develop|experimental>

DESCRIPTION
  Get the status of a contract or NFT.

EXAMPLES
  Learn how to get the status of a contract

    $ holograph status:contract --help --env mainnet|testnet|develop|experimental

  Learn how to get the status of an NFT

    $ holograph status:nft --help --env mainnet|testnet|develop|experimental
```

_See code: [dist/commands/status/index.ts](https://github.com/holographxyz/holograph-cli/blob/v0.0.12/dist/commands/status/index.ts)_

## `holograph status:contract`

Check the status of a contract across all networks defined in the config.

```
USAGE
  $ holograph status:contract [--address <value>] [--output csv|json|yaml|] [--env
    mainnet|testnet|develop|experimental]

FLAGS
  --address=<value>  The address of contract to check status of
  --env=<option>     [default: testnet] Holograph environment to use
                     <options: mainnet|testnet|develop|experimental>
  --output=<option>  [default: yaml] Define table output type
                     <options: csv|json|yaml|>

DESCRIPTION
  Check the status of a contract across all networks defined in the config.

EXAMPLES
  $ holograph status:contract --address="0x5059bf8E4De43ccc0C27ebEc9940e2310E071A78" --env mainnet|testnet|develop|experimental
```

_See code: [dist/commands/status/contract.ts](https://github.com/holographxyz/holograph-cli/blob/v0.0.12/dist/commands/status/contract.ts)_

## `holograph status:nft`

Check the status of an NFT across all networks defined in the config.

```
USAGE
  $ holograph status:nft [--address <value>] [--id <value>] [--output csv|json|yaml|] [--env
    mainnet|testnet|develop|experimental]

FLAGS
  --address=<value>  The address of contract to check status of
  --env=<option>     [default: testnet] Holograph environment to use
                     <options: mainnet|testnet|develop|experimental>
  --id=<value>       Token ID to check
  --output=<option>  [default: yaml] Define table output type
                     <options: csv|json|yaml|>

DESCRIPTION
  Check the status of an NFT across all networks defined in the config.

EXAMPLES
  $ holograph status:nft --address="0x5059bf8E4De43ccc0C27ebEc9940e2310E071A78" --id=1 --env mainnet|testnet|develop|experimental
```

_See code: [dist/commands/status/nft.ts](https://github.com/holographxyz/holograph-cli/blob/v0.0.12/dist/commands/status/nft.ts)_

<!-- commandsstop -->

## Developing

If you want to build the package directly, or if you want to help [contribute](#contributing), please do the following:

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

| Branch                                                                          | Status                                                                             |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| [mainnet](https://github.com/holographxyz/holograph-cli/tree/mainnet)           | Accepts PRs from `testnet` or `release/x.x.x` when we intend to deploy to mainnet. |
| [testnet](https://github.com/holographxyz/holograph-cli/tree/testnet)           | Accepts PRs from `develop` that are ready to be deployed to testnet.               |
| [develop](https://github.com/holographxyz/holograph-cli/tree/develop)           | Accepts PRs from `feature/xyz` branches that are experimental or in testing stage. |
| [experimental](https://github.com/holographxyz/holograph-cli/tree/experimental) | Accepts PRs from `feature/xyz`                                                     |

We generally follow [this Git branching model](https://nvie.com/posts/a-successful-git-branching-model/).
Please read the linked post if you're planning to make frequent PRs into this repository.

### The `mainnet` branch

The `mainnet` branch contains the code for our latest "stable" mainnet releases.
Updates from `mainnet` always come from the `testnet` branch.
We only ever update the `mainnet` branch when we intend to deploy code that has been tested on testnets to all mainnet networks supported by Holograph protocol.
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
