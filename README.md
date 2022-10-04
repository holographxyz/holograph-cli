# oclif-hello-world

oclif example Hello World CLI

[![oclif](https://img.shields.io/badge/cli-oclif-brightgreen.svg)](https://oclif.io)
[![Version](https://img.shields.io/npm/v/oclif-hello-world.svg)](https://npmjs.org/package/oclif-hello-world)
[![CircleCI](https://circleci.com/gh/oclif/hello-world/tree/main.svg?style=shield)](https://circleci.com/gh/oclif/hello-world/tree/main)
[![Downloads/week](https://img.shields.io/npm/dw/oclif-hello-world.svg)](https://npmjs.org/package/oclif-hello-world)
[![License](https://img.shields.io/npm/l/oclif-hello-world.svg)](https://github.com/oclif/hello-world/blob/main/package.json)

<!-- toc -->
* [oclif-hello-world](#oclif-hello-world)
* [Usage](#usage)
* [Commands](#commands)
<!-- tocstop -->

# Usage

<!-- usage -->
```sh-session
$ npm install -g holo-cli
$ holo COMMAND
running command...
$ holo (--version)
holo-cli/0.0.1 darwin-arm64 node-v18.9.0
$ holo --help [COMMAND]
USAGE
  $ holo COMMAND
...
```
<!-- usagestop -->

# Commands

<!-- commands -->
* [`holo analyze`](#holo-analyze)
* [`holo bridge`](#holo-bridge)
* [`holo bridge:contract`](#holo-bridgecontract)
* [`holo bridge:nft`](#holo-bridgenft)
* [`holo config`](#holo-config)
* [`holo config:networks`](#holo-confignetworks)
* [`holo config:user`](#holo-configuser)
* [`holo config:view`](#holo-configview)
* [`holo deploy`](#holo-deploy)
* [`holo deploy:contract`](#holo-deploycontract)
* [`holo help [COMMAND]`](#holo-help-command)
* [`holo indexer`](#holo-indexer)
* [`holo operator`](#holo-operator)
* [`holo operator:recover`](#holo-operatorrecover)
* [`holo plugins`](#holo-plugins)
* [`holo plugins:install PLUGIN...`](#holo-pluginsinstall-plugin)
* [`holo plugins:inspect PLUGIN...`](#holo-pluginsinspect-plugin)
* [`holo plugins:install PLUGIN...`](#holo-pluginsinstall-plugin-1)
* [`holo plugins:link PLUGIN`](#holo-pluginslink-plugin)
* [`holo plugins:uninstall PLUGIN...`](#holo-pluginsuninstall-plugin)
* [`holo plugins:uninstall PLUGIN...`](#holo-pluginsuninstall-plugin-1)
* [`holo plugins:uninstall PLUGIN...`](#holo-pluginsuninstall-plugin-2)
* [`holo plugins:update`](#holo-pluginsupdate)
* [`holo propagator`](#holo-propagator)
* [`holo status`](#holo-status)
* [`holo status:contract`](#holo-statuscontract)
* [`holo status:nft`](#holo-statusnft)

## `holo analyze`

Extract all operator jobs and get their status

```
USAGE
  $ holo analyze [--scope <value>] [--output <value>]

FLAGS
  --output=<value>    [default: ./analyze_results.json] specify a file to output the results to (ie
                      "~/Desktop/analyze_results.json")
  --scope=<value>...  single-line JSON object array of blocks to analyze "[{ network: string, startBlock: number,
                      endBlock: number }]"

DESCRIPTION
  Extract all operator jobs and get their status

EXAMPLES
  $ holo analyze --scope='[{"network":"goerli","startBlock":10857626,"endBlock":11138178},{"network":"mumbai","startBlock":26758573,"endBlock":27457918},{"network":"fuji","startBlock":11406945,"endBlock":12192217}]'
```

_See code: [dist/commands/analyze/index.ts](https://github.com/cxip-labs/holo-cli/blob/v0.0.1/dist/commands/analyze/index.ts)_

## `holo bridge`

Make a bridge request

```
USAGE
  $ holo bridge

DESCRIPTION
  Make a bridge request

EXAMPLES
  $ holo bridge

  $ holo bridge:contract
```

_See code: [dist/commands/bridge/index.ts](https://github.com/cxip-labs/holo-cli/blob/v0.0.1/dist/commands/bridge/index.ts)_

## `holo bridge:contract`

Bridge a Holographable contract from source chain to destination chain

```
USAGE
  $ holo bridge:contract [--sourceNetwork <value>] [--destinationNetwork <value>] [--tx <value>] [--txNetwork
    <value>] [--deploymentType <value>]

FLAGS
  --deploymentType=<value>      The type of deployment to use: [deployedTx, deploymentConfig]
  --destinationNetwork=<value>  The name of destination network, where the bridge request is sent to
  --sourceNetwork=<value>       The name of source network, from which to make the bridge request
  --tx=<value>                  The hash of transaction that deployed the original collection
  --txNetwork=<value>           The network on which the transaction was executed

DESCRIPTION
  Bridge a Holographable contract from source chain to destination chain

EXAMPLES
  $ holo bridge:contract --tx="0x42703541786f900187dbf909de281b4fda7ef9256f0006d3c11d886e6e678845"
```

_See code: [dist/commands/bridge/contract.ts](https://github.com/cxip-labs/holo-cli/blob/v0.0.1/dist/commands/bridge/contract.ts)_

## `holo bridge:nft`

Bridge a Holographable NFT from source chain to destination chain

```
USAGE
  $ holo bridge:nft [--sourceNetwork <value>] [--destinationNetwork <value>] [--address <value>] [--tokenId
    <value>]

FLAGS
  --address=<value>             The address of the contract on the source chain
  --destinationNetwork=<value>  The name of destination network, where the bridge request is sent to
  --sourceNetwork=<value>       The name of source network, from which to make the bridge request
  --tokenId=<value>             The ID of the NFT on the source chain (number or 32-byte hex string)

DESCRIPTION
  Bridge a Holographable NFT from source chain to destination chain

EXAMPLES
  $ holo bridge:nft --address="0x1318d3420b0169522eB8F3EF0830aceE700A2eda" --tokenId=1
```

_See code: [dist/commands/bridge/nft.ts](https://github.com/cxip-labs/holo-cli/blob/v0.0.1/dist/commands/bridge/nft.ts)_

## `holo config`

Initialize the Holo command line to become an operator or to bridge collections and NFTs manually

```
USAGE
  $ holo config [--defaultFrom rinkeby|goerli|mumbai|fuji] [--defaultTo rinkeby|goerli|mumbai|fuji] [--url
    <value> --network rinkeby|goerli|mumbai|fuji] [--privateKey <value>] [--fromFile <value>] [--fromJson <value>]

FLAGS
  --defaultFrom=<option>  Default network to bridge FROM (source network)
                          <options: rinkeby|goerli|mumbai|fuji>
  --defaultTo=<option>    Default network to bridge TO (destination network)
                          <options: rinkeby|goerli|mumbai|fuji>
  --fromFile=<value>      Location of file to load config
  --fromJson=<value>      JSON object to use as the config
  --network=<option>      Network to set
                          <options: rinkeby|goerli|mumbai|fuji>
  --privateKey=<value>    Default account to use when sending all transactions
  --url=<value>           Provider URL of network to set

DESCRIPTION
  Initialize the Holo command line to become an operator or to bridge collections and NFTs manually

EXAMPLES
  $ holo --defaultFrom goerli

  $ holo --defaultFrom goerli --defaultTo mumbai

  $ holo --privateKey abc...def

  $ holo --fromFile ./config.json

  $ holo --fromJson '{"version": "beta1", ...}
```

_See code: [dist/commands/config/index.ts](https://github.com/cxip-labs/holo-cli/blob/v0.0.1/dist/commands/config/index.ts)_

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
  $ holo:networks

  $ holo:networks --output json

  $ holo:networks --output yaml

  $ holo:networks --output clean
```

_See code: [dist/commands/config/networks.ts](https://github.com/cxip-labs/holo-cli/blob/v0.0.1/dist/commands/config/networks.ts)_

## `holo config:user`

View the current user address

```
USAGE
  $ holo config:user [--output clean|json|yaml]

FLAGS
  --output=<option>  Output format
                     <options: clean|json|yaml>

DESCRIPTION
  View the current user address

EXAMPLES
  $ holo:user

  $ holo:user --output json

  $ holo:user --output yaml

  $ holo:user --output clean
```

_See code: [dist/commands/config/user.ts](https://github.com/cxip-labs/holo-cli/blob/v0.0.1/dist/commands/config/user.ts)_

## `holo config:view`

View the current configuration state of the Holo command line

```
USAGE
  $ holo config:view [--output clean|json|yaml]

FLAGS
  --output=<option>  Output format
                     <options: clean|json|yaml>

DESCRIPTION
  View the current configuration state of the Holo command line

EXAMPLES
  $ holo:view

  $ holo:view --output json

  $ holo:view --output yaml

  $ holo:view --output clean
```

_See code: [dist/commands/config/view.ts](https://github.com/cxip-labs/holo-cli/blob/v0.0.1/dist/commands/config/view.ts)_

## `holo deploy`

Make a deploy request

```
USAGE
  $ holo deploy

DESCRIPTION
  Make a deploy request

EXAMPLES
  $ holo deploy

  $ holo deploy:contract
```

_See code: [dist/commands/deploy/index.ts](https://github.com/cxip-labs/holo-cli/blob/v0.0.1/dist/commands/deploy/index.ts)_

## `holo deploy:contract`

Deploy a Holographable contract

```
USAGE
  $ holo deploy:contract [--tx <value>] [--txNetwork <value>] [--deploymentType <value>]

FLAGS
  --deploymentType=<value>  The type of deployment to use: [deployedTx, deploymentConfig]
  --tx=<value>              The hash of transaction that deployed the original collection
  --txNetwork=<value>       The network on which the transaction was executed

DESCRIPTION
  Deploy a Holographable contract

EXAMPLES
  $ holo deploy:contract --tx="0x42703541786f900187dbf909de281b4fda7ef9256f0006d3c11d886e6e678845"
```

_See code: [dist/commands/deploy/contract.ts](https://github.com/cxip-labs/holo-cli/blob/v0.0.1/dist/commands/deploy/contract.ts)_

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

_See code: [@oclif/plugin-help](https://github.com/oclif/plugin-help/blob/v5.1.12/src/commands/help.ts)_

## `holo indexer`

Listen for EVM events and update database network status

```
USAGE
  $ holo indexer [-m listen|manual|auto] [-h <value>] [--healthCheck] [--networks <value>] [-w <value>]

FLAGS
  -h, --host=<value>     [default: http://localhost:9001] The host to listen on
  -m, --mode=<option>    The mode in which to run the indexer
                         <options: listen|manual|auto>
  -w, --warp=<value>     Start from the beginning of the chain
  --healthCheck          Launch server on http://localhost:6000 to make sure command is still running
  --networks=<value>...  Comma separated list of networks to operate on

DESCRIPTION
  Listen for EVM events and update database network status

EXAMPLES
  $ holo indexer --networks="goerli mumbai fuji" --mode=auto
```

_See code: [dist/commands/indexer/index.ts](https://github.com/cxip-labs/holo-cli/blob/v0.0.1/dist/commands/indexer/index.ts)_

## `holo operator`

Listen for EVM events for jobs and process them

```
USAGE
  $ holo operator [-m listen|manual|auto] [--healthCheck] [--sync] [--unsafePassword <value>] [--networks
    <value>]

FLAGS
  -m, --mode=<option>       The mode in which to run the operator
                            <options: listen|manual|auto>
  --healthCheck             Launch server on http://localhost:6000 to make sure command is still running
  --networks=<value>...     Comma separated list of networks to operate on
  --sync                    Start from last saved block position instead of latest block position
  --unsafePassword=<value>  Enter the plain text password for the wallet in the holo cli config

DESCRIPTION
  Listen for EVM events for jobs and process them

EXAMPLES
  $ holo operator --networks="goerli mumbai fuji" --mode=auto
```

_See code: [dist/commands/operator/index.ts](https://github.com/cxip-labs/holo-cli/blob/v0.0.1/dist/commands/operator/index.ts)_

## `holo operator:recover`

Attempt to re-run/recover a particular Operator Job

```
USAGE
  $ holo operator:recover [--network <value>] [--tx <value>]

FLAGS
  --network=<value>  The network on which the transaction was executed
  --tx=<value>       The hash of transaction that we want to attempt to execute

DESCRIPTION
  Attempt to re-run/recover a particular Operator Job

EXAMPLES
  $ holo operator:recover --network="goerli" --tx="0x..."
```

_See code: [dist/commands/operator/recover.ts](https://github.com/cxip-labs/holo-cli/blob/v0.0.1/dist/commands/operator/recover.ts)_

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

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/v2.1.0/src/commands/plugins/index.ts)_

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

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/v2.1.0/src/commands/plugins/inspect.ts)_

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

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/v2.1.0/src/commands/plugins/install.ts)_

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

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/v2.1.0/src/commands/plugins/link.ts)_

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

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/v2.1.0/src/commands/plugins/uninstall.ts)_

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

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/v2.1.0/src/commands/plugins/update.ts)_

## `holo propagator`

Listen for EVM events deploys collections to ther supported networks

```
USAGE
  $ holo propagator [-m listen|manual|auto] [--healthCheck] [--sync] [--unsafePassword <value>] [-w <value>]
    [--networks <value>] [--recover <value>] [--recoverFile <value>]

FLAGS
  -m, --mode=<option>       The mode in which to run the propagator
                            <options: listen|manual|auto>
  -w, --warp=<value>        Start from the beginning of the chain
  --healthCheck             Launch server on http://localhost:6000 to make sure command is still running
  --networks=<value>...     Comma separated list of networks to operate on
  --recover=<value>         [default: []] Provide a JSON array of RecoveryData objects to manually ensure propagation
  --recoverFile=<value>     Filename reference to JSON array of RecoveryData objects to manually ensure propagation
  --sync                    Start from last saved block position instead of latest block position
  --unsafePassword=<value>  Enter the plain text password for the wallet in the holo cli config

DESCRIPTION
  Listen for EVM events deploys collections to ther supported networks

EXAMPLES
  $ holo propagator --networks="rinkeby mumbai fuji" --mode=auto
```

_See code: [dist/commands/propagator/index.ts](https://github.com/cxip-labs/holo-cli/blob/v0.0.1/dist/commands/propagator/index.ts)_

## `holo status`

Get asset status

```
USAGE
  $ holo status

DESCRIPTION
  Get asset status

EXAMPLES
  $ holo status

  $ holo status:contract

  $ holo status:nft
```

_See code: [dist/commands/status/index.ts](https://github.com/cxip-labs/holo-cli/blob/v0.0.1/dist/commands/status/index.ts)_

## `holo status:contract`

Check the status of a contract across all enabled networks

```
USAGE
  $ holo status:contract [--address <value>] [--output csv|json|yaml|]

FLAGS
  --address=<value>  The address of contract to check status of
  --output=<option>  [default: yaml] Define table output type
                     <options: csv|json|yaml|>

DESCRIPTION
  Check the status of a contract across all enabled networks

EXAMPLES
  $ holo status:contract --address="0x5059bf8E4De43ccc0C27ebEc9940e2310E071A78"
```

_See code: [dist/commands/status/contract.ts](https://github.com/cxip-labs/holo-cli/blob/v0.0.1/dist/commands/status/contract.ts)_

## `holo status:nft`

Check the status of an nft across all enabled networks

```
USAGE
  $ holo status:nft [--address <value>] [--id <value>] [--output csv|json|yaml|]

FLAGS
  --address=<value>  The address of contract to check status of
  --id=<value>       Token ID to check
  --output=<option>  [default: yaml] Define table output type
                     <options: csv|json|yaml|>

DESCRIPTION
  Check the status of an nft across all enabled networks

EXAMPLES
  $ holo status:nft --address="0x5059bf8E4De43ccc0C27ebEc9940e2310E071A78" --id=1
```

_See code: [dist/commands/status/nft.ts](https://github.com/cxip-labs/holo-cli/blob/v0.0.1/dist/commands/status/nft.ts)_
<!-- commandsstop -->
