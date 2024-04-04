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
* [Overview](#overview)
* [Usage](#usage)
* [Commands](#commands)
* [Command Topics](#command-topics)
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
# Command Topics

* [`holograph bridge`](docs/bridge.md) - Make a bridge request.
* [`holograph config`](docs/config.md) - Initialize the Holograph CLI with a config file. If no flags are passed, the CLI will prompt you for the required information.
* [`holograph create`](docs/create.md) - Create Holographable contracts and NFTs.
* [`holograph faucet`](docs/faucet.md) - Request Testnet HLG from a faucet.
* [`holograph help`](docs/help.md) - Display help for holograph.
* [`holograph operator`](docs/operator.md) - Listen for jobs and execute jobs.
* [`holograph status`](docs/status.md) - Get the status of a contract or NFT.

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
