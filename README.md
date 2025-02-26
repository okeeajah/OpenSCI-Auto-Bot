# OpenSCI Auto Bot

Automated bot for OpenSCI token claiming and voting on Base Sepolia testnet. This tool helps automate your interaction with OpenSCI contracts to claim tokens and vote on projects.

## Features

- Claim tokens from OpenSCI faucets
- Vote on specific OpenSCI projects with customizable vote distributions
- Multiple account support (via private keys)
- Proxy support for IP rotation
- Auto-retry mechanism for failed transactions
- Token balance checking
- Scheduled daily operations

## Prerequisites

- Node.js (v14 or higher)
- npm (Node Package Manager)
- Base Sepolia ETH for gas fees

## Installation

1. Clone the repository
```bash
git clone https://github.com/airdropinsiders/OpenSCI-Auto-Bot.git
cd OpenSCI-Auto-Bot
```

2. Install dependencies
```bash
npm install
```

3. Create configuration files:
   - `pk.txt`: Add your private keys (one per line)
   - `proxies.txt`: (Optional) Add your proxies (one per line)

## Private Key Format

Add one private key per line in `pk.txt`:
```
0x123abc...
0x456def...
```

## Proxy Format

Add one proxy per line in `proxies.txt` using one of these formats:
```
ip:port
username:password@ip:port
http://ip:port
http://username:password@ip:port
socks5://username:password@ip:port
```

## Usage

Run the bot:
```bash
npm start
```

The interactive menu will provide the following options:
1. Claim tokens from faucet
2. Vote on projects
3. Both claim tokens and vote
4. Check balances
5. Schedule daily operations
6. Exit

## Contract Addresses

- Voting Contract: `0x672e69f8ED6eA070f5722d6c77940114cc901938`
- Faucet Contract: `0x43808E0766f88332535FF8326F52e4734de35F0e`
- Voting Token: `0x3E933b66904F83b6E91a9511877C99b43584adA3`

## Vote Distribution

The bot is configured to vote for the following projects:
- `0xe5d033db611ae3f5682ace7285860a6ceb1195d5f80f2721a82d4baff67daddb`: 4 tokens
- `0xb99bb4429ce45c2cf000bc98f847741c88603e234f6099d78fe47c2b50738776`: 2 tokens
- `0x8689005e34728a5f6027d7c12bd49ef51fa54d62971bf6e5490fbaaaf85a1e21`: 2 tokens
- `0xf712336c9a04915c7b25b30412d0fb8613a417cd8a94f00ca0b2da73e1704949`: 2 tokens

## Security Notice

- **Never share your private keys**
- Test with small amounts first
- Use a dedicated wallet for bot operations
- Make sure you have enough ETH for gas fees

## License

MIT

## Disclaimer

This tool is provided for educational purposes only. Use at your own risk. The authors are not responsible for any loss of funds or other damages that may occur from using this software.
