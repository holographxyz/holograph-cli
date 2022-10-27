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

This is a CLI is primarily for operators of the holograph network. The CLI includes tools to move NFTs between networks and view their status.

<!-- toc -->

- [Overview](#overview)
- [Usage](#usage)
- [Commands](#commands)
<!-- tocstop -->

# Usage

<!-- usage -->

```sh-session
$ npm install -g @holographxyz/cli
$ holo COMMAND
running command...
$ holo (--version)
@holographxyz/cli/0.0.1 darwin-x64 node-v18.9.0
$ holo --help [COMMAND]
USAGE
  $ holo COMMAND
...
```

<!-- usagestop -->

# Commands

<!-- commands -->

- [`holo bridge`](#holo-bridge)
- [`holo bridge:contract`](#holo-bridgecontract)
- [`holo bridge:nft`](#holo-bridgenft)
- [`holo config`](#holo-config)
- [`holo config:networks`](#holo-confignetworks)
- [`holo config:user`](#holo-configuser)
- [`holo config:view`](#holo-configview)
- [`holo create`](#holo-create)
- [`holo create:nft`](#holo-createnft)
- [`holo help [COMMAND]`](#holo-help-command)
- [`holo operator`](#holo-operator)
- [`holo operator:bond`](#holo-operatorbond)
- [`holo operator:recover`](#holo-operatorrecover)
- [`holo plugins`](#holo-plugins)
- [`holo plugins:install PLUGIN...`](#holo-pluginsinstall-plugin)
- [`holo plugins:inspect PLUGIN...`](#holo-pluginsinspect-plugin)
- [`holo plugins:install PLUGIN...`](#holo-pluginsinstall-plugin-1)
- [`holo plugins:link PLUGIN`](#holo-pluginslink-plugin)
- [`holo plugins:uninstall PLUGIN...`](#holo-pluginsuninstall-plugin)
- [`holo plugins:uninstall PLUGIN...`](#holo-pluginsuninstall-plugin-1)
- [`holo plugins:uninstall PLUGIN...`](#holo-pluginsuninstall-plugin-2)
- [`holo plugins:update`](#holo-pluginsupdate)
- [`holo status`](#holo-status)
- [`holo status:contract`](#holo-statuscontract)
- [`holo status:nft`](#holo-statusnft)

## `holo bridge`

Make a bridge request

```
USAGE
  $ holo bridge

DESCRIPTION
  Make a bridge request

EXAMPLES
  Learn how to bridge a Holographable contract

    $ holo bridge:contract --help

  Learn how to bridge a Holographable NFT

    $ holo bridge:nft --help
```

_See code: [dist/commands/bridge/index.ts](https://github.com/holographxyz/holograph-cli/blob/v0.0.1/dist/commands/bridge/index.ts)_

## `holo bridge:contract`

Bridge a Holographable contract from source chain to destination chain. You need to have a deployment config JSON file. Use the "contract:create" command to create or extract one.

```
USAGE
  $ holo bridge:contract [--sourceNetwork goerli|mumbai|fuji|rinkeby] [--destinationNetwork
    goerli|mumbai|fuji|rinkeby] [--deploymentConfig <value>]

FLAGS
  --deploymentConfig=<value>     The config file to use
  --destinationNetwork=<option>  The network on which the contract will be deployed
                                 <options: goerli|mumbai|fuji|rinkeby>
  --sourceNetwork=<option>       The network from which contract deploy request will be sent
                                 <options: goerli|mumbai|fuji|rinkeby>

DESCRIPTION
  Bridge a Holographable contract from source chain to destination chain. You need to have a deployment config JSON
  file. Use the "contract:create" command to create or extract one.

EXAMPLES
  $ holo bridge:contract --sourceNetwork="ethereumTestnetGoerli" --destinationNetwork="avalancheTestnet" --deploymentConfig="./MyContract.json"
```

_See code: [dist/commands/bridge/contract.ts](https://github.com/holographxyz/holograph-cli/blob/v0.0.1/dist/commands/bridge/contract.ts)_

## `holo bridge:nft`

Beam a Holographable NFT from source chain to destination chain.

```
USAGE
  $ holo bridge:nft [--collectionAddress <value>] [--tokenId <value>] [--sourceNetwork
    goerli|mumbai|fuji|rinkeby] [--destinationNetwork goerli|mumbai|fuji|rinkeby]

FLAGS
  --collectionAddress=<value>    The address of the collection smart contract
  --destinationNetwork=<option>  The destination network which to beam to
                                 <options: goerli|mumbai|fuji|rinkeby>
  --sourceNetwork=<option>       The source network from which to beam
                                 <options: goerli|mumbai|fuji|rinkeby>
  --tokenId=<value>              The token ID of the NFT to beam

DESCRIPTION
  Beam a Holographable NFT from source chain to destination chain.

EXAMPLES
  $ holo bridge:nft --sourceNetwork="ethereumTestnetGoerli" --destinationNetwork="avalancheTestnet" --collectionAddress="0x1318d3420b0169522eB8F3EF0830aceE700A2eda" --tokenId="0x01"
```

_See code: [dist/commands/bridge/nft.ts](https://github.com/holographxyz/holograph-cli/blob/v0.0.1/dist/commands/bridge/nft.ts)_

## `holo config`

Initialize the Holograph CLI with a config file. If no flags are passed, the CLI will prompt you for the required information.

```
USAGE
  $ holo config [--url <value> --network goerli|mumbai|fuji|rinkeby] [--privateKey <value>] [--fromFile
    <value>] [--fromJson <value>]

FLAGS
  --fromFile=<value>    Path to the config file to load
  --fromJson=<value>    JSON object to use as the config
  --network=<option>    Network to set
                        <options: goerli|mumbai|fuji|rinkeby>
  --privateKey=<value>  Default account to use when sending all transactions
  --url=<value>         Provider URL of network to set

DESCRIPTION
  Initialize the Holograph CLI with a config file. If no flags are passed, the CLI will prompt you for the required
  information.

EXAMPLES
  $ holo config --privateKey abc...def

  $ holo config --fromFile ./config.json

  $ holo config --fromJson '{"version": "beta3", ...}
```

_See code: [dist/commands/config/index.ts](https://github.com/holographxyz/holograph-cli/blob/v0.0.1/dist/commands/config/index.ts)_

## `holo config:networks`

View the current network config

```
USAGE
  $ holo config:networks [--output clean|json|yaml]

FLAGS
  --output=<option>  Output format
                     <options: clean|json|yaml>

DESCRIPTION
  View the current network config

EXAMPLES
  $ holo config:networks

  $ holo config:networks --output json

  $ holo config:networks --output yaml

  $ holo config:networks --output clean
```

_See code: [dist/commands/config/networks.ts](https://github.com/holographxyz/holograph-cli/blob/v0.0.1/dist/commands/config/networks.ts)_

## `holo config:user`

View the current user information

```
USAGE
  $ holo config:user [--output clean|json|yaml]

FLAGS
  --output=<option>  Output format
                     <options: clean|json|yaml>

DESCRIPTION
  View the current user information

EXAMPLES
  $ holo config:user

  $ holo config:user --output json

  $ holo config:user --output yaml

  $ holo config:user --output clean
```

_See code: [dist/commands/config/user.ts](https://github.com/holographxyz/holograph-cli/blob/v0.0.1/dist/commands/config/user.ts)_

## `holo config:view`

View the current configuration state of the Holograph command line

```
USAGE
  $ holo config:view [--output clean|json|yaml]

FLAGS
  --output=<option>  Output format
                     <options: clean|json|yaml>

DESCRIPTION
  View the current configuration state of the Holograph command line

EXAMPLES
  $ holo config:view

  $ holo config:view --output json

  $ holo config:view --output yaml

  $ holo config:view --output clean
```

_See code: [dist/commands/config/view.ts](https://github.com/holographxyz/holograph-cli/blob/v0.0.1/dist/commands/config/view.ts)_

## `holo create`

Create holographable contracts and assets

```
USAGE
  $ holo create

DESCRIPTION
  Create holographable contracts and assets

EXAMPLES
  $ holograph create

  $ holo create:contract

  $ holo create:nft
```

_See code: [dist/commands/create/index.ts](https://github.com/holographxyz/holograph-cli/blob/v0.0.1/dist/commands/create/index.ts)_

## `holo create:nft`

Mint a Holographable NFT

```
USAGE
  $ holo create:nft [--collectionAddress <value>] [--tokenId <value>] [--tokenUriType ipfs|https|arweave]
    [--tokenUri <value>] [--network goerli|mumbai|fuji|rinkeby]

FLAGS
  --collectionAddress=<value>  The address of the collection smart contract
  --network=<option>           Name of network to use
                               <options: goerli|mumbai|fuji|rinkeby>
  --tokenId=<value>            [default: 0] The token id to mint. By default the token id is 0, which mints the next
                               available token id
  --tokenUri=<value>           The uri of the token, minus the prepend (ie "ipfs://")
  --tokenUriType=<option>      The token URI type
                               <options: ipfs|https|arweave>

DESCRIPTION
  Mint a Holographable NFT

EXAMPLES
  $ holo create:nft --network="ethereumTestnetGoerli" --collectionAddress="0xf90c33d5ef88a9d84d4d61f62c913ba192091fe7" --tokenId="0" --tokenUriType="ipfs" --tokenUri="QmfQhPGMAbHL31qcqAEYpSP5gXwXWQa3HZjkNVzZ2mRsRs/metadata.json"
```

_See code: [dist/commands/create/nft.ts](https://github.com/holographxyz/holograph-cli/blob/v0.0.1/dist/commands/create/nft.ts)_

## `holo help [COMMAND]`

Display help for holo.

```
USAGE
  $ holo help [COMMAND] [-n]

ARGUMENTS
  COMMAND  Command to show help for.

FLAGS
  -n, --nested-commands  Include all nested commands in the output.

DESCRIPTION
  Display help for holo.
```

_See code: [@oclif/plugin-help](https://github.com/oclif/plugin-help/blob/v5.1.14/src/commands/help.ts)_

## `holo operator`

Listen for EVM events for jobs and process them

```
USAGE
  $ holo operator [-m listen|manual|auto] [--healthCheck] [--sync] [--unsafePassword <value>] [--networks
    goerli|mumbai|fuji|rinkeby]

FLAGS
  -m, --mode=<option>       The mode in which to run the operator
                            <options: listen|manual|auto>
  --healthCheck             Launch server on http://localhost:6000 to make sure command is still running
  --networks=<option>...    Space separated list of networks to use
                            <options: goerli|mumbai|fuji|rinkeby>
  --sync                    Start from last saved block position instead of latest block position
  --unsafePassword=<value>  Enter the plain text password for the wallet in the holograph cli config

DESCRIPTION
  Listen for EVM events for jobs and process them

EXAMPLES
  $ holo operator --networks ethereumTestnetGoerli polygonTestnet avalancheTestnet --mode=auto
```

_See code: [dist/commands/operator/index.ts](https://github.com/holographxyz/holograph-cli/blob/v0.0.1/dist/commands/operator/index.ts)_

## `holo operator:bond`

Start an operator up into a pod

```
USAGE
  $ holo operator:bond [-n <value>] [--pod <value>] [--amount <value>]

FLAGS
  -n, --network=<value>  The network to bond to
  --amount=<value>       Amount of tokens to deposit
  --pod=<value>          Pod number to join

DESCRIPTION
  Start an operator up into a pod

EXAMPLES
  $ holo operator:bond --network <string> --pod <number> --amount <number>
```

_See code: [dist/commands/operator/bond.ts](https://github.com/holographxyz/holograph-cli/blob/v0.0.1/dist/commands/operator/bond.ts)_

## `holo operator:recover`

Attempt to re-run/recover a particular Operator Job

```
USAGE
  $ holo operator:recover [--network ethereumTestnetGoerli|polygonTestnet|avalancheTestnet|ethereumTestnetRinkeby]
    [--tx <value>]

FLAGS
  --network=<option>  The network on which the transaction was executed
                      <options: ethereumTestnetGoerli|polygonTestnet|avalancheTestnet|ethereumTestnetRinkeby>
  --tx=<value>        The hash of transaction that we want to attempt to execute

DESCRIPTION
  Attempt to re-run/recover a particular Operator Job

EXAMPLES
  $ holo operator:recover --network="ethereumTestnetGoerli" --tx="0x..."
```

_See code: [dist/commands/operator/recover.ts](https://github.com/holographxyz/holograph-cli/blob/v0.0.1/dist/commands/operator/recover.ts)_

## `holo plugins`

List installed plugins.

```
USAGE
  $ holo plugins [--core]

FLAGS
  --core  Show core plugins.

DESCRIPTION
  List installed plugins.

EXAMPLES
  $ holo plugins
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/v2.1.1/src/commands/plugins/index.ts)_

## `holo plugins:install PLUGIN...`

Installs a plugin into the CLI.

```
USAGE
  $ holo plugins:install PLUGIN...

ARGUMENTS
  PLUGIN  Plugin to install.

FLAGS
  -f, --force    Run yarn install with force flag.
  -h, --help     Show CLI help.
  -v, --verbose

DESCRIPTION
  Installs a plugin into the CLI.
  Can be installed from npm or a git url.

  Installation of a user-installed plugin will override a core plugin.

  e.g. If you have a core plugin that has a 'hello' command, installing a user-installed plugin with a 'hello' command
  will override the core plugin implementation. This is useful if a user needs to update core plugin functionality in
  the CLI without the need to patch and update the whole CLI.


ALIASES
  $ holo plugins:add

EXAMPLES
  $ holo plugins:install myplugin

  $ holo plugins:install https://github.com/someuser/someplugin

  $ holo plugins:install someuser/someplugin
```

## `holo plugins:inspect PLUGIN...`

Displays installation properties of a plugin.

```
USAGE
  $ holo plugins:inspect PLUGIN...

ARGUMENTS
  PLUGIN  [default: .] Plugin to inspect.

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

DESCRIPTION
  Displays installation properties of a plugin.

EXAMPLES
  $ holo plugins:inspect myplugin
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/v2.1.1/src/commands/plugins/inspect.ts)_

## `holo plugins:install PLUGIN...`

Installs a plugin into the CLI.

```
USAGE
  $ holo plugins:install PLUGIN...

ARGUMENTS
  PLUGIN  Plugin to install.

FLAGS
  -f, --force    Run yarn install with force flag.
  -h, --help     Show CLI help.
  -v, --verbose

DESCRIPTION
  Installs a plugin into the CLI.
  Can be installed from npm or a git url.

  Installation of a user-installed plugin will override a core plugin.

  e.g. If you have a core plugin that has a 'hello' command, installing a user-installed plugin with a 'hello' command
  will override the core plugin implementation. This is useful if a user needs to update core plugin functionality in
  the CLI without the need to patch and update the whole CLI.


ALIASES
  $ holo plugins:add

EXAMPLES
  $ holo plugins:install myplugin

  $ holo plugins:install https://github.com/someuser/someplugin

  $ holo plugins:install someuser/someplugin
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/v2.1.1/src/commands/plugins/install.ts)_

## `holo plugins:link PLUGIN`

Links a plugin into the CLI for development.

```
USAGE
  $ holo plugins:link PLUGIN

ARGUMENTS
  PATH  [default: .] path to plugin

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

DESCRIPTION
  Links a plugin into the CLI for development.
  Installation of a linked plugin will override a user-installed or core plugin.

  e.g. If you have a user-installed or core plugin that has a 'hello' command, installing a linked plugin with a 'hello'
  command will override the user-installed or core plugin implementation. This is useful for development work.


EXAMPLES
  $ holo plugins:link myplugin
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/v2.1.1/src/commands/plugins/link.ts)_

## `holo plugins:uninstall PLUGIN...`

Removes a plugin from the CLI.

```
USAGE
  $ holo plugins:uninstall PLUGIN...

ARGUMENTS
  PLUGIN  plugin to uninstall

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

DESCRIPTION
  Removes a plugin from the CLI.

ALIASES
  $ holo plugins:unlink
  $ holo plugins:remove
```

## `holo plugins:uninstall PLUGIN...`

Removes a plugin from the CLI.

```
USAGE
  $ holo plugins:uninstall PLUGIN...

ARGUMENTS
  PLUGIN  plugin to uninstall

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

DESCRIPTION
  Removes a plugin from the CLI.

ALIASES
  $ holo plugins:unlink
  $ holo plugins:remove
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/v2.1.1/src/commands/plugins/uninstall.ts)_

## `holo plugins:uninstall PLUGIN...`

Removes a plugin from the CLI.

```
USAGE
  $ holo plugins:uninstall PLUGIN...

ARGUMENTS
  PLUGIN  plugin to uninstall

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

DESCRIPTION
  Removes a plugin from the CLI.

ALIASES
  $ holo plugins:unlink
  $ holo plugins:remove
```

## `holo plugins:update`

Update installed plugins.

```
USAGE
  $ holo plugins:update [-h] [-v]

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

DESCRIPTION
  Update installed plugins.
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/v2.1.1/src/commands/plugins/update.ts)_

## `holo status`

Get the status of a contract or NFT

```
USAGE
  $ holo status

DESCRIPTION
  Get the status of a contract or NFT

EXAMPLES
  Learn how to get the status of a contract

    $ holo status:contract --help

  Learn how to get the status of an NFT

    $ holo status:nft --help
```

_See code: [dist/commands/status/index.ts](https://github.com/holographxyz/holograph-cli/blob/v0.0.1/dist/commands/status/index.ts)_

## `holo status:contract`

Check the status of a contract across all networks defined in the config

```
USAGE
  $ holo status:contract [--address <value>] [--output csv|json|yaml|]

FLAGS
  --address=<value>  The address of contract to check status of
  --output=<option>  [default: yaml] Define table output type
                     <options: csv|json|yaml|>

DESCRIPTION
  Check the status of a contract across all networks defined in the config

EXAMPLES
  $ holo status:contract --address="0x5059bf8E4De43ccc0C27ebEc9940e2310E071A78"
```

_See code: [dist/commands/status/contract.ts](https://github.com/holographxyz/holograph-cli/blob/v0.0.1/dist/commands/status/contract.ts)_

## `holo status:nft`

Check the status of an nft across all networks defined in the config

```
USAGE
  $ holo status:nft [--address <value>] [--id <value>] [--output csv|json|yaml|]

FLAGS
  --address=<value>  The address of contract to check status of
  --id=<value>       Token ID to check
  --output=<option>  [default: yaml] Define table output type
                     <options: csv|json|yaml|>

DESCRIPTION
  Check the status of an nft across all networks defined in the config

EXAMPLES
  $ holo status:nft --address="0x5059bf8E4De43ccc0C27ebEc9940e2310E071A78" --id=1
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
